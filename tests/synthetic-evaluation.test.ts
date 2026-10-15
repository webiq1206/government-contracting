import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { evaluationPlan, runSyntheticEvaluation, type EvaluationAuthorization,
  type EvaluationClient } from "../scripts/lib/synthetic-evaluation";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "brostco-evaluation-test-"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Tests cannot contact a provider."); }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals(); });

function authorization(): EvaluationAuthorization {
  const plan = evaluationPlan();
  return { runId: "synthetic-test", planSha256: plan.sha256,
    maximumProviderCostNanoUsd: plan.maximumProviderCostNanoUsd, mode: "offline-fixture",
    runtimeReference: "offline-test", accountReference: "synthetic-account" };
}
const cents = { quote_amount: 1234.56, missing_fields: [] };
const range = { quote_amount: null, missing_fields: ["price clarification"] };
const review = { deadline_matches_current_notice: false, signed_acknowledgment_missing: true,
  deadline_source_excerpt: "Bid deadline is November 19, 2026 at 2 PM America/Denver.",
  signature_source_excerpt: "Signed acknowledgment is required." };
function response(model: string, value: unknown) {
  return { id: "synthetic-response", model, service_tier: "default", status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text: typeof value === "string" ? value : JSON.stringify(value) }] }],
    usage: { input_tokens: 100, output_tokens: 200,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
}
function client(dispatch?: EvaluationClient["dispatchOnce"]): EvaluationClient {
  let call = 0;
  return { mode: "offline-fixture", runtimeReference: "offline-test", accountReference: "synthetic-account",
    assertAdmission: vi.fn(async () => {}), dispatchOnce: vi.fn(dispatch ?? (async body =>
      response(String(body.model), [cents, range, review][call++]))) };
}
function events() {
  return readFileSync(join(root, "synthetic-test", "events.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
}

describe("bounded synthetic model screen", () => {
  it("fixes the five worst-case attempts at $0.0654208 provider cost, without app markup/reservations", () => {
    const plan = evaluationPlan();
    expect(plan.maximumProviderCostNanoUsd).toBe(65_420_800);
    expect(plan.attempts.map(a => a.outputTokenLimit)).toEqual([1600, 3200, 1600, 3200, 4096]);
    expect(plan.attempts.every(a => a.byteEnvelope <= 8192)).toBe(true);
    for (const attempt of plan.attempts) {
      expect(attempt.body).toMatchObject({ reasoning: { effort: "none" }, service_tier: "default", store: false,
        truncation: "disabled", prompt_cache_options: { mode: "explicit" } });
      expect(attempt.body).not.toHaveProperty("tools");
      expect(JSON.stringify(attempt.body)).not.toContain("input_file");
      expect(JSON.stringify(attempt.body)).not.toContain("apiKey");
    }
  });

  it("passes three model labels using only three dispatches and records the real smaller token cost", async () => {
    const c = client();
    const result = await runSyntheticEvaluation(root, authorization(), c);
    expect(result).toEqual({ status: "passed", reason: null, dispatches: 3,
      knownProviderCostNanoUsd: 2_420_000, unknownCostHoldNanoUsd: 0 });
    expect(c.dispatchOnce).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
    expect(events().at(-1).event).toBe("run_finished");
  });

  it("allows one cost-known JSON/truncation correction per extraction and never a sixth dispatch", async () => {
    let call = 0;
    const c = client(async body => {
      const n = call++;
      const r = response(String(body.model), ["{", cents, range, range, review][n]);
      return n === 2 ? { ...r, status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } : r;
    });
    const result = await runSyntheticEvaluation(root, authorization(), c);
    expect(result.status).toBe("passed");
    expect(result.dispatches).toBe(5);
    expect(c.dispatchOnce).toHaveBeenCalledTimes(5);
    expect(events().filter(e => e.event === "dispatch_started").map(e => e.correction)).toEqual([false, true, false, true, false]);
    await expect(runSyntheticEvaluation(root, authorization(), c)).rejects.toThrow();
    expect(c.dispatchOnce).toHaveBeenCalledTimes(5);
  });

  it("fsyncs an unresolved started event before calling the client and rejects a competing run", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const c = client(async () => {
      expect(events().at(-1)).toMatchObject({ event: "dispatch_started", attempt: 1 });
      entered(); await pending; throw new Error("simulated uncertain transport failure");
    });
    const first = runSyntheticEvaluation(root, authorization(), c);
    await started;
    await expect(runSyntheticEvaluation(root, authorization(), c)).rejects.toThrow();
    expect(c.dispatchOnce).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toMatchObject({ status: "stopped", dispatches: 1, reason: "transport-error-or-refusal" });
    expect(events().at(-1).unknownCostHoldNanoUsd).toBeGreaterThan(0);
  });

  it.each(["missing-usage", "wrong-model", "wrong-tier", "cache", "reasoning", "input-over-bound", "output-over-cap", "contradictory", "negative"])(
    "stops on %s before any correction and preserves the unknown-cost hold", async fault => {
      const c = client(async body => {
        const r: any = response(String(body.model), "invalid JSON");
        if (fault === "missing-usage") delete r.usage;
        if (fault === "wrong-model") r.model = "gpt-4.1";
        if (fault === "wrong-tier") r.service_tier = "priority";
        if (fault === "cache") r.usage.input_tokens_details.cached_tokens = 1;
        if (fault === "reasoning") r.usage.output_tokens_details.reasoning_tokens = 1;
        if (fault === "input-over-bound") r.usage.input_tokens = 8193;
        if (fault === "output-over-cap") r.usage.output_tokens = 1601;
        if (fault === "contradictory") r.usage.input_tokens_details.cached_tokens = 101;
        if (fault === "negative") r.usage.input_tokens = -1;
        return r;
      });
      const r = await runSyntheticEvaluation(root, authorization(), c);
      expect(r).toMatchObject({ status: "stopped", reason: "unknown-usage", dispatches: 1 });
      expect(r.unknownCostHoldNanoUsd).toBeGreaterThan(0);
      expect(c.dispatchOnce).toHaveBeenCalledTimes(1);
    });

  it("does not retry or persist a raw transport error that might contain secret material", async () => {
    const c = client(async () => { throw new Error("sk-synthetic-secret and private response header"); });
    const r = await runSyntheticEvaluation(root, authorization(), c);
    expect(r).toMatchObject({ status: "stopped", dispatches: 1, reason: "transport-error-or-refusal" });
    expect(JSON.stringify(events())).not.toContain("sk-synthetic-secret");
    expect(JSON.stringify(events())).not.toContain("private response header");
  });

  it("stops on a content refusal even with valid usage, and records known incurred cost", async () => {
    const c = client(async body => ({ ...response(String(body.model), cents),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "synthetic refusal" }] }] }));
    const r = await runSyntheticEvaluation(root, authorization(), c);
    expect(r).toMatchObject({ status: "stopped", reason: "provider-refusal-or-incomplete", dispatches: 1,
      knownProviderCostNanoUsd: 110_000, unknownCostHoldNanoUsd: 0 });
  });

  it("does not turn a semantic wrong answer into another paid attempt", async () => {
    const c = client(async body => response(String(body.model), { quote_amount: 1235, missing_fields: [] }));
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ status: "stopped", reason: "failed-label", dispatches: 1 });
  });

  it("requires source-backed amendment findings, not only favorable booleans", async () => {
    let call = 0;
    const c = client(async body => response(String(body.model),
      [cents, range, { ...review, signature_source_excerpt: "Signed acknowledgment is optional." }][call++]));
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ status: "stopped", reason: "failed-label", dispatches: 3 });
  });

  it("stops when the one permitted correction also fails", async () => {
    const c = client(async body => response(String(body.model), "{"));
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ status: "stopped", reason: "invalid-json", dispatches: 2 });
  });

  it("checks account admission before every dispatch, including corrections", async () => {
    const c = client(async body => response(String(body.model), "{"));
    c.assertAdmission = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("retained refusal"));
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ status: "stopped", reason: "admission-blocked", dispatches: 1 });
    expect(c.dispatchOnce).toHaveBeenCalledTimes(1);
  });

  it("rejects a changed client account after admission before dispatch", async () => {
    const c = client();
    c.assertAdmission = async () => { c.accountReference = "different-account"; };
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ status: "stopped", reason: "admission-blocked", dispatches: 0 });
    expect(c.dispatchOnce).not.toHaveBeenCalled();
  });

  it("will not dispatch when the journal root is unavailable", async () => {
    const c = client();
    await expect(runSyntheticEvaluation(join(root, "absent-parent"), authorization(), c)).rejects.toThrow();
    expect(c.dispatchOnce).not.toHaveBeenCalled();
  });

  it("freezes nested wire options so a supplied client cannot add tools or change caps", async () => {
    const c = client(async body => {
      expect(Object.isFrozen(body)).toBe(true);
      expect(Object.isFrozen(body.input)).toBe(true);
      expect(Object.isFrozen(body.reasoning)).toBe(true);
      expect(() => { (body.reasoning as any).effort = "high"; }).toThrow();
      return response(String(body.model), { quote_amount: 0, missing_fields: [] });
    });
    expect(await runSyntheticEvaluation(root, authorization(), c)).toMatchObject({ dispatches: 1, reason: "failed-label" });
  });

  it.each(["cost-low", "cost-high", "plan", "runtime", "account", "mode", "run-id"])("rejects mismatched %s authorization before dispatch", async field => {
    const a = authorization(); const c = client();
    if (field === "cost-low") a.maximumProviderCostNanoUsd--;
    if (field === "cost-high") a.maximumProviderCostNanoUsd++;
    if (field === "plan") a.planSha256 = "not-the-plan";
    if (field === "runtime") a.runtimeReference = "other-runtime";
    if (field === "account") a.accountReference = "other-account";
    if (field === "mode") a.mode = "live-approved";
    if (field === "run-id") a.runId = "../escape";
    await expect(runSyntheticEvaluation(root, a, c)).rejects.toThrow("authorization");
    expect(c.dispatchOnce).not.toHaveBeenCalled();
    expect(existsSync(join(root, "synthetic-test"))).toBe(false);
  });

  it("will not follow a symlink or reuse an abandoned claim", async () => {
    const target = join(root, "target"); mkdirSync(target);
    symlinkSync(target, join(root, "synthetic-test"));
    const c = client();
    await expect(runSyntheticEvaluation(root, authorization(), c)).rejects.toThrow();
    expect(c.dispatchOnce).not.toHaveBeenCalled();
    expect(existsSync(join(target, "events.jsonl"))).toBe(false);
  });

  it("offers only a plan at the CLI and refuses --execute without a live binding", () => {
    const plan = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/gpt6-synthetic-evaluation.ts", "--plan"], { encoding: "utf8" }));
    expect(plan).toMatchObject({ mode: "offline-plan-only", paidCalls: 0, liveRuntimeBinding: false });
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/gpt6-synthetic-evaluation.ts", "--execute"],
      { stdio: "pipe" })).toThrow();
  });
});
