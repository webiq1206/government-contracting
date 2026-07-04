# BROSTCO — Autonomous Procurement Execution

Autonomous federal-services contracting: monitors SAM.gov, scores opportunities against a versioned Company Profile, analyzes solicitations, sources + vets subcontractors, runs outreach, prepares call cards, builds bids, and tracks compliance — with a human in the loop only where it matters.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000). On boot it **applies SQL migrations (advisory-locked, idempotent), seeds the Company Profile, and starts the autonomous engine** (cron scheduler + queue workers).
- `pnpm --filter @workspace/api-server run migrate` — apply DB migrations only (`artifacts/api-server/migrations/*.sql`).
- `pnpm --filter @workspace/api-server run seed` — seed the active Company Profile + templates (idempotent).
- `pnpm --filter @workspace/api-server agent list` — list the 13 agents + maintenance jobs.
- `pnpm --filter @workspace/api-server agent run <name> [key=val…]` — run one agent once (e.g. `run scoring-engine opportunityId=…`).
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- **Required env:** `DATABASE_URL` (Postgres). **For the AI agents:** `ANTHROPIC_API_KEY`. Everything else (SAM, Google Maps, Hunter, Gmail OAuth, Twilio, Resend, Supabase Storage) is optional and degrades gracefully — see `.replit` `[userenv]`. Set `RUN_WORKER=false` to disable the engine on an instance (API-only); `REDIS_URL` switches the queue from pg-boss to BullMQ.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (`artifacts/api-server`) — REST + the autonomous engine
- Frontend: Vite + React 19 (`artifacts/brostco`)
- DB: PostgreSQL. Raw SQL migrations are the source of truth (`artifacts/api-server/migrations/`). The `@workspace/db` Drizzle package is scaffolding and not the schema of record.
- AI: Anthropic Claude (`claude-sonnet-4-6`) with the Company Profile injected as system context on every call
- Queue: pg-boss (Postgres-backed; no Redis) by default; BullMQ when `REDIS_URL` is set
- Build: esbuild (ESM bundle)

## Where things live

- **DB schema (source of truth):** `artifacts/api-server/migrations/000_init.sql` (19 tables), `001_bid_tracking.sql`, `002_rls.sql` (Row-Level Security lockdown). Applied on boot by `src/lib/migrate.ts`.
- **Company Profile (business rules):** `artifacts/api-server/src/engine/seed-data.ts` (the real BROSTCO v1.2 profile — rubric, hard exclusions, margins, thresholds). Editable at runtime via the profile API; versioned in the `company_profile` table.
- **Autonomous engine:** `artifacts/api-server/src/engine/` — `agents/` (13 agents + maintenance + runner + registry), `ai/` (Claude client + profile injection), `domain/` (scoring, pricing, compliance — pure logic), `integrations/` (SAM, USASpending, BLS, Google, Hunter, Gmail, Twilio, Resend, storage, documents, pdf, scrapers), `queue/`, `scheduler.ts`, `worker.ts` (`startEngine`).
- **API routes:** `artifacts/api-server/src/routes/` (opportunities, subs, agents, compliance, contracts, call-cards, analytics, profile, scoring-weights, integrations, auth).
- **Frontend pages:** `artifacts/brostco/src/pages/`.
- **Legacy Next.js implementation (reference):** `.migration-backup/` — the original single-package build these were ported from.

## Architecture decisions

- The engine runs **inside the api-server process** (started after `listen` in `src/index.ts`), not as a separate service — one deployment runs both API and agents. Autoscale-safe: the cron scheduler enqueues with a per-minute `singletonKey`, so scheduled jobs fire once even across multiple instances.
- **Migrations run on boot** under a Postgres advisory lock (idempotent, race-safe), so a fresh database is provisioned automatically — no manual step.
- **Raw SQL migrations, not Drizzle push**, are authoritative: the schema uses triggers (updated_at) and RLS policies that Drizzle push does not manage.
- **Graceful degradation everywhere:** any integration whose key is absent disables that feature (logged) instead of crashing. Only `DATABASE_URL` + `ANTHROPIC_API_KEY` are needed for the core to function.
- Agents are isolated modules; a failure in one is caught by the runner, logged to `agent_logs` with full reasoning, and never cascades.

## Product

A single operator runs ~20–30 min/day: triage the Review Queue (60-second pursue/dismiss), work the mobile Call Queue (enter written sub quotes after each call), review + submit assembled bids, and approve weekly Learning-Loop scoring changes. The platform monitors, scores, researches, and sends outreach 24/7.

## Gotchas

- **Autoscale + cron:** if the deployment scales to zero when idle, cron ticks won't fire. For reliable 2-hour SAM polling, use a reserved-VM/always-on deployment or an external pinger.
- **Engine env:** without `ANTHROPIC_API_KEY`, Claude-dependent agents log "skipped" (rule-only agents like scoring/compliance/analytics still run via deterministic fallbacks).
- **Two quote paths exist:** the UI writes `call_cards.quote_amount`; the engine's bid-builder reads the `quotes` table. If you rely on bid-builder, ensure quotes also land in `quotes` (or reconcile the two — noted for follow-up).

## User preferences

- Absolute rule: no em dashes in user-facing site copy / generated content.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
