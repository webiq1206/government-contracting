/**
 * Lending a platform credential, end to end.
 *
 * The grant table and the resolution order existed before this screen did, so
 * the thing worth proving is not that a row gets written: it is that writing
 * it changes which credential the customer's work actually runs on, and that
 * revoking it changes back. A grant that looked right on the page and did
 * nothing to orgApiKey would be worse than no screen at all.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const PLATFORM_KEY = "platform-anthropic-key-for-test";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("platform key grants (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let admin: typeof import("../lib/admin/platform-keys");
  let orgApiKey: typeof import("../lib/integration-keys").orgApiKey;
  let clearIntegrationKeyCache: typeof import("../lib/integration-keys").clearIntegrationKeyCache;

  const orgId = { value: "" };
  const ORG_NAME = `keygrant-${randomUUID()}`;
  const ADMIN = "grant-admin@example.test";
  const realAnthropic = process.env.ANTHROPIC_API_KEY;
  const realSam = process.env.SAM_API_KEY;

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    admin = await import("../lib/admin/platform-keys");
    ({ orgApiKey, clearIntegrationKeyCache } = await import("../lib/integration-keys"));

    // The platform must actually hold the key it is lending, and must not hold
    // the one the refusal case is about.
    process.env.ANTHROPIC_API_KEY = PLATFORM_KEY;
    delete process.env.SAM_API_KEY;

    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [ORG_NAME]
    );
    orgId.value = org!.id;
  });

  afterAll(async () => {
    if (realAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realAnthropic;
    if (realSam === undefined) delete process.env.SAM_API_KEY;
    else process.env.SAM_API_KEY = realSam;
    clearIntegrationKeyCache();

    if (!orgId.value) return;
    await query(`delete from platform_key_grants where org_id = $1`, [orgId.value]).catch(
      () => {}
    );
    await query(`delete from platform_key_usage where org_id = $1`, [orgId.value]).catch(
      () => {}
    );
    await query(`delete from admin_audit_log where admin_email = $1`, [ADMIN]).catch(() => {});
    await query(`delete from organizations where id = $1`, [orgId.value]).catch(() => {});
  });

  it("gives an account nothing until a grant exists", async () => {
    clearIntegrationKeyCache();
    expect(await orgApiKey("ANTHROPIC_API_KEY", orgId.value)).toBe("");
  });

  it("puts the account on our key once granted, and records who and why", async () => {
    const res = await admin.grantKeyToAccount({
      orgId: orgId.value,
      key: "ANTHROPIC_API_KEY",
      note: "walking them through a demo",
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      adminEmail: ADMIN,
      adminUserId: null,
    });
    expect(res.ok).toBe(true);

    clearIntegrationKeyCache();
    expect(await orgApiKey("ANTHROPIC_API_KEY", orgId.value)).toBe(PLATFORM_KEY);

    const audit = await query<{ action: string; detail: Record<string, unknown> | null }>(
      `select action, detail from admin_audit_log where admin_email = $1`,
      [ADMIN]
    );
    expect(audit.map((a) => a.action)).toContain("platform_key_granted");
    expect(audit[0].detail?.reason).toBe("walking them through a demo");
  });

  it("meters what the borrowed key is used for", async () => {
    // Counted only because the credential is ours. This is the number that
    // turns into an invoice, so a grant that spent silently would be the bug.
    const states = await admin.platformKeyStates(orgId.value);
    const anthropic = states.find((s) => s.key === "ANTHROPIC_API_KEY")!;
    expect(anthropic.calls).toBeGreaterThan(0);
    expect(anthropic.hasOwnKey).toBe(false);
    expect(anthropic.expired).toBe(false);
    expect(anthropic.note).toBe("walking them through a demo");
  });

  it("takes the key back on revoke", async () => {
    const res = await admin.revokeKeyFromAccount({
      orgId: orgId.value,
      key: "ANTHROPIC_API_KEY",
      adminEmail: ADMIN,
    });
    expect(res.ok).toBe(true);

    clearIntegrationKeyCache();
    expect(await orgApiKey("ANTHROPIC_API_KEY", orgId.value)).toBe("");

    // Revoking permission must not erase the record of what was spent.
    const states = await admin.platformKeyStates(orgId.value);
    expect(states.find((s) => s.key === "ANTHROPIC_API_KEY")!.calls).toBeGreaterThan(0);
  });

  it("treats an expired grant as inert rather than invisible", async () => {
    await query(
      `insert into platform_key_grants (org_id, env_key, note, expires_at)
       values ($1, 'ANTHROPIC_API_KEY', 'expired demo', now() - interval '1 day')
       on conflict (org_id, env_key) do update
         set note = excluded.note, expires_at = excluded.expires_at`,
      [orgId.value]
    );

    clearIntegrationKeyCache();
    expect(await orgApiKey("ANTHROPIC_API_KEY", orgId.value)).toBe("");

    const anthropic = (await admin.platformKeyStates(orgId.value)).find(
      (s) => s.key === "ANTHROPIC_API_KEY"
    )!;
    // Still listed, so somebody can see why the account stopped working.
    expect(anthropic.expired).toBe(true);
    expect(anthropic.note).toBe("expired demo");

    await query(`delete from platform_key_grants where org_id = $1`, [orgId.value]);
  });

  it("refuses a grant with no reason, a past expiry, or a key we do not hold", async () => {
    const noReason = await admin.grantKeyToAccount({
      orgId: orgId.value,
      key: "ANTHROPIC_API_KEY",
      note: "   ",
      expiresAt: null,
      adminEmail: ADMIN,
      adminUserId: null,
    });
    expect(noReason).toMatchObject({ ok: false });

    const pastExpiry = await admin.grantKeyToAccount({
      orgId: orgId.value,
      key: "ANTHROPIC_API_KEY",
      note: "demo",
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
      adminEmail: ADMIN,
      adminUserId: null,
    });
    expect(pastExpiry).toMatchObject({ ok: false });

    // Lending a key we do not hold would grant an empty string, which reads to
    // the customer as an integration that is on and broken.
    const notHeld = await admin.grantKeyToAccount({
      orgId: orgId.value,
      key: "SAM_API_KEY",
      note: "waiting on SAM",
      expiresAt: null,
      adminEmail: ADMIN,
      adminUserId: null,
    });
    expect(notHeld).toMatchObject({ ok: false });

    clearIntegrationKeyCache();
    expect(await orgApiKey("ANTHROPIC_API_KEY", orgId.value)).toBe("");
  });

  it("will not lend a credential that is an identity rather than a quota", async () => {
    // Sending from our Twilio number or Gmail mailbox misattributes the
    // message to us and cannot be taken back, so those are not offered.
    const offered = admin.LENDABLE_KEYS.map((k) => k.key);
    expect(offered).not.toContain("TWILIO_ACCOUNT_SID");
    expect(offered).not.toContain("TWILIO_FROM_NUMBER");
    expect(offered).not.toContain("GMAIL_CLIENT_SECRET");
    expect(offered).toContain("ANTHROPIC_API_KEY");

    const rejected = await admin.grantKeyToAccount({
      orgId: orgId.value,
      key: "TWILIO_FROM_NUMBER",
      note: "they want to text",
      expiresAt: null,
      adminEmail: ADMIN,
      adminUserId: null,
    });
    expect(rejected).toMatchObject({ ok: false });
  });

  it("warns about SAM rather than treating it like the others", () => {
    // The opportunity monitor asks for roughly 1,800 requests a day against a
    // key limited near 1,000, so lending it stops ingestion for everyone.
    const sam = admin.LENDABLE_KEYS.find((k) => k.key === "SAM_API_KEY")!;
    expect(sam.hazard).toBeTruthy();
    expect(sam.hazard).toContain("1,000");
    for (const other of admin.LENDABLE_KEYS.filter((k) => k.key !== "SAM_API_KEY")) {
      expect(other.hazard).toBeUndefined();
    }
  });
});
