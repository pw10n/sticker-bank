# Backup and restore

## Where backups live
The optional in-cluster MySQL ships a nightly CronJob (`sticker-bank-backup`, 02:15 UTC) that writes `sticker_bank-<timestamp>.sql.gz` into the PVC `sticker-bank-backups` and deletes files older than 30 days. The dump uses `--single-transaction --routines --triggers`; `--routines` is required because it includes the `reset_parent_pin` procedure. Copy backups off the cluster periodically. If you bring your own MySQL server, schedule an equivalent dump there.

To list or copy dumps, start a temporary pod that mounts the PVC, then use `kubectl cp`.

## Restore into an empty database
1. Scale the app down: `kubectl -n sticker-bank scale deploy/sticker-bank --replicas=0`.
2. Recreate an empty database:

   ```sh
   kubectl -n sticker-bank exec -it sticker-bank-mysql-0 -- \
     mysql -uroot -p -e "DROP DATABASE IF EXISTS sticker_bank; CREATE DATABASE sticker_bank CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
   ```
3. Load the dump (routines come with it):

   ```sh
   gunzip -c sticker_bank-<timestamp>.sql.gz | \
     kubectl -n sticker-bank exec -i sticker-bank-mysql-0 -- mysql -uroot -p sticker_bank
   ```
   Make sure the application DB user still has privileges on `sticker_bank`.
4. Scale the app back up: `kubectl -n sticker-bank scale deploy/sticker-bank --replicas=1`.

## Verify
- Row counts look right, for example `SELECT COUNT(*) FROM <table>;` for the main tables, compared with what you expect.
- The routine exists:

  ```sql
  SHOW PROCEDURE STATUS WHERE Db = 'sticker_bank' AND Name = 'reset_parent_pin';
  ```
- The app reports ready: the pod becomes Ready and Parent Mode opens.
