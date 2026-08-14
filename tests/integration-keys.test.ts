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

  it("resolves SAM credentials per organization rather than from config", () => {
    const src = read("lib/integrations/sam.ts");
    // config.sam.apiKey reads process.env, which is the platform's key.
    expect(src).not.toMatch(/config\.sam\.apiKey/);
    expect(src).toMatch(/orgApiKey\("SAM_API_KEY"\)/);
  });
});
