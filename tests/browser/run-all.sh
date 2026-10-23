#!/bin/bash
#
# Every browser suite, one after another, each against fresh data.
#
# Run back to back against one database the suites interfere with each other:
# one archives the student another is about to look for, one uses up the last
# unchecked document, one sets a branch to check its own papers and the next
# expects it not to. Run that way the whole set reports about fifty failures
# and none of them is real. Run this way they pass.
#
# Fresh data means a copy of a prepared database, not a fresh seed. A seed
# leaves ten courses in the catalogue, and a dozen suites want the real one:
# search, the finder, universities, destinations, deadlines, shortlists and
# the assistant all read it, and every one of them failed on a full run for
# that reason alone. So the catalogue is loaded once into a template and each
# suite gets a copy, which takes half a second rather than three minutes.
#
# The template is built on the first run and reused after that. To rebuild it,
# for instance after a migration:
#
#   FRESH=1 tests/browser/run-all.sh
#
# For one suite while working on it:
#
#   npm run db:seed && npm run build && npm start &
#   node tests/browser/<name>.mjs
#
# BASE can point the suites at another port, which is how a change is compared
# against the build before it.
set -u
cd "$(dirname "$0")/../.."

PORT="${PORT:-3000}"
BASE="${BASE:-http://localhost:$PORT}"
OUT="${OUT:-/tmp/portal-suites}"
FRESH="${FRESH:-}"
hyd=0
mkdir -p "$OUT"
: > "$OUT/summary.txt"

DB=$(grep -oE "localhost:5432/[a-z0-9_]+" .env | head -1 | cut -d/ -f2)
TEMPLATE="${DB}_seed"
psqlq() { PGPASSWORD="${PGPASSWORD:-local}" psql -h localhost -U "${PGUSER:-postgres}" -d "$1" -qAtc "$2"; }

stop() {
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
    case "$cmd" in *"next-server"*|*"next start"*) kill -9 "$pid" 2>/dev/null ;; esac
  done
  sleep 1
}

# Two suites stand in for an outside service: ai answers as Anthropic's
# Messages API on 4011, payments as Razorpay's Orders API on 4010. The app
# reads both addresses when it makes the call, so pointing it at them here is
# what lets those suites run at all rather than reporting nine failures. For
# every other suite the ports are simply shut, which is the right answer for a
# test run: a stray call to a real service fails at once instead of going out.
start() {
  ANTHROPIC_API_BASE=http://localhost:4011 RAZORPAY_API_BASE=http://localhost:4010 \
  setsid npm start > "$OUT/app.log" 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")" = "200" ] && return 0
    sleep 2
  done
  echo "the server did not come up; see $OUT/app.log" >&2
  return 1
}

# The template: a seeded database with the real catalogue loaded and published.
if [ -n "$FRESH" ] || [ "$(psqlq postgres "select count(*) from pg_database where datname = '$TEMPLATE'")" != "1" ]; then
  echo "preparing $TEMPLATE (seed, catalogue, publish) — a few minutes, once"
  stop
  npm run db:seed > "$OUT/seed.log" 2>&1 || { echo "the seed failed; see $OUT/seed.log" >&2; exit 1; }
  npx tsx --env-file=.env scripts/import-catalogue.ts > "$OUT/catalogue.log" 2>&1 \
    || echo "the catalogue did not load; the suites that need it will skip or fail (see $OUT/catalogue.log)" >&2
  psqlq "$DB" "update programs set status = 'LIVE' where status = 'DRAFT'" > /dev/null
  psqlq postgres "drop database if exists $TEMPLATE" > /dev/null
  psqlq postgres "create database $TEMPLATE template $DB owner app" > /dev/null \
    || { echo "could not make the template" >&2; exit 1; }
fi

# The daily journal opens over every page from the end of the working day
# until it is answered, which is right for people and wrong for suites that
# sign in as staff and press things: run at 6 PM, every one of them would be
# clicking into the popup. So the template's working day ends a minute before
# midnight (Settings refuses a cutoff that is not after the day's end, so the
# window cannot be shut altogether), and no suite starts in the last few
# minutes of the day in India: see wait_past_midnight below. The journal suite
# sets its own clock.
psqlq "$TEMPLATE" "insert into app_settings (id) values ('app') on conflict do nothing; update app_settings set journal_day_end = '23:58', journal_out_of_hours = '23:58', journal_cutoff = '23:59' where id = 'app'" > /dev/null

# The journal is open from 23:58 to 23:59 in India on the template's clock.
# A suite that starts just before then could be clicking into it, so it waits.
wait_past_midnight() {
  while :; do
    t=$(TZ=Asia/Kolkata date +%H%M)
    [ "$t" -ge 2345 ] && [ "$t" -le 2359 ] || return 0
    sleep 20
  done
}

# Postgres will not copy or drop a database that anything is connected to, so
# the server has to be down for both, which it has to be anyway: the sign-in
# limit is held in memory and a suite that signs the same person in several
# times is otherwise refused on the ninth.
reset_db() {
  psqlq postgres "drop database if exists $DB" > /dev/null \
    && psqlq postgres "create database $DB template $TEMPLATE owner app" > /dev/null
}

for f in tests/browser/*.mjs; do
  b=$(basename "$f" .mjs)
  # Anything beginning with an underscore is a helper or somebody's scratch
  # file, not a suite.
  case "$b" in _*) continue;; esac
  stop
  wait_past_midnight
  reset_db || { echo "$b: the database could not be reset" >> "$OUT/summary.txt"; continue; }
  start || break
  # Most suites are done inside a couple of minutes. The two that walk every
  # screen for every role are not: buttons presses every control on forty-odd
  # screens eleven times over, and nav follows every link. Cut short, they
  # report nothing at all, which is worse than taking the time.
  case "$b" in buttons) limit=4200 ;; nav|navigation|routes) limit=1800 ;; *) limit=600 ;; esac
  BASE="$BASE" timeout "$limit" node "$f" > "$OUT/$b.log" 2>&1
  code=$?
  n=$(grep -c "^FAIL" "$OUT/$b.log")
  # The hydration warning is reported rather than failed (tests/browser/_errors.mjs
  # says why). Counting it here keeps it in front of whoever reads the run.
  h=$(grep -c "recovered hydration mismatch" "$OUT/$b.log")
  hyd=$((hyd + h))
  if grep -q "^SKIPPED" "$OUT/$b.log"; then
    echo "$b: skipped" >> "$OUT/summary.txt"
  elif [ "$code" -ne 0 ] || [ "$n" -gt 0 ]; then
    echo "$b: exit=$code fails=$n" >> "$OUT/summary.txt"
  else
    echo "$b: ok" >> "$OUT/summary.txt"
  fi
  printf '%s\n' "$(tail -1 "$OUT/summary.txt")"
done

echo
if [ "$hyd" -gt 0 ]; then
  echo "The hydration warning was seen $hyd times across the run. It is reported"
  echo "rather than failed; scripts/hydration-diff.mjs says what is known about it,"
  echo "and STRICT_HYDRATION=1 makes it fail again."
  echo
fi
echo "Logs in $OUT. What did not pass:"
grep -vE ': (ok|skipped)$' "$OUT/summary.txt" || echo "  everything passed"
