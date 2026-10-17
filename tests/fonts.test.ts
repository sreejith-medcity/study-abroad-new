import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/*
  The portal's type, and where it comes from.

  Every page used to block on a stylesheet from fonts.googleapis.com: a third
  party on the critical path of a portal holding student files, and a request
  from every branch to a server that is not ours. The fonts are files in the
  bundle now. This stops that quietly coming back, which is a one-line change
  somebody could make without noticing what it costs.
*/

/** The file with its comments taken out: prose about a host is not a request to it. */
function code(path: string) {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const layout = code("src/app/layout.tsx");
const css = readFileSync("src/app/globals.css", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

test("no type is fetched from somewhere else", () => {
  for (const host of ["fonts.googleapis.com", "fonts.gstatic.com", "use.typekit.net", "fonts.bunny.net"]) {
    assert.ok(!layout.includes(host), `src/app/layout.tsx still reaches out to ${host}`);
  }
});

test("the fonts are in the bundle", () => {
  const faces = [...layout.matchAll(/@fontsource\/([a-z0-9-]+)\/([a-z0-9-]+)\.css/g)];
  assert.ok(faces.length >= 6, `expected the weights to be imported, found ${faces.length}`);
  for (const [, family] of faces) {
    assert.ok(pkg.dependencies[`@fontsource/${family}`], `@fontsource/${family} is imported but not a dependency`);
    assert.ok(existsSync(`node_modules/@fontsource/${family}`), `@fontsource/${family} is not installed`);
  }
  // Only latin: the portal is written in English, and a Cyrillic subset
  // nobody reads is still a file somebody downloads.
  for (const [whole, , weight] of faces) {
    assert.ok(weight.startsWith("latin"), `${whole} pulls in more than latin`);
  }
});

test("the families the stylesheet asks for are the ones imported", () => {
  const imported = new Set([...layout.matchAll(/@fontsource\/([a-z0-9-]+)\//g)].map((m) => m[1]));
  const token = (name: string) => css.match(new RegExp(`--font-${name}:\\s*"([^"]+)"`))?.[1];
  for (const name of ["display", "sans", "mono"]) {
    const family = token(name);
    assert.ok(family, `--font-${name} should name a family`);
    const slug = family.toLowerCase().replace(/\s+/g, "-");
    assert.ok(imported.has(slug), `--font-${name} is ${family}, which is not imported (imported: ${[...imported].join(", ")})`);
  }
});
