/**
 * What a support session is NOT allowed to do.
 *
 * "Sign in as a customer" is the highest-privilege state in the product, and
 * every guard around it is invisible: nothing on screen changes if one of them
 * stops working, so the only thing keeping them honest is these tests. Each
 * one pins a specific way the feature could quietly become dangerous.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── The account being impersonated, and the admin doing it ────────────────

const ADMIN_EMAIL = "admin@example.com";

let sessionUser: Record<string, unknown> | null = null;

vi.mock("../lib/auth", () => ({
  currentUser: vi.fn(async () => sessionUser),
}));

vi.mock("../lib/integrations/gmail", () => ({
  gmail: { isConnected: vi.fn(async () => true), send: vi.fn(async () => ({ id: "x" })) },
}));

vi.mock("../lib/app-settings", () => ({
  isAutomationPaused: vi.fn(async () => false),
  AUTOMATION_PAUSED_ERROR: "Automation is fully paused.",
}));

import { isPlatformAdmin, requirePlatformAdmin } from "../lib/platform-admin";
import { impersonationRefusal, currentImpersonator } from "../lib/impersonation";
import { sendOutreachEmail } from "../lib/integrations/email-transport";

function ordinarySession(email: string) {
  return {
    id: "user-1",
    email,
    name: null,
    role: "operator",
    organizationId: "org-1",
    subscriptionStatus: "active",
    planKey: "standard",
    trialEndsAt: null,
    billingExempt: false,
    suspendedAt: null,
    impersonatedBy: null,
  };
}

const ORIGINAL_ALLOWLIST = process.env.PLATFORM_ADMIN_EMAILS;
const ORIGINAL_OPERATOR = process.env.OPERATOR_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  sessionUser = null;
  process.env.PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  delete process.env.OPERATOR_EMAIL;
});

afterEach(() => {
  if (ORIGINAL_ALLOWLIST === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL_ALLOWLIST;
  if (ORIGINAL_OPERATOR === undefined) delete process.env.OPERATOR_EMAIL;
  else process.env.OPERATOR_EMAIL = ORIGINAL_OPERATOR;
});

describe("who counts as a platform administrator", () => {
  it("reads the allowlist from the environment, case and space insensitively", () => {
    process.env.PLATFORM_ADMIN_EMAILS = " Owner@Example.com , second@example.com ";
    expect(isPlatformAdmin("owner@example.com")).toBe(true);
    expect(isPlatformAdmin("OWNER@EXAMPLE.COM")).toBe(true);
    expect(isPlatformAdmin("second@example.com")).toBe(true);
    expect(isPlatformAdmin("stranger@example.com")).toBe(false);
  });

  /**
   * The whole point of keeping this in the environment: nothing that happens
   * inside the product — a signup, an invite, a compromised org owner, a
   * users.role someone set by hand — can grant it.
   */
  it("is not granted by a database role", async () => {
    sessionUser = { ...ordinarySession("someone@example.com"), role: "admin" };
    const res = await requirePlatformAdmin();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("answers 404 rather than 403, so the admin area is not advertised", async () => {
    sessionUser = ordinarySession("customer@example.com");
    const res = await requirePlatformAdmin();
    expect((res as Response).status).toBe(404);
  });

  it("lets a real administrator through", async () => {
    sessionUser = ordinarySession(ADMIN_EMAIL);
    const res = await requirePlatformAdmin();
    expect(res).not.toBeInstanceOf(Response);
  });
});

describe("a support session cannot reach the admin area", () => {
  /**
   * The admin's email is on the allowlist, and the session is theirs. It is
   * still refused, because the session is acting as somebody else. This is
   * also what makes nested impersonation impossible: starting one requires
   * this guard to pass.
   */
  it("is refused even though the impersonating admin is on the allowlist", async () => {
    sessionUser = { ...ordinarySession(ADMIN_EMAIL), impersonatedBy: ADMIN_EMAIL };
    const res = await requirePlatformAdmin();
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(404);
  });

  it("refuses money-moving routes with a 403 and an explanation", () => {
    const refusal = impersonationRefusal({ impersonatedBy: ADMIN_EMAIL });
    expect(refusal).not.toBeNull();
    expect(refusal!.status).toBe(403);
  });

  it("does not get in the way of an ordinary session", () => {
    expect(impersonationRefusal({ impersonatedBy: null })).toBeNull();
  });
});

