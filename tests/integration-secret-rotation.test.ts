/**
 * A stored credential must survive the deployment's secret changing.
 *
 * On 2026-09-08 production had every saved key encrypted under SESSION_SECRET
 * (the only secret set when they were saved). AUTH_SECRET was added later, as
 * the docs ask, and from the next boot the reader derived a different key and
 * called every row unreadable: every agent stopped, and the message told the
 * operator to restore a secret that was already correct. Nothing had been
 * lost. The reader has to try every secret the deployment holds, and a rekey
 * has to be able to move rows onto the current one.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const OLD = "old-session-secret-provisioned-by-the-host-0000000000000000000000";
const NEW = "new-auth-secret-added-by-the-operator-later-000000000000000000000";
const ROTATED = "rotated-auth-secret-000000000000000000000000000000000000000000000";

const saved: Record<string, string | undefined> = {};
const KEYS = ["AUTH_SECRET", "SESSION_SECRET", "AUTH_SECRET_PREVIOUS", "NODE_ENV"] as const;

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function mod() {
  return import("../lib/integration-settings");
}

describe("integration secret rotation", () => {
  it("reads a value written under SESSION_SECRET after AUTH_SECRET is added", async () => {
    process.env.SESSION_SECRET = OLD;
    const { encryptSecret, decryptSecret, isUnderPrimarySecret } = await mod();
    const stored = encryptSecret("sk-ant-example");
    expect(isUnderPrimarySecret(stored)).toBe(true);

    // The operator adds AUTH_SECRET. The host's SESSION_SECRET is still set.
    process.env.AUTH_SECRET = NEW;
    expect(decryptSecret(stored)).toBe("sk-ant-example");
    expect(isUnderPrimarySecret(stored)).toBe(false);

    // Re-encrypting moves it onto the primary.
    const moved = encryptSecret(decryptSecret(stored)!);
    expect(isUnderPrimarySecret(moved)).toBe(true);
    delete process.env.SESSION_SECRET;
    expect(decryptSecret(moved)).toBe("sk-ant-example");
  });

  it("reads a value written under the previous AUTH_SECRET during a deliberate rotation", async () => {
    process.env.AUTH_SECRET = NEW;
    const { encryptSecret, decryptSecret } = await mod();
    const stored = encryptSecret("sam-key-example");

    process.env.AUTH_SECRET = ROTATED;
    process.env.AUTH_SECRET_PREVIOUS = NEW;
    expect(decryptSecret(stored)).toBe("sam-key-example");
  });

  it("still reports a value no held secret can read, and says what to do", async () => {
    process.env.AUTH_SECRET = NEW;
    const { encryptSecret, decryptSecret } = await mod();
    const stored = encryptSecret("maps-key-example");

    process.env.AUTH_SECRET = ROTATED;
    // No previous secret, no session secret: genuinely unreadable.
    expect(() => decryptSecret(stored)).toThrow(/could not be decrypted/i);
    expect(() => decryptSecret(stored)).toThrow(/AUTH_SECRET_PREVIOUS/);
    expect(() => decryptSecret(stored)).toThrow(/db:rekey-secrets/);
  });

  it("writes new values under the primary secret only", async () => {
    process.env.AUTH_SECRET = NEW;
    process.env.SESSION_SECRET = OLD;
    const { encryptSecret, candidateSecrets, isUnderPrimarySecret } = await mod();
    expect(candidateSecrets()[0]).toBe(NEW);
    expect(candidateSecrets()).toContain(OLD);
    expect(isUnderPrimarySecret(encryptSecret("x"))).toBe(true);
  });

  it("lists each secret once, primary first, and never the empty string", async () => {
    process.env.AUTH_SECRET = NEW;
    process.env.SESSION_SECRET = NEW;
    process.env.AUTH_SECRET_PREVIOUS = "";
    const { candidateSecrets } = await mod();
    expect(candidateSecrets()).toEqual([NEW]);
  });

  it("leaves legacy plaintext alone", async () => {
    process.env.AUTH_SECRET = NEW;
    const { decryptSecret, isUnderPrimarySecret } = await mod();
    expect(decryptSecret("plain-old-token")).toBeNull();
    expect(isUnderPrimarySecret("plain-old-token")).toBe(false);
  });
});
