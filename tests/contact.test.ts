import { describe, it, expect } from "vitest";
import { extractContacts, rootDomain } from "@/lib/domain/contact";

describe("rootDomain", () => {
  it("strips protocol, www, path and port", () => {
    expect(rootDomain("https://www.example.com/contact")).toBe("example.com");
    expect(rootDomain("blog.example.co.uk")).toBe("co.uk"); // naive last-two; acceptable
    expect(rootDomain("EXAMPLE.COM:443")).toBe("example.com");
  });
});

describe("extractContacts", () => {
  it("pulls a mailto: address", () => {
    const html = `<a href="mailto:info@roofingtoday.com">Email us</a>`;
    const r = extractContacts(html, "roofingtoday.com");
    expect(r.best).toBe("info@roofingtoday.com");
  });

  it("prefers an on-domain role inbox over an off-domain one", () => {
    const html = `
      <a href="mailto:jane@gmail.com">Jane</a>
      <a href="mailto:contact@roofingtoday.com">Contact</a>`;
    const r = extractContacts(html, "roofingtoday.com");
    expect(r.best).toBe("contact@roofingtoday.com");
  });

  it("prefers info@ over sales@ on the same domain", () => {
    const html = `sales@roofingtoday.com and info@roofingtoday.com`;
    const r = extractContacts(html, "roofingtoday.com");
    expect(r.best).toBe("info@roofingtoday.com");
  });

  it("ignores no-reply, placeholder and asset-like addresses", () => {
    const html = `
      no-reply@roofingtoday.com
      someone@example.com
      logo@2x.png
      real@roofingtoday.com`;
    const r = extractContacts(html, "roofingtoday.com");
    expect(r.emails).toContain("real@roofingtoday.com");
    expect(r.emails).not.toContain("no-reply@roofingtoday.com");
    expect(r.emails).not.toContain("someone@example.com");
    expect(r.emails.some((e) => e.includes(".png"))).toBe(false);
  });

  it("returns null when there is nothing usable", () => {
    const r = extractContacts(`<p>No contact here</p>`, "roofingtoday.com");
    expect(r.best).toBeNull();
    expect(r.emails).toHaveLength(0);
  });

  it("dedupes repeated addresses", () => {
    const html = `info@x.com info@x.com <a href="mailto:info@x.com">x</a>`;
    const r = extractContacts(html, "x.com");
    expect(r.emails.filter((e) => e === "info@x.com")).toHaveLength(1);
  });
});
