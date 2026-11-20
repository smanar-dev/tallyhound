#!/bin/sh
# Restore a backup into an EMPTY database (T-28):
#   TARGET_URL=postgres://.../tallyhound_restored tools/restore.sh backups/tallyhound-20270115-070000.dump
# Then, with DATABASE_URL pointing at the restored database and the same master key and file bucket as production:
#   npm run admin -- migrate
#   npm run admin -- after-restore --by "Your name"     # closes again any firm closed since the backup was taken
#   npm run admin -- firms
# docs/BACKUP.md has the whole procedure and what a restore does and does not bring back.
set -eu
: "${TARGET_URL:?Set TARGET_URL to an empty database}"
[ -f "${1:-}" ] || { echo "Give the dump file to restore" >&2; exit 2; }
N=$(psql "$TARGET_URL" -Atc "select count(*) from information_schema.tables where table_schema = 'public'")
[ "$N" = "0" ] || { echo "The target database is not empty ($N tables). Restore only into a new database." >&2; exit 3; }
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_URL" "$1"
psql "$TARGET_URL" -Atc "select 'firms: ' || count(*) from firms"
