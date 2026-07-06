#!/bin/bash
# Best-effort post-merge setup. Deliberately NOT `set -e`: a pull must never
# leave the environment in a failed state. Dependency install is required, but
# migrations are best-effort here because the worker applies any pending
# migrations at boot (lib/migrate.ts) regardless.

npm install --legacy-peer-deps || echo "[post-merge] npm install reported an issue; continuing."
npm run db:migrate || echo "[post-merge] db:migrate skipped/failed; the worker applies migrations at boot."
