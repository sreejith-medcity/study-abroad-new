# Moving the portal onto the VPS

The box is **srv581286**, 82.112.231.213, Ubuntu 24.04, the one already
running Caddy. Caddy stays the front door. The portal, its database and the
student documents all live in one compose stack, and nothing in it is
published to the internet except through Caddy.

Why the move: on Hostinger, LiteSpeed sits in front of the app and answers
some requests itself. It refuses every document upload with a 500 the app
never sees, whatever the file size. Nothing we can write in the app can
change that, because the app is not the one answering. On the VPS there is
no such layer.

Secrets are typed with `read -rs`, which echoes nothing and keeps them out of
the shell history. Nothing in this directory ever holds a real value.

## Tonight

In order. The times are what each step takes with nobody waiting on it; the
portal is closed from step 3 to step 9, which is about half an hour.

| | Step | About |
|---|---|---|
| 1 | On the VPS: `cd /opt/portal && git pull`, then `APP_COMMIT=$(git rev-parse --short HEAD) docker compose -f deploy/docker-compose.yml up -d --build` so tonight's code is the one that runs. Wait for `docker compose -f deploy/docker-compose.yml ps` to show the app `healthy`. | 5 min |
| 2 | Tell the branches the portal is closed for the next half hour. Lower the TTL on `doc.medcityoverseas.com` to 300 if it is not already. | 2 min |
| 3 | On Hostinger, stop the Node application, so nothing can write to Supabase behind us. | 1 min |
| 4 | `cd /opt/portal/deploy`, then `read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL`, then `./move-database.sh --replace`. It asks you to type `replace`, then dumps, restores and prints the row counts of both sides. It stops by itself if they differ. | 5 to 10 min |
| 5 | If step 4 ended with "Run: docker compose --profile tools run --rm migrate", run exactly that. It applies only what Supabase never had. | 1 min |
| 5a | `docker compose exec -T db psql -U portal -d portal -v ON_ERROR_STOP=1 < ausbildung-process.sql`. The written Ausbildung process: its statuses, documents and hand-over addresses. Safe to run twice. | 1 min |
| 6 | `export SUPABASE_URL=https://cjynaevdkugubfegnldw.supabase.co`, then `read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY`, then `python3 move-documents.py`. It fetches only what the first pass did not have and says how many files the database refers to that are not in the folder. That number should be 0. | 2 to 10 min |
| 7 | `docker compose cp documents/. app:/data/uploads/` then `docker compose exec -u root app chown -R portal:portal /data/uploads`. Without the chown the files belong to root and the app cannot write beside them. | 2 min |
| 8 | Set `PUBLIC_BASE_URL=https://doc.medcityoverseas.com` in `.env`, then `docker compose up -d`. Check `curl -s https://portal-vps.medcityoverseas.com/api/health` says `{"ok":true}`. | 1 min |
| 9 | Point `doc.medcityoverseas.com` at 82.112.231.213. Caddy already answers for that name, so the certificate is issued as soon as the DNS moves. `curl -sI https://doc.medcityoverseas.com/api/health` shows `server: Caddy` once it has. | 2 to 5 min |
| 10 | Watch `docker compose logs -f app` while somebody signs in, uploads a document, opens a file from before the move, runs a search and opens the Course finder. Open What's new: the foot says the commit from step 1. | 10 min |
| 11 | In GitHub, Actions, run "Scheduled jobs" by hand with `crm`. It should say `HTTP 200`. That proves the scheduler reaches the VPS with the right `CRON_SECRET`. | 2 min |
| 12 | Tell the branches it is open. Leave Hostinger stopped and Supabase untouched for a week. | |

**Rollback**, at any point up to step 12: point the DNS back at Hostinger,
start the Node application there, and the portal is exactly as it was at step
3; nothing here deletes anything from Hostinger or Supabase.

## What ends up where

| | |
|---|---|
| App | `portal-app`, listening on 127.0.0.1:3200, Caddy in front |
| Database | `portal-db`, Postgres 16, on the `pgdata` volume, not published |
| Documents | the `uploads` volume, mounted at `/data/uploads`, owned by the app's user `portal` (uid 1001) |
| Dumps | `deploy/backups/portal-<date>.sql.gz`, one a night at 02:15, kept 14 days |
| Documents backup | `deploy/backups/uploads-<date>.tar.gz`, Sundays at 02:45, kept 5 weeks |
| Settings | `deploy/.env`, never committed, made from `env.example` |

