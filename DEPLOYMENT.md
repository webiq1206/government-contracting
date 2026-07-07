# Deploying BROSTCO to Replit

The repository is structured to import into Replit and run with minimal setup.
Included already: `.replit`, `replit.nix` (Node 20 + Chromium), `package.json`
scripts, SQL migrations, and a seed script.

---

## 1. Provision a database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. Project Settings → Database → **Connection string** → copy the URI
   (use the connection pooler URI). This is your `DATABASE_URL`.
3. (Optional) Project Settings → Storage, the app auto-creates its bucket, or
   set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to store documents there.
   Without them, documents fall back to local disk (fine to start).

You can also use any other Postgres 15+ (Neon, RDS, Railway Postgres).

## 2. Import into Replit

1. Replit → **Create Repl** → **Import from GitHub** → this repo.
2. Replit reads `.replit` / `replit.nix` automatically (Node 20, Chromium).

> Replit sometimes tries to auto-rewrite Next.js projects to a Vite template on
> import. If it offers that, decline it and keep the Next.js config as-is.

## 3. Set Secrets (environment variables)

Open the **Secrets** panel (lock icon) and add, at minimum:

| Secret | Value |
|---|---|
| `DATABASE_URL` | your Postgres/Supabase URI |
| `ANTHROPIC_API_KEY` | your Claude API key |
| `AUTH_SECRET` | a long random string |
| `OPERATOR_EMAIL` | your login email |
| `OPERATOR_PASSWORD_HASH` | run `npm run agent -- hash-password 'yourpassword'` in the Shell and paste the output |
| `APP_URL` | your Repl's public URL, e.g. `https://brostco.username.repl.co` |

Add the rest from `.env.example` as you obtain each key (SAM, Google Maps,
Hunter, Gmail OAuth, Twilio, Resend). Every one is optional, the platform runs
and is testable without them and lights each feature up when its key appears.

## 4. Initialize the database (once)

In the Replit **Shell**:

```bash
npm install          # if not already done by the importer
npm run db:setup     # runs migrations + seeds the Company Profile, weights, templates, operator
```

## 5. Run

Press **Run**. The default command is `npm run start`, which launches the web
app and the worker together (via `concurrently`). The worker connects to the
Postgres-backed queue (pg-boss), **no Redis needed**.

- Web dashboard: your Repl URL.
- Worker: runs the cron scheduler (Opportunity Monitor every 2h, Compliance
  daily, Analytics daily, Learning Loop weekly) and processes queued agent jobs.
- Health checks: `GET /api/health` (web) and the worker's `:3100/health`.

### Deployments (always-on)

For 24/7 operation, use **Replit Deployments**. The included `.replit`
`[deployment]` block builds with `npm run db:setup && npm run build` and runs
`npm run start`. If you prefer to run web and worker as two separate services
(web-facing + background), set `RUN_WORKER=false` on the web service and run
`npm run worker` on the second.

---

## Row-Level Security (Supabase)

Migration `0002_rls.sql` enables Postgres RLS on every application table and
revokes the `anon` / `authenticated` grants. The app connects via the direct
`DATABASE_URL` role (table owner), which bypasses RLS, so it is unaffected, but
Supabase's auto-generated PostgREST API and the public JS client can read/write
**nothing**. This runs automatically as part of `npm run db:setup` / `db:migrate`.
If you later want to expose a table to the browser, add explicit `create policy`
statements in a new migration.

## Connecting Gmail (outreach)

1. Google Cloud Console → create OAuth 2.0 credentials (Web application), enable
   the Gmail API.
2. Authorized redirect URI: `${APP_URL}/api/integrations/gmail/callback`.
3. Set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_SENDER`.
4. In the app: **Settings → Integrations → Connect Gmail**, complete consent.
   The refresh token is stored automatically; all outreach then sends from that
   Gmail account with open/click tracking.

## State-license scrapers (optional)

Playwright scrapers are **off by default** (`ENABLE_SCRAPERS=false`). To enable:
set `ENABLE_SCRAPERS=true`. On Replit, `replit.nix` provides Chromium and points
Playwright at it via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Each state is an
isolated module, a broken scraper never blocks the others or the federal feed.

## Switching the queue to Redis/BullMQ (optional)

Set `REDIS_URL` (e.g. an Upstash `rediss://…` URL). The queue layer switches from
pg-boss to BullMQ automatically. No code change required.

---

## Verifying a deployment

```bash
curl https://<your-app>/api/health           # { ok: true, integrations: {...} }
npm run agent -- run compliance-monitor        # exercises DB + an agent
npm run agent -- list                          # shows all agents + schedules
```

Then sign in and confirm the Pipeline, Review Queue, and Agents views load.
The Integrations settings page shows exactly which keys are wired up.

## Troubleshooting

- **`DATABASE_URL is not set`**, add the secret; re-run `npm run db:setup`.
- **Login fails**, ensure `OPERATOR_EMAIL` + `OPERATOR_PASSWORD_HASH` are set
  (hash generated with `npm run agent -- hash-password`), or seed a user.
- **Agents log "skipped: ANTHROPIC_API_KEY not set"**, add the Claude key.
- **TLS errors to Postgres**, the pool already relaxes TLS for managed hosts;
  ensure the URI is the pooler/connection string from your provider.
