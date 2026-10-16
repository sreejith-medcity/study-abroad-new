import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SKINS, readSkin } from "../src/lib/skins";

/*
  The portal can be painted on three surfaces. Two of them change what is
  behind the text: glass puts a coloured field under a translucent card, and
  night turns the card dark. A colour that reads well on white does not
  necessarily read well on either, and the usual way this effect is got wrong
  is that the second line of every row quietly stops being legible.

  So the contrast is checked here rather than by eye, against the worst place
  on the page each skin can put a piece of text.
*/

const css = readFileSync("src/app/globals.css", "utf8");

type RGB = [number, number, number];

function hex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}
function channel(c: number) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: RGB) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** fg laid over bg at the given alpha. */
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;
}

/** Read one custom property out of a [data-skin="..."] block. */
function token(skin: string, name: string): string {
  const block = css.match(new RegExp(`\\[data-skin="${skin}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(block, `no [data-skin="${skin}"] block in globals.css`);
  const m = block[1].match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  assert.ok(m, `[data-skin="${skin}"] does not set --color-${name}`);
  return m[1].trim();
}

const AA = 4.5;

test("the skin list and its guard agree", () => {
  assert.equal(SKINS.length, 3);
  assert.deepEqual(SKINS.map((s) => s.id), ["soft", "glass", "night"]);
  assert.equal(readSkin("night"), "night");
  assert.equal(readSkin("chartreuse"), "soft", "an unknown value falls back rather than leaving the page unpainted");
  assert.equal(readSkin(null), "soft");
  assert.equal(readSkin(undefined), "soft");
});

test("text on a night card passes AA", () => {
  const card = hex(token("night", "surface"));
  for (const name of ["ink", "ink-soft", "muted", "good-700", "warn-700", "stop-700", "info-700", "brand-500"]) {
    const r = contrast(hex(token("night", name)), card);
    assert.ok(r >= AA, `--color-${name} on a night card reads at ${r.toFixed(2)} to 1, under ${AA}`);
  }
  // The links, which are lifted by their own rule rather than by a token.
  const link = css.match(/\[data-skin="night"\] \.text-brand-600[\s\S]*?color:\s*(#[0-9a-f]{6});/);
  assert.ok(link, "night should lift the brand link colour");
  const r = contrast(hex(link[1]), card);
  assert.ok(r >= AA, `the night link colour reads at ${r.toFixed(2)} to 1`);
});

test("text on a glass card passes AA over the strongest part of the field", () => {
  // The card is translucent, so what is behind it decides. These are the
  // field's own gradient stops, read from the stylesheet so the test follows
  // any change to it.
  const body = css.match(/\[data-skin="glass"\] body \{([\s\S]*?)\n\}/);
  assert.ok(body, "glass should paint a field behind the cards");
  const pageColour = hex((body[1].match(/background-color:\s*(#[0-9a-f]{6})/) ?? [])[1] ?? "#ffffff");
  const stops = [...body[1].matchAll(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map((m) => ({
    rgb: [Number(m[1]), Number(m[2]), Number(m[3])] as RGB,
    alpha: Number(m[4]),
  }));
  assert.ok(stops.length >= 3, "expected the field to be built from several colours");

  const surface = token("glass", "surface").match(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/);
  assert.ok(surface, "the glass card should be translucent white");
  const cardAlpha = Number(surface[1]);

  // One card per gradient stop, each over that stop at full strength.
  const cards = stops.map((s) => over([255, 255, 255], cardAlpha, over(s.rgb, s.alpha, pageColour)));

  for (const name of ["ink", "ink-soft", "muted", "brand-600", "brand-700", "good-700", "warn-700", "stop-700"]) {
    const ink = hex(token("glass", name));
    const worst = Math.min(...cards.map((c) => contrast(ink, c)));
    assert.ok(worst >= AA, `--color-${name} on a glass card reads at ${worst.toFixed(2)} to 1 at the worst spot, under ${AA}`);
  }
});
