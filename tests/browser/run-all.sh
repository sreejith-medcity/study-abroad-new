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
# It takes a couple of hours. For one suite while working on it:
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
mkdir -p "$OUT"
: > "$OUT/summary.txt"

restart() {
  for pid in $(ls /proc | grep -E '^[0-9]+$'); do
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
    case "$cmd" in *"next-server"*|*"next start"*) kill -9 "$pid" 2>/dev/null ;; esac
  done
  sleep 1
  setsid npm start > "$OUT/app.log" 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/login")" = "200" ] && return 0
    sleep 2
  done
  echo "the server did not come up; see $OUT/app.log" >&2
  return 1
}

for f in tests/browser/*.mjs; do
  b=$(basename "$f" .mjs)
  [ "$b" = "_height" ] && continue
  # Fresh data for every suite, and a fresh process with it: the sign-in limit
  # is held in memory, and a suite that signs the same person in several times
  # will otherwise be refused on the ninth.
  npm run db:seed > "$OUT/seed.log" 2>&1 || { echo "$b: the seed failed" >> "$OUT/summary.txt"; continue; }
  restart || break
  BASE="$BASE" timeout 600 node "$f" > "$OUT/$b.log" 2>&1
  code=$?
  n=$(grep -c "^FAIL" "$OUT/$b.log")
  if [ "$code" -ne 0 ] || [ "$n" -gt 0 ]; then
    echo "$b: exit=$code fails=$n" >> "$OUT/summary.txt"
  else
    echo "$b: ok" >> "$OUT/summary.txt"
  fi
  printf '%s\n' "$(tail -1 "$OUT/summary.txt")"
done

echo
echo "Logs in $OUT. What did not pass:"
grep -v ': ok$' "$OUT/summary.txt" || echo "  everything passed"
