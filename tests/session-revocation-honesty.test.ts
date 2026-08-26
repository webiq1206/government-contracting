/**
 * Signing a device out has to be true or say it failed.
 *
 * Both revocation helpers swallowed their error and returned 0, and 0 is not
 * distinguishable from "the row was already gone". So a database that refused
 * the delete produced "That session had already ended" for one device, and
 * `{ ok: true, ended: 0 }` rendered as "0 devices signed out" in the success
 * tone for the rest, while every one of those sessions stayed live.
 *
 * The person on this page is usually the person who thinks somebody else is
 * in their account. Telling them a sign-out worked when it did not is the
 * worst lie this product can tell, and it was my own code doing it.
 *
 * Verified against the real route with a trigger that makes every delete on
 * `sessions` throw: 500 and a message naming what is still signed in, where
 * before it was 200 with a count of zero. With the trigger removed the same
 * call ended 428 stale sessions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const LIB = readFileSync("lib/account.ts", "utf8");
const ROUTE = readFileSync("app/api/account/sessions/route.ts", "utf8");

describe("what a failed revocation reports", () => {
  it("does not turn a database error into a count of zero", () => {
    const revokes = LIB.slice(LIB.indexOf("export async function revokeSession"));
    expect(revokes).not.toContain("catch(() => [] as { id: string }[])");
  });

  it("answers a failed sign-out with a failure, not a success", () => {
    expect(ROUTE).toContain("status: 500");
    // Both paths: one device, and every other device.
    expect(ROUTE.match(/status: 500/g)?.length).toBe(2);
  });

  it("keeps 'already ended' for the case where that is actually true", () => {
    /*
     * The 404 is right for a session that is genuinely gone and wrong for one
     * that is still live because the delete failed. They are different
     * sentences now because they are different facts.
     */
    expect(ROUTE).toContain("That session had already ended.");
    expect(ROUTE).toContain("status: 404");
  });

  it("tells somebody what to do next, since the device is still in", () => {
    // A failure notice that does not say the session is still live leaves the
    // reader to assume the safer thing, which is the wrong one.
    expect(ROUTE).toContain("still signed in");
    expect(ROUTE).toContain("change your password");
  });

  it("is surfaced by the page rather than swallowed a second time", () => {
    const form = readFileSync("components/account-forms.tsx", "utf8");
    expect(form).toContain('setMsg({ tone: "bad", text: data.error');
  });
});
