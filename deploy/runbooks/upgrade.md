# Upgrade

1. Build and push a new image under a tag you have never used (never reuse a tag, never deploy `latest`). The app version needs no attention: every build is stamped with the UTC time it was made (`YYYY.MMDD.HHMMSS`).

   ```sh
   TAG=$(date -u +%Y%m%d-%H%M%S); echo "$TAG"
   docker buildx build --platform linux/amd64,linux/arm64 \
     -t registry.example.com/sticker-bank:$TAG --push .
   ```
2. Take a backup first (see `backup-restore.md`).
3. Bump the image tag in `deploy/k8s/deployment.yaml`, then apply:

   ```sh
   kubectl -n sticker-bank apply -f deploy/k8s/deployment.yaml
   kubectl -n sticker-bank rollout status deploy/sticker-bank
   ```
4. The rolling update (maxSurge 1, maxUnavailable 0) starts the new pod, which runs Flyway migrations on startup. The old pod keeps serving until the new one is Ready.
5. Installed apps and open tabs refresh themselves. Each build carries its build time as its app version, and the server sends that as `X-Min-Frontend-Version` on every API response (unless `STICKER_BANK_MIN_FRONTEND_VERSION` is set). An app built earlier than that applies the new service worker at the next safe moment in Child Mode. A rollback (`rollout undo`) does not force a refresh, because newer apps are fine. To check what is running, look at the line at the bottom of any page (`App <version> · Server <version>`; two different numbers mean that device has not refreshed yet), or run `curl -s https://<hostname>/api/bootstrap` and read `appVersion`. To let old apps keep running after a release, set `STICKER_BANK_MIN_FRONTEND_VERSION` to the oldest version you still accept, in the same format.

## Expand/contract rule
During a rollout the old and new versions run against the same schema at the same time, so migrations must be backward compatible:
- Expand first: add columns/tables as nullable or with defaults; do not drop or rename anything the old version uses.
- Release the code that uses the new schema.
- Contract in a later release: remove the old columns/tables once no running version reads them.

Roll back with `kubectl -n sticker-bank rollout undo deploy/sticker-bank`; this works only if the migrations followed the rule above.
