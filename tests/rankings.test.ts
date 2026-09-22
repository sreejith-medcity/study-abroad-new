import { test } from "node:test";
import assert from "node:assert/strict";
import { bestRankSort, parseRank, parseRankingsCsv, rankLabels } from "../src/lib/rankings";

test("ranks read as published, bands sort by their top", () => {
  assert.deepEqual(parseRank("=154"), { text: "=154", sort: 154 });
  assert.deepEqual(parseRank("#12"), { text: "12", sort: 12 });
  assert.deepEqual(parseRank("601–650"), { text: "601-650", sort: 601 });
  assert.deepEqual(parseRank("1001+"), { text: "1001+", sort: 1001 });
  assert.equal(parseRank("top 100"), null);
  assert.equal(parseRank("650-601"), null);
  assert.equal(bestRankSort("601-650", "251-300"), 251);
  assert.deepEqual(rankLabels({ qsRank: "=154", qsYear: 2026, theRank: "201-250", theYear: 2026 }), ["QS 2026 =154", "THE 2026 201-250"]);
  assert.deepEqual(rankLabels({ qsRank: "12", qsYear: null, theRank: null, theYear: null }), ["QS #12"]);
});

test("the rankings CSV reports line-level errors", () => {
  const { rows, errors } = parseRankingsCsv("university,country_code,qs_rank,qs_year,the_rank,the_year\nUniversity of Hull,GB,=580,2026,,\nNowhere,GB,,,,\nOther,GB,top ten,2026,,");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qsRank, "=580");
  assert.deepEqual(errors.map((e) => e.line), [3, 4]);
});
