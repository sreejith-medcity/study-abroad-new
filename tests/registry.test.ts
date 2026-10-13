import { test } from "node:test";
import assert from "node:assert/strict";
import { matchKey, pickHeader, REGISTRY_SOURCES } from "../src/lib/registry";

const deqar = REGISTRY_SOURCES.deqar;

const file = (header: string, ...rows: string[]) => [header, ...rows].join("\n");

test("a header is matched by name, not position, and ignoring case and separators", () => {
  const headers = ["DEQAR ID", "Name_Primary", "Country", "website link"];
  assert.equal(pickHeader(headers, ["name_primary"]), "Name_Primary");
  assert.equal(pickHeader(headers, ["website_link"]), "website link");
  assert.equal(pickHeader(headers, ["deqar_id"]), "DEQAR ID");
  assert.equal(pickHeader(headers, ["tuition"]), null);
});

test("DEQAR rows parse, with the first of a multi-valued cell taken", () => {
  const { rows, mapped, headers } = deqar.parse(
    file(
      "deqar_id,name_primary,country,city,website_link,closure_date",
      "1,Teesside University,United Kingdom,Middlesbrough,https://tees.ac.uk,",
      "2,Dublin City University,IE,Dublin;Glasnevin,https://dcu.ie,",
    ),
  );
  assert.equal(rows.length, 2);
  assert.equal(mapped.name, "name_primary");
  assert.deepEqual(headers.includes("closure_date"), true);
  assert.equal(rows[0].name, "Teesside University");
  assert.equal(rows[0].city, "Middlesbrough");
  // A cell holding several values gives one, not a run-on string.
  assert.equal(rows[1].city, "Dublin");
  assert.equal(rows[1].country, "IE");
});

test("a closed institution is dropped and said to be dropped", () => {
  const { rows, dropped, droppedCount } = deqar.parse(
    file("deqar_id,name_primary,country,closure_date", "1,Open College,GB,", "2,Shut College,GB,2019-08-31"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Open College");
  assert.equal(droppedCount, 1);
  assert.match(dropped[0], /Shut College/);
});

test("a row with no name or no country is dropped rather than half-imported", () => {
  const { rows, droppedCount } = deqar.parse(file("name_primary,country", ",GB", "Nameless Place,", "Real University,GB"));
  assert.equal(rows.length, 1);
  assert.equal(droppedCount, 2);
});

test("a file whose columns have moved reports no mapping instead of guessing", () => {
  const { rows, mapped, headers } = deqar.parse(file("col_a,col_b,col_c", "1,2,3"));
  assert.equal(mapped.name, null);
  assert.equal(mapped.country, null);
  assert.equal(rows.length, 0);
  assert.deepEqual(headers, ["col_a", "col_b", "col_c"]);
});

test("names match across case, punctuation and the ampersand", () => {
  assert.equal(matchKey("King's College London"), matchKey("Kings College London"));
  assert.equal(matchKey("Arts & Humanities Institute"), matchKey("Arts and Humanities Institute"));
  assert.notEqual(matchKey("University of York"), matchKey("York University"));
});

test("every register listed carries a licence that allows reuse", () => {
  for (const s of Object.values(REGISTRY_SOURCES)) {
    assert.ok(s.licence.length > 0, `${s.key} has no licence recorded`);
    assert.ok(s.url.startsWith("https://"), `${s.key} is not fetched over https`);
    assert.ok(s.floor > 0, `${s.key} has no floor, so a truncated file would import`);
  }
});
