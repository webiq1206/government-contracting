import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { logAgent } from "@/lib/logger";
import { enqueue } from "@/lib/queue";
import { verifySvixSignature } from "@/lib/webhook-verify";
import { email as resend } from "@/lib/integrations/resend";
import {
  captureReply,
  matchInboundReply,
  parseCorrelationToken,
} from "@/lib/reply-capture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend inbound-email webhook (svix-signed). Captures replies to outreach
 * sent via Resend: correlates by the plus-addressed reply-to token
 * (info+t<trackingId>@domain), falls back to sender email (weak match — never
 * auto-saves a quote), and runs the same capture pipeline as the Gmail
 * reply poller.
 */

function textFromHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  const secret = config.resend.webhookSecret;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  const payload = await req.text();
  const ok = verifySvixSignature({
    secret,
    id: req.headers.get("svix-id") ?? "",
    timestamp: req.headers.get("svix-timestamp") ?? "",
    payload,
    signatureHeader: req.headers.get("svix-signature") ?? "",
  });
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: any;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  if (body?.type !== "email.received" && body?.type !== "inbound.email.received") {
    return NextResponse.json({ ok: true, ignored: body?.type ?? "unknown" });
  }

  const data = body.data ?? {};
  const emailId: string | null = data.email_id ?? data.id ?? null;
  let from: string = data.from?.email ?? data.from ?? "";
  let toList: string[] = Array.isArray(data.to)
    ? data.to.map((t: any) => (typeof t === "string" ? t : t?.email ?? ""))
    : [String(data.to ?? "")];
  let replyText: string =
    (typeof data.text === "string" && data.text.trim()) ||
    (typeof data.html === "string" ? textFromHtml(data.html) : "");

  // The email.received webhook carries metadata only; fetch the message body
  // (and any missing metadata) from Resend's receiving API.
  if (!replyText && emailId) {
    const fetched = await resend.getReceived(emailId);
    if (fetched.error) {
      // Fail loudly: a reply arrived but we couldn't read it.
      await logAgent({
        agent: "reply-poll",
        action: "resend-inbound-error",
        level: "error",
        status: "error",
        message: `Resend inbound webhook received email ${emailId} but its content could not be fetched: ${fetched.error}. The reply was NOT captured, check it in the info@ inbox.`,
      });
      return NextResponse.json({ error: "content fetch failed" }, { status: 502 });
    }
    replyText =
      (fetched.text && fetched.text.trim()) ||
      (fetched.html ? textFromHtml(fetched.html) : "");
    if (!from && fetched.from) from = fetched.from;
    if ((!toList.length || !toList[0]) && fetched.to) toList = fetched.to;
  }

  const fromEmail = ((String(from).match(/<([^>]+)>/)?.[1] ?? String(from)) || "")
    .toLowerCase()
    .trim();
  if (!fromEmail || !replyText) return NextResponse.json({ ok: true, ignored: "empty" });

  // Attempt tracking-token correlation (plus-address in To field from legacy
  // outreach sends). Falls back to sender-email weak match for replies to the
  // plain info@brostco.com Reply-To used by current outreach sends.
  const trackingToken = parseCorrelationToken(toList);
  const { comm, strongMatch } = await matchInboundReply({ trackingToken, fromEmail });
  if (!comm) return NextResponse.json({ ok: true, matched: false });

  const result = await captureReply({
    comm,
    strongMatch,
    fromEmail,
    replyText,
    messageId: emailId,
  });

  // Declines are closed out inside captureReply (thank-you + soft close). Do not
  // enqueue call-prep. For warm replies, enqueue call-prep. On a duplicate
  // delivery (webhook retry) we still attempt the enqueue when not declined:
  // the retry may exist precisely because a previous attempt captured the reply
  // but failed to enqueue. An enqueue failure is returned as retriable (500) —
  // capture itself is committed and idempotent, so the provider's retry
  // re-attempts only the enqueue.
  if (result.subId && !result.declined) {
    try {
      await enqueue("call-prep", {
        opportunityId: comm.opportunity_id,
        subcontractorId: result.subId,
        ...(result.extracted.quoteAmount != null
          ? { emailMentionedPrice: result.extracted.quoteAmount }
          : {}),
      });
    } catch (err) {
      await logAgent({
        agent: "reply-poll",
        action: "resend-inbound-error",
        opportunityId: comm.opportunity_id,
        subcontractorId: result.subId,
        level: "error",
        status: "error",
        message: `Reply captured but the call-prep job could not be enqueued: ${err instanceof Error ? err.message : String(err)}. The webhook returns 500 so Resend retries.`,
      }).catch(() => undefined);
      return NextResponse.json({ error: "enqueue failed" }, { status: 500 });
    }
  }

  if (result.duplicate) {
    return NextResponse.json({ ok: true, matched: true, duplicate: true });
  }

  if (result.declined) {
    // closeOutDeclinedSub already wrote the reply-declined agent log.
    return NextResponse.json({
      ok: true,
      matched: true,
      declined: true,
      thankYouSent: result.thankYouSent,
    });
  }

  const priceNote = result.quoteSaved
    ? ` Their quote of $${result.extracted.quoteAmount!.toLocaleString()} was saved to the record; confirm it on the call.`
    : result.quoteSkippedExisting
      ? ` Their email quotes $${result.extracted.quoteAmount!.toLocaleString()}, but a quote already exists, review manually.`
      : result.extracted.quoteAmount != null
        ? ` Their email mentions $${result.extracted.quoteAmount.toLocaleString()}, confirm it on the call.`
        : "";
  await logAgent({
    agent: "reply-poll",
    action: "reply-received",
    opportunityId: comm.opportunity_id,
    subcontractorId: result.subId ?? undefined,
    level: "success",
    message: `${result.companyName ?? fromEmail} replied (via Resend inbound) about "${comm.opportunity_title ?? "an opportunity"}". Marked responsive; reply saved and a call card is being prepared.${priceNote}`,
    reasoning: `Reply excerpt: ${replyText.slice(0, 300)}`,
  });

  return NextResponse.json({
    ok: true,
    matched: true,
    quoteSaved: result.quoteSaved,
  });
}
