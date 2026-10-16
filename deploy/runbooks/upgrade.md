# Upgrade

1. Build and push a new image with a new version tag (never reuse a tag, never deploy `latest`):

   ```sh
   docker buildx build --platform linux/amd64,linux/arm64 \
     --build-arg APP_VERSION=1.1.0 -t registry.example.com/sticker-bank:1.1.0 --push .
   ```
2. Take a backup first (see `backup-restore.md`).
3. Bump the image tag in `deploy/k8s/deployment.yaml`, then apply:

   ```sh
   kubectl -n sticker-bank apply -f deploy/k8s/deployment.yaml
   kubectl -n sticker-bank rollout status deploy/sticker-bank
   ```
4. The rolling update (maxSurge 1, maxUnavailable 0) starts the new pod, which runs Flyway migrations on startup. The old pod keeps serving until the new one is Ready.

## Expand/contract rule
During a rollout the old and new versions run against the same schema at the same time, so migrations must be backward compatible:
- Expand first: add columns/tables as nullable or with defaults; do not drop or rename anything the old version uses.
- Release the code that uses the new schema.
- Contract in a later release: remove the old columns/tables once no running version reads them.

Roll back with `kubectl -n sticker-bank rollout undo deploy/sticker-bank`; this works only if the migrations followed the rule above.
