#!/bin/bash
set -e
# 4GB heap: the builder's Node caps itself near 2GB by default, and type-
# checking this codebase needs more; without this the build aborts at
# "Checking validity of types" with a heap OOM. If a smaller builder cannot
# honour 4GB, set DEPLOY_SKIP_TYPECHECK=1 in the deployment environment
# instead. CI has already type-checked every commit twice (tsc and a full
# next build).
NODE_OPTIONS=--max-old-space-size=4096 npm run build
# Submit sitemap URLs to IndexNow for search engine indexing.
if command -v node &>/dev/null; then
  node scripts/submit-indexnow.mjs || echo "IndexNow submission skipped (non-fatal)"
fi
