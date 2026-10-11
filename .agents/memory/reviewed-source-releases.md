---
name: Reviewed source releases
description: The user's release workflow for reviewed GitHub changes imported into the existing BrostCo app.
---

Only import the exact reviewed and merged GitHub revision into the existing app; do not reimplement it or add unrelated edits. Before import, verify the expected local baseline and create a private source recovery artifact that has been independently restored and checked. Preserve local publication ancestry with a normal history-preserving merge, and verify the exact approved tree and clean worktree afterward. Treat publication as a separate step requiring its own authorization.

**Why:** the user wants GitHub to remain the reviewed source of truth while retaining Replit's publication history and a recoverable pre-import baseline.

**How to apply:** for future source-sync requests, stop on any baseline, target-tree, recovery, or conflict mismatch; never publish as part of an import-only request.
