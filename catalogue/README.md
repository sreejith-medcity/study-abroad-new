# Course catalogue

Real programmes gathered from the institutions' own pages and from official
registers (IPEDS, the OfS register, Canada's Designated Learning Institutions
list, TEQSA, NZQA, Hochschulkompass, BIBB, the Bundesagentur fuer Arbeit).
No aggregator or agency source was used, and nothing here came from
KC Overseas or coursefinder.ai.

897 rows across fourteen destinations and 279 institutions, in the importer's
own format, on a 23-column header. Everything lands as `DRAFT`, so it is
reviewed on the Programs screen and published per country or per pathway with
the bulk control there, which acts on every row matching the filters rather than
the visible page.

| destination | programmes | institutions | work rights known |
|---|---|---|---|
| United Kingdom | 165 | 63 | 95 |
| Canada | 149 | 40 | 92 |
| Germany | 126 | 59 | 0 |
| United States | 120 | 32 | 20 |
| Australia | 98 | 20 | 92 |
| New Zealand | 92 | 17 | 85 |
| Ireland | 77 | 20 | 49 |
| Netherlands | 31 | 12 | 0 |
| Sweden | 10 | 4 | 0 |
| France | 7 | 3 | 0 |
| Finland | 7 | 3 | 0 |
| Italy | 6 | 3 | 0 |
| Portugal | 6 | 1 | 0 |
| Switzerland | 3 | 2 | 0 |
| **total** | **897** | **279** | **433** |

Three waves so far. Wave 1 is the eight original files, wave 2 the `*2.csv`
files, wave 3 the `*3.csv` files. No institution appears in more than one wave
and no programme is duplicated across the set.

## The rule these were gathered under

A number is either verified on the institution's own page or the cell is empty.
Nothing was interpolated, annualised from a per-credit rate, or carried across
from a sibling programme. That is why coverage varies so much by column: US
universities publish per credit hour, Australian ones per session, so those
tuition cells are mostly blank rather than mostly wrong.

Blank is an instruction to go and check, not a defect.

## Adding to it

New destinations need a row in `countries` before their programmes will import,
or the rows are dropped without an error. Finland, Portugal and Spain were added
for wave 3 (`supabase-part9-countries.sql`); Spain has no rows yet.

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

`work_rights` is its own column, not prose: `ELIGIBLE`, `INELIGIBLE` or
`UNKNOWN`, with `work_rights_note` carrying the evidence. It drives a badge on
the search row and a "Post-study work" filter, and that filter returns confirmed
rows only, never the unknowns.

| | eligible | ineligible | unknown |
|---|---|---|---|
| United Kingdom | 164 | 1 | 0 |
| Canada | 113 | 26 | 10 |
| Australia | 76 | 16 | 6 |
| New Zealand | 72 | 13 | 7 |
| Ireland | 49 | 0 | 28 |
| United States | 20 | 0 | 100 |
| Germany | 125 | 0 | 1 |
| Rest of Europe | 67 | 0 | 3 |

Every verdict names its source in the note. Where the right depends on national
law rather than the institution, the note cites the law or the government page:
the UK Graduate visa (gov.uk), § 20 AufenthG for Germany, and the immigration
services of the Netherlands, Finland, Sweden, France, Italy and Portugal, all
checked on 21 Sep 2026. Canadian degrees rest on IRCC's rule that degrees carry
no field-of-study requirement; Canadian college programmes rest on each
college's own list or programme page. Elsewhere the source is the institution's
own statement or an official register (INZ's post-study work qualification list,
CRICOS registration, the Irish Third Level Graduate Programme award levels).
155 rows stay `UNKNOWN`, which is the honest state rather than a gap to paper over.

Two notes worth reading before selling: Switzerland gives graduates six months
to look for a job, but that job then needs approval, so those rows stay
unconfirmed with the rule in the note. France allows only work related to the
degree above a salary floor, and the note says so.

Programmes marked not eligible because the college leaves them off its own
complete PGWP list (Sheridan, St. Clair, Durham, Georgian, Niagara, Loyalist)
carry that reason in the note. The University of Hull's MSc Advanced Clinical
Practice is part-time only, so it cannot be taken on a Student visa at all and
should probably be archived. Three Vancouver Community College programmes are
open only to Canadian citizens and permanent residents, which their notes say.

