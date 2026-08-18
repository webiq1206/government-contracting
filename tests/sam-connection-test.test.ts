import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VALIDATORS } from "../lib/integration-validators";

/**
 * "SAM.gov returned an error (HTTP 404)."
 *
 * That sentence cost an operator an afternoon, and it was true but useless.
 * SAM.gov does not reject an unknown API key with 401 or 403. Its gateway
 * turns the request away with a bare 404 and an empty body, indistinguishable
 * from a dead URL, so our generic status message read as "SAM.gov is broken"
 * when it meant "that key is not one of ours". Verified against the live API:
 * the saved key returns 200 on the same URL that a well-formed but unknown key
 * 404s on.
 *
 * Underneath sat the reason a good key was never being sent: the test read
 * process.env while the page beside it said "saved here" about a
 * per-organization value in the database.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function mockFetch(res: {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}) {
  const spy = vi.fn(async () =>
    new Response(res.body ?? "", {
      status: res.status,
      headers: res.headers ?? {},
    })
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SAM.gov connection test", () => {
  it("reads SAM's empty 404 as an unrecognized key, not as an outage", async () => {
    mockFetch({ status: 404, body: "", headers: { server: "istio-envoy" } });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "well-formed-but-unknown" });

    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/did not recognize this key/i);
    // The operator needs to know what to do about it.
    expect(r.message).toMatch(/copy it again/i);
    // The old wording is the bug. It must not come back.
    expect(r.message).not.toMatch(/^SAM\.gov returned an error \(HTTP 404\)\.$/);
  });

  it("does not swallow a 404 that came with a real explanation", async () => {
    // Only the empty-bodied 404 is SAM's way of saying "unknown key". If
    // something ever answers 404 with a reason, show the reason.
    mockFetch({ status: 404, body: JSON.stringify({ message: "No such resource" }) });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "k" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("No such resource");
    expect(r.message).not.toMatch(/did not recognize this key/i);
  });

  it("blames the key only when SAM.gov actually rejected it", async () => {
    mockFetch({ status: 403, body: JSON.stringify({ error: { code: "API_KEY_INVALID" } }) });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "bad" });

    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected this key/i);
  });

  it("passes SAM's own explanation through when it gives one", async () => {
    mockFetch({
      status: 400,
      body: JSON.stringify({ errorMessage: "postedFrom is a required parameter" }),
    });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "k" });

    expect(r.ok).toBe(false);
    expect(r.message).toContain("postedFrom is a required parameter");
    // A real answer from SAM is not reported as an unreachable network.
    expect(r.message).not.toMatch(/couldn't reach/i);
  });

  it("identifies itself, because an unnamed client gets refused at the gateway", async () => {
    const spy = mockFetch({ status: 200, body: JSON.stringify({ totalRecords: 0 }) });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "k" });

    expect(r.ok).toBe(true);
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBeTruthy();
    expect(headers["User-Agent"]).not.toBe("node");
    expect(headers.Accept).toBe("application/json");
  });

  it("still reports a rate limit as a working key", async () => {
    mockFetch({ status: 429 });
    const r = await VALIDATORS.sam({ SAM_API_KEY: "k" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/rate limit/i);
  });

  it("never echoes the key back, even when the upstream quotes our request", async () => {
    // The key rides in the query string, so a gateway that quotes the offending
    // URL hands it straight back. This message is shown on screen AND stored in
    // integration_settings.last_error.
    const key = "SUPERSECRETSAMKEY1234567890abcdef";
    mockFetch({
      status: 400,
      body: JSON.stringify({
        message: `Bad request: /opportunities/v2/search?api_key=${key}&limit=1`,
      }),
    });
    const r = await VALIDATORS.sam({ SAM_API_KEY: key });

    expect(r.ok).toBe(false);
    expect(r.message).not.toContain(key);
    expect(r.message).toContain("[redacted]");
  });
});

describe("the Test button tests the credential the app would use", () => {
  /*
   * The page said "saved here" next to a key stored per organization while the
   * test read process.env, so it was testing a different value than the one
   * running. Source assertions, because the failure is a call site reverting
   * to the convenient global.
   */
  const src = read("app/api/integrations/test/route.ts");

  it("resolves saved keys through the per-organization getter", () => {
    expect(src).toMatch(/orgApiKey\(/);
  });

  it("does not fall back to the shared environment for UI-managed keys", () => {
    // process.env may still serve keys the UI does not manage, but it must not
    // be reached for an allowed key ahead of the organization's own value.
    const envReads = src.match(/process\.env\[[^\]]+\]/g) ?? [];
    expect(envReads.length).toBeLessThanOrEqual(1);
    expect(src).toMatch(/isAllowedKey\(f\.env\)\s*\?\s*await orgApiKey/);
  });

  it("no longer relies on hydrateIntegrationEnv, which is a no-op", () => {
    // The name may still appear in a comment explaining the history; what must
    // not come back is calling it and then trusting process.env.
    expect(src).not.toMatch(/await\s+hydrateIntegrationEnv\s*\(/);
    expect(src).not.toMatch(/^\s*import\b.*hydrateIntegrationEnv/m);
  });
});
