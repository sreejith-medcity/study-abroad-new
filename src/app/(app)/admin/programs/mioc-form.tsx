"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { groupInr } from "@/lib/format";
import { buildMioc, parseDump, type MiocBuild } from "@/lib/mioc";
import type { MiocBatchResult, MiocPrepareResult } from "@/server/mioc-load";
import { miocFinishAction, miocLoadAction, miocPrepareAction } from "./actions";

const BATCH = 1000;
const n = groupInr;

/** The export as text, unpacked first when phpMyAdmin compressed it with gzip. */
async function readExport(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) throw new Error("This is a zip file. Export again from phpMyAdmin with compression set to gzip or none.");
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return file.text();
}

/** Lets the page paint before a long piece of work in the browser. */
const breathe = () => new Promise((r) => setTimeout(r, 30));

/**
 * Brings in the catalogue from the MIOC app's database export.
 *
 * The file is read here, in the browser, and only the catalogue rows are sent
 * on: a full export also carries the app's students, and none of that leaves
 * this page. Check first, which writes nothing; then load, which sends the
 * programs a thousand at a time so no request runs long, and which can be run
 * again from the start if it stops partway.
 */
export function MiocForm() {
  const router = useRouter();
  const built = useRef<MiocBuild | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ build: MiocBuild; prep: MiocPrepareResult } | null>(null);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onCheck() {
    if (!file) return;
    setError(null);
    setDone(null);
    setCheck(null);
    try {
      setBusy("Reading the file…");
      await breathe();
      const text = await readExport(file);
      const tables = parseDump(text);
      if (!tables.tb_courses.length || !tables.tb_universities.length || !tables.tb_destinations.length) {
        throw new Error("This file has no tb_destinations, tb_universities or tb_courses rows. Export those tables from the MIOC database (and tb_main_course for study areas).");
      }
      const build = buildMioc(tables);
      built.current = build;
      setBusy("Checking against the catalogue…");
      const res = await miocPrepareAction({ countries: build.countries, universities: build.universities }, true);
      if (res.error || !res.result) throw new Error(res.error ?? "The check did not come back.");
      setCheck({ build, prep: res.result });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onLoad() {
    const build = built.current;
    if (!build) return;
    setError(null);
    const started = Date.now();
    try {
      setBusy("Setting up countries and universities…");
      const prep = await miocPrepareAction({ countries: build.countries, universities: build.universities }, false);
      if (prep.error || !prep.result) throw new Error(prep.error ?? "Setting up the universities did not come back.");
      const ids = prep.result.ids;
      const total: MiocBatchResult = { created: 0, filled: 0, unchanged: 0, keptResearched: 0, noUniversity: 0 };
      setBusy("Loading programs…");
      setProgress({ done: 0, of: build.programs.length });
      for (let i = 0; i < build.programs.length; i += BATCH) {
        const batch = build.programs.slice(i, i + BATCH);
        const subset: Record<number, string> = {};
        for (const p of batch) if (ids[p.universityMiocId]) subset[p.universityMiocId] = ids[p.universityMiocId];
        // One retry: a dropped connection on batch 60 of 105 should not mean starting again.
        let res = await miocLoadAction(batch, subset).catch((e: Error) => ({ error: e.message, result: undefined }));
        if (res.error) res = await miocLoadAction(batch, subset).catch((e: Error) => ({ error: e.message, result: undefined }));
        if (res.error || !res.result) {
          throw new Error(`Stopped after ${n(i)} of ${n(build.programs.length)} programs: ${res.error ?? "no answer"}. Everything before that is saved. Load again to carry on; what is already in is not duplicated.`);
        }
        for (const k of Object.keys(total) as (keyof MiocBatchResult)[]) total[k] += res.result[k];
        setProgress({ done: Math.min(i + BATCH, build.programs.length), of: build.programs.length });
      }
      const seconds = Math.round((Date.now() - started) / 1000);
      await miocFinishAction({ ...total, programs: build.programs.length, seconds });
      const parts = [
        `${n(total.created)} new programs added as drafts`,
        total.filled ? `${n(total.filled)} already here had empty fields filled` : null,
        total.unchanged ? `${n(total.unchanged)} loaded before and left as they are` : null,
        total.keptResearched ? `${n(total.keptResearched)} left alone because the team researched them by hand` : null,
        total.noUniversity ? `${n(total.noUniversity)} skipped for want of a university` : null,
      ].filter(Boolean);
      setDone(
        `Loaded. ${prep.result.countriesNew.length ? `${prep.result.countriesNew.length} ${prep.result.countriesNew.length === 1 ? "country" : "countries"} added (${prep.result.countriesNew.join(", ")}). ` : ""}${n(prep.result.universitiesNew)} universities added, ${n(prep.result.universitiesHere)} matched to ones already here. ${parts.join("; ")}. Took ${seconds}s.`,
      );
      setCheck(null);
      built.current = null;
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const b = check?.build;
  return (
    <div className="space-y-3" data-mioc>
      <p className="text-sm leading-relaxed text-muted">
        The countries, universities and courses kept in the MIOC app. In phpMyAdmin, export <span className="font-mono text-xs">tb_destinations</span>,{" "}
        <span className="font-mono text-xs">tb_universities</span>, <span className="font-mono text-xs">tb_courses</span> and{" "}
        <span className="font-mono text-xs">tb_main_course</span> as SQL (gzip is fine). The file is read in this browser and only the catalogue is sent on.
        New courses land as drafts; nothing here is renamed or deleted, and a course the team researched by hand is left alone. Safe to run again: only
        courses not loaded before are added, and nothing already loaded is changed. A MIOC course deleted here comes back on the next run, so archive one
        rather than delete it.
      </p>
      <Field label="MIOC export (.sql or .sql.gz)" htmlFor="mioc-file">
        <input
          id="mioc-file"
          type="file"
          accept=".sql,.gz,application/sql,application/gzip"
          className="text-xs"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setCheck(null);
            setDone(null);
            setError(null);
          }}
        />
      </Field>
      {error && <Alert tone="bad">{error}</Alert>}
      {done && (
        <div data-mioc-done>
          <Alert tone="ok">{done}</Alert>
        </div>
      )}
      {b && check && (
        <div data-mioc-check className="space-y-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          <p className="font-medium text-ink">Checked, nothing written yet.</p>
          <ul className="list-disc space-y-1 pl-5 text-ink-soft">
            <li>
              <span data-mioc-count="programs">{n(b.programs.length)}</span> courses in {n(b.universities.length)} universities across {b.countries.length} countries.
            </li>
            <li>
              Universities: <span data-mioc-count="universities-new">{n(check.prep.universitiesNew)}</span> new, {n(check.prep.universitiesHere)} already here.
              {check.prep.countriesNew.length > 0 && <> Countries to add: {check.prep.countriesNew.join(", ")}.</>}
            </li>
            <li>
              Recorded as figures: yearly tuition for {n(b.figures.tuition)}, application fee for {n(b.figures.applicationFee)}, IELTS for {n(b.figures.ielts)}, intakes for{" "}
              {n(b.figures.intakes)}, duration for {n(b.figures.duration)}. {n(b.figures.tuitionInWords)} fees given for a semester, for nine months or in another currency are kept in
              words in the entry notes, not turned into a yearly figure.
            </li>
            <li>
              Left out: {n(b.skipped.duplicateCourses)} repeats of a course filed under a second study area, {n(b.skipped.orphanCourses)} courses whose university is gone or switched
              off{b.skipped.hiddenCountries.length ? `, and everything in ${b.skipped.hiddenCountries.join(", ")} (switched off in the app)` : ""}
              {b.skipped.unknownCountries.length ? `. Countries this import does not know: ${b.skipped.unknownCountries.join(", ")}` : ""}.
            </li>
          </ul>
          <p className="text-xs text-muted">Courses that match one already in the catalogue at the same university and level are not added twice. That count comes with the load.</p>
        </div>
      )}
      {progress && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(progress.of, 1)) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted" data-mioc-progress>
            {n(progress.done)} of {n(progress.of)} programs. Keep this page open.
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!file || !!busy} onClick={onCheck}>
          {busy && !check ? busy : "Check the file"}
        </Button>
        {check && (
          <Button type="button" disabled={!!busy} onClick={onLoad} data-mioc-load>
            {busy ? busy : `Load ${n(check.build.programs.length)} courses`}
          </Button>
        )}
      </div>
    </div>
  );
}
