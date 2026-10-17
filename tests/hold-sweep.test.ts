/**
 * A dead process leaves the claim behind and must not leave it forever.
 * The sweep releases only what is older than the provider timeout plus its
 * margin, and it never turns a pending receipt or a scheduled send into
 * another provider call.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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
  HOLD_REGISTRY,
  PROVIDER_ATTEMPT_TTL_MS,
  USAGE_ABANDON_MINUTES,
  providerAttemptIsStale,
  sweepActed,
} from "../lib/domain/hold-registry";
import { pipelineStallActions, PIPELINE_STALL_HOURS } from "../lib/domain/pipeline-watch";

describe("hold leases", () => {
  it("waits until the provider abort cannot still be on the wire", () => {
    expect(PROVIDER_ATTEMPT_TTL_MS).toBeGreaterThan(AI_CALL_TIMEOUT_MS);
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
      ])
    );
  });

  it("alerts once while eligible work is stalled and once when it clears", () => {
    expect(PIPELINE_STALL_HOURS).toEqual({ scoring: 2, band: 2, rfq: 6 });
    expect(pipelineStallActions({
      scoringEligible: 3,
      bandEligible: 0,
      rfqEligible: 1,
      scoringIncidentOpen: false,
      bandIncidentOpen: false,
      rfqIncidentOpen: true,
    })).toEqual([{ kind: "scoring", action: "alert" }]);
    expect(pipelineStallActions({
      scoringEligible: 0,
      bandEligible: 0,
      rfqEligible: 0,
      scoringIncidentOpen: true,
      bandIncidentOpen: false,
      rfqIncidentOpen: false,
    })).toEqual([{ kind: "scoring", action: "resolve" }]);
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
  const staleScope = `tenant:${randomUUID()}`;
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
        agent text not null,
        status text not null,
        started_at timestamptz not null default now(),
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
      `insert into job_runs (agent, status, started_at) values
         ('scoring-engine', 'running', now() - interval '24 minutes'),
         ('scoring-engine', 'running', now() - interval '40 minutes'),
         ('notice-description-sweep', 'running', now() - interval '100 minutes')`
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
         ($3, 'queued', '{"kind":"outreach"}'::jsonb, now() - interval '90 days', null)`,
      [randomUUID(), randomUUID(), randomUUID()]
    );
    await state.db.query(
      `insert into ai_work_receipts (org_id, work_key, state, started_at)
       values ($1, 'scoring', 'pending', now() - interval '20 minutes')`,
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
    const runs = await state.db!.query("select agent, status, error from job_runs order by started_at");
    expect(runs.rows.filter((row) => row.agent === "scoring-engine" && row.status === "error").length).toBe(1);
    expect(runs.rows.find((row) => row.agent === "scoring-engine" && row.status === "running")).toBeTruthy();
    expect(runs.rows.find((row) => row.agent === "notice-description-sweep")?.status).toBe("error");
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
      "select delivery_state, coalesce(meta->>'kind', '') as kind from communications"
    );
    expect(mail.rows.map((row) => `${row.kind}:${row.delivery_state}`).sort()).toEqual([
      "manual:held",
      "manual:unknown",
      "outreach:queued",
    ]);
    expect(
      (await state.db!.query("select state from ai_work_receipts")).rows
    ).toEqual([{ state: "pending" }]);
  });

  it("does not teach the sweep to replay a receipt or a scheduled send", () => {
    const src = readFileSync("lib/domain/hold-sweep.ts", "utf8");
    expect(src).not.toContain("state = 'retryable'");
    expect(src).not.toContain("state='retryable'");
    expect(src).toContain("coalesce(meta->>'kind', '') = 'manual'");
    expect(src).toContain("coalesce(meta->>'kind', '') <> 'manual'");
    const ai = readFileSync("lib/ai/claude.ts", "utf8");
    const openai = readFileSync("lib/ai/openai.ts", "utf8");
    expect(ai).toContain("timeout: opts.timeoutMs ?? AI_CALL_TIMEOUT_MS");
    expect(openai).toContain("req.timeoutMs ?? AI_CALL_TIMEOUT_MS");
    expect(readFileSync("lib/agents/registry.ts", "utf8")).toContain('holdSweep, cron: "*/10 * * * *"');
  });
});