Every variable the portal reads is listed in `docker-compose.yml` under the
app service and explained in `env.example`. The tests in
`tests/deploy-kit.test.ts` fail if the code starts reading one that is not
there.

## Before the evening of the move

This is the dress rehearsal, on the test name, with real data. Everything in
it should already be done by tonight; it is kept so the kit can be rebuilt.

1. Clone the repository on the VPS, somewhere permanent:

       cd /opt && git clone https://github.com/sreejith-medcity/study-abroad-new portal && cd portal/deploy

2. Make the settings file. The database password is made here and never
   leaves the box. Hex only: it goes into a URL, and `/`, `@`, `#`, `?` or `%`
   in it would break the connection string the app is given:

       cp env.example .env
       echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env

   Then open `.env` and fill in the rest. `AUTH_SECRET` should be the one the
   live site uses today, so nobody is signed out by the move; copy it from
   Hostinger's Node.js environment screen. `CRON_SECRET` must be the same
   value as the `CRON_SECRET` repository secret in GitHub, because that is
   what calls the scheduled jobs. Set `PUBLIC_BASE_URL` to
   `https://portal-vps.medcityoverseas.com` for the test, and change it to the
   live address at cutover. Leave the three `SUPABASE_` values empty: that is
   what makes the portal store documents on the volume.

3. Build and start it. The commit is handed in so the portal can say which one
   it runs:

       APP_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build
       docker compose ps

   The app shows `healthy` once `/api/health` answers from inside the
   container, which means it has reached the database.

4. Point the test name at the box: an A record for
   `portal-vps.medcityoverseas.com` to 82.112.231.213. Add the Caddy entry
   from `Caddyfile.portal`, then:

       caddy validate --config /etc/caddy/Caddyfile
       systemctl reload caddy

   Caddy asks the app `/api/health` every 30 seconds and answers 503 itself
   while the app is down, rather than leaving a browser hanging.

5. Bring the data over. Both scripts take their secret through the
   environment rather than a file. For the database, use the **Session
   pooler** connection string from the Supabase dashboard (Connect, then
   Session pooler, port 5432): the direct one is IPv6 only, which the VPS does
   not have, and the transaction pooler on 6543 cannot serve `pg_dump`.

       read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL
       ./move-database.sh

       export SUPABASE_URL=https://cjynaevdkugubfegnldw.supabase.co
       read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
       python3 move-documents.py
       docker compose cp documents/. app:/data/uploads/
       docker compose exec -u root app chown -R portal:portal /data/uploads

   What `move-database.sh` does, so nothing in it is a surprise: it refuses to
   write over a database that already holds tables unless told `--replace`;
   asks Supabase which Postgres it runs and dumps with a `pg_dump` of the same
   major version, because an older `pg_dump` cannot read a newer server; dumps
   the `public` and `drizzle` schemas, the second being the migration history,
   so `migrate` on the VPS does not try to run everything again; runs the
   dump through `prepare-dump.sh`, which drops what only Supabase can run (row
   level security and its policies, grants to Supabase's roles, extension
   statements) and rewrites the trigram index operator classes from Supabase's
   `extensions` schema to `public`, and stops on anything else it does not
   recognise, before a single statement is run; creates `pg_trgm` in the
   portal database, because the dump cannot carry it; restores in one
   transaction, so a failure leaves the database empty rather than half full;
   and then counts users, students, applications, documents, programs,
   universities and organizations on both sides and exits 1 if any differ.
   Both the raw dump and the prepared one stay in `backups/`.

   If it says Supabase has no `drizzle.__drizzle_migrations` table, do not run
   `migrate` until the applied migrations have been recorded; ask before going
   on.

6. Walk the test site: sign in, open a student, **upload a document**, open a
   document somebody uploaded before the move, run a search (the trigram
   indexes), open the Course finder, check a student portal login, open Go
   live and see that documents are reported as stored on a volume. This is the
   point of the test name: everything is real except who is using it.

7. Check the backup loop is alive: `docker compose logs backup` shows
   "backup loop started". Take a dump now rather than waiting for 02:15:

       docker compose exec backup /backup.sh now
       ls -la backups

