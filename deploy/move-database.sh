#!/usr/bin/env bash
# Moves the database from Supabase onto this box.
#
# Run it on the VPS, from the deploy directory, with the stack up. It reads the
# Supabase connection string from the environment so the password is never
# written into a file or a command history:
#
#   read -rs SUPABASE_DB_URL && export SUPABASE_DB_URL
#   ./move-database.sh
#
# Use the Session pooler string from the Supabase dashboard (Connect, then
# Session pooler, port 5432). The direct string is IPv6 only and the transaction
# pooler on 6543 cannot serve pg_dump.
#
# What it does, in order: looks at what is already in the portal database and
# refuses to write over it unless called with --replace; dumps the public and
# drizzle schemas from Supabase with a pg_dump of the same major version as the
# source; runs the dump through prepare-dump.sh, which drops what only Supabase
# can run and stops on anything it does not recognise; creates pg_trgm in the
# portal database; restores in one transaction, so a failure leaves the database
# empty rather than half full; then counts the key tables on both sides and
# refuses to call it done unless they agree.
#
#   ./move-database.sh --replace   drops what is here first; asks before it does
set -euo pipefail
cd "$(dirname "$0")"

: "${SUPABASE_DB_URL:?export SUPABASE_DB_URL first, with read -rs so it stays out of the history}"
replace=0
if [ "${1:-}" = "--replace" ]; then replace=1; fi

# The URL is handed to the helper containers through the environment, not on
# their command line, so it never shows in ps on the host.
source_sql() {
  docker run --rm -i -e SUPABASE_DB_URL "$1" sh -c 'psql "$SUPABASE_DB_URL" -X -Atc "$0"' "$2"
}
target_sql() {
  docker compose exec -T db psql -U portal -d portal -X -Atc "$1"
}
tables=(users students applications documents programs universities organizations)
counts_sql() {
  local parts=() t
  for t in "${tables[@]}"; do parts+=("select '$t|' || count(*) from $t"); done
  printf '%s union all ' "${parts[@]}" | sed 's/ union all $//'
}

if [ -f .env ]; then
  password=$(grep -E '^POSTGRES_PASSWORD=' .env | cut -d= -f2- || true)
  if printf '%s' "$password" | grep -q '[/@#?%]'; then
    echo "Warning: POSTGRES_PASSWORD in .env contains / @ # ? or %, which break the DATABASE_URL the app is given."
    echo "The database itself will restore, but the app will not connect. Make it with: openssl rand -hex 24"
  fi
fi

echo "Checking what is already in the portal database"
existing=$(target_sql "select count(*) from information_schema.tables where table_schema in ('public', 'drizzle')")
if [ "$existing" != "0" ]; then
  if [ "$replace" = "1" ]; then
    echo "The portal database holds $existing tables. --replace was given, so they will be dropped."
    printf 'Type replace to go on: '
    read -r answer
    if [ "$answer" != "replace" ]; then echo "Stopped. Nothing was changed."; exit 1; fi
    target_sql "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;" > /dev/null
    echo "Dropped."
  else
    echo "The portal database already holds $existing tables. Stopping, rather than writing over them."
    echo "If this is the second pass on the night of the move, or a retry, run:"
    echo "  ./move-database.sh --replace"
    exit 1
  fi
fi

echo "Asking Supabase which Postgres it runs"
version_num=$(source_sql postgres:17 "show server_version_num")
major=$(printf '%s' "$version_num" | cut -c1-2)
case "$major" in
  15|16|17|18) ;;
  *) echo "Unexpected server_version_num '$version_num' from Supabase. Stopping."; exit 1 ;;
esac
dump_image="postgres:$major"
echo "Postgres $major, so the dump is taken with $dump_image"

has_drizzle=$(source_sql "$dump_image" "select count(*) from information_schema.tables where table_schema = 'drizzle' and table_name = '__drizzle_migrations'")
schemas=(--schema=public)
if [ "$has_drizzle" = "1" ]; then
  schemas+=(--schema=drizzle)
else
  echo "Warning: Supabase has no drizzle.__drizzle_migrations table, so the migration history cannot come across."
  echo "Do not run the migrate service afterwards without recording the applied migrations first."
fi

echo "Counting the key tables in Supabase"
source_counts=$(source_sql "$dump_image" "$(counts_sql)")
printf '%s\n' "$source_counts" | sed 's/^/  /; s/|/ /'

stamp=$(date +%Y-%m-%d-%H%M)
mkdir -p backups
raw="backups/from-supabase-$stamp.sql"
ready="backups/from-supabase-$stamp.ready.sql"

echo "Dumping from Supabase into $raw"
docker run --rm -i -e SUPABASE_DB_URL "$dump_image" sh -c 'pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges --no-publications --no-subscriptions --no-security-labels --no-tablespaces --no-comments "$@"' pg_dump "${schemas[@]}" > "$raw"
echo "Dumped $(wc -c < "$raw") bytes"
if [ ! -s "$raw" ]; then echo "The dump is empty. Stopping."; exit 1; fi

echo "Preparing the dump for plain Postgres"
./prepare-dump.sh < "$raw" > "$ready"

echo "Creating the trigram extension in the portal database"
target_sql "create extension if not exists pg_trgm with schema public" > /dev/null

echo "Restoring into the portal database, in one transaction"
docker compose exec -T db psql -U portal -d portal -X -q -v ON_ERROR_STOP=1 --single-transaction < "$ready"
target_sql "analyze" > /dev/null

echo "Counting what arrived"
target_counts=$(target_sql "$(counts_sql)")
mismatch=0
while IFS='|' read -r table here; do
  there=$(printf '%s\n' "$source_counts" | awk -F'|' -v t="$table" '$1 == t { print $2 }')
  if [ "$here" = "$there" ]; then
    printf '  %-14s %8s  same on both sides\n' "$table" "$here"
  else
    printf '  %-14s %8s here, %s in Supabase  MISMATCH\n' "$table" "$here" "$there"
    mismatch=1
  fi
done <<< "$target_counts"
if [ "$mismatch" = "1" ]; then
  echo "The counts differ. Do not switch the DNS on this copy; look at the dump in $raw."
  exit 1
fi

if [ "$has_drizzle" = "1" ]; then
  recorded=$(target_sql "select count(*) from drizzle.__drizzle_migrations")
  in_repo=$(grep -c '"tag"' ../drizzle/meta/_journal.json || true)
  echo "Migration history: $recorded recorded, $in_repo in this checkout."
  if [ "$recorded" -lt "$in_repo" ]; then
    echo "Run: docker compose --profile tools run --rm migrate   to apply the $((in_repo - recorded)) Supabase never had."
  else
    echo "The schema is current; migrate has nothing to do."
  fi
fi

echo "Done. The raw dump is kept at $raw and what was restored at $ready."
