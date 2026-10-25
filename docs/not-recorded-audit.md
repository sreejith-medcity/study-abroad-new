# The "Not recorded" rule: audit of the catalogue screens

The rule: a figure nobody has verified stays null in the database and reads as "Not recorded" (or a field-specific equivalent) wherever it is shown. It is never shown as 0, "free" or a blank that could be read as zero. A whole-course fee is never divided into a yearly one, a CGPA is never converted to a percentage, and a null is never sorted, filtered, counted, exported or compared as if it were zero. `feeText`, `tuitionText` and `durationText` in `src/lib/catalogue.ts` are the reference helpers.

This audit was done after the catalogue grew by about 104,000 imported courses, most of them with no fee, no scores and no duration on record, which is exactly where a null treated as a zero would do the most damage.

## What was wrong, and what changed

Course finder, "N sit inside the budget" (`src/server/finder.ts`, `finderCounts`). The count reused `budgetWhere`, which deliberately keeps a course with no fee on record in the list. That meant every unpriced course was counted as inside the budget, so a 15 lakh budget over the new catalogue claimed tens of thousands of fits. A new `knownInsideBudgetWhere` in `src/server/program-search.ts` counts only a recorded fee, at a rate the team has set, at or under the budget. The results page now says the count is of courses with a recorded fee and that the rest stay in the list.

Course finder, default order (`finderCandidates`). The same lenient test ordered the results, so unpriced courses ranked level with the ones known to fit. The order is now: known to fit, then no fee on record, then known to be over.

Course finder, the reason on each match (`src/lib/finder-score.ts`). When only a whole-course fee was recorded, its average year was compared with the budget and the match said "inside the budget" with nothing to show that an average was involved. The sentence now says "averaged over the course". No yearly figure is shown; the helper already refused to do that.

Pre-submission check, passport validity (`src/lib/checks.ts`). A course with no duration on record was assumed to last 12 months, and the check then reported "Passport valid for the full course" as a pass. The guess is gone: with no course length the check reports a warning that the passport is valid at intake and the course length is not recorded, or a blocker if the passport runs out before the intake.

Search chip "No English test needed" (`src/server/program-search.ts`, `QUICK`; the brief reader in `src/lib/brief.ts`). The chip matches courses whose English minimums are all null, and null means nobody has recorded one, not that the institution needs none. After the import that chip returned the bulk of the catalogue under a label that promised something the data does not say. It now reads "No English test recorded", which is what it filters on. The "No GRE" and "No GMAT" chips were left as they were: the schema records those tests only where an institution requires them, so null there does mean none.

Student portal, tuition line (`src/app/portal/page.tsx`). The localised tuition text used truthiness, so a fee the institution states as nil (0) read as "not confirmed yet", the label for an unknown. The portal now calls `tuitionText` with its own English or Malayalam labels, including a new "no tuition fee" label in both languages, so all three states survive translation.

Unit tests were added for each pure change: `tuitionText` with and without labels, the passport check with no duration, the strict budget SQL against the lenient one, the English chip's label and SQL, and the averaged wording.

## What was checked and judged fine

The program page, search results in all three views, the compare page, the shortlist, the university page, the draft review table, the admin programs list and edit form, and the catalogue history all go through `feeText`, `tuitionText`, `durationText` and `intakesText`, or test `!= null` before printing a figure, and show "Not recorded" otherwise. The admin form and every importer (CSV, CRICOS, MIOC, register sync) read a blank as null, never as 0.

Sorting by fee everywhere (search, routes view, finder, similar programs, search export) puts nulls last, with per-year figures before whole-course ones and the two never compared with each other. Commission ordering and route ordering treat an unknown rate or an unknown tuition as null, sorted last.

Eligibility: `checkEligibility` and `notBlockedWhere` skip a requirement whose minimum is null, so a null means "no requirement on record", not "requires 0". A null CGPA or GPA is never converted; a percentage minimum is only checked against a recorded percentage.

The budget filter `budgetWhere` keeps unpriced courses in the list, which is the intended behaviour for a filter: it hides nothing on an unknown. Its whole-course branch only rules a course out when the average year is over budget, which is certain without inventing a yearly figure. The "Deposit under 1,500" chip and the IELTS and gap filters follow the same "unknown stays in the list" convention and the result rows say "Not recorded" where that applies.

The two CSV exports write a null as an empty cell and a stated zero as 0, which the export's own comment documents; the dashboard Excel export carries counts and sums of money actually recorded, not catalogue figures.

The AI assistant's catalogue tool writes "not recorded" into the prompt for every missing tuition, fee, score, intake and duration, and its system prompt forbids converting a whole-course fee or a CGPA.

Commission estimates (`partnerEstimate`, `routeCommission`, the SQL in `commission-estimate.ts` and `vendors.ts`) return null or "not known" when the yearly tuition is null, and say so rather than working from a whole-course fee. `amountsFor` in `src/lib/money.ts` does fall back to 0 for a null tuition, but its only caller refuses to create a commission row when the result is not positive, so no zero is ever stored or shown.

Search result cards omit the duration chip when it is null rather than printing "Not recorded" in the metadata line. That is an omission, not a zero, and the program page shows the full label, so it was left alone.