## The evening of the move

The live database keeps changing until the moment the name is switched, so
the data is brought over a second time, with nobody working in the portal.
That is the **Tonight** table at the top; the notes here are what each step
relies on.

- `./move-database.sh --replace` drops `public` and `drizzle` in the portal
  database and starts clean, which is why it asks you to type the word first.
  There is no partial state: a failed restore rolls back to empty.
- `move-documents.py` keeps what the first pass fetched under
  `deploy/documents`, so the second pass pulls only the files uploaded since,
  then `docker compose cp` puts everything on the volume again and the chown
  gives it to the app's user. Files copied in as root would still be readable,
  but a new upload for a student whose folder root owns would fail.
- The scheduled jobs are called from GitHub Actions at
  `https://doc.medcityoverseas.com/api/cron/...` with the `CRON_SECRET`
  repository secret, so they follow the DNS. Nothing on the VPS runs them.
  Until the DNS moves they are still calling Hostinger, which is stopped, so
  a few runs will fail with GitHub emailing about it; they pick up on their
  own once the name points here. Step 11 is the proof.
- Sessions survive because `AUTH_SECRET` is the same and the name is the same.

## If it goes wrong

Nothing is deleted from Hostinger or Supabase by any of this. Point the DNS
back, start the Node application on Hostinger again, and the portal is exactly
as it was; the only work lost is whatever was typed into the VPS copy after
the switch. Keep both running for a week before taking anything down.

If the app container is unhealthy, `docker compose logs app` says why. The
usual one is a password in `.env` that will not fit in a URL; the move script
warns about that before it starts.

## Afterwards

### Backups

The backup container watches the clock and runs `backup.sh`: a database dump
every night at 02:15, kept 14 days, and a tarball of the documents every
Sunday at 02:45, kept 5 weeks. The dump holds every schema and the extension,
so it restores into an empty database on its own. Each is written to a `.part`
file and renamed only when complete.

Check it ran: `docker compose logs backup` has a "wrote" line per night, and
`ls -la backups` shows the files. Run one by hand: `docker compose exec backup
/backup.sh now`, or `/backup.sh documents` for the tarball.

Prove a dump restores, into a scratch database that is dropped straight after,
with yesterday's date in place of the one shown:

    docker compose exec -T db createdb -U portal restoretest && gunzip -c backups/portal-2026-10-25.sql.gz | docker compose exec -T db psql -q -U portal -d restoretest -v ON_ERROR_STOP=1 && docker compose exec -T db psql -U portal -d restoretest -Atc 'select count(*) from students' && docker compose exec -T db dropdb -U portal restoretest

Copy the dumps off the box as well: a VPS snapshot and the dumps are two
different kinds of safety.

### Releases

    cd /opt/portal && git pull
    APP_COMMIT=$(git rev-parse --short HEAD) docker compose -f deploy/docker-compose.yml up -d --build
    docker compose -f deploy/docker-compose.yml --profile tools run --rm migrate

The last line is needed only when a release added a migration; run with
nothing to do, it says so and changes nothing. What's new and `/api/version`
show the commit that was handed in.

### Health and monitoring

`/api/health` answers `{"ok":true}` to anybody once the database answers, and
the compose health check, Caddy's health check and an uptime monitor all use
it. With `HEALTH_TOKEN` set, `/api/health?token=<value>` adds the user count,
the storage backend and the time taken, and `&probe=storage` writes and deletes
a file on the volume to prove uploads work.

Signed in, the same facts and more are on one screen at `/admin/system`
(Reports, System, for the super admin, the ops manager and the Overseas
admin): the release that is running, the database with its counts and whether
its migration history matches the build, the upload folder with its free space
and a write test, the five scheduled jobs with their last run, and the health
answer. Copy report puts the whole screen on the clipboard as text, with hosts
and folders but never a password, which is what to paste when asking for help.
The super admin can run any of the five jobs from there by hand; the run is
recorded as a manual one, so it never passes for the scheduler having run.

### Supabase

Once the week is up, Supabase can be left for storage only, or closed. Nothing
in the app needs it: with `SUPABASE_URL` unset, uploads go to `/data/uploads`
and are served from there, and Go live reports documents as stored on a
volume. Delete `deploy/documents` on the VPS once the volume holds everything;
it is a second copy of several gigabytes of passports.
