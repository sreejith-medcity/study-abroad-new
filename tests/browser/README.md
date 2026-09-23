# Browser smoke tests

Playwright scripts that sign in as each role and walk the real screens. They
expect a build running on http://localhost:3000 and the sample data loaded:

```bash
npm run db:seed
npm run build && npm start &
npm i -D playwright            # once, if it is not installed
node tests/browser/dashboards.mjs
```

| Script | Covers |
| --- | --- |
| `dashboards.mjs` | All five role dashboards, the landing page per role, nav labels |
| `enquiries.mjs` | Capture, follow-up, conversion to a student, org isolation |
| `money.mjs` | Commission rules and pipeline, wallet, payout request and payment |
| `phase4.mjs` | Insights, its CSV export, and the learning library audiences |
| `roles.mjs` | Adding a user with a role and title, and what ops managers and the documentation team can reach |
| `portal.mjs` | The student portal: language switch, documents, messages, isolation, and the invite |
| `publicform.mjs` | The public enquiry form, consent, the branch QR panel and org isolation |
| `super-smoke.mjs` | Super admin gating: audit log, role controls, health detail |
| `super-actions.mjs` | Role change, password reset and the forced password change |
| `settings.mjs` | The four settings tabs per role, a platform save that sticks, and the colour and password rules |
| `polish.mjs` | The command palette and its scoping, toasts, and the shell at phone width |
| `app-deadlines.mjs` | Typed application deadlines: adding, telling the partner, dashboard windows, the list filter, ticking off, and the offer's accept-by date |
| `artwork.mjs` | The logo and favicon uploader, what it serves, and who may change it |
| `golive.mjs` | The sample-data cleanup: what it lists, what it refuses, what survives |
| `catalogue.mjs` | The catalogue at full size: paging, the count, a bulk publish across every match, and post-study work rights |
| `cricos.mjs` | The full CRICOS register through the admin upload, a bulk publish of 25,889 drafts, a second sync, and the partner screens at 27,000 programs (needs `CRICOS_DIR`) |
| `scholarships.mjs` | Adding a scholarship and its rules, where it shows, the search filter, and pausing it |
| `deadlines.mjs` | Recording deadlines and a fee waiver, the date rules, and where partners see them: program page, search filters, the deadlines page and the apply form warning |
| `offer-visa.mjs` | Recording an offer, a CAS number and a visa decision with their rules, what the partner sees and is told, and the portal view |
| `destinations.mjs` | The visa living-cost figures, a rankings CSV with errors, and where rankings and funds show: search, the universities index, program and university pages |
| `events.mjs` | Publishing a webinar with its rules, the partner's notice, taking a seat and the join link, registering a student, seat counts and cancelling |
| `support.mjs` | Raising a ticket, the team's notice and reply, who it waits on, resolving, and branch isolation |
| `services.mjs` | A partner requests an education loan, the team works it from the queue, and the partner sees and is told of each change |
| `training.mjs` | Building and publishing a course with its rules, failing and passing the quiz, the certificate, team progress and who may open a certificate |
| `updates.mjs` | Publishing an update, an announcement and a What's New item, who is told, the dashboard banner and country tabs, and the What's New dot (needs the catalogue) |
| `universities.mjs` | The universities index: destination, level and name filters, sorting by size, and the links to each university and its programs |
| `program-options.mjs` | Requesting options for a new and a registered student, the team's list, shortlisting it all, linking, archiving and branch isolation (needs the catalogue) |
| `programs.mjs` | The program and university pages, the admin edit screen and its rules, and that an unverified fee never reads as free |
| `search-upgrades.mjs` | Program labels (bulk and one at a time), several levels and seasons at once, chip counts, open or closed by deadline, eligibility from typed scores, the universities view, compare and download, and the new program-page details (needs the catalogue) |
| `student-profile.mjs` | Mailing address and second citizenship, the background questions and their rules, important contacts, the ACT, section and tab status, the visa-refusal warning, and application priority on the file, list, filter, sort and export |
| `documents-share.mjs` | Guidance and a sample per document type, a text file refused as a sample, sharing one file with the student, what the portal can and cannot open, and stopping the share |
| `billing.mjs` | Billing companies with PAN, GSTIN, LUT and IFSC rules, the limit of four, editing without the account number, the default, a payout to a chosen company and the team's view, removal rules, the owner's switch that hides commission from counsellors, and the commission structure page |
| `directory.mjs` | The team's contact list with its rules and escalation levels, quick links, promotional schemes with dates, destinations and who is told, the partner pages and dashboard cards, and the owner's commission switch |
| `student-platform.mjs` | The branch's name, colour and logo on its portal and enquiry form with the colour and file rules, the WhatsApp switches, and the sign-up question builder with answers on the enquiry |
| `rich-prep.mjs` | Comment formatting (the format bar, what renders and what stays text, previews) and the branch test preparation page: courses and their rules, the owner's switch, and an enquiry from the page |
| `payments.mjs` | The owner's Razorpay keys (sealed, never shown again), a partner paying a due fee against a stand-in for Razorpay's API, the signed webhook marking it paid once, the lists, and the switch. Start the server with `RAZORPAY_API_BASE=http://localhost:4010` |
| `ai.mjs` | AI features against a stand-in for Anthropic's API: off without a key, the owner's settings, the assistant and its catalogue tool, a practice interview that never sends the student's name, reading a passport into the profile after a person checks it, the course finder keeping only what the portal itself offers when the AI answers, the monthly allowance and the switch. Start the server with `ANTHROPIC_API_BASE=http://localhost:4011` |
| `team.mjs` | The branch owner's Team page: adding counsellors within the tier's seats with a one-time password, switching one off (students move to the owner, sign-in ends at once) and back on, a password reset, and who cannot reach it |
| `bulk.mjs` | Bulk upload: students from CSV (fill blanks only, locked profiles left alone, CGPA kept, consent needed), students with no email kept apart on one family number, enquiries from Excel, the team's branch column with its part-name match and its list of branches, problems gathered into one line, application and commission updates through the same rules as the screens, and who cannot upload |
| `finder.mjs` | The course finder: the one-screen form and the guided three questions, a description read into the answers without an AI key, the course box's suggestions, the matches with their reasons, the panel that narrows them with counts, the sorts, paging, offer turnaround set one at a time and in bulk, and the filters for public or private, highest qualification and a study gap in months (needs the catalogue) |
| `shortlist.mjs` | Shortlisting from search and a program page, the side by side comparison, removal, read-only roles and branch isolation |

