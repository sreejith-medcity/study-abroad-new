#!/usr/bin/env python3
"""Copies every file out of the Supabase Storage bucket onto this box.

Run it on the VPS, from the deploy directory, with the service role key in the
environment so it stays out of the shell history:

    export SUPABASE_URL=https://xxxx.supabase.co
    read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY
    python3 move-documents.py

Keys are kept exactly as the database holds them, because src/server/storage.ts
reads a file at <UPLOAD_DIR>/<storage key> and nothing else: students/<student
id>/<id>.pdf, resources/<id>.pdf, brand/logo-<id>.png, org-logos/<org id>/...,
program-options/..., document-samples/.... The whole bucket is walked, so every
one of those folders comes across.

A file already here with some bytes in it is left alone, so the script can be
run again the night of the move to pick up the stragglers without pulling
everything down twice. A listing or a download that fails is tried three times
before it is given up on and counted, and the script exits 1 if anything was.

After the copy, if the portal database has been moved and the stack is up, the
script asks it for every storage key it holds and says how many are not in the
folder. Set CHECK_DB=0 to skip that.
"""
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "student-documents")
OUT = pathlib.Path(os.environ.get("OUT_DIR", "documents"))
CHECK_DB = os.environ.get("CHECK_DB", "1") != "0"
ATTEMPTS = 3

if not URL or not KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.")


def call(path, body=None, raw=False):
    """One request to the storage API, tried a few times before it counts as failed."""
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
    last = None
    for attempt in range(1, ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read() if raw else json.loads(res.read())
        except urllib.error.HTTPError as e:
            # A missing or forbidden object will not appear on a retry.
            if e.code in (400, 401, 403, 404):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
        if attempt < ATTEMPTS:
            time.sleep(2 * attempt)
    raise last


def walk(prefix=""):
    """Supabase lists one level at a time: a row with no id is a folder."""
    offset = 0
    while True:
        rows = call(
            f"object/list/{BUCKET}",
            {"prefix": prefix, "limit": 200, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
        )
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


def fetch(key, target):
    blob = call(f"object/{BUCKET}/{key}", raw=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(target.name + ".part")
    tmp.write_bytes(blob)
    tmp.rename(target)
    return len(blob)


def keys_in_database():
    """Every storage key the moved database refers to, or None if it cannot be asked."""
    # Every column in src/db/schema.ts that holds a storage key.
    sql = (
        "select storage_key from documents where storage_key is not null "
        "union select storage_key from resources where storage_key is not null "
        "union select storage_key from option_request_files where storage_key is not null "
        "union select sample_storage_key from document_types where sample_storage_key is not null "
        "union select portal_logo_key from organizations where portal_logo_key is not null "
        "union select logo_key from app_settings where logo_key is not null "
        "union select favicon_key from app_settings where favicon_key is not null"
    )
    try:
        res = subprocess.run(
            ["docker", "compose", "exec", "-T", "db", "psql", "-U", "portal", "-d", "portal", "-X", "-Atc", sql],
            capture_output=True, text=True, timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if res.returncode != 0:
        return None
    return {line.strip() for line in res.stdout.splitlines() if line.strip()}


copied = skipped = failed = 0
bytes_copied = 0
seen = []
try:
    for key in walk():
        seen.append(key)
        target = OUT / key
        if target.exists() and target.stat().st_size > 0:
            skipped += 1
            continue
        try:
            bytes_copied += fetch(key, target)
        except Exception as e:  # noqa: BLE001 - counted and reported, the run goes on
            print(f"could not fetch {key}: {e}")
            failed += 1
            continue
        copied += 1
        if copied % 50 == 0:
            print(f"{copied} copied")
except Exception as e:  # noqa: BLE001
    print(f"listing the bucket failed: {e}")
    print(f"copied {copied}, already here {skipped}, failed {failed} before it stopped; run again to carry on")
    sys.exit(1)

print(f"{len(seen)} files in the bucket: copied {copied} ({bytes_copied / 1048576:.1f} MB), already here {skipped}, failed {failed}")

if CHECK_DB:
    wanted = keys_in_database()
    if wanted is None:
        print("Could not ask the portal database for its storage keys (stack not up, or the database not moved yet); skipped that check.")
    else:
        here = {str(p.relative_to(OUT)) for p in OUT.rglob("*") if p.is_file() and not p.name.endswith(".part")}
        missing = sorted(k for k in wanted if k not in here)
        print(f"The database refers to {len(wanted)} files; {len(wanted) - len(missing)} are in the folder, {len(missing)} are not.")
        for k in missing[:20]:
            print(f"  missing: {k}")
        if len(missing) > 20:
            print(f"  and {len(missing) - 20} more")

print(f"They are under {OUT.resolve()}. Put them on the volume, then give them to the app's user:")
print(f"  docker compose cp {OUT}/. app:/data/uploads/")
print("  docker compose exec -u root app chown -R portal:portal /data/uploads")
sys.exit(1 if failed else 0)
