#!/usr/bin/env bash
# Moves the database from Supabase onto this box.
#
# Run it on the VPS, from the deploy directory. It reads the Supabase
# connection string from the environment so the password is never written into
# a file or a command history:
#
#   read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL
#   ./move-database.sh
#
# It dumps, keeps the dump, and restores into the portal database. Nothing is
# dropped: it refuses to run if the portal database already holds tables, so a
# second run cannot quietly write over a day of work.
set -euo pipefail
cd "$(dirname "$0")"

: "${SUPABASE_DB_URL:?export SUPABASE_DB_URL first, with read -rs so it stays out of the history}"
source .env

stamp=$(date +%Y-%m-%d-%H%M)
dump="backups/from-supabase-$stamp.sql"
mkdir -p backups

echo "Checking what is already in the portal database"
tables=$(docker compose exec -T db psql -U portal -d portal -Atc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$tables" != "0" ]; then
  echo "The portal database already holds $tables tables. Stopping, rather than writing over them."
  echo "If this is a retry and you mean to start again:"
  echo "  docker compose exec -T db psql -U portal -d portal -c 'drop schema public cascade; create schema public;'"
  exit 1
fi

echo "Dumping from Supabase into $dump"
docker run --rm -i -e PGURL="$SUPABASE_DB_URL" postgres:16 \
  sh -c 'pg_dump "$PGURL" --no-owner --no-acl --schema=public' > "$dump"
echo "Dumped $(wc -c < "$dump") bytes"

echo "Restoring into the portal database"
docker compose exec -T db psql -U portal -d portal -v ON_ERROR_STOP=1 < "$dump"

echo "Counting what arrived"
docker compose exec -T db psql -U portal -d portal -Atc "
  select 'students ' || (select count(*) from students)
  union all select 'applications ' || (select count(*) from applications)
  union all select 'documents ' || (select count(*) from documents)
  union all select 'users ' || (select count(*) from users)
  union all select 'organizations ' || (select count(*) from organizations)"
echo "Done. The dump is kept at $dump."
