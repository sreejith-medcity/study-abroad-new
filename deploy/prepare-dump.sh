#!/usr/bin/env bash
# Makes a Supabase dump restorable into the plain Postgres of the compose stack.
#
#   ./prepare-dump.sh < from-supabase.sql > ready.sql
#
# pg_dump of the public schema on Supabase carries a few things this box has no
# use for, or cannot run: row level security and its policies, which refer to
# Supabase's own roles; CREATE EXTENSION lines, when the extension is in the
# dump at all; a SET for a parameter a newer Postgres added; and the trigram
# index operator classes qualified with Supabase's "extensions" schema, where
# move-database.sh has put pg_trgm in "public" instead. Those are dropped or
# rewritten, and each kind is counted on stderr.
#
# Anything else that still refers to a Supabase-only schema (auth, storage,
# extensions, realtime, vault and so on) or to a Supabase role outside the
# table data is printed and the script exits 1, so a restore is never attempted
# with a statement that is going to fail halfway through. Table data is never
# touched: the check skips every COPY block.
set -euo pipefail

exec awk '
function count(kind) { dropped[kind]++ }
BEGIN { in_copy = 0; in_policy = 0; bad = 0; rewritten = 0 }

# Table data goes through untouched, whatever it says.
in_copy { print; if ($0 == "\\.") in_copy = 0; next }
/^COPY / { in_copy = 1; print; next }

# A policy can wrap onto several lines; skip to the one ending the statement.
in_policy { if ($0 ~ /;[ \t]*$/) in_policy = 0; next }
/^CREATE POLICY / { count("policies"); if ($0 !~ /;[ \t]*$/) in_policy = 1; next }

/^SET transaction_timeout/ { count("newer SET parameters"); next }
/^\\restrict / || /^\\unrestrict / { count("psql restrict markers"); next }
/^CREATE EXTENSION / || /^COMMENT ON EXTENSION / { count("extension statements"); next }
/^ALTER TABLE .* (ENABLE|DISABLE|FORCE|NO FORCE) ROW LEVEL SECURITY;/ { count("row level security switches"); next }
/^(GRANT|REVOKE) / { count("grants"); next }
/^ALTER .* OWNER TO / { count("owner changes"); next }

{
  if ($0 ~ /^CREATE SCHEMA (public|drizzle);/) { sub(/^CREATE SCHEMA /, "CREATE SCHEMA IF NOT EXISTS "); count("schema creations made tolerant") }
  rewritten += gsub(/extensions\.gin_trgm_ops/, "public.gin_trgm_ops")
  rewritten += gsub(/extensions\.gist_trgm_ops/, "public.gist_trgm_ops")

  if ($0 ~ /(^|[^A-Za-z0-9_"])(extensions|auth|storage|realtime|_realtime|graphql|graphql_public|vault|pgsodium|supabase_functions|supabase_migrations|net|cron)\.[A-Za-z_]/ \
      || $0 ~ /(^|[^A-Za-z0-9_"])(TO|FROM|FOR) +(anon|authenticated|service_role|dashboard_user|supabase_admin|supabase_auth_admin|supabase_storage_admin)([^A-Za-z0-9_]|$)/) {
    bad++
    printf("line %d still needs Supabase: %s\n", NR, $0) > "/dev/stderr"
  }
  print
}

END {
  for (k in dropped) printf("dropped %d %s\n", dropped[k], k) > "/dev/stderr"
  if (rewritten) printf("rewrote %d trigram operator class references from extensions to public\n", rewritten) > "/dev/stderr"
  if (bad) {
    printf("%d line(s) refer to something only Supabase has. Nothing was restored; look at them above and fix the dump by hand.\n", bad) > "/dev/stderr"
    exit 1
  }
}'
