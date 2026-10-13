# Course catalogue

Real programmes gathered from the institutions' own pages and from official
registers (IPEDS, the OfS register, Canada's Designated Learning Institutions
list, TEQSA, NZQA, Hochschulkompass, BIBB, the Bundesagentur fuer Arbeit).
No aggregator or agency source was used, and nothing here came from
KC Overseas or coursefinder.ai.

1,010 rows across fourteen destinations, in the importer's
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


## Australia at full size: the CRICOS register

The hand-researched rows in this folder are the verified core. Australia's full
list, about 26,000 courses from 1,500 providers, comes from the government's
CRICOS register instead (data.gov.au, CC BY 2.5 AU) and is loaded by the
"Australia (CRICOS)" card on the admin Programs screen, not from a CSV here.
The register gives provider, campus, level, field, duration and the
international tuition for the whole course. It has no entry requirements,
intakes or application fees, so those stay blank until someone adds them, and
counsellors can still apply by choosing the intake the student is aiming for.
Post-study work is set from the Home Affairs 485 rule: a bachelor's, master's
or doctoral course of 92 or more registered weeks meets the course side of the
Post-Higher Education Work stream. Shorter degrees and vocational courses say
why they are not confirmed. The 89 rows here that carry a CRICOS code are
matched to the register rather than duplicated, and keep their verified data.
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


## PhD and nursing top-up, October 2026

`phd-and-topup.csv` adds 47 courses the catalogue had none of: 33 doctorates
and 14 nursing top-up degrees, across the United Kingdom, Ireland, Australia,
Canada and New Zealand. Every row carries `program_url`, the institution page it
was read from, and a one-line `entry_requirements` in the institution's own
words.

Only 21 of the 47 carry a tuition figure, and that is correct. A fee is
recorded only where the page states one for a year, or states a total for a
course of twelve months or less. Where a page gives a band (Manchester's five
project-dependent PhD bands), a range (Canterbury, Toronto Metropolitan), a
figure it never labels as annual (Nottingham, Southampton), or only a link to a
central fees page (Edinburgh, Cardiff, most of the research degrees), the
column is empty and the screen says "Not recorded". None of it is estimated.

Two things worth knowing before publishing any of it:

- The two Australian enrolled-nurse pathways (Australian Catholic University,
  Western Sydney) require an **Australian** Diploma of Nursing and current
  AHPRA registration as an enrolled nurse. They are open to international
  applicants in principle and out of reach for most Indian applicants in
  practice. The entry requirement says so on the row.
- Three of the UK top-ups state that they do not by themselves lead to NMC
  registration.

New Zealand has no nursing top-up here, deliberately: the Nursing Council's own
education page lists no post-registration bachelor's route, and internationally
qualified nurses go through a Competence Assessment Programme, which is not a
degree.


## Aviation, Teesside and University College Birmingham, October 2026

`aviation-and-two-universities.csv` answers three things the counselling team
reported missing: aviation courses, Teesside University and University College
Birmingham. 66 rows, 43 in the United Kingdom, 6 in Ireland, 6 in Australia,
5 in Canada, 4 in New Zealand and 2 in Germany. Every row carries
`program_url` and a one-line `entry_requirements` read from that page.

Thirty-three rows are the two universities the team named, across their real
subject spread rather than aviation alone, so a counsellor searching either
name finds a usable list. The other thirty-three are aviation: 26 under the
`Aviation` study area and 9 under `Aerospace Engineering`, covering pilot
training degrees, air transport management, aircraft engineering and airport
operations.

Fifty-three of the 66 carry a tuition figure. The thirteen blanks are pages
that give a band, a total for a course longer than a year, or no figure at
all, and they display "Not recorded" rather than a guess.

One thing to tell a candidate before they get excited about a pilot degree:
on the flying routes (Buckinghamshire New, SETU Pilot Studies, UNSW Flying,
Massey Air Transport Pilot) **flight training is charged separately** and is
the larger part of the cost. The row says so in its entry requirements.
Massey's page quotes a single combined figure that is plainly not annual
tuition, so that column is empty rather than misleading.


## Public registers, and which ones may be used

Checked October 2026, by reading each publisher's own licence rather than
assuming. The finding that matters most: **no government anywhere publishes
international tuition, English requirements and intake dates in bulk.** Not one
of the 39 destinations. Australia's CRICOS is the single exception on fees, and
only because it states the international tuition for the whole course. So a
register fills in institutions and course names; the three columns a counsellor
quotes to a student still come from the institution's own page, one at a time,
and read "Not recorded" until they do.

Loadable from the portal today:

| Register | What it gives | Licence |
|---|---|---|
| Australia CRICOS | ~26,000 courses, 1,500 providers, with whole-course international tuition | CC BY 2.5 AU |
| DEQAR | institutions across the European Higher Education Area, city and website | ODC PDDL, public domain |

Researched, licence permits reuse, not yet built: UK Discover Uni (CC BY 4.0,
undergraduate courses only), the UK Home Office register of licensed student
sponsors (OGL), US IPEDS and College Scorecard (public domain), Ontario college
programmes (OGL Ontario), Poland RAD-on (CC0), Norway DBH (NLOD), Italy MUR
(public domain), Singapore data.gov.sg (Open Data Licence), Georgia's list of
English-taught programmes.

**Not to be used, whatever the pressure.** Each was checked and each forbids it:

- Hochschulkompass (HRK): free for personal use only. Any other use, expressly
  including commercial use and expressly including of individual parts, needs
  the HRK foundation's permission.