/**
 * The guarantees above are only worth what the least-guarded sink is worth.
 *
 * Both holes found in review were of exactly this shape: a second outbound
 * mail path that did not go through the transport, and a second Stripe route
 * that did not ask about impersonation. Neither was visible from the guarded
 * code. These sweep the source so a third one cannot be added quietly.
 */
describe("every sink is covered, not just the obvious one", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

  it("routes every outbound mail sink through an impersonation check", () => {
    const senders = execSync(
      "grep -rl 'gmail\\.send(' --include=*.ts lib app 2>/dev/null || true",
      { cwd: resolve(__dirname, ".."), encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      // The Gmail client itself is the primitive being guarded, and
      // system-mail addresses the account holder rather than the outside
      // world.
      .filter((f) => !f.endsWith("lib/integrations/gmail.ts"))
      .filter((f) => !f.endsWith("lib/integrations/system-mail.ts"));

    expect(senders.length).toBeGreaterThan(0);
    const unguarded = senders.filter((f) => !/currentImpersonator/.test(read(f)));
    expect(unguarded, `outbound mail with no support-session check: ${unguarded}`).toEqual([]);
  });

  it("refuses a support session at every route that moves money", () => {
    const routes = execSync(
      "grep -rl 'stripe\\.\\(subscriptions\\|checkout\\|billingPortal\\)' --include=route.ts app 2>/dev/null || true",
      { cwd: resolve(__dirname, ".."), encoding: "utf8" }
    )
      .split("\n")
      .filter(Boolean)
      // The webhook is Stripe calling us, with no user session involved.
      .filter((f) => !f.includes("webhook"));

    expect(routes.length).toBeGreaterThan(0);
    const unguarded = routes.filter(
      (f) => !/impersonationRefusal|support_session/.test(read(f))
    );
    expect(unguarded, `money-moving routes with no support-session check: ${unguarded}`).toEqual(
      []
    );
  });
});

describe("no subcontractor hears from a support session", () => {
  const PARAMS = {
    to: "sub@example.com",
    subject: "Project outreach",
    html: "<p>Are you available for this bid?</p>",
    text: "Are you available for this bid?",
    trackingId: "0b7f9a2c-9f1e-4c1d-8b3a-1234567890ab",
  };

  /**
   * The failure this prevents is not malice. It is an admin reproducing a
   * customer's bug who clicks Send, and a real subcontractor receiving a real
   * solicitation from a company that did not send it. There is no undo.
   */
  it("blocks outreach while an admin is signed in as the customer", async () => {
    sessionUser = { ...ordinarySession("customer@example.com"), impersonatedBy: ADMIN_EMAIL };
    const result = await sendOutreachEmail(PARAMS);
    expect(result.blocked).toBe(true);
    expect(result.provider).toBeNull();
    expect(result.error).toMatch(/support session/i);
  });

  it("does not block the customer's own sending", async () => {
    sessionUser = ordinarySession("customer@example.com");
    const result = await sendOutreachEmail(PARAMS);
    expect(result.blocked).not.toBe(true);
  });

  /**
   * The background worker has no session at all. That has to read as "nobody
   * is impersonating" rather than as an error, or scheduled outreach would
   * stop the moment this check was added.
   */
  it("reads as nobody impersonating when there is no session to read", async () => {
    sessionUser = null;
    expect(await currentImpersonator()).toBeNull();
    const result = await sendOutreachEmail(PARAMS);
    expect(result.blocked).not.toBe(true);
  });
});
