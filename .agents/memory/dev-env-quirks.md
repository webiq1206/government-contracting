---
name: Dev environment quirks
description: NODE_ENV=production in workspace env breaks next dev CSS; devDeps get pruned; vitest 2.x blocked
---

- The workspace environment sets `NODE_ENV=production` globally. This breaks `next dev` (Tailwind/PostCSS is skipped → "Module parse failed: Unexpected character '@'" on globals.css) and makes plain `npm install` skip devDependencies.
  - **Why:** Next.js disables parts of its dev CSS pipeline under a non-standard NODE_ENV; npm prunes devDeps under production.
  - **How to apply:** `dev:web` script forces `NODE_ENV=development next dev`. To run vitest/dev tooling from a shell, first run `NODE_ENV=development npm install` (the workflow's `npm install` prunes devDeps again on each restart).
- The Replit package firewall blocks `vitest@2.1.9` (403). The project uses vitest 3.x for this reason — don't downgrade to 2.x.
