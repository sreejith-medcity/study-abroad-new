import "server-only";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { createId } from "@/lib/id";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function root() {
  return path.resolve(process.env.UPLOAD_DIR ?? "./uploads");
}

export class UploadError extends Error {}

/** Local disk storage. Swap for an S3-compatible adapter in production. */
export async function saveUpload(file: File, folder: string) {
  if (file.size === 0) throw new UploadError("The file is empty.");
  if (file.size > MAX_BYTES) throw new UploadError("Files must be 10 MB or smaller.");
  if (!ALLOWED.includes(file.type)) throw new UploadError("Upload a PDF, JPG, PNG or WebP file.");
  const ext = path.extname(file.name).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
  const key = `${folder}/${createId()}${ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(await file.arrayBuffer()));
  return { storageKey: key, mimeType: file.type, sizeBytes: file.size };
}

export async function readUpload(storageKey: string) {
  const full = path.join(root(), storageKey);
  if (!full.startsWith(root())) throw new Error("Invalid key");
  return readFile(full);
}
