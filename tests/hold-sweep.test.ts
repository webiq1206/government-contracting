/**
 * A dead process leaves the claim behind and must not leave it forever.
 * The sweep releases only what is older than the lease for that claim, and
 * it never calls a provider or sends mail itself: released work goes back
 * to its schedule and runs again under a fresh claim.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ db: null as PGlite | null }));

vi.mock("../lib/db", () => ({
  query: async (sql: string, params?: unknown[]) => {
    const result = await state.db!.query(sql, params);
    return result.rows;
  },
  queryOne: async (sql: string, params?: unknown[]) => {
    const result = await state.db!.query(sql, params);
    return result.rows[0] ?? null;
  },
}));

import { reclaimStaleProviderAttempts } from "../lib/domain/hold-sweep";
import {
  AI_CALL_TIMEOUT_MS,
  AI_RECEIPT_TTL_MS,
  HOLD_REGISTRY,
  PROVIDER_ATTEMPT_TTL_MS,
  USAGE_ABANDON_MINUTES,
  providerAttemptIsStale,
  sweepActed,
} from "../lib/domain/hold-registry";
import {
  PIPELINE_STALL_COOLDOWN_MS,
  pipelineStallDecision,
  pipelineStallEligible,
} from "../lib/domain/pipeline-stall";

describe("hold leases", () => {
  it("waits until the provider abort cannot still be on the wire", () => {
    expect(PROVIDER_ATTEMPT_TTL_MS).toBeGreaterThan(AI_CALL_TIMEOUT_MS);
    // A receipt covers a primary and a fallback call; its lease is longer.
    expect(AI_RECEIPT_TTL_MS).toBeGreaterThanOrEqual(2 * AI_CALL_TIMEOUT_MS + (PROVIDER_ATTEMPT_TTL_MS - AI_CALL_TIMEOUT_MS));
    expect(AI_RECEIPT_TTL_MS).toBe(25 * 60_000);
    expect(USAGE_ABANDON_MINUTES * 60_000).toBe(PROVIDER_ATTEMPT_TTL_MS);
    expect(providerAttemptIsStale(new Date(Date.now() - PROVIDER_ATTEMPT_TTL_MS + 1_000))).toBe(false);
    expect(providerAttemptIsStale(new Date(Date.now() - PROVIDER_ATTEMPT_TTL_MS))).toBe(true);
    expect(providerAttemptIsStale(null)).toBe(false);
  });

  it("names every latch, its lease, and a release that does not replay an uncertain call", () => {
    expect(HOLD_REGISTRY.length).toBeGreaterThan(10);
    for (const row of HOLD_REGISTRY) {
      expect(row.ttl.length).toBeGreaterThan(0);
      expect(row.releasePath.length).toBeGreaterThan(0);
      expect(row.replay).not.toBe("replay");
    }
    expect(HOLD_REGISTRY.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "AI provider attempt",
        "AI work receipt",
        "Usage ledger row",
        "Job run",
        "Quote-request slot",
        "Scheduled email claim",
        "Prospective fence",
        "Solicitation reverification",
      ])
    );
    const reverification = HOLD_REGISTRY.find((row) => row.name === "Solicitation reverification");
    expect(reverification?.ttl).toContain("15 min");
    expect(reverification?.replay).toBe("never");
    // The two leases that used to be unbounded. An unbounded lease held one
    // record forever after a single interrupted call.
    const receipt = HOLD_REGISTRY.find((row) => row.name === "AI work receipt");
    expect(receipt?.ttl).toContain("25 min");
    expect(receipt?.currentExpiry).not.toContain("none");
    const scheduled = HOLD_REGISTRY.find((row) => row.name === "Scheduled email claim");
    expect(scheduled?.ttl).toContain("15 min");
    expect(scheduled?.releasePath).toContain("Sent");
  });

  it("sends one stall alert per stall and skips outreach while it is paused", () => {
    expect(pipelineStallDecision({ eligible: true, incidentOpen: false })).toBe("alert");
    expect(pipelineStallDecision({ eligible: true, incidentOpen: true })).toBe("quiet");
    const now = new Date("2026-10-17T12:00:00Z");
    expect(pipelineStallDecision({
      eligible: true,
      incidentOpen: false,
      lastAlertAt: new Date(now.getTime() - 60_000),
      now,
    })).toBe("quiet");
    expect(PIPELINE_STALL_COOLDOWN_MS).toBe(6 * 60 * 60 * 1000);
    expect(pipelineStallEligible({
      undecidedBand: 0,
      bandDecisions: 0,
      unsourcedPursue: 0,
      finderRuns: 0,
      unverifiedPairings: 0,
      verifyRuns: 0,
      unsentVerified: 4,
      outreachRuns: 0,
      outboundPaused: true,
    })).toBe(false);
    expect(existsSync("lib/domain/pipeline-watch.ts")).toBe(false);
  });

  it("does not treat a quiet sweep as something to mail", () => {
    expect(sweepActed({
      reclaimedAttempts: [],
      settledUsage: 0,
      releasedRfqClaims: 0,
      closedRuns: 0,
      settledDispatchClaims: 0,
      heldPreviews: 0,
      settledManualQueued: 0,
      settledManualUncertain: 0,
    })).toBe(false);
  });
});

describe("a crash after the claim and a lost settlement write", () => {
  const staleOrgId = randomUUID();
  const otherOrgId = randomUUID();
  const staleScope = `tenant:${staleOrgId}`;
  const freshScope = `tenant:${randomUUID()}`;
  const staleAttempt = randomUUID();
  const freshAttempt = randomUUID();
  const staleUsage = randomUUID();
  const freshUsage = randomUUID();

  beforeAll(async () => {
    state.db = new PGlite();
    await state.db.exec(`
      create table ai_provider_facts (
        account_scope text not null,
        provider text not null,
        credential_hash text not null,
        pending_attempt uuid,
        pending_started_at timestamptz,
        last_success_at timestamptz,
        last_failure_at timestamptz,
        failure_reason text,
        failure_status integer,
        refusal_reason text,
        refusal_status integer,
        primary key (account_scope, provider, credential_hash)
      );
      create table job_runs (
        id uuid primary key default gen_random_uuid(),
        org_id uuid,
        agent text not null,
        status text not null,
        started_at timestamptz not null default now(),
        finished_at timestamptz,
        error text
      );
      create table solicitation_verifications (
        id uuid primary key default gen_random_uuid(),
        org_id uuid,
        state text not null,
        started_at timestamptz,
        finished_at timestamptz,
        error text
      );
      create table api_usage_events (
        id uuid primary key,
        outcome text not null,
        finished_at timestamptz,
        error_code text,
        started_at timestamptz not null default now(),
        reserved_cost numeric
      );
      create table rfq_send_claims (
        id uuid primary key default gen_random_uuid(),
        state text not null,
        created_at timestamptz not null default now()
      );
      create table prospective_dispatch_claims (
        id uuid primary key default gen_random_uuid(),
        started_at timestamptz not null default now(),
        finished_at timestamptz
      );
      create table prospective_previews (
        id uuid primary key default gen_random_uuid(),
        state text not null,
        created_at timestamptz not null default now(),
        running_since timestamptz,
        finished_at timestamptz
      );
      create table communications (
        id uuid primary key default gen_random_uuid(),
        request_key uuid,
        delivery_state text,
        meta jsonb,
        created_at timestamptz not null default now(),
        provider_attempted_at timestamptz,
        delivery_detail text,
        delivery_updated_at timestamptz
      );
      create table ai_work_receipts (
        org_id uuid,
        work_key text,
        state text not null,
        started_at timestamptz not null default now()
      );
    `);
    await state.db.query(
      `insert into ai_provider_facts
         (account_scope, provider, credential_hash, pending_attempt, pending_started_at, refusal_reason)
       values ($1, 'OpenAI', 'stale', $2, now() - interval '20 minutes', 'quota exhausted'),
              ($3, 'OpenAI', 'fresh', $4, now() - interval '1 minute', null)`,
      [staleScope, staleAttempt, freshScope, freshAttempt]
    );
    await state.db.query(
      `insert into job_runs (org_id, agent, status, started_at) values
         ($1::uuid, 'scoring-engine', 'running', now() - interval '24 minutes'),
         ($1::uuid, 'scoring-engine', 'running', now() - interval '26 minutes'),
         ($2::uuid, 'scoring-engine', 'running', now() - interval '24 minutes'),
         ($1::uuid, 'scoring-engine', 'running', now() - interval '40 minutes'),
         (null, 'scoring-engine', 'running', now() - interval '24 minutes'),
         (null, 'notice-description-sweep', 'running', now() - interval '100 minutes')`,
      [staleOrgId, otherOrgId]
    );
    await state.db.query(
      `insert into solicitation_verifications (org_id, state, started_at) values
         ($1::uuid, 'in_progress', now() - interval '20 minutes'),
         ($1::uuid, 'in_progress', now() - interval '1 minute')`,
      [staleOrgId]
    );
    await state.db.query(
      `insert into api_usage_events (id, outcome, started_at, reserved_cost) values
         ($1, 'pending', now() - interval '20 minutes', 2),
         ($2, 'pending', now(), 2)`,
      [staleUsage, freshUsage]
    );
    await state.db.query(
      `insert into rfq_send_claims (state, created_at) values
         ('reserved', now() - interval '20 minutes'),
         ('reserved', now() - interval '1 minute')`
    );
    await state.db.query(
      `insert into prospective_dispatch_claims (started_at) values
         (now() - interval '20 minutes'),
         (now() - interval '1 minute')`
    );
    await state.db.query(
      `insert into prospective_previews (state, running_since) values
         ('running', now() - interval '20 minutes'),
         ('running', now() - interval '1 minute')`
    );
    await state.db.query(
      `insert into communications (request_key, delivery_state, meta, created_at, provider_attempted_at) values
         ($1, 'queued', '{"kind":"manual"}'::jsonb, now() - interval '20 minutes', null),
         ($2, 'attempting', '{"kind":"manual"}'::jsonb, now() - interval '20 minutes', now() - interval '20 minutes'),
         ($3, 'queued', '{"kind":"outreach"}'::jsonb, now() - interval '90 days', null),
         ($4, 'queued', '{"kind":"outreach"}'::jsonb, now() - interval '1 minute', null),
         ($5, 'attempting', '{"kind":"outreach"}'::jsonb, now() - interval '40 minutes', now() - interval '40 minutes')`,
      [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]
    );
    await state.db.query(
      `insert into ai_work_receipts (org_id, work_key, state, started_at) values
         ($1, 'scoring-live', 'pending', now() - interval '20 minutes'),
         ($1, 'scoring-dead', 'pending', now() - interval '26 minutes'),
         ($1, 'scoring-done', 'complete', now() - interval '26 minutes')`,
      [randomUUID()]
    );
  }, 30_000);

  it("releases the abandoned attempt and keeps the in-flight one", async () => {
    const before = await state.db!.query("select count(*)::int as n from api_usage_events");
    const result = await reclaimStaleProviderAttempts();
    expect(result.reclaimedAttempts.map((row) => row.accountScope)).toEqual([staleScope]);
    expect(sweepActed(result)).toBe(true);
    const facts = await state.db!.query(
      "select account_scope, pending_attempt, failure_reason, refusal_reason from ai_provider_facts order by account_scope"
    );
    const stale = facts.rows.find((row) => row.account_scope === staleScope);
    const fresh = facts.rows.find((row) => row.account_scope === freshScope);
    expect(stale?.pending_attempt).toBeNull();
    expect(String(stale?.failure_reason)).toContain("was not replayed");
    expect(stale?.refusal_reason).toBe("quota exhausted");
    expect(fresh?.pending_attempt).toBe(freshAttempt);
    expect(await state.db!.query("select count(*)::int as n from api_usage_events")).toEqual(before);
    const usage = await state.db!.query(
      "select id, outcome, reserved_cost::text as reserved_cost from api_usage_events"
    );
    expect(usage.rows.find((row) => row.id === staleUsage)).toMatchObject({
      outcome: "failed",
      reserved_cost: "2",
    });
    expect(usage.rows.find((row) => row.id === freshUsage)).toMatchObject({ outcome: "pending" });
    const runs = await state.db!.query<{ org_id: string | null; agent: string; status: string }>(
      "select org_id::text as org_id, agent, status from job_runs"
    );
    const scoring = runs.rows.filter((row) => row.agent === "scoring-engine");
    expect(scoring.filter((row) => row.status === "error").map((row) => row.org_id)).toEqual([staleOrgId]);
    expect(scoring.filter((row) => row.org_id === otherOrgId).every((row) => row.status === "running")).toBe(true);
    expect(scoring.filter((row) => row.org_id === null && row.status === "running")).toHaveLength(1);
    expect(scoring.filter((row) => row.status === "running")).toHaveLength(4);
    expect(runs.rows.find((row) => row.agent === "notice-description-sweep")?.status).toBe("error");
    expect(result.expiredReverifications).toBe(1);
    const checks = await state.db!.query<{ state: string }>(
      "select state from solicitation_verifications order by started_at"
    );
    expect(checks.rows.map((row) => row.state)).toEqual(["failed", "in_progress"]);
    const claims = await state.db!.query("select state from rfq_send_claims order by created_at");
    expect(claims.rows.map((row) => row.state)).toEqual(["released", "reserved"]);
    const dispatch = await state.db!.query(
      "select finished_at is not null as done from prospective_dispatch_claims order by started_at"
    );
    expect(dispatch.rows.map((row) => row.done)).toEqual([true, false]);
    const previews = await state.db!.query(
      "select state from prospective_previews order by running_since"
    );
    expect(previews.rows.map((row) => row.state)).toEqual(["held", "running"]);
    const mail = await state.db!.query(
      "select delivery_state, coalesce(meta->>'kind', '') as kind, delivery_detail from communications"
    );
    expect(mail.rows.map((row) => `${row.kind}:${row.delivery_state}`).sort()).toEqual([
      "manual:held",
      "manual:unknown",
      "outreach:attempting",
      "outreach:held",
      "outreach:queued",
    ]);
    expect(String(mail.rows.find((row) => row.kind === "outreach" && row.delivery_state === "held")?.delivery_detail))
      .toContain("never reached the mailbox");
    expect(result.releasedQueuedMail).toBe(1);
    // The attempting outreach row may have reached the mailbox; the sweep
    // itself leaves it for the Sent-folder reconciliation and counts it.
    expect(result.unresolvedScheduledMail).toBe(1);
    const receipts = await state.db!.query<{ work_key: string; state: string }>(
      "select work_key, state from ai_work_receipts order by work_key"
    );
    expect(receipts.rows).toEqual([
      { work_key: "scoring-dead", state: "retryable" },
      { work_key: "scoring-done", state: "complete" },
      { work_key: "scoring-live", state: "pending" },
    ]);
    expect(result.releasedReceipts).toBe(1);
    expect(result.pendingReceiptsLeft).toBe(1);
  });

  it("does nothing more on a second pass", async () => {
    const result = await reclaimStaleProviderAttempts();
    expect(result.releasedReceipts).toBe(0);
    expect(result.releasedQueuedMail).toBe(0);
    expect(result.pendingReceiptsLeft).toBe(1);
  });

  it("does not teach the sweep to call a provider or send mail itself", () => {
    const src = readFileSync("lib/domain/hold-sweep.ts", "utf8");
    expect(src).not.toMatch(/from "\.\.\/ai\//);
    expect(src).not.toMatch(/from "\.\.\/integrations\//);
    expect(src).not.toContain("complete(");
    expect(src).not.toContain("send(");
    // A receipt past its lease is handed back, never replayed here.
    expect(src).toContain("set state = 'retryable'");
    expect(src).toContain("AI_RECEIPT_TTL_MS");
    // A queued claim is released only when the mailbox was never asked.
    expect(src).toContain("provider_attempted_at is null");
    expect(src).toContain("coalesce(meta->>'kind', '') = 'manual'");
    expect(src).toContain("coalesce(meta->>'kind', '') <> 'manual'");
    const ai = readFileSync("lib/ai/claude.ts", "utf8");
    const openai = readFileSync("lib/ai/openai.ts", "utf8");
    expect(ai).toContain("timeout: opts.timeoutMs ?? AI_CALL_TIMEOUT_MS");
    expect(openai).toContain("req.timeoutMs ?? AI_CALL_TIMEOUT_MS");
    expect(src).toContain("distinct on (reclaimed.account_scope, reclaimed.provider, reclaimed.credential_hash)");
    expect(src).toContain("runs.org_id");
    const registry = readFileSync("lib/agents/registry.ts", "utf8");
    expect(registry).toContain('pursuitContinuationSweep, cron: "*/10 * * * *"');
    expect(registry).not.toContain("hold-sweep");
    expect(registry).not.toContain("holdSweep");
    const continuation = readFileSync("lib/agents/pursuit-continuation-sweep.ts", "utf8");
    expect(continuation).toContain("runHoldSweepCycle");
    expect(continuation).toContain("recoverOpenPursuitGaps");
    expect(readFileSync("worker/scheduler.ts", "utf8")).toContain("singletonKey: `${agent.name}:${stamp}`");
    expect(readFileSync("lib/agents/provider-recovery-probe.ts", "utf8")).not.toContain("runHoldSweepCycle");
    expect(readFileSync("worker/index.ts", "utf8")).not.toContain("runHoldSweepCycle");
    const cycle = readFileSync("lib/agents/hold-sweep.ts", "utf8");
    expect(cycle).not.toContain("band_decision");
    expect(cycle).not.toContain("enqueue(");
    expect(cycle).toContain("reconcileUncertainScheduledMail");
    const reconcile = readFileSync("lib/scheduled-mail-reconcile.ts", "utf8");
    expect(reconcile).not.toContain(".send(");
    expect(reconcile).toContain("findSentMessage");
    expect(cycle).not.toContain("pipeline_band_stall");
    expect(cycle).not.toContain("pipeline_rfq_stall");
    const reverify = readFileSync("lib/agents/reverify.ts", "utf8");
    expect(reverify).toContain("finally");
    expect(reverify).toContain("The in-progress lease was released and the check was not replayed.");
  });
});
