# Whose students somebody sees: the audit

The rule is in the README under "Whose students somebody sees" and in
`src/server/scope.ts`. A counsellor role without "See every student" sees only
their own students: the ones assigned to them, the ones they registered, the
ones nobody at their branch has been given, and the ones they are on by name,
as the officer, or through a document they checked. A branch head, a senior
counsellor, a desk counsellor and the head office roles see every student in
their organisation scope. A sub-agent sees only its own organisation.

The first pass applied the rule to the students list, the board, the search
palette, the application deadlines and the placement tracker. This pass went
through everything else a counsellor can reach. Each place is listed below
with what was found and what, if anything, changed. Every fix reuses
`studentWhere`, `ownStudentsOnly`, `ownApplicationsOnly` or `mayOpenStudent`
from `src/server/scope.ts`; nothing re-implements the rule. The views of the
roles that see every student are unchanged, and View-as on the dashboards is
untouched.

## Fixed

**Student picker API**, `src/app/api/pick/students/route.ts`. Fed the search
screen's "check eligibility for" combobox from the whole organisation. Now
filters with `studentWhere`, so typing a colleague's student's name finds
nothing.

**Course finder**, `src/app/(app)/finder/page.tsx`. Both the "a student's file"
select and the student read from the `student` address parameter were scoped
by organisation only, so a counsellor who knew an id could read another
counsellor's student's scores through the eligibility check. Both now use
`studentWhere`. `src/server/finder.ts` itself holds no student query; it only
names `student` among the filter keys.

**Search screen**, `src/app/(app)/search/page.tsx`. The same two things: the
student named in the address and the first few students offered before
anything is typed. Both now use `studentWhere`.

**Search export**, `src/app/api/programs/search-export/route.ts`. Reads a
student's scores to narrow the spreadsheet, scoped by organisation only. Now
`studentWhere`.

**Program page**, `src/app/(app)/programs/[id]/page.tsx`. The "check a
student" picker and the student named in the address, used for the fit and
the shortlist button. Now `studentWhere`.

**Events**, `src/app/(app)/events/page.tsx` and `src/server/events.ts`. The
register picker offered every student of the branch, and "Your students
registered" listed every registration made from the branch. The picker now
uses `studentWhere`; the registrations shown are the ones whose student is
within `studentWhere`, found by one query over the registered ids. Registering
already went through `getStudentForUser`. Removing a student's seat now also
asks `mayOpenStudent`, so a counsellor cannot take a colleague's student off
the list.

**Program options, new request**, `src/app/(app)/program-options/new/page.tsx`.
The student select now uses `studentWhere`. The request action already went
through `getStudentForUser`.

**Program options, linking a request to a file**,
`src/app/(app)/program-options/page.tsx`. The "link to a student" select
offered every student of the request's branch. Now the request's branch's
students within `studentWhere`. The link action already went through
`getStudentForUser`.

**Practice interview**, `src/app/(app)/interview/page.tsx` and
`src/server/ai-actions.ts`. The applications offered for practice were the
branch's; they now carry `ownApplicationsOnly`. Past sessions name the student
they were for, so a session is listed and opened only where it was about no
student, was the person's own, or is about a student within `studentWhere`.
The interview action checked the application's organisation; it now asks
`mayOpenStudent` of the application's student. The assistant chat and the
document extraction were already right: the chat reads no student data, and
extraction already used `mayOpenStudent`.

**A colleague's day**, `src/server/tasks.ts` and `src/app/(app)/my-day/page.tsx`.
Opening somebody else's day listed all their tasks, each naming a student.
`taskList` now takes the viewer and, where the viewer does not see every
student, keeps the viewer's own tasks, tasks about nobody in particular, and
tasks about students within `ownStudentsOnly`. The student's own timeline tab
passes no viewer, because it is already reached through a student that opens.

**Commission statement**, `src/server/commission.ts` and
`src/app/(app)/commission/page.tsx`. Each line names a student and an
application. `commissionWhere` and `commissionTotals` take the same `mine`
condition the applications list takes, and the branch statement passes
`ownApplicationsOnly`. A branch owner's statement is unchanged. The wallet is
the branch's purse and names nobody, so it is left as it was.

**Submission pack download**, `src/app/api/packs/[id]/route.ts`. Matched the
student's organisation only. Now `mayOpenStudent`, the same as the document
download.

## Checked and left as they are

**Enquiries**, `src/server/enquiries.ts` and `src/app/(app)/enquiries`. The
branch's shared pool before a student exists. Left on purpose.

**Program options list**, `src/app/(app)/program-options/page.tsx` and
`src/server/option-access.ts`. A request is the branch's, often for somebody
without a file yet, and the team answers it for the branch. Left as the
branch's shared list, like enquiries. Only the student pickers on it changed.

**Comments and contact log**. Read on the student's tabs, through
`getStudentForUser`, or on an application through `getApplicationForUser`,
both of which ask `mayOpenStudent`. The actions that write them do the same.
Nothing to change.

**Documents**. The download route and the upload already asked
`mayOpenStudent` or `getStudentForUser`.

**Dashboards and the dashboard export**, `src/server/dashboard-lens.ts`. A
counsellor's dashboard reads the students assigned to them, which is narrower
than the rule, not wider. View-as for the super admin and operations is kept.

**Applications export**, `src/app/api/applications/export/route.ts`. Already
passes `ownApplicationsOnly`.

**Notifications**. A link to a student is checked with `mayOpenStudent` before
it is followed.

**Documentation queue, desk, work queue, agents, services, invoices, income,
insights, journal reports**. Reachable only by the head office roles, by the
branch owner, or by the person's own journal. The invoice queue is gated by
"Read invoices", which a counsellor does not have by default; if an owner
gives it, the queue is the branch's, which is the matrix's choice.

**Applications badge in the menu**, `src/server/nav-counts.ts`. Counts the
branch's files awaiting the partner, as raw SQL, for the whole branch. It is a
number, not a name, so it is left; it can disagree with a counsellor's list
and is worth revisiting with the count functions rather than raw SQL.

**Student platform, portal, CRM and WhatsApp routes**. Not reached by a
signed-in counsellor.

## Tests

`tests/browser/scope.mjs` seeds the same three students at Kottayam and adds a
webinar with two registrations, a past practice session and two tasks on the
senior's desk. Signed in as the counsellor, it checks the student picker API,
the finder, the search screen, the events page, the program options request,
the program page, the practice interview, a colleague's day and the
applications export. Signed in as the branch head, it checks the same places
show everybody. The commission statement and the pack download are not in the
suite, because seeding a commission line or a built pack needs more of the
desk's workflow than the suite sets up.
