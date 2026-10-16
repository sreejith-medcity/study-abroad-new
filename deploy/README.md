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

## What ends up where

| | |
|---|---|
| App | `portal-app`, listening on 127.0.0.1:3200, Caddy in front |
| Database | `portal-db`, Postgres 16, on the `pgdata` volume, not published |
| Documents | the `uploads` volume, mounted at `/data/uploads` |
| Dumps | `deploy/backups/portal-<date>.sql.gz`, one a night at 02:15, kept 14 days |

## Before the evening of the move

1. Clone the repository on the VPS, somewhere permanent:

       cd /opt && git clone https://github.com/sreejith-medcity/study-abroad-new portal && cd portal/deploy

2. Make the settings file. The database password is made here and never
   leaves the box:

       cp env.example .env
       echo "POSTGRES_PASSWORD=$(openssl rand -base64 30)" >> .env

   Then open `.env` and fill in the rest. `AUTH_SECRET` should be the one the
   live site uses today, so nobody is signed out by the move; copy it from
   Hostinger's Node.js environment screen. Set `PUBLIC_BASE_URL` to
   `https://portal-vps.medcityoverseas.com` for the test, and change it to the
   live address at cutover.

3. Build and start it:

       docker compose up -d --build

4. Point the test name at the box: an A record for
   `portal-vps.medcityoverseas.com` to 82.112.231.213. Add the Caddy entry
   from `Caddyfile.portal`, validate, reload.

5. Bring the data over. Both scripts ask for their secret through the
   environment rather than a file, so nothing lands in the shell history:

       read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL
       ./move-database.sh

       export SUPABASE_URL=https://cjynaevdkugubfegnldw.supabase.co
       read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
       python3 move-documents.py
       docker compose cp documents/. app:/data/uploads/

6. Walk the test site: sign in, open a student, **upload a document**, open a
   document somebody uploaded before the move, run a search, open the Course
   finder, check a student portal login. This is the point of the test name:
   everything is real except who is using it.

## The evening of the move

The live database keeps changing until the moment the name is switched, so
the data is brought over a second time, with nobody working in the portal.

1. Tell the branches the portal is closed for the next half hour.
2. On Hostinger, stop the Node application, so nothing can write to Supabase
   behind us.
3. Start again on the VPS with the fresh data:

       docker compose exec -T db psql -U portal -d portal -c 'drop schema public cascade; create schema public;'
       read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL
       ./move-database.sh
       python3 move-documents.py
       docker compose cp documents/. app:/data/uploads/

   The document copy skips what it already has, so this pass only fetches
   what was uploaded since the first one.
4. Set `PUBLIC_BASE_URL=https://doc.medcityoverseas.com` in `.env` and
   `docker compose up -d`.
5. Point `doc.medcityoverseas.com` at 82.112.231.213. Caddy already answers
   for that name, so the certificate is issued as soon as the DNS moves.
6. Watch `docker compose logs -f app` while somebody signs in, uploads a
   document and opens a file from before the move.

## If it goes wrong

Nothing is deleted from Hostinger or Supabase by any of this. Point the DNS
back, start the Node application on Hostinger again, and the portal is exactly
as it was; the only work lost is whatever was typed into the VPS copy after
the switch. Keep both running for a week before taking anything down.

## Afterwards

- Nightly dumps land in `deploy/backups`. Copy them off the box as well:
  a VPS snapshot and the dumps are two different kinds of safety.
- Releases: `git pull && docker compose up -d --build`, and
  `docker compose --profile tools run --rm migrate` when the schema moved.
- Supabase can then be left for storage only, or closed entirely. Nothing in
  the app needs it once the documents are on the volume: with `SUPABASE_URL`
  unset, uploads go to `/data/uploads` and are served from there.
