#!/usr/bin/env python3
"""Copies every student document out of Supabase Storage onto this box.

Run it on the VPS, from the deploy directory, with the service role key in the
environment so it stays out of the shell history:

    read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
    export SUPABASE_URL=https://xxxx.supabase.co
    python3 move-documents.py

Keys are kept exactly as they are, because that is what the database holds:
students/<student id>/<file>. A file already copied is left alone, so the
script can be run again the night of the move to pick up the stragglers
without pulling everything down twice.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "student-documents")
OUT = pathlib.Path(os.environ.get("OUT_DIR", "documents"))

if not URL or not KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.")


def call(path, body=None, raw=False):
    req = urllib.request.Request(
        f"{URL}/storage/v1/{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {KEY}",
            "apikey": KEY,
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read() if raw else json.loads(res.read())


def walk(prefix=""):
    """Supabase lists one level at a time: a row with no id is a folder."""
    offset = 0
    while True:
        rows = call(f"object/list/{BUCKET}", {"prefix": prefix, "limit": 200, "offset": offset, "sortBy": {"column": "name", "order": "asc"}})
        if not rows:
            return
        for row in rows:
            name = row["name"]
            full = f"{prefix}{name}" if prefix.endswith("/") or not prefix else f"{prefix}/{name}"
            if row.get("id") is None:
                yield from walk(full + "/")
            else:
                yield full
        offset += len(rows)


copied = skipped = failed = 0
for key in walk():
    target = OUT / key
    if target.exists() and target.stat().st_size > 0:
        skipped += 1
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        blob = call(f"object/{BUCKET}/{key}", raw=True)
    except urllib.error.HTTPError as e:
        print(f"could not fetch {key}: {e.code}")
        failed += 1
        continue
    tmp = target.with_suffix(target.suffix + ".part")
    tmp.write_bytes(blob)
    tmp.rename(target)
    copied += 1
    if copied % 50 == 0:
        print(f"{copied} copied")

print(f"copied {copied}, already here {skipped}, failed {failed}")
print(f"They are under {OUT.resolve()}. Put them on the volume with:")
print(f"  docker compose cp {OUT}/. app:/data/uploads/")
