import "server-only";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { createId } from "@/lib/id";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export class UploadError extends Error {}

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
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new UploadError(`Storage rejected the upload (${res.status}). ${detail.slice(0, 200)}`);
    }
  } else {
    const full = path.join(localRoot(), key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, Buffer.from(await file.arrayBuffer()));
  }

  return { storageKey: key, mimeType: file.type, sizeBytes: file.size };
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  const config = supabaseConfig();
  if (config) {
    const res = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${storageKey}`, {
      headers: { Authorization: `Bearer ${config.key}` },
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
      headers: { Authorization: `Bearer ${config.key}` },
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
