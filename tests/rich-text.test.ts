import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseRich, toPlain, toWhatsApp } from "../src/lib/rich-text";

test("rich text: bold, italic and links inline", () => {
  assert.deepEqual(parseInline("Send the **CAS** by *Friday*: https://example.ac.uk/cas."), [
    { t: "text", v: "Send the " }, { t: "b", v: "CAS" }, { t: "text", v: " by " }, { t: "i", v: "Friday" }, { t: "text", v: ": " }, { t: "a", v: "https://example.ac.uk/cas" }, { t: "text", v: "." },
  ]);
});

test("rich text: lists and paragraphs, and markup is never HTML", () => {
  const b = parseRich("Please upload:\n- passport\n- <script>x</script>\n\n1. sign\n2. return");
  assert.equal(b.length, 3);
  assert.equal(b[0].t, "p");
  assert.equal(b[1].t, "ul");
  assert.deepEqual(b[1].t === "ul" ? b[1].items[1] : null, [{ t: "text", v: "<script>x</script>" }]);
  assert.equal(b[2].t === "ol" ? b[2].items.length : 0, 2);
});

test("rich text: WhatsApp markers and plain previews", () => {
  assert.equal(toWhatsApp("**Offer** is *in*"), "*Offer* is _in_");
  assert.equal(toPlain("**Offer** is *in*"), "Offer is in");
  assert.deepEqual(parseInline("javascript:alert(1)"), [{ t: "text", v: "javascript:alert(1)" }]);
});

test("rich text: links to programs in the portal", () => {
  assert.deepEqual(parseInline("See /programs/mucg7hioxZrCN9DRgW7z now"), [{ t: "text", v: "See " }, { t: "a", v: "/programs/mucg7hioxZrCN9DRgW7z" }, { t: "text", v: " now" }]);
  assert.deepEqual(parseInline("path /etc/passwd"), [{ t: "text", v: "path /etc/passwd" }]);
});
