#!/bin/sh
# Nightly database backup (T-28). Run from cron or the host's scheduler:
#   DATABASE_URL=postgres://... BACKUP_DIR=/var/backups/tallyhound tools/backup.sh
# Writes one compressed dump and removes dumps older than KEEP_DAYS (30). With BACKUP_S3=s3://bucket/prefix the dump is also
# copied there with the aws command; give that bucket a 30-day expiry rule.
# What is in a dump: every firm's state, sealed with that firm's key, and the wrapped keys. Without the master key it reads as
# noise. What is not: the files themselves (they are in the file bucket) and the master key.
set -eu
: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP_DAYS:-30}"; mkdir -p "$DIR"
OUT="$DIR/tallyhound-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$OUT.part" "$DATABASE_URL"
pg_restore --list "$OUT.part" > /dev/null          # a dump that cannot be listed is not a backup
mv "$OUT.part" "$OUT"
find "$DIR" -name 'tallyhound-*.dump' -mtime +"$KEEP" -delete
if [ -n "${BACKUP_S3:-}" ]; then aws s3 cp --only-show-errors "$OUT" "$BACKUP_S3/$(basename "$OUT")"; fi
echo "$OUT"
