import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactForm } from "@/components/marketing/contact-form";
import { NextRequest } from "next/server";
import { __resetRateLimits } from "@/lib/rate-limit";
import {
  CONTACT_INBOX_FALLBACK,
  CONTACT_TIP_MARKER,
  buildContactTip,
  parseContactSubmission,
  resolveContactInbox,
} from "@/lib/domain/public-contact";

const mocks = vi.hoisted(() => ({
  send: vi.fn(async () => ({ messageId: "mail-1" })),
}));

vi.mock("@/lib/integrations/system-mail", () => ({
  systemMail: { send: mocks.send },
}));

import { POST } from "@/app/api/contact/route";
import { middleware } from "../middleware";

const tip = {
  name: "Kai North",
  email: "kai.north@example.com",
  message: "Named tip for the contact inbox check.",
};

function post(body: unknown, init: RequestInit = {}) {
  return new Request("https://brostco.com/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("contact inbox address", () => {
  it("prefers CONTACT_INBOX_EMAIL, then DIGEST_EMAIL_TO, then hello@brostco.com", () => {
    expect(
      resolveContactInbox({
        contactInbox: "tips@brostco.com",
        digestTo: "ops@brostco.com",
      }),
    ).toBe("tips@brostco.com");
    expect(resolveContactInbox({ contactInbox: "  ", digestTo: "ops@brostco.com" })).toBe(
      "ops@brostco.com",
    );
    expect(resolveContactInbox({ contactInbox: "not-an-email", digestTo: "" })).toBe(
      CONTACT_INBOX_FALLBACK,
    );
    expect(resolveContactInbox({})).toBe("hello@brostco.com");
  });
});

describe("contact tip mail", () => {
  it("puts a findable tip marker in the subject and the name, email, and message in the body", () => {
    const mail = buildContactTip(tip);
    expect(mail.subject).toBe(`${CONTACT_TIP_MARKER}: Kai North`);
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text).toContain(CONTACT_TIP_MARKER);
    expect(mail.text).toContain("Name: Kai North");
    expect(mail.text).toContain("Email: kai.north@example.com");
    expect(mail.text).toContain(tip.message);
    expect(buildContactTip({ ...tip, message: "Fast \u2014 reliable" }).text).toContain("Fast, reliable");
  });

  it("keeps a forged line break out of the subject", () => {
    const mail = buildContactTip({
      ...tip,
      name: "Kai\r\nBcc: leaked@example.com",
    });
    expect(mail.subject).toBe("Contact tip: Kai Bcc: leaked@example.com");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe("POST /api/contact", () => {
  const previous = {
    contact: process.env.CONTACT_INBOX_EMAIL,
    digest: process.env.DIGEST_EMAIL_TO,
  };

  beforeEach(() => {
    __resetRateLimits();
    mocks.send.mockClear();
    mocks.send.mockResolvedValue({ messageId: "mail-1" });
    delete process.env.CONTACT_INBOX_EMAIL;
    delete process.env.DIGEST_EMAIL_TO;
  });

  afterEach(() => {
    restore("CONTACT_INBOX_EMAIL", previous.contact);
    restore("DIGEST_EMAIL_TO", previous.digest);
  });

  it("accepts an anonymous post and emails the named tip", async () => {
    process.env.DIGEST_EMAIL_TO = "ops@brostco.com";
    const response = await POST(post(tip));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ops@brostco.com",
        subject: "Contact tip: Kai North",
        text: expect.stringContaining("Email: kai.north@example.com"),
      }),
    );
  });

  it("uses CONTACT_INBOX_EMAIL ahead of the digest address", async () => {
    process.env.CONTACT_INBOX_EMAIL = "inbox@brostco.com";
    process.env.DIGEST_EMAIL_TO = "ops@brostco.com";
    expect((await POST(post(tip))).status).toBe(200);
    expect(mocks.send.mock.calls[0][0].to).toBe("inbox@brostco.com");
  });

  it("falls back to hello@brostco.com when neither inbox env is set", async () => {
    expect((await POST(post(tip))).status).toBe(200);
    expect(mocks.send.mock.calls[0][0].to).toBe("hello@brostco.com");
  });

  it("rejects a missing message without sending", async () => {
    const response = await POST(post({ ...tip, message: " " }));
    expect(response.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not mail a filled honeypot", async () => {
    const response = await POST(post({ ...tip, company_url: "https://spam.test" }));
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("says so when platform mail cannot deliver", async () => {
    mocks.send.mockResolvedValue({ disabled: true, error: "Platform inbox is not connected." });
    const response = await POST(post(tip));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "We could not send that message. Email hello@brostco.com and we will reply.",
    });
  });

  it("accepts a normal form post", async () => {
    const body = new URLSearchParams({
      name: tip.name,
      email: tip.email,
      message: tip.message,
    });
    const response = await POST(
      new Request("https://brostco.com/api/contact", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

describe("contact routes are public", () => {
  it("lets the page and the API through without a session", () => {
    for (const path of ["/contact", "/api/contact"]) {
      const response = middleware(new NextRequest(`https://example.test${path}`, { method: "POST" }));
      expect(response.headers.get("x-middleware-next"), path).toBe("1");
      expect(response.status, path).not.toBe(401);
    }
  });
});

describe("contact form", () => {
  it("shows name, email, and message, and posts to the public API", () => {
    const html = renderToStaticMarkup(createElement(ContactForm));
    expect(html).toContain('name="name"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
    expect(html).toContain('action="/api/contact"');
    expect(html).toContain('href="/privacy"');
  });
});

describe("contact field checks", () => {
  it("asks for a real email", () => {
    expect(parseContactSubmission({ ...tip, email: "not-an-email" })).toEqual({
      ok: false,
      error: "Enter a valid email address.",
    });
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
