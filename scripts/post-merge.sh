#!/bin/bash
# Best-effort post-merge dependency setup. Deliberately NOT `set -e`: a pull
# must never leave the editor in a failed state. Schema changes are excluded
# on purpose. Production migrations require the owner-only release credential
# and must never run from a developer hook or a web/worker process.

npm install --legacy-peer-deps || echo "[post-merge] npm install reported an issue; continuing."
echo "[post-merge] dependencies checked. Run the owner-only migration release step before deploying this revision."
