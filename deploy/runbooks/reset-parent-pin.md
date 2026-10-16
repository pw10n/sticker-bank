# Reset the parent PIN

Use this when the parent PIN is forgotten. Child data (tasks, stickers, history) is not touched (FR-8.9).

1. Make sure the parent is ready to set a new PIN right away. After the reset, whoever opens Parent Mode first sets the new PIN.
2. Call the stored procedure in the database (replace the placeholders; use your own namespace, pod, admin user, and name):

   ```sh
   kubectl -n <mysql-namespace> exec -it <mysql-pod> -- \
     mysql -u <admin-user> -p sticker_bank -e "CALL reset_parent_pin('Your Name');"
   ```

   For the optional in-cluster MySQL the pod is `sticker-bank-mysql-0` in namespace `sticker-bank`. With compose, use `docker compose exec mysql mysql ...`.
3. Open Parent Mode on any device and create the new PIN.
4. Audit the reset:

   ```sql
   SELECT * FROM pin_reset_log ORDER BY reset_at DESC;
   ```

If `reset_parent_pin` does not exist after a restore, the dump was taken without `--routines`; see `backup-restore.md`.
