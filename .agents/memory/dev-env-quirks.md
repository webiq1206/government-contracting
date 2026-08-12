---
name: Dev environment quirks
description: NODE_ENV=production in workspace env breaks next dev CSS; devDeps get pruned; vitest 2.x blocked
---

- The workspace environment sets `NODE_ENV=production` globally. This breaks `next dev` (Tailwind/PostCSS is skipped → "Module parse failed: Unexpected character '@'" on globals.css) and makes plain `npm install` skip devDependencies.
  - **Why:** Next.js disables parts of its dev CSS pipeline under a non-standard NODE_ENV; npm prunes devDeps under production.
  - **How to apply:** `dev:web` script forces `NODE_ENV=development next dev`. To run vitest/dev tooling from a shell, first run `NODE_ENV=development npm install` (the workflow's `npm install` prunes devDeps again on each restart).
- The Replit package firewall blocks `vitest@2.1.9` (403). The project uses vitest 3.x for this reason — don't downgrade to 2.x.
- Long-running jobs must run in the **foreground** of a shell call. Backgrounding them (`&`, `nohup`, even `setsid`) does not protect them: when the shell call returns or times out, the job is killed, often with no error in its log.
  - **How to apply:** split long pipelines into stages that each fit the shell timeout (~5 min) and run each stage in the foreground, rather than launching one long job and polling it.
- Playwright drives the local `next dev` server, so **editing any source file mid-run breaks the run** — HMR recompiles and reloads the page, destroying the `window` hooks the script depends on, and the script dies silently.
  - **How to apply:** finish all source edits before starting a capture/scrape run; treat the run as a quiet period.
- Playwright's bundled Chromium download is unusable here (missing `libglib-2.0.so.0`). The repl pins Playwright to a Nix-provided Chromium via an executable-path env var; pass that as `executablePath` plus `--no-sandbox` when launching directly.
- A corrupted `next dev` build cache makes **the whole page silently stop hydrating**: server HTML renders fine, but no client component mounts, so `useEffect` never runs and state never updates. It reads exactly like a broken component, which sends you debugging the wrong thing.
  - **Why:** killing a process mid-compile (or overlapping compiles) can leave `.next` serving 404s for `/_next/static/chunks/main-app.js` and `app-pages-internals.js`, so React never boots.
  - **How to apply:** when a client component's effects appear not to run, check the network panel for 404s on those two chunks *before* touching the component. Fix with `rm -rf .next` and a workflow restart. Also avoid running `next build` while `next dev` is running — they share `.next`.
