# Backups and restore (T-28)

## What is backed up, and what is not

| Thing | Where it lives | Backed up by |
| :-- | :-- | :-- |
| Every firm's state (clients, checklists, messages, records), sealed with that firm's key | Postgres, `firm_state` | `tools/backup.sh`, nightly, 30 days kept |
| Each firm's key, wrapped by the master key | Postgres, `firms.wrapped_key` | the same dump |
| Sign-in accounts, the audit log, the arriving-message queue, usage and status | Postgres | the same dump |
| The files clients send, sealed | The file bucket | Not backed up, on purpose. See below |
| The master key | AWS KMS (`TH_KMS_KEY_ID`), or `TH_MASTER_KEY` | Never in a backup. KMS keeps it; a `TH_MASTER_KEY` belongs in the host's secret store and one offline copy |

A dump on its own reads as noise: no client name, message or document can be read from it without the master key.

**Files are not backed up and the bucket has versioning off.** A file deleted on schedule, by an owner, or after hand-off must be
gone, not recoverable from a second copy (`docs/SECURITY.md`). The cost: if the bucket itself were lost, staff would see
"Tallyhound no longer holds a copy" and ask the client again. Bucket providers store each object on several machines already.
This replaces the ticket's "object storage versioning", which would have kept deleted documents.

## Every night

    DATABASE_URL=... BACKUP_DIR=/var/backups/tallyhound BACKUP_S3=s3://tallyhound-backups/db tools/backup.sh

Give the backup bucket a 30-day expiry rule and its own credentials: the app's role does not need to read backups. A managed
Postgres with point-in-time recovery is better still and can replace this script; keep 30 days.

## Restoring

1. Make a new, empty database. `tools/restore.sh` refuses a database that already has tables.
2. `TARGET_URL=postgres://.../new_db tools/restore.sh backups/tallyhound-YYYYMMDD-HHMMSS.dump`
3. Point `DATABASE_URL` at the new database. Keep the same master key and the same file bucket.
4. `npm run admin -- migrate`
5. `npm run admin -- after-restore --by "Your name"`. **Do not skip this.** A backup taken before a firm closed its account
   contains that firm's wrapped key, so the restore brings the firm back. Closing a firm leaves a marker in the file bucket
   (`closed/<firm id>`, a time and nothing else), which a database restore does not touch. This command closes again every
   firm that has one.
6. `npm run admin -- firms`, then start the service.

What a restore to an earlier time means for firms that stayed open:

- Messages and documents that arrived after the backup are not in it. Twilio and Postmark keep their own logs; clients may need to send again.
- Anything deleted on schedule since the backup comes back in the database, and is deleted again by the timer's next pass, because deletion goes by dates held in the state. Files deleted since then stay deleted: they were never in the backup.
- A message the backup shows as waiting may already have been sent. The pipeline never resends a claimed message, so nothing goes twice; a message that was queued and unsent at backup time is sent late. Check `npm run admin -- status` after the first pass.
- Opt-outs received after the backup are lost with it. Before the service is started after a restore, export the opt-out list from Twilio for the gap and apply it. This step is manual today.

## The drill

Performed 20 November 2026 on the development machine (Postgres 16, a database with two firms): backup, close one firm,
restore into a fresh database, migrate, `after-restore`, list firms. The closed firm came back in the restore and was closed
again by step 5; the open firm's state opened with the same master key; a second restore into the same database was refused.
Start to finish: under 2 seconds at that size. The time that matters is at production size on the production host: repeat
this drill there before the first pilot firm goes live, and write the time here.