### The ones that change what a counsellor should say

- **Mohawk College Supply Chain Management exists twice, with opposite answers.**
  The Hamilton programme is on Mohawk's own PGWP list. The Mississauga campus
  version runs in partnership with triOS, a private career college, which makes
  it a public-private partnership and not PGWP-eligible. Same programme name,
  different outcome, and anyone selling from the name alone will get it wrong.
- **Centennial's Project Management (Online)** prints "PGWP Aligned: No" on its
  own page. It is cheap and looks like an easy postgraduate option, and it leads
  nowhere for a student whose goal is to stay.
- **The New Zealand Diploma in Enrolled Nursing does not qualify**, at SIT, Toi
  Ohomai or Ara. Enrolled nursing sits at Level 5 and is not on INZ's list. A
  student who takes it instead of a Bachelor of Nursing gets no post-study work
  visa at all. The same goes for the hospitality and cookery diplomas.
- **Inside a single provider the answer can split.** At Toi Ohomai the five
  engineering and construction diplomas qualify and seven other sub-degree
  awards do not. Never flatten a provider to one verdict.
- **UT Dallas is the opposite of what anyone would guess**: its business school
  publishes a STEM-designated list, so MS in IT and Management is confirmed,
  while its engineering school publishes nothing, so its computer science and
  computer engineering programmes are unknown.
- **The UK Graduate Route drops to 18 months from January 2027.** The notes say
  so. Most students being counselled now will get the shorter one.

### A correction worth keeping

An earlier pass recorded George Brown B415 and B412 as ineligible "under 2 years,
so no PGWP". The verdict was right and the reason was wrong: there is no
two-year rule. IRCC asks for a programme of at least 8 months, and length
decides how long the permit lasts, not whether there is one. Both are ineligible
because George Brown's own pages say "PGWP Eligible: No", which is a
field-of-study outcome. The distinction matters, because several 8-month
graduate certificates in this catalogue (Fanshawe DAA1, four Durham
certificates, Niagara Data Analytics) are confirmed eligible.

### Australia's vocational rows are a scoped no

The 13 TAFE rows read "No 485 Higher Ed stream; Post-Vocational may apply". That
is deliberate. They are a definite no for the Post-Higher Education Work stream,
which needs a degree, but the Post-Vocational Education Work stream still exists
for a trade qualification tied to an occupation on the skilled list. Certificate
III in Carpentry and the Diploma of Nursing could plausibly go that way. Do not
read those rows as "no work rights at all".

### Where the remaining unknowns are, and why

- **Europe, 4 rows.** Switzerland's three (see above) and Germany's recognition
  route for nurses trained in the EU, which does not apply to Indian applicants.
- **United States, 100 rows.** Most universities point at the DHS CIP list and
  tell the student to read their own I-20. A student at NJIT, Texas Tech, UT
  Arlington, Buffalo, Stony Brook, Binghamton, Cleveland State or Missouri S&T
  almost certainly does get STEM OPT in practice, but no page on those sites
  says so. Get it in writing from each DSO, or stop stating it.
- **Canada, 10 rows.** Four Lambton programmes (its list needs a browser; the
  note warns that only the Sarnia campus counts), four Vancouver Community
  College programmes, Humber's Global Business Management (Humber's own page
  says "N/A" rather than yes), and Saskatchewan Polytechnic's Computer Systems
  Technology, whose list would not render.
- **Ireland, 28 rows.** Nineteen are National College of Ireland, whose
  stay-back page would not render. NCI is a volume recruiter and worth one email.

### Seneca, Sheridan and Humber

Settled on 21 Sep 2026 in a browser. Seneca's Data Analytics and Supply Chain
Management – Global Logistics are on its list. None of the three Sheridan
programmes is on Sheridan's PGWP-aligned list (updated 13 Apr 2026); for
project management, the aligned one is Project Management – Information
Technology. Humber's Global Business Management page shows "PGWP-Eligible: N/A".

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
