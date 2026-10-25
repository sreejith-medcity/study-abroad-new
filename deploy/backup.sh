#!/bin/bash
# The nightly dump and the weekly documents tarball, as run inside the backup
# container of docker-compose.yml. Three ways to call it:
#
#   backup.sh loop        what the container runs: watch the clock, dump at
#                         02:15 every night, tar the documents at 02:45 on
#                         Sundays, prune what is older than the keep period
#   backup.sh now         one database dump, right now
#   backup.sh documents   one documents tarball, right now
#
# A dump is written to a .part file first and only renamed once pg_dump and
# gzip have both finished cleanly, so a half-written file never carries a
# finished name. The database dump keeps the whole database, every schema and
# the pg_trgm extension, so it restores on its own into an empty database.
set -euo pipefail

OUT=/backups
KEEP_DUMPS_DAYS=14
KEEP_DOCUMENTS_DAYS=35

say() { echo "$(date -Iseconds) $*"; }

dump_database() {
  local out="$OUT/portal-$(date +%Y-%m-%d).sql.gz"
  if pg_dump -h db -U portal -d portal --no-owner --no-acl | gzip > "$out.part"; then
    mv "$out.part" "$out"
    say "wrote $out ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.part"
    say "the database dump failed"
    return 1
  fi
}

tar_documents() {
  local out="$OUT/uploads-$(date +%Y-%m-%d).tar.gz"
  if tar -czf "$out.part" -C /uploads .; then
    mv "$out.part" "$out"
    say "wrote $out ($(du -h "$out" | cut -f1))"
  else
    rm -f "$out.part"
    say "the documents tarball failed"
    return 1
  fi
}

prune() {
  find "$OUT" -name 'portal-*.sql.gz' -mtime +"$KEEP_DUMPS_DAYS" -delete
  find "$OUT" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DOCUMENTS_DAYS" -delete
  find "$OUT" -name '*.part' -mmin +180 -delete
}

case "${1:-loop}" in
  now)
    dump_database
    ;;
  documents)
    tar_documents
    ;;
  loop)
    say "backup loop started; dumps at 02:15 nightly, documents at 02:45 on Sundays, kept $KEEP_DUMPS_DAYS and $KEEP_DOCUMENTS_DAYS days"
    while true; do
      now=$(date +%H%M)
      if [ "$now" = "0215" ]; then
        dump_database || true
        prune
        sleep 90
      elif [ "$now" = "0245" ] && [ "$(date +%u)" = "7" ]; then
        tar_documents || true
        prune
        sleep 90
      fi
      sleep 50
    done
    ;;
  *)
    echo "usage: backup.sh loop | now | documents" >&2
    exit 2
    ;;
esac
