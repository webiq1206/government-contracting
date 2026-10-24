import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { parseContactSubmission, resolveContactInbox } from "@/lib/domain/public-contact";
import { systemMail } from "@/lib/integrations/system-mail";
import { clientIp, consume, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 20_000;

/**
 * Public contact form.
 *
 * No session. Middleware lets /api/contact through, and this handler emails
 * the platform inbox through system mail. Recipient order: CONTACT_INBOX_EMAIL,
 * then DIGEST_EMAIL_TO, then hello@brostco.com.
 */
export async function POST(req: Request) {
  const rate = consume("contact-form", clientIp(req), {
    limit: 8,
    windowMs: 15 * 60_000,
  });
  if (!rate.ok) {
    return tooManyRequests(
      "Too many messages. Try again later, or email hello@brostco.com.",
      rate,
    );
  }

  const raw = await readContactBody(req);
  if (raw === "too-large") {
    return NextResponse.json({ error: "That message is too long." }, { status: 413 });
  }
  if (raw === "unsupported") {
    return NextResponse.json(
      { error: "Send the message as JSON or a form." },
      { status: 415 },
    );
  }
  if (!raw) {
    return NextResponse.json(
      { error: "Send a name, email, and message." },
      { status: 400 },
    );
  }

  const parsed = parseContactSubmission(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (parsed.honeypot) return NextResponse.json({ ok: true });

  const to = resolveContactInbox({
    contactInbox: config.systemMail.contactInbox,
    digestTo: config.systemMail.digestTo,
  });
  const result = await systemMail.send({
    to,
    subject: parsed.tip.subject,
    text: parsed.tip.text,
  });
  if (result.disabled || result.error) {
    return NextResponse.json(
      {
        error:
          "We could not send that message. Email hello@brostco.com and we will reply.",
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}

async function readContactBody(
  req: Request,
): Promise<Record<string, unknown> | "too-large" | "unsupported" | null> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY) return "too-large";
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json") || type === "") {
    const text = await req.text();
    if (text.length > MAX_BODY) return "too-large";
    if (!text.trim()) return null;
    try {
      const json = JSON.parse(text) as unknown;
      return json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null;
    } catch {
      return type === "" ? "unsupported" : null;
    }
  }
  if (
    type.includes("application/x-www-form-urlencoded") ||
    type.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    if (!form) return null;
    return {
      name: form.get("name"),
      email: form.get("email"),
      message: form.get("message"),
      company_url: form.get("company_url"),
    };
  }
  return "unsupported";
}
