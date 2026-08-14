import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Customers bring their own API keys, and the platform's must never serve one.
 *
 * The bug this guards against was structural rather than logical:
 * integration_settings was keyed by `env_key` alone, so the second customer to
 * save a SAM key overwrote the first, and `hydrateIntegrationEnv()` then
 * copied whichever row it found into `process.env`, which one worker shares
 * across every tenant's jobs. Nothing in the code looked wrong; the table
 * shape and a global write did the damage.
 *
 * These are source assertions for the same reason the data-scoping test is:
 * the failure mode is a call site that forgets, and reading the source catches
 * the next one on the day it is written.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("integration credentials are per organization", () => {
  it("keys the settings table by env_key AND org_id", () => {
    const migration = read("db/migrations/050_integration_settings_per_org.sql");
    expect(migration).toMatch(/primary key \(env_key, org_id\)/i);
  });

  it("never upserts on env_key alone", () => {
    // `on conflict (env_key)` is the exact expression that let one customer
    // overwrite another's credential.
    const src = read("lib/integration-settings.ts");
    expect(src).not.toMatch(/on conflict \(env_key\)\s/i);
    expect(src).toMatch(/on conflict \(env_key, org_id\)/i);
  });

  it("scopes every settings query to an organization", () => {
    const src = read("lib/integration-settings.ts");
    // Every backtick-quoted SQL literal that touches the table, however the
    // statement is phrased ("select * from ...", "update ...", "insert into
    // ...", "delete from ...").
    const statements = (src.match(/`[^`]*integration_settings[^`]*`/gi) ?? []).filter(
      (s) => /\b(select|insert|update|delete)\b/i.test(s)
    );
    expect(statements.length, "expected to find the CRUD statements").toBeGreaterThanOrEqual(4);
    for (const s of statements) {
      expect(s, `unscoped settings query:\n${s}`).toMatch(/org_id/);
    }
  });

  /**
   * The load-bearing one. Writing a credential into process.env makes it
   * visible to every concurrent request in the process, so even correct
   * per-org storage would still leak.
   */
  it("never writes a credential into process.env", () => {
    const src = read("lib/integration-settings.ts");
    expect(src).not.toMatch(/process\.env\[[^\]]+\]\s*=/);
  });

  it("only lets the founding organization fall back to the environment", () => {
    const src = read("lib/integration-keys.ts");
    // The fallback must be guarded by an explicit legacy-org comparison; an
    // unguarded read would hand the platform's key to a customer.
    expect(src).toMatch(/org === LEGACY_ORG_ID/);
    const fallback = src.slice(src.indexOf("if (!value && org === LEGACY_ORG_ID)"));
    expect(fallback).toMatch(/process\.env\[key\]/);
  });

  /**
   * Every credential a customer is billed for, one case each. The platform's
   * key must never be the one that runs their search, their AI call, their
   * lookup, or sends from their phone number.
   */
  it.each([
    ["lib/integrations/sam.ts", /config\.sam\.apiKey/, /orgApiKey\("SAM_API_KEY"\)/],
    ["lib/integrations/googleMaps.ts", /config\.googleMaps\.apiKey/, /orgApiKey\("GOOGLE_MAPS_API_KEY"\)/],
    ["lib/integrations/hunter.ts", /config\.hunter\.apiKey/, /orgApiKey\("HUNTER_API_KEY"\)/],
    ["lib/integrations/twilio.ts", /config\.twilio\.(accountSid|authToken|fromNumber)/, /orgApiKey\("TWILIO_ACCOUNT_SID"\)/],
  ])("resolves %s credentials per organization", (file, platformPattern, orgPattern) => {
    const src = read(file);
    expect(src, `${file} still reads the platform credential`).not.toMatch(platformPattern);
    expect(src, `${file} does not resolve a per-org credential`).toMatch(orgPattern);
  });

  /**
   * The Anthropic SDK client was a module-level singleton built from
   * process.env, so the first organization to make an AI call captured its key
   * in memory for every tenant that followed, until the process restarted.
   */
  it("never caches one Anthropic client across organizations", () => {
    const src = read("lib/ai/claude.ts");
    expect(src).not.toMatch(/let _client: Anthropic \| null/);
    expect(src).toMatch(/_clients = new Map<string, Anthropic>/);
    expect(src).toMatch(/orgApiKey\("ANTHROPIC_API_KEY"/);
  });

  it("hides platform-owned integrations from customers", () => {
    // Ahrefs tracks our marketing domain; Supabase is our storage. A field a
    // customer can fill that changes nothing for them is worse than no field.
    const defs = read("lib/integration-defs.ts");
    expect(defs).toMatch(/platformOnly\?: boolean/);
    const ahrefs = defs.slice(defs.indexOf('id: "ahrefs"'), defs.indexOf('id: "googleMaps"'));
    expect(ahrefs).toMatch(/platformOnly: true/);
  });
});
