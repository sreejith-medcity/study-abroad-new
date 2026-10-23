import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELEASES } from "../src/lib/releases";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");

test("package.json, the release list and the changelog name the same newest release", () => {
  assert.equal(RELEASES[0].version, pkg.version);
  const top = changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1];
  assert.equal(top, pkg.version);
});

test("releases are numbered, dated, newest first, and none repeats", () => {
  const key = (v: string) => v.split(".").map((x) => x.padStart(5, "0")).join(".");
  for (const r of RELEASES) {
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.changes.length > 0);
    assert.ok(changelog.includes(`## ${r.version} `), `CHANGELOG.md has ${r.version}`);
  }
  const keys = RELEASES.map((r) => key(r.version));
  assert.deepEqual(keys, [...keys].sort().reverse());
  assert.equal(new Set(keys).size, keys.length);
});
