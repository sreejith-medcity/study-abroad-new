# Course catalogue

Real programmes gathered from the institutions' own pages and from official
registers (IPEDS, the OfS register, Canada's Designated Learning Institutions
list, TEQSA, NZQA, Hochschulkompass, BIBB, the Bundesagentur fuer Arbeit).
No aggregator or agency source was used, and nothing here came from
KC Overseas or coursefinder.ai.

746 rows across thirteen destinations, in the importer's own format, on a
23-column header. Everything lands as `DRAFT`, so it is reviewed on the Programs
screen and published per country or per pathway with the bulk control there,
which acts on every row matching the filters rather than the visible page.

## The rule these were gathered under

A number is either verified on the institution's own page or the cell is empty.
Nothing was interpolated, annualised from a per-credit rate, or carried across
from a sibling programme. That is why coverage varies so much by column: US
universities publish per credit hour, Australian ones per session, so those
tuition cells are mostly blank rather than mostly wrong.

Blank is an instruction to go and check, not a defect.

## The files

Wave 1 is the eight original files. Wave 2 is the `*2.csv` files, a second
pass across a wider set of institutions with no overlap with wave 1.

| destination | wave 1 | wave 2 | institutions added in wave 2 |
|---|---|---|---|
| uk | 40 | 67 | 26 |
| ireland | 32 | 45 | 7 |
| canada | 29 | 67 | 14 |
| australia | 31 | 67 | 8 |
| germany | 31 | 95 | 30 providers and institutions |
| usa | 30 | 90 | 18 |
| newzealand | 32 | 60 | 7 |
| europe (NL, FR, IT, SE, CH) | 30 | - | - |

## Checking a file before importing

    DOC_CODES="$(psql "$DATABASE_URL" -tAc "select string_agg(code, ',') from document_types")" \
      npx tsx scripts/validate-catalogue.ts

It parses each CSV with the same code the import screen uses, so a bad row shows
up here rather than halfway through an import, and reports how complete each
file is.

## What still needs a person

- Fee years are mixed, because institutions publish on different cycles. Some
  UK rows are 2025/26 and some 2027/28; Charles Sturt is the 2027 schedule,
  Federation 2026, Murdoch 2027.
- `required_docs` is thin outside Germany and the US. Most universities describe
  entry requirements in prose rather than as a checklist.
- Some rows are skeletons: real programmes where the numbers sat behind a fee
  calculator or a JavaScript widget that could not be read.
- RRC Polytech's year 1 amounts are labelled *Program/Student Fees* and include
  health, dental and international health cover, so they are slightly broader
  than pure tuition.
- Kent State, Cleveland State, Texas Tech and CSU East Bay publish only a
  combined tuition-and-fees annual estimate, the figure they issue I-20s
  against. Those cells were blanked rather than filed as tuition. If the
  business wants the I-20 number instead, it needs its own column.

## Post-study work rights

`work_rights` is its own column, not prose: `ELIGIBLE`, `INELIGIBLE`, or
`UNKNOWN`, with `work_rights_note` carrying the institution's own wording. It
drives a badge on the search row and a "Post-study work" filter, and the filter
returns confirmed rows only, never the unknowns.

The importer takes the words people actually write, so `PGWP-ineligible`,
`STEM OPT`, `yes` and `no` all land correctly, and anything it does not
recognise is rejected rather than guessed at.

Fourteen rows are set so far:

- **INELIGIBLE (6)**: four Georgian@ILAC Toronto programmes, which are the
  public-private partnership category that lost eligibility, and George Brown
  B415 and B412, which are 8-month programmes and so under the two-year floor.
- **ELIGIBLE (8)**: the Rochester Institute of Technology programmes RIT itself
  names as STEM-designated.

The other 732 are `UNKNOWN`, and that is the honest state rather than a gap to
paper over. Filling it in is a per-institution job: the rule is mechanical in
Canada and broad in the UK, but a counsellor quoting it is telling a student
they can stay and work, so it goes in only where the institution says so.
- **MOI**: Kent State states outright that it does not accept Medium of
  Instruction letters, recorded as `false` on all six of its rows. No
  institution in the set was found to accept one, so the column is otherwise
  empty rather than `false` by assumption.
- **Nurse recognition is not Ausbildung.** The ten German `NURSING` /
  `REGISTRATION` rows (Triple Win, the ZAV placements, and the Bundesland
  recognition authorities) are routes for nurses who already qualified abroad.
  Hand in Hand for International Talents was deliberately left out of that
  group: it is an IHK pilot for hotel, restaurant and chef occupations, not
  nursing.

## Institutions that could not be read

Griffith, La Trobe, Edith Cowan, Southern Cross, Canberra, Torrens, Newcastle,
UniSA, Tasmania (client-side rendered or robots-blocked); Canadore, Cambrian,
Lambton, Saskatchewan Polytechnic, Lakehead, KPU, TRU, UNBC, Manitoba, Bow
Valley, Langara; Hull, Glasgow Caledonian, York St John, IBAT; Houston, UIC,
Wayne State, Michigan Tech, UMKC, Oklahoma State, SIUE, Northern Illinois, WPI,
IU Indianapolis; Whitireia and WelTec, NMIT, NorthTec; TH Koeln, Hochschule
Bremen, TU Braunschweig, TU Clausthal, Furtwangen, Kempten, Schmalkalden,
Fresenius, Freiburg, KIT, TUM.

These are the obvious next targets for a third pass, or for a direct request
to the institution.