- DAAD International Programmes: all rights reserved. It is the only German
  source holding fees, language and intakes together, which is exactly why it
  is licensed the way it is.
- ETER / EHESO: the licence forbids making the dataset or parts of it available
  on an online support.
- Studiekeuzedatabase (Netherlands): contract only, non-transferable and
  non-sublicensable.
- Malaysian Qualifications Register: no licence stated.
- coursefinder.ai and KC Overseas: a partner's compiled database. Copying it
  into this portal is off the table, through a partner login or otherwise.

That list is repeated in the code, in `src/lib/registry.ts`, and shown on the
register card itself, so the reasoning survives whoever reads it next.


## Austria and Sweden, October 2026

`austria.csv` (193 rows, 10 institutions) and `sweden.csv` (328 rows, 11
institutions) came from a worklist Medcity's own team had compiled of
universities and course names worth covering. The worklist was used only to
decide what to look up. Every row here was read off the institution's own page
and carries that page's URL, the same rule as the rest of this folder.

Both destinations had institutions on file and zero courses before this.

What is missing, and why, because the pattern matters for every European
destination after these two:

- **Austrian tuition is blank on 180 of 193 rows.** Every public university
  there charges non-EU students the same EUR 726.72 per semester, and not one
  of TU Graz, TU Wien, Leoben, JKU, Innsbruck, BOKU or Univie states anywhere
  that an academic year is two semesters. Doubling it would be arithmetic the
  university did not do. The 13 rows that do carry a fee are MODUL Vienna, a
  private university whose own page says "you can choose to pay for 2 semesters
  (1 academic year)".
- **Swedish tuition is blank on 256 of 328 rows.** Swedish universities publish
  a first instalment and a whole-programme total, not a yearly figure. A fee is
  recorded only where the programme runs 12 months, so the total is the year, or
  where the university publishes a per-academic-year table that the programme
  page matches (Jonkoping, University West). Karlstad and Dalarna state a
  per-semester fee; those were doubled by the research pass and I put them back
  to empty, for the same reason as Austria.
- **IELTS is blank on most Swedish rows.** Sweden states its requirement as
  "English 6", a Swedish upper-secondary level, not a test band. The wording is
  kept in entry_requirements rather than converted into a score.
- **No English-taught bachelor's exists** at TU Graz, University of Vienna,
  Innsbruck, FH JOANNEUM or BOKU. Their own pages say so. Roughly thirty
  bachelor's names on the worklist were German-taught and are therefore absent:
  that is the worklist being wrong, not a gap here.

Australia is not in these files. CRICOS already carries all 21 of the
Australian universities on the worklist, and 25,000 courses besides.


## Malta, October 2026

`malta.csv`, 178 courses at 10 institutions: MCAST 52, University of Malta 46,
and 80 across the private sector (Global College Malta, Learn Key, IDEA
College, STC Higher Education, GBS Malta, Malta Business School, Knights
College, London School of Commerce Malta). Every row carries the institution's
own page.

**Fees: 65 of 178.** The two public institutions publish differently from each
other and from the private colleges, which is why coverage is uneven rather
than lazy:

- University of Malta undergraduate pages print "Fee per academic year" for
  non-EU students, so all 29 of those are recorded: 8,500 for business and
  arts, 10,800 for science, health, IT and engineering, 26,000 for Medicine.
- University of Malta postgraduate pages print a whole-course total instead,
  and the year splits are uneven (one master's is 10,800 with the whole of it
  in year one). Those are blank.
- MCAST publishes only whole-course totals by level and duration, in a 2024/25
  schedule. No per-year figure exists on their site, so every MCAST row is
  blank. There is no newer schedule published.
- The private colleges vary: Global College Malta, Learn Key, GBS and Knights
  publish real per-year fees; STC shows three unlabelled prices side by side
  and "contact us"; IDEA publishes only a part-time price that non-EU students
  are not eligible for.

**IELTS: 140 of 178, and these come from each institution's admissions page,
not from the course pages.** Neither public institution states a score on any
course page. University of Malta requires 6.0 overall for undergraduate and
6.5 for postgraduate; MCAST requires 5.5 at levels 5 to 7. Those are the
institutions' own published admission requirements, applied to their own
courses. The MCAST figure comes from a 2024/25 FAQ, which is the most recent
they publish.

**Three rows were dropped, deliberately.** Malita International College's
bachelor's and master's, because its MBA page sits on a URL that says
bachelor-of-business-administration, its awards come from a United States body
and are described only as "comparable to" a Maltese level rather than being
MFHEA-accredited. And Learn Key's BBA, whose stated entry requirements are
United States financial-aid wording (GED, ability-to-benefit exam) pasted onto
a Maltese programme. None of them is safe to put in front of a visa applicant.

**Four institutions that exist but are not here, and why:**

- **American University of Malta** and the **Institute of Tourism Studies**:
  both real and operating, both sites built so that no course or fee can be
  read from them without a browser. Worth revisiting by hand.
- **21 Academy**: licensed, with an MFHEA quality report, but its own website
  did not respond at all. Check before relying on it.
- **EIE Institute of Education**: no live website could be found. Treat it as
  dormant until somebody produces one.

University of Malta's course finder is JavaScript-driven and cannot be
enumerated, so its 46 rows are a prioritised sample rather than its full
catalogue. MCAST's coverage is near-complete for levels 5 to 7.
