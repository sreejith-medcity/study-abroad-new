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

Screenshots land in `/tmp/smoke-*`. Each script exits non-zero if a check fails.

Two things to know: every context sends its own `x-forwarded-for`, because the
sign-in rate limiter would otherwise count one role's attempts against the next,
and external requests are blocked so a page never waits on Google Fonts.
`super-actions.mjs` changes a seeded password and `money.mjs` settles a commission,
so re-seed before running either a second time.

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
