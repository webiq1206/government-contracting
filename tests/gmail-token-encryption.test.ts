/**
 * Gmail OAuth refresh tokens are the platform's most sensitive stored secret:
 * a standing key to read and send from a customer's mailbox. They must be
 * encrypted at rest, and the read path must stay compatible with rows written
 * before encryption shipped.
 */
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.AUTH_SECRET =
    process.env.AUTH_SECRET ||
    "test-secret-that-is-plenty-long-for-aes-key-derivation-000000";
});

describe("gmail token encryption helpers", () => {
  it("encrypts a refresh_token at rest and reads it back", async () => {
    const { encryptSecret, decryptSecret } = await import("../lib/integration-settings");
    const raw = "1//0gRefreshTokenSecretValue_abc123";
    const enc = encryptSecret(raw);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(raw); // the plaintext is not in the stored blob
    expect(decryptSecret(enc)).toBe(raw);
  });

  it("returns null for a legacy plaintext value (reader then uses it raw)", async () => {
    // Rows written before encryption started have no "v1:" prefix. decrypt
    // returns null for them; the gmail reader falls back to the raw string so
    // existing connections keep working.
    const { decryptSecret } = await import("../lib/integration-settings");
    expect(decryptSecret("plain-old-token")).toBeNull();
  });
});
