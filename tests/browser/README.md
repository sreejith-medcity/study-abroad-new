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
| `portal.mjs` | The student portal: language switch, documents, messages, isolation, and the invite |
| `publicform.mjs` | The public enquiry form, consent, the branch QR panel and org isolation |
| `super-smoke.mjs` | Super admin gating: audit log, role controls, health detail |
| `super-actions.mjs` | Role change, password reset and the forced password change |

Screenshots land in `/tmp/smoke-*`. Each script exits non-zero if a check fails.

Two things to know: every context sends its own `x-forwarded-for`, because the
sign-in rate limiter would otherwise count one role's attempts against the next,
and external requests are blocked so a page never waits on Google Fonts.
`super-actions.mjs` changes a seeded password, so re-seed after running it.

If several suites run back to back, the same staff account signs in often enough
to trip the per-account limit (eight attempts in ten minutes) and every check in
that suite fails at once with the login page. That is the limiter working, not a
regression: restart the server, which clears the in-memory buckets, and run
again.
