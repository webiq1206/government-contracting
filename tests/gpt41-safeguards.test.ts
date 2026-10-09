import { sourceEvidenceMatches, verifiedSourcePage } from "@/lib/domain/source-evidence";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { strictJsonSchema } from "@/lib/ai/strict-schema";
import { groundedMoney, quoteHasRange } from "@/lib/domain/source-money";
import { buildOpenAiBody, parseOpenAiResponse } from "@/lib/ai/openai";
import { chooseRoute, type RoutingConfig } from "@/lib/ai/routing";
import { assessReadiness } from "@/lib/domain/submission-readiness";

describe("GPT-4.1 production safeguards", () => {
  const cfg: RoutingConfig = { anthropic: { model: "claude-haiku-4-5", modelSmart: "claude-sonnet-5" }, openai: { model: "gpt-4.1", modelSmart: "gpt-4.1" }, routineProvider: "OpenAI", complexProvider: "OpenAI", fallback: false };
  it("preserves complex budget controls with the same model in both tiers", () => {
    const plan = chooseRoute({ cfg, available: { OpenAI: true, Anthropic: true }, complexity: "complex" });
    expect(plan?.primary).toMatchObject({ model: "gpt-4.1", provider: "OpenAI", complex: true });
    expect(plan?.fallback).toBeNull();
  });
  it("never silently changes providers when fallback is disabled", () => {
    expect(chooseRoute({ cfg, available: { OpenAI: false, Anthropic: true } })).toBeNull();
  });
  it("sends strict JSON schema without reasoning parameters to GPT-4.1", () => {
    const schema = strictJsonSchema(z.object({ amount: z.number().nullable(), verified: z.boolean() }));
    const body = buildOpenAiBody({ apiKey: "test", model: "gpt-4.1", instructions: "Return JSON", prompt: "test", maxTokens: 500, effort: "medium", responseSchema: schema });
    expect(body.reasoning).toBeUndefined();
    expect(body.max_output_tokens).toBe(500);
    expect(body.text).toEqual({ format: { type: "json_schema", name: "brostco_response", strict: true, schema } });
    expect(schema.required).toEqual(["amount", "verified"]);
    expect(schema.additionalProperties).toBe(false);
  });
  it("does not report refusals, queued or incomplete responses as complete", () => {
    expect(parseOpenAiResponse({ status: "queued" }).stopReason).toBe("queued");
    expect(parseOpenAiResponse({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }).stopReason).toBe("refusal");
    expect(parseOpenAiResponse({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }).stopReason).toBe("max_tokens");
  });
  it("keeps cents and rejects computed, invented, shorthand or rounded amounts", () => {
    expect(groundedMoney(1234.56, "Our total is $1,234.56")).toBe(1234.56);
    expect(groundedMoney(1234.56, "Our total is $1,234.56.")).toBe(1234.56);
    expect(groundedMoney(1234.56, "Our total is $1,234.567")).toBeNull();
    expect(groundedMoney(1235, "Our total is $1,234.56")).toBeNull();
    expect(groundedMoney(10300, "80 units at $125 plus $300 delivery")).toBeNull();
    expect(groundedMoney(125, "Budget $125k")).toBeNull();
    expect(groundedMoney(120, "USD 120")).toBe(120);
    expect(groundedMoney(0, "Freight $0")).toBe(0);
    expect(groundedMoney(-1, "-$1")).toBeNull();
  });
  it("does not invent a firm quote from a range", () => {
    expect(quoteHasRange("$10,000 to $12,000")).toBe(true);
    expect(quoteHasRange("between $10,000 and $12,000")).toBe(true);
    expect(quoteHasRange("Total $10,000")).toBe(false);
  });
  it("holds sending while the compliance audit is pending even after human signoff", () => {
    expect(assessReadiness({ mechanicallyComplete: true, blockerCount: 0, auditStatus: "pending", openAuditBlockers: 0, verifiedBy: "Reviewer", submissionState: "approved", humanGateRequired: false }).maySend).toBe(false);
  });
});

it("checks quotations on the cited page, not a different page", () => {
  const source = "[p.1] Old deadline November 16.\n[p.2] Amended deadline November 19.";
  expect(sourceEvidenceMatches(source, "Amended deadline November 19.", 2)).toBe(true);
  expect(sourceEvidenceMatches(source, "Amended deadline November 19.", 1)).toBe(false);
  expect(sourceEvidenceMatches(source, "", 2)).toBe(false);
  expect(sourceEvidenceMatches(source, "Invented requirement", 2)).toBe(false);
});

describe("physical page citation verification", () => {
  const source = "[p.1] Cover\n[p.2] Submission format\n[p.3] Honeywell technician certificates are required.\n[p.5] Submission format";
  it("corrects a one-page discrepancy only when the quotation identifies the physical page", () => {
    expect(verifiedSourcePage(source, "Honeywell technician certificates are required.", 2)).toBe(3);
  });
  it("preserves a correctly quoted page and does not compact missing or blank pages", () => {
    expect(verifiedSourcePage(source, "Submission format", 5)).toBe(5);
  });
  it("does not invent a correction for ambiguous, missing or invented quotations", () => {
    expect(verifiedSourcePage(source, "Submission format", 3)).toBeUndefined();
    expect(verifiedSourcePage(source, undefined, 2)).toBeUndefined();
    expect(verifiedSourcePage(source, "Invented certification", 2)).toBeUndefined();
    expect(verifiedSourcePage("Unpaginated source", "Unpaginated source", 1)).toBeUndefined();
  });
});
