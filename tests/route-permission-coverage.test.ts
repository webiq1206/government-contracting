/**
 * Every route that changes something must say who is allowed to.
 *
 * The role model is only worth as much as its coverage. One handler that
 * forgets the capability is a hole in exactly the shape of the thing it
 * writes, and nothing about the file will look wrong: it will have a tenant
 * guard, a billing guard, and full write access for a read-only user.
 *
 * So this walks every route handler in the app rather than trusting a list.
 * A new POST added next year is caught the first time this runs, which is the
 * only kind of check that survives contact with a growing codebase.
 *
 * Exemptions are named individually, with a reason, below. A blanket pattern
 * would quietly absorb the next mistake.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API = join(process.cwd(), "app/api");
const MUTATING = /export async function (POST|PUT|PATCH|DELETE)\b/;

/**
 * Routes that change something and legitimately have no capability gate.
 *
 * Each of these is either unauthenticated by design (a webhook, a token-bearing
 * external surface, the auth handshake itself) or is the platform-admin
 * surface, which has its own separate guard.
 */
const EXEMPT: Record<string, string> = {
  "auth/bootstrap/route.ts": "First-run setup: there is no account to have a role in yet.",
  "auth/login/route.ts": "The sign-in handshake itself.",
  "auth/logout/route.ts": "Ends your own session; every role may.",
  "auth/signup/route.ts": "Creates the account and its first owner.",
  "auth/forgot-password/route.ts": "Unauthenticated by design.",
  "auth/reset-password/route.ts": "Unauthenticated by design; the token is the credential.",
  "billing/webhook/route.ts": "Stripe calls this, not a person. Signature-verified.",
  "invitations/accept/route.ts": "The invitation token is the credential; it grants the role.",
  "vendor/[token]/documents/route.ts": "External subcontractor portal; the link is the credential.",
  "vendor/[token]/w9/route.ts": "External subcontractor portal; the link is the credential.",
  "admin/accounts/[id]/route.ts": "Platform admin, guarded by requirePlatformAdmin.",
  "admin/impersonate/route.ts": "Platform admin, guarded by requirePlatformAdmin.",
  "admin/invitations/route.ts": "Platform admin, guarded by requirePlatformAdmin.",
  "admin/invitations/[id]/route.ts": "Platform admin, guarded by requirePlatformAdmin.",
  "admin/key-grants/route.ts": "Platform admin, guarded by requirePlatformAdmin.",
  "analytics/route.ts": "Records a product-analytics event for the signed-in user's own session.",
  /*
   * Every role may say the product is wrong, including the read-only ones. A
   * viewer looking at a number that does not add up is exactly the person who
   * should be able to report it, and a capability check here would only teach
   * them that reporting it is somebody else's job. Still tenant-scoped.
   */
  "feedback/route.ts": "Feedback about the product you are already using; every role may send it.",
  "guide/ask/route.ts": "Asks a question about the page you are already allowed to see.",
  "guide/narrate/route.ts": "Asks a question about the page you are already allowed to see.",
  "authority/draft/route.ts": "Site Authority is platform-owner tooling for our own domain.",
  "authority/outreach/[id]/route.ts": "Site Authority is platform-owner tooling for our own domain.",
  /*
   * Your own account, not the organization's. Every capability in the matrix
   * is a permission over shared records; a read-only teammate must still be
   * able to change their own name, rotate their own password and end their
   * own sessions. Each of these is scoped to auth.id inside the statement it
   * runs, which is the check that matters here.
   */
  "account/name/route.ts": "Changes your own display name; scoped to auth.id.",
  "account/password/route.ts":
    "Changes your own password, and requires the current one; scoped to auth.id.",
  "account/sessions/route.ts": "Ends your own sessions; the delete is scoped to auth.id.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("every mutating API route names a capability", () => {
  const routes = walk(API).map((f) => ({
    rel: relative(API, f),
    src: readFileSync(f, "utf8"),
  }));

  it("finds routes to check at all", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((r) => MUTATING.test(r.src)).length).toBeGreaterThan(30);
  });

  it("gates every mutating handler that is not explicitly exempt", () => {
    const ungated = routes
      .filter((r) => MUTATING.test(r.src))
      .filter((r) => !(r.rel in EXEMPT))
      .filter(
        (r) =>
          !/capability:\s*"/.test(r.src) &&
          !/requireCapability\(/.test(r.src) &&
          !/can\(\s*auth\.orgRole/.test(r.src)
      )
      .map((r) => r.rel);

    expect(ungated).toEqual([]);
  });

  it("keeps the exemption list honest", () => {
    // An exemption for a route that no longer exists is dead weight that makes
    // the list harder to read and easier to add to carelessly.
    const known = new Set(routes.map((r) => r.rel));
    const stale = Object.keys(EXEMPT).filter((k) => !known.has(k));
    expect(stale).toEqual([]);
  });
});
