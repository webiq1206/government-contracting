# BROSTCO — Autonomous Procurement Execution Platform

An autonomous government-contracting pipeline. It monitors SAM.gov and state
portals for opportunities, scores them against a versioned **Company Profile**,
analyzes solicitations, researches pricing, finds and vets subcontractors, runs
outreach, prepares call cards, builds bid packages, and tracks compliance — with
a human in the loop only where it matters (~20–30 min/day).

Built to the BROSTCO System Design & Build Brief (SYS-01 … SYS-12).

---

## Architecture

```
Presentation   Next.js 14 (App Router) + Tailwind — dashboard (7 views), mobile-ready Call Queue
Agents         13 isolated modules + maintenance jobs, run by a worker via a job queue
AI             Anthropic Claude (claude-sonnet-4-6). Company Profile injected as system context on EVERY call
Integrations   SAM.gov · USASpending · BLS CPI · Google Places · Hunter.io · Gmail OAuth · Twilio · Resend · Supabase Storage · Playwright scrapers
Data           PostgreSQL (Supabase). Single source of truth. Versioned company_profile + scoring_weights
Queue          pg-boss (Postgres-backed, default) or BullMQ (set REDIS_URL)
```

Each agent is an isolated module with its own job. A failure in one agent is
caught by the runner, logged to `agent_logs` with full reasoning, and never
cascades to the others.

### The 13 agents (SYS-05)

| Agent | Trigger | What it does |
|---|---|---|
| Opportunity Monitor | cron 2h | Polls SAM + scrapers, dedupes, normalizes, triggers scoring; routes Sources Sought to a high-priority queue |
| Scoring Engine | on ingest | 100-pt rubric + hard exclusions first → pursue/review/dismiss; routes downstream |
| Solicitation Analyst | on pursue | Structured analysis: scope, requirements, risk flags, past-perf classification, SOW, sub questions |
| Pricing Research | on pursue | USASpending comps, CPI-adjusted; avg/median/P25/P75; incumbent; margin scenarios |
| Sub Finder | on active | Google Places per trade; ranks 10–15 candidates/trade; triggers verify for top 5 |
| Sub Verify | per candidate | Hunter email, phone, license, SAM exclusions, review summary; flags missing project history |
| Outreach | on verified | Personalized Gmail sends w/ open+click tracking; schedules 48h follow-up; reply detection |
| Call Prep | on reply | One-screen call card + Claude call script + SOW questions + response capture |
| Bid Builder | on quote | Prices at target margin; past-perf narrative; QA checklist; PDF + DOCX package |
| Compliance Monitor | cron daily | SAM/cert/LLC/insurance expiries, non-SS cap, FAR RSS; SMS on critical |
| Learning Loop | cron weekly | Win/loss analysis → proposed scoring weights (human approves); sub reliability scoring |
| Analytics Engine | cron daily | Win rate, margins, pipeline value, velocity, cash flow; weekly digest email |
| Sources Sought Responder | on SS notice | Capability-statement response from Template 3; queued for human send within 24h |

---

## Quick start (local)

```bash
git clone <repo> && cd brostco
npm install
cp .env.example .env          # fill DATABASE_URL + ANTHROPIC_API_KEY at minimum
npm run agent -- hash-password 'yourpassword'   # paste the output into OPERATOR_PASSWORD_HASH
npm run db:setup              # runs migrations + seeds the Company Profile
npm run dev                   # web on :3000, worker + scheduler alongside
```

Open http://localhost:3000 and sign in with `OPERATOR_EMAIL` / your password.

### The only truly required env vars

- `DATABASE_URL` — Postgres/Supabase connection string
- `ANTHROPIC_API_KEY` — for the AI agents
- `AUTH_SECRET`, `OPERATOR_EMAIL`, `OPERATOR_PASSWORD_HASH` — to log in

**Everything else is optional.** Each integration degrades gracefully: a missing
key disables that feature (clearly logged) instead of crashing. Fill keys in as
you get them — features light up automatically. See `.env.example` for the full,
annotated list and where to obtain each key.

---

## Deploying to Replit

The repo is structured to import into Replit and run with minimal setup — see
[DEPLOYMENT.md](./DEPLOYMENT.md) for the step-by-step. Summary:

1. Import the repo. `.replit` + `replit.nix` are included (Node 20, Chromium for scrapers).
2. Add your Secrets (env vars) — at minimum `DATABASE_URL` and `ANTHROPIC_API_KEY`.
3. Run once: `npm run db:setup`.
4. Press Run (`npm run start` launches web + worker together via `concurrently`).

No Redis required (pg-boss uses your Postgres). To use BullMQ instead, set `REDIS_URL`.

---

## Operator workflow (SYS-06, SYS-10)

The platform runs 24/7. A typical human day:

- **Morning (~10 min):** review the daily digest, triage the **Review Queue**
  (60-second pursue/dismiss decisions), clear compliance alerts.
- **Call Queue (5–15 min/call):** work the mobile-friendly call cards; enter the
  written quote and notes right after each call (that triggers the Bid Builder).
- **Bid review (~15 min/bid):** check the QA checklist, confirm price, submit
  (the platform enforces submitting ≥ 2h before the deadline).
- **Weekly (~30 min):** review the Learning Loop report and approve/reject the
  proposed scoring-weight changes; update the Company Profile if rules changed.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Web + worker with hot reload |
| `npm run build` / `npm run start` | Production build / run |
| `npm run db:migrate` / `db:seed` / `db:setup` | Migrations / seed / both |
| `npm run worker` | Worker only |
| `npm run agent -- list` | List agents |
| `npm run agent -- run <name> [key=val …]` | Run one agent once |
| `npm run agent -- hash-password '<pw>'` | Generate an operator password hash |
| `npm run test` | Domain unit tests (pricing, scoring, compliance, cron, JSON) |
| `npm run typecheck` | `tsc --noEmit` |

---

## Project layout

```
app/                 Next.js dashboard (route group (dash)) + API routes
  (dash)/            pipeline, call-queue, review, subs, analytics, compliance,
                     contracts, agents, opportunity/[id], settings/*
  api/               auth, opportunities/*, call-cards/*, agents/*, track/*,
                     integrations/gmail/*, profile, scoring-weights/*, files/*, health
components/          shared UI (nav, badges, action button, forms, editors)
lib/
  config.ts          env config + integration readiness
  db.ts              pg pool + query helpers
  ai/                claude client (profile injection) + company profile loader
  domain/            pure, tested business logic (scoring, pricing, compliance)
  integrations/      SAM, USASpending, BLS, Google, Hunter, Gmail, Twilio, Resend,
                     storage, document generation, scrapers/
  agents/            13 agents + maintenance + runner + registry
  queue/             pluggable pg-boss / BullMQ
worker/              worker entrypoint + cron scheduler
db/                  migrations + seed data
tests/               vitest unit tests
scripts/             migrate, seed, run-agent CLI
```

---

## Cost (SYS-12)

At ~50 opportunities/month, roughly **$300–650/mo** all-in (Supabase, Claude,
Google Places, Hunter, Twilio, Resend, hosting). Recovered on the margin of a
single mid-size contract.
