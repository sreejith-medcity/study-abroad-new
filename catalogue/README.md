# Course catalogue

Real programmes gathered from the institutions' own pages and from official
registers (IPEDS, the OfS register, Canada's Designated Learning Institutions
list, TEQSA, NZQA, Hochschulkompass, BIBB). No aggregator or agency source was
used, and nothing here came from KC Overseas or coursefinder.ai.

255 rows across the eight destinations, in the importer's own format. Everything
lands as `DRAFT`, so it is reviewed on the Programs screen and published per
country or per pathway with the bulk control there.

## The rule these were gathered under

A number is either verified on the institution's own page or the cell is empty.
Nothing was interpolated, annualised from a per-credit rate, or carried across
from a sibling programme. That is why coverage varies so much by column: US
universities publish per credit hour, Australian ones per session, so those
tuition cells are mostly blank rather than mostly wrong.

Blank is a instruction to go and check, not a defect.

## Checking a file before importing

    DOC_CODES="$(psql "$DATABASE_URL" -tAc "select string_agg(code, ',') from document_types")" \
      npx tsx scripts/validate-catalogue.ts

It parses each CSV with the same code the import screen uses, so a bad row shows
up here rather than halfway through an import, and reports how complete each
file is.

## What still needs a person

- Fee years are mixed, because institutions publish on different cycles. A few
  UK rows are 2025/26 and a few are 2027/28.
- `required_docs` is thin outside Germany. Most universities describe entry
  requirements in prose rather than as a checklist.
- Some rows are skeletons: real programmes where the numbers sat behind a fee
  calculator or a JavaScript widget that could not be read.
- Several institutions could not be reached at all and are missing: Politecnico
  di Milano and Torino, Lund, Uppsala, the Dutch universities of applied
  sciences, Griffith and La Trobe.
