import { describe, it, expect } from "vitest";
import {
  decodePortalToken,
  encodePortalToken,
  subPortalUrl,
  PORTAL_TTL_SECONDS,
} from "@/lib/domain/sub-portal-link";
import { encodeDocToken, decodeDocToken } from "@/lib/domain/doc-link";

const SUB = "8f2f1a34-0000-4000-8000-00000000abcd";
const nowSec = () => Math.floor(Date.now() / 1000);

describe("the link a subcontractor signs through", () => {
  it("round-trips the subcontractor it was minted for", () => {
    const token = encodePortalToken({ s: SUB, e: nowSec() + 60 });
    expect(decodePortalToken(token)?.s).toBe(SUB);
  });

  it("refuses an expired link", () => {
    expect(decodePortalToken(encodePortalToken({ s: SUB, e: nowSec() - 1 }))).toBeNull();
  });

  it("refuses a link whose payload was edited to name someone else", () => {
    const token = encodePortalToken({ s: SUB, e: nowSec() + 60 });
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ s: "someone-else", e: nowSec() + 60 }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodePortalToken(`${forged}.${sig}`)).toBeNull();
  });

  it("refuses junk without throwing", () => {
    for (const bad of ["", ".", "abc", "abc.def", "..."]) {
      expect(decodePortalToken(bad)).toBeNull();
    }
  });

  /**
   * The important one. A document link is handed out freely in outreach email;
   * a portal link can sign a tax form. Different signing keys mean one can
   * never be reshaped into the other, even though the token format matches.
   */
  it("cannot be swapped with a document link in either direction", () => {
    const portal = encodePortalToken({ s: SUB, e: nowSec() + 60 });
    const doc = encodeDocToken({ k: "s", v: "some/key.pdf", n: "plans.pdf", e: nowSec() + 60 });
    expect(decodeDocToken(portal)).toBeNull();
    expect(decodePortalToken(doc)).toBeNull();
  });

  it("builds an absolute URL on our own domain, since it goes in an email", () => {
    const original = process.env.APP_URL;
    process.env.APP_URL = "https://app.brostco.com/";
    const url = subPortalUrl(SUB);
    process.env.APP_URL = original;
    expect(url.startsWith("https://app.brostco.com/vendor/")).toBe(true);
  });

  it("expires in a fortnight, not indefinitely", () => {
    const token = subPortalUrl(SUB).split("/vendor/")[1];
    const decoded = decodePortalToken(token);
    expect(decoded).not.toBeNull();
    const lifetime = (decoded as { e: number }).e - nowSec();
    expect(lifetime).toBeGreaterThan(PORTAL_TTL_SECONDS - 60);
    expect(lifetime).toBeLessThanOrEqual(PORTAL_TTL_SECONDS);
  });
});
