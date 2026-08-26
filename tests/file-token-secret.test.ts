/**
 * A public secret must not sign a link to somebody's tax form.
 *
 * config.auth.secret falls back to "dev-insecure-secret-change-me", which is a
 * literal in the open-source tree. A production instance running on it signs
 * file-access tokens with a value anyone can read, so every stored
 * solicitation document, W-9 and subcontractor upload is reachable by anyone
 * who can construct a URL.
 *
 * The health endpoint already returned 503 for this, which is what stops a
 * host routing traffic. It does not stop the process minting tokens, and
 * lib/domain/sub-portal-link.ts had already taken the stronger position for
 * portal links. File links are reachable by the same strangers and carry the
 * same documents.
 *
 * The two halves fail differently on purpose: minting throws, because that is
 * our own code doing something it must not; verifying returns false, because a
 * thrown error on a public route is a 500, and a 500 tells a stranger more
 * than a refusal does.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

const REAL = "a-real-production-secret-value";

async function withEnv(
  env: Record<string, string | undefined>,
  fn: (m: typeof import("../lib/integrations/storage")) => void | Promise<void>
) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  try {
    await fn(await import("../lib/integrations/storage"));
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

afterEach(() => {
  vi.resetModules();
});

describe("file access tokens", () => {
  it("refuses to mint one in production on the public default secret", async () => {
    await withEnv(
      { NODE_ENV: "production", AUTH_SECRET: undefined, SESSION_SECRET: undefined },
      (m) => {
        expect(() => m.fileToken("docs/w9.pdf", 9999999999)).toThrow(/AUTH_SECRET/);
      }
    );
  });

  it("refuses a token forged with the published default secret", async () => {
    /*
     * The actual attack, not a stand-in for it.
     *
     * The first version of this passed "anything" as the signature, which is
     * refused whether or not the guard exists, so it proved nothing: it
     * survived having the guard removed. What matters is a signature computed
     * correctly against the secret that is printed in the source, which is
     * what a stranger with a checkout can produce.
     *
     * Legitimately issued tokens are refused too, and that is right rather
     * than a degradation to avoid: under a published key every one of them is
     * indistinguishable from a forgery.
     */
    const { createHmac } = await import("node:crypto");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const forged = createHmac("sha256", "dev-insecure-secret-change-me")
      .update(`file:docs/w9.pdf:${exp}`)
      .digest("hex");
    await withEnv(
      { NODE_ENV: "production", AUTH_SECRET: undefined, SESSION_SECRET: undefined },
      (m) => {
        expect(m.verifyFileToken("docs/w9.pdf", exp, forged)).toBe(false);
      }
    );
  });

  it("works normally in production once a real secret is set", async () => {
    await withEnv({ NODE_ENV: "production", AUTH_SECRET: REAL }, (m) => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const tok = m.fileToken("docs/spec.pdf", exp);
      expect(tok).toMatch(/^[0-9a-f]{64}$/);
      expect(m.verifyFileToken("docs/spec.pdf", exp, tok)).toBe(true);
    });
  });

  it("still rejects a token for a different file or a passed expiry", async () => {
    // The checks that existed before must survive the new guard above them.
    await withEnv({ NODE_ENV: "production", AUTH_SECRET: REAL }, (m) => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const tok = m.fileToken("docs/spec.pdf", exp);
      expect(m.verifyFileToken("docs/other.pdf", exp, tok)).toBe(false);
      const past = Math.floor(Date.now() / 1000) - 1;
      expect(m.verifyFileToken("docs/spec.pdf", past, m.fileToken("docs/spec.pdf", past))).toBe(
        false
      );
    });
  });

  it("keeps the default working outside production, which is what it is for", async () => {
    await withEnv(
      { NODE_ENV: "test", AUTH_SECRET: undefined, SESSION_SECRET: undefined },
      (m) => {
        const exp = Math.floor(Date.now() / 1000) + 600;
        const tok = m.fileToken("docs/spec.pdf", exp);
        expect(m.verifyFileToken("docs/spec.pdf", exp, tok)).toBe(true);
      }
    );
  });
});
