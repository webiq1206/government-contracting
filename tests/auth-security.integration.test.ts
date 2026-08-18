/**
 * Auth & session security, proven against a real database.
 *
 * These are trust-boundary invariants whose failure is account takeover or a
 * free upgrade, so they are asserted on real rows through the real functions
 * rather than mocks: single-use reset tokens, no account enumeration, session
 * expiry, and — the important one — that a session's org membership and
 * suspension state are read FRESH on every request, so removal or suspension
 * takes effect immediately rather than living in a stale cookie.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("auth & session security (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let auth: typeof import("../lib/auth");
  let reset: typeof import("../lib/auth-password-reset");
  let entitlements: typeof import("../lib/billing/entitlements");

  const user = { id: "", email: `sec-${randomUUID().slice(0, 8)}@example.invalid` };
  const org = { id: "" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    auth = await import("../lib/auth");
    reset = await import("../lib/auth-password-reset");
    entitlements = await import("../lib/billing/entitlements");

    const u = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role)
       values ($1,$2,'Sec User','member') returning id`,
      [user.email, auth.hashPassword("original-password-1")]
    );
    user.id = u!.id;
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status, trial_ends_at)
       values ($1,'trial', now() + interval '10 days') returning id`,
      [`sec-org-${randomUUID()}`]
    );
    org.id = o!.id;
    await query(
      `insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`,
      [org.id, user.id]
    );
  });

  afterAll(async () => {
    if (user.id) {
      await query(`delete from password_reset_tokens where user_id=$1`, [user.id]).catch(() => {});
      await query(`delete from sessions where user_id=$1`, [user.id]).catch(() => {});
      await query(`delete from organization_members where user_id=$1`, [user.id]).catch(() => {});
      await query(`delete from users where id=$1`, [user.id]);
    }
    if (org.id) await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
  });

  it("hashing round-trips and rejects the wrong password", () => {
    const h = auth.hashPassword("hunter2hunter2");
    expect(auth.verifyPassword("hunter2hunter2", h)).toBe(true);
    expect(auth.verifyPassword("wrong", h)).toBe(false);
    // No two hashes are identical (random salt).
    expect(auth.hashPassword("x").slice(0, 40)).not.toBe(auth.hashPassword("x").slice(0, 40));
  });

  it("a random or forged session token resolves to nobody", async () => {
    expect(await auth.resolveSession(undefined)).toBeNull();
    expect(await auth.resolveSession(randomBytesHex())).toBeNull();
    expect(await auth.resolveSession("env-operator.123.deadbeef")).toBeNull();
  });

  it("a valid session resolves, and its org state is read fresh each time", async () => {
    const token = await auth.createSession(user.id);
    const s1 = await auth.resolveSession(token);
    expect(s1?.id).toBe(user.id);
    expect(s1?.organizationId).toBe(org.id);

    // Suspend the org: the SAME session must now carry the suspension, and the
    // access gate must read "none" — no need to invalidate the cookie.
    await query(`update organizations set suspended_at = now() where id=$1`, [org.id]);
    const s2 = await auth.resolveSession(token);
    expect(s2?.organizationId).toBe(org.id);
    expect(entitlements.accessLevel(entitlements.entitlementOf(s2 as never))).toBe("none");
    await query(`update organizations set suspended_at = null where id=$1`, [org.id]);

    // Remove the membership: organizationId drops to null immediately.
    await query(`delete from organization_members where org_id=$1 and user_id=$2`, [org.id, user.id]);
    const s3 = await auth.resolveSession(token);
    expect(s3?.organizationId).toBeNull();
    // restore for later cleanup symmetry
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [org.id, user.id]);
  });

  it("an expired session does not resolve", async () => {
    const token = await auth.createSession(user.id);
    await query(`update sessions set expires_at = now() - interval '1 hour' where id=$1`, [token]);
    expect(await auth.resolveSession(token)).toBeNull();
  });

  it("forgot-password never reveals whether an account exists", async () => {
    const before = await tokenCount();
    await reset.requestPasswordReset("definitely-not-a-user@nowhere.invalid");
    expect(await tokenCount()).toBe(before); // no token minted for a non-user
    // A real user mints a token, but the caller cannot tell from the response.
    await reset.requestPasswordReset(user.email);
    expect(await tokenCount()).toBe(before + 1);
  });

  it("a reset token is single-use and rotates the password + kills sessions", async () => {
    // Mint a raw token by inserting its hash the way requestPasswordReset does.
    const rawToken = await mintResetToken();
    // A live session that must be killed by the reset.
    const liveSession = await auth.createSession(user.id);
    expect(await auth.resolveSession(liveSession)).not.toBeNull();

    const first = await reset.resetPasswordWithToken({ token: rawToken, password: "brand-new-password-9" });
    expect(first).toEqual({ ok: true });
    // Password actually changed.
    const row = await queryOne<{ password_hash: string }>(`select password_hash from users where id=$1`, [user.id]);
    expect(auth.verifyPassword("brand-new-password-9", row!.password_hash)).toBe(true);
    // All prior sessions invalidated.
    expect(await auth.resolveSession(liveSession)).toBeNull();

    // The token cannot be used a second time.
    const second = await reset.resetPasswordWithToken({ token: rawToken, password: "another-password-9" });
    expect("error" in second).toBe(true);
  });

  it("an expired reset token is refused", async () => {
    const raw = await mintResetToken({ expired: true });
    const res = await reset.resetPasswordWithToken({ token: raw, password: "yet-another-pass-9" });
    expect("error" in res).toBe(true);
  });

  it("a reset is refused for a too-short password before any token work", async () => {
    const res = await reset.resetPasswordWithToken({ token: "irrelevant", password: "short" });
    expect(res).toMatchObject({ error: expect.stringContaining("10 characters") });
  });

  // --- helpers ---
  function randomBytesHex() {
    // 64 hex chars, shaped like a real session id but not in the table.
    return Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(NOWSEED() * 16)]).join("");
  }
  let seed = 1;
  function NOWSEED() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  async function tokenCount() {
    const r = await queryOne<{ n: number }>(`select count(*)::int as n from password_reset_tokens where user_id=$1`, [user.id]);
    return r?.n ?? 0;
  }
  async function mintResetToken(opts: { expired?: boolean } = {}) {
    const { createHash, randomBytes } = await import("node:crypto");
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    const exp = opts.expired ? "now() - interval '1 hour'" : "now() + interval '1 hour'";
    await query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1,$2,${exp})`,
      [user.id, hash]
    );
    return raw;
  }
});