Screenshots land in `/tmp/smoke-*`. Each script exits non-zero if a check fails.

Each script expects the seed it starts from, so re-seed between runs rather than
chaining them: `enquiries.mjs` converts an enquiry into a student, which is
enough to make `money.mjs` look broken afterwards. `roles.mjs` and
`publicform.mjs` also trip the sign-in rate limiter if they are run repeatedly
without a restart, which reads as a failure but is the limiter doing its job.

`catalogue.mjs` additionally wants the real catalogue loaded:

```bash
npm run db:seed && npx tsx scripts/import-catalogue.ts
```

Two things to know: every context sends its own `x-forwarded-for`, because the
sign-in rate limiter would otherwise count one role's attempts against the next,
and external requests are blocked so a page never waits on Google Fonts.
`super-actions.mjs` changes a seeded password, `money.mjs` settles a commission,
and `golive.mjs` deletes the sample data outright, so re-seed before running any
of those a second time. `golive.mjs` in particular leaves the database with one
organisation and one account, which is the point of it.

Two more things, both consequences of the polish pass:

- Success messages are toasts now, not inline notes, so assert against
  `[role="status"]` rather than `main`.
- There are no loading skeletons any more (see the main README), but the
  `settle` helper that waits for `[aria-busy="true"]` to detach is harmless.
  Use `waitForURL` rather than `page.url()` when checking that a role is
  redirected away, and after a client-side link wait for the new content.

If a whole suite suddenly fails at the sign-in step, it is almost certainly the
rate limiter: eight attempts per email per ten minutes. `select outcome, count(*)
from sign_in_events where created_at > now() - interval '10 minutes' group by
outcome` will show `throttled` rows. Restarting the server clears the counters,
since they are held in memory.

If several suites run back to back, the same staff account signs in often enough
to trip the per-account limit (eight attempts in ten minutes) and every check in
that suite fails at once with the login page. That is the limiter working, not a
regression: restart the server, which clears the in-memory buckets, and run
again.
