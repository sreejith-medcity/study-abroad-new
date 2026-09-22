import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Clearing the sample data before the portal carries real students.
 *
 * What counts as sample data is deliberately narrow and stated on the screen:
 * accounts on a .test or example.com address, students and enquiries on
 * example.com, and any partner organisation left with nothing real in it. A real
 * branch with real staff can never match, because matching requires that every
 * account and every student in it is itself sample data.
 */

/**
 * The rule, as SQL, so the count and the delete can never drift apart. One
 * statement per call: the driver will accept several in a single string and then
 * quietly run only part of it, which is not a risk worth taking here.
 */
const SCOPE = [
  sql`create temporary table _users on commit drop as
        select id from users where email like '%.test' or email like '%@example.com'`,
  sql`create temporary table _students on commit drop as
        select id from students where email like '%@example.com'`,
  sql`create temporary table _orgs on commit drop as
        select o.id from organizations o
        where o.type <> 'HQ'
          and not exists (select 1 from users u where u.org_id = o.id and u.id not in (select id from _users))
          and not exists (select 1 from students s where s.org_id = o.id and s.id not in (select id from _students))`,
  sql`create temporary table _apps on commit drop as
        select a.id from applications a
        where a.student_id in (select id from _students) or a.org_id in (select id from _orgs)`,
];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function scope(tx: Tx) {
  for (const statement of SCOPE) await tx.execute(statement);
}

export type DemoInventory = {
  organisations: { id: string; name: string; city: string | null }[];
  accounts: { id: string; name: string; email: string; role: string }[];
  counts: Record<string, number>;
  keeping: Record<string, number>;
};

/** What the cleanup would remove, and what it would leave behind. */
export async function demoInventory(): Promise<DemoInventory> {
  return db.transaction(async (tx) => {
    await scope(tx);
    const organisations = await tx.execute<{ id: string; name: string; city: string | null }>(
      sql`select id, name, city from organizations where id in (select id from _orgs) order by name`,
    );
    const accounts = await tx.execute<{ id: string; name: string; email: string; role: string }>(
      sql`select id, name, email, role::text as role from users where id in (select id from _users) order by email`,
    );
    const [counts] = await tx.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from _students) as students,
        (select count(*)::int from _apps) as applications,
        (select count(*)::int from enquiries where org_id in (select id from _orgs) or email like '%@example.com') as enquiries,
        (select count(*)::int from commissions where application_id in (select id from _apps) or org_id in (select id from _orgs)) as commissions,
        (select count(*)::int from notifications) as notifications,
        (select count(*)::int from audit_logs where actor_id in (select id from _users)) as audit_entries
    `);
    const [keeping] = await tx.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from organizations where id not in (select id from _orgs)) as organisations,
        (select count(*)::int from users where id not in (select id from _users)) as accounts,
        (select count(*)::int from programs) as programs,
        (select count(*)::int from universities) as universities,
        (select count(*)::int from status_definitions) as statuses,
        (select count(*)::int from resources) as resources,
        (select count(*)::int from commission_rules) as commission_rules
    `);
    return {
      organisations,
      accounts,
      counts: { ...counts, organisations: organisations.length, accounts: accounts.length },
      keeping,
    };
  });
}

/**
 * Removes it, in one transaction. A real record that a sample account happened to
 * touch keeps its own row and loses only the pointer, and a library item, which
 * cannot be left without an owner, passes to whoever runs this.
 */
export async function clearDemoData(actorId: string): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
    await scope(tx);
    const before = await tx.execute<{ n: number }>(sql`select count(*)::int as n from _users`);

    // Order matters: children first, then the pointers into what survives, then
    // the accounts and the organisations themselves.
    const steps = [
      sql`delete from wallet_entries where org_id in (select id from _orgs)
            or commission_id in (select id from commissions where application_id in (select id from _apps) or org_id in (select id from _orgs))`,
      sql`delete from payout_requests where org_id in (select id from _orgs)`,
      sql`delete from commissions where application_id in (select id from _apps) or org_id in (select id from _orgs)`,
      sql`delete from edit_requests where student_id in (select id from _students) or requested_by_id in (select id from _users)`,
      sql`delete from applications where id in (select id from _apps)`,
      sql`delete from enquiries where org_id in (select id from _orgs) or email like '%@example.com'`,
      sql`delete from tickets where org_id in (select id from _orgs)`,
      sql`delete from option_requests where org_id in (select id from _orgs)`,
      sql`delete from service_requests where student_id in (select id from _students) or org_id in (select id from _orgs)`,
      sql`delete from students where id in (select id from _students) or org_id in (select id from _orgs)`,

      sql`update app_settings set updated_by_id = null where updated_by_id in (select id from _users)`,
      sql`update documents set uploaded_by_id = null where uploaded_by_id in (select id from _users)`,
      sql`update comments set author_id = null where author_id in (select id from _users)`,
      sql`update wallet_entries set created_by_id = null where created_by_id in (select id from _users)`,
      sql`update enquiries set assigned_to_id = null where assigned_to_id in (select id from _users)`,
      sql`update students set created_by_id = null, assigned_to_id = null
            where created_by_id in (select id from _users) or assigned_to_id in (select id from _users)`,
      sql`update resources set created_by_id = ${actorId} where created_by_id in (select id from _users)`,

      sql`delete from notifications`,
      sql`delete from audit_logs where actor_id in (select id from _users)`,
      sql`delete from users where id in (select id from _users)`,
      sql`delete from organizations where id in (select id from _orgs)`,
    ];
    for (const step of steps) await tx.execute(step);

    const [after] = await tx.execute<Record<string, number>>(sql`
      select
        (select count(*)::int from organizations) as organisations,
        (select count(*)::int from users) as accounts,
        (select count(*)::int from students) as students,
        (select count(*)::int from applications) as applications
    `);
    return { ...after, removedAccounts: Number(before[0]?.n ?? 0) };
  });
}
