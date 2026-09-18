"use client";

import { useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Button, Card, CardHeader, cn } from "@/components/ui";
import { clearBrandImageAction, uploadBrandImageAction } from "./actions";

const ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,.ico";

type Kind = "logo" | "favicon";

/**
 * The size each piece of artwork is actually drawn at, with headroom for a
 * high-density screen. A logo sits about 32px tall in the header and a favicon
 * 32px square, so anything beyond this is bytes every visitor pays for and
 * nobody sees.
 */
const TARGET: Record<Kind, { w: number; h: number }> = {
  logo: { w: 600, h: 150 },
  favicon: { w: 256, h: 256 },
};

/**
 * Shrinks a picture in the browser before it is uploaded, keeping its shape and
 * its transparency. Vector and icon files are left alone: an SVG is already
 * small and rasterising it would only make it worse.
 */
async function shrink(file: File, kind: Kind): Promise<File> {
  if (file.type === "image/svg+xml" || file.type.includes("icon")) return file;

  const target = TARGET[kind];
  const source = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
  if (!source) return file;

  const scale = Math.min(target.w / source.naturalWidth, target.h / source.naturalHeight, 1);
  if (scale === 1 && file.size < 120_000) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(source.src);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
}

const COPY: Record<Kind, { title: string; blurb: string; hint: string; frame: string }> = {
  logo: {
    title: "Logo",
    blurb: "Shown in the header, on the sign-in page, on the public enquiry form and in the student portal.",
    hint: "A wide PNG or SVG on a transparent background works best. Around 240 by 64 pixels, up to 2 MB.",
    frame: "h-16 w-48",
  },
  favicon: {
    title: "Favicon",
    blurb: "The small icon on the browser tab and in a bookmark.",
    hint: "A square PNG, SVG or ICO, at least 64 by 64 pixels.",
    frame: "size-16",
  },
};

export function ArtworkPanel({ logo, favicon, version }: { logo: boolean; favicon: boolean; version: string }) {
  return (
    <Card>
      <CardHeader title="Logo and favicon" subtitle="Upload your own artwork, or leave these empty to use the drawn mark." />
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Artwork kind="logo" uploaded={logo} version={version} />
        <Artwork kind="favicon" uploaded={favicon} version={version} />
      </div>
    </Card>
  );
}

function Artwork({ kind, uploaded, version }: { kind: Kind; uploaded: boolean; version: string }) {
  const [open, setOpen] = useState(false);
  const copy = COPY[kind];
  // The version changes whenever the artwork does, which is what busts the cache.
  const src = `/api/brand/${kind}?v=${version}`;

  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3.5">
      <p className="font-display text-sm font-semibold text-ink">{copy.title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted">{copy.blurb}</p>

      <div className={cn("mt-3 grid place-items-center rounded-lg border border-dashed border-line-strong bg-surface p-2", copy.frame)}>
        {/* A fixed cap, because a percentage height cannot resolve inside a centred grid. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`Current ${copy.title.toLowerCase()}`} className="max-h-12 w-auto max-w-full object-contain" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
          {uploaded ? "Replace" : "Upload"}
        </Button>
        {uploaded && <ClearButton kind={kind} />}
        {!uploaded && <span className="text-xs text-muted">Using the drawn mark</span>}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={`Upload a ${copy.title.toLowerCase()}`} description={copy.hint}>
        <UploadForm kind={kind} onDone={() => setOpen(false)} />
      </Modal>
    </div>
  );
}

function UploadForm({ kind, onDone }: { kind: Kind; onDone: () => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const smaller = await shrink(file, kind);
    // Put the smaller picture back on the input, so that is what gets uploaded.
    if (smaller !== file && input.current) {
      const list = new DataTransfer();
      list.items.add(smaller);
      input.current.files = list.files;
    }
    const saved = file.size - smaller.size;
    setName(
      `${file.name} · ${(smaller.size / 1024).toFixed(0)} KB` +
        (saved > 1024 ? ` (resized, down from ${(file.size / 1024).toFixed(0)} KB)` : ""),
    );
    setPreview(URL.createObjectURL(smaller));
    setBusy(false);
  }

  return (
    <ActionForm action={uploadBrandImageAction} submitLabel="Upload" pendingLabel="Uploading…" hideSubmit>
      <input type="hidden" name="kind" value={kind} />

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file && input.current) {
            const list = new DataTransfer();
            list.items.add(file);
            input.current.files = list.files;
            void choose(file);
          }
        }}
        className="rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-5 text-center"
      >
        {preview ? (
          <div className="mx-auto grid max-h-28 place-items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="What you are about to upload" className="h-28 w-full object-contain" />
          </div>
        ) : (
          <p className="text-[13px] text-muted">Drop a file here, or choose one below.</p>
        )}
        {name && <p className="mt-2 text-xs text-muted">{name}</p>}
        <input
          ref={input}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          onChange={(e) => void choose(e.target.files?.[0])}
          aria-label={`${kind === "logo" ? "Logo" : "Favicon"} file`}
          className="mt-3 block w-full text-[13px] file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-brand-700"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Preparing…" : "Upload"}
        </Button>
      </div>
    </ActionForm>
  );
}

function ClearButton({ kind }: { kind: Kind }) {
  return (
    <ActionForm action={clearBrandImageAction} hideSubmit className="inline">
      <input type="hidden" name="kind" value={kind} />
      <button type="submit" className="text-xs text-muted hover:text-stop-500">
        Remove
      </button>
    </ActionForm>
  );
}
