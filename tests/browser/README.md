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
| `universities.mjs` | The universities index: destination, level and name filters, sorting by size, and the links to each university and its programs |
| `programs.mjs` | The program and university pages, the admin edit screen and its rules, and that an unverified fee never reads as free |
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
- Pages stream behind a loading skeleton, so `domcontentloaded` fires before the
  content arrives. Wait for `[aria-busy="true"]` to detach, and use `waitForURL`
  rather than `page.url()` when checking that a role is redirected away.

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
