import "server-only";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { createId } from "@/lib/id";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export class UploadError extends Error {}

/** Artwork is smaller and allows the vector and icon formats a logo needs. */
const BRAND_MAX_BYTES = 2 * 1024 * 1024;
const BRAND_ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/x-icon", "image/vnd.microsoft.icon"];

export type SavedFile = { storageKey: string; mimeType: string; sizeBytes: number };

/** Supabase Storage when configured, local disk otherwise (development). */
function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "student-documents";
  return url && key ? { url: url.replace(/\/$/, ""), key, bucket } : null;
}

function localRoot() {
  return path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
}

function validate(file: File) {
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > MAX_BYTES) throw new UploadError("Files must be 10 MB or smaller.");
  if (!ALLOWED.includes(file.type)) throw new UploadError("Upload a PDF, JPG, PNG or WebP file.");
}

export async function saveUpload(file: File, folder: string): Promise<SavedFile> {
  validate(file);
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
  const key = `${folder}/${createId()}${ext}`;
  const config = supabaseConfig();

  if (config) {
    const res = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        apikey: config.key,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!res.ok) throw storageError(res.status, await res.text().catch(() => ""));
  } else {
    const full = path.join(localRoot(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(await file.arrayBuffer()));
  }

  return { storageKey: key, mimeType: file.type, sizeBytes: file.size };
}

/**
 * The logo and the favicon. Kept apart from saveUpload because the rules differ:
 * artwork may be an SVG or an .ico, and it has to stay small enough to sit in the
 * page header without slowing every screen down.
 */
export async function saveBrandImage(file: File, kind: "logo" | "favicon"): Promise<SavedFile> {
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > BRAND_MAX_BYTES) throw new UploadError("Artwork must be 2 MB or smaller.");
  if (!BRAND_ALLOWED.includes(file.type)) throw new UploadError("Upload a PNG, JPG, WebP, SVG or ICO file.");

  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".png";
  const key = `brand/${kind}-${createId()}${ext}`;
  const config = supabaseConfig();

  if (config) {
    const res = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.key}`,
        apikey: config.key,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!res.ok) throw storageError(res.status, await res.text().catch(() => ""));
  } else {
    const full = path.join(localRoot(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(await file.arrayBuffer()));
  }

  return { storageKey: key, mimeType: file.type, sizeBytes: file.size };
}

/**
 * Turns a storage refusal into something a super admin can act on. A row-level
 * security refusal always means the same thing: the key in use is not the service
 * role key, because that one bypasses the bucket's policies.
 */
function storageError(status: number, detail: string) {
  if (/row-level security|AccessDenied|Unauthorized/i.test(detail)) {
    return new UploadError(
      "Supabase refused the upload because the key in use is not the service role key. " +
        "In Supabase, open Project settings, API keys, copy the service_role key, and set it as " +
        "SUPABASE_SERVICE_ROLE_KEY in Hostinger, then redeploy.",
    );
  }
  if (status === 404) {
    return new UploadError(
      `Supabase has no bucket named "${supabaseConfig()?.bucket}". Create it as a private bucket, or set SUPABASE_STORAGE_BUCKET to the right name.`,
    );
  }
  return new UploadError(`Storage rejected the upload (${status}). ${detail.slice(0, 200)}`);
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  const config = supabaseConfig();
  if (config) {
    const res = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${storageKey}`, {
      headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Storage returned ${res.status} for ${storageKey}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const full = path.join(localRoot(), storageKey);
  if (!full.startsWith(localRoot())) throw new Error("Invalid key");
  return readFile(full);
}

export async function deleteUpload(storageKey: string): Promise<void> {
  const config = supabaseConfig();
  if (config) {
    await fetch(`${config.url}/storage/v1/object/${config.bucket}/${storageKey}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
    });
    return;
  }
  await unlink(path.join(localRoot(), storageKey)).catch(() => {
    // already gone; the database record is what matters
  });
}

export function storageBackend() {
  return supabaseConfig() ? "supabase" : "local-disk";
}

/**
 * Writes a tiny object and deletes it again, so an admin can confirm the
 * storage credentials really work rather than only that they are set.
 */
export async function probeStorage(): Promise<{ backend: string; write: "ok"; } | { backend: string; write: "failed"; detail: string }> {
  const backend = storageBackend();
  const key = `_probe/${createId()}.txt`;
  const config = supabaseConfig();
  try {
    if (config) {
      const put = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.key}`,
          apikey: config.key,
          "Content-Type": "text/plain",
          "x-upsert": "true",
        },
        body: "probe",
      });
      if (!put.ok) {
        // Same plain-language reading as an upload, so ?probe=storage is useful on its own.
        const body = await put.text().catch(() => "");
        return { backend, write: "failed", detail: storageError(put.status, body).message };
      }
      await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${config.key}`, apikey: config.key },
      });
    } else {
      const full = path.join(localRoot(), key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, "probe");
      await unlink(full);
    }
    return { backend, write: "ok" };
  } catch (e) {
    return { backend, write: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
