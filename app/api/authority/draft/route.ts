import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { complete, ClaudeNotConfiguredError } from "@/lib/ai/claude";
import { logAgent } from "@/lib/logger";
import { config } from "@/lib/config";
import { outreachTemplate } from "@/lib/domain/backlink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Draft an outreach message for one qualified backlink prospect. The draft is
 * saved with approval_status = 'pending' — it is NEVER sent here. A human must
 * approve it first (the approval gate), which keeps the platform compliant with
 * CAN-SPAM and Google's link-scheme guidelines. Claude refines the copy when
 * configured; otherwise a safe white-hat template is used.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as { prospectId?: string };
  if (!body.prospectId) {
    return NextResponse.json({ error: "prospectId is required." }, { status: 400 });
  }

  const prospect = await queryOne<{
    id: string;
    domain: string;
    opportunity_type: string;
    tier: string | null;
    contact_json: unknown;
  }>(
    `select id, domain, opportunity_type, tier, contact_json from backlink_prospects where id = $1`,
    [body.prospectId]
  );
  if (!prospect) return NextResponse.json({ error: "Prospect not found." }, { status: 404 });
  if (prospect.tier === "reject") {
    return NextResponse.json({ error: "This prospect was rejected in qualification." }, { status: 400 });
  }

  // Don't stack duplicate pending drafts for the same prospect.
  const pending = await queryOne<{ id: string }>(
    `select id from backlink_outreach where prospect_id = $1 and approval_status = 'pending' limit 1`,
    [prospect.id]
  );
  if (pending) {
    return NextResponse.json({ ok: true, id: pending.id, existing: true });
  }

  const profile = await getProfileJson();
  const companyName = profile?.dba || profile?.legal_name || "our company";
  const trades = (profile?.primary_trades ?? []).slice(0, 3).join(", ");
  const valueProp = trades
    ? `We're a ${profile?.small_business ? "small-business " : ""}government contractor specializing in ${trades}.`
    : "We're a government contractor.";

  let draft = outreachTemplate({
    domain: prospect.domain,
    opportunityType: prospect.opportunity_type,
    senderName: profile?.owner_name || "The team",
    companyName,
    companyUrl: `https://${config.ahrefs.target}`,
    valueProp,
  });

  // Pull the dead URL for broken-link prospects so the draft can be specific.
  const contact = (prospect.contact_json ?? {}) as { dead_url?: string; source_page?: string };
  const deadUrlLine =
    prospect.opportunity_type === "broken_link" && contact.dead_url
      ? `The specific dead link is ${contact.dead_url}${contact.source_page ? ` on the page ${contact.source_page}` : ""}. Reference it concretely.`
      : "";

  // Optional Claude refinement — keep it honest, brief, no incentives.
  try {
    const { text, usage } = await complete(
      [
        "Refine this cold outreach email to be warm, concise, specific and genuinely helpful. Rules: no flattery you can't back up, never offer money/links-for-pay/incentives, no pushy language, keep it under 120 words, keep a clear subject line. Do not use em dashes.",
        "Return exactly two lines: first line `Subject: ...`, then a blank line, then the body.",
        "",
        `Prospect site: ${prospect.domain}`,
        `Opportunity type: ${prospect.opportunity_type}`,
        deadUrlLine,
        "",
        `Subject: ${draft.subject}`,
        "",
        draft.body,
      ].join("\n"),
      { maxTokens: 500 }
    );
    const m = text.match(/^\s*Subject:\s*(.+?)\n([\s\S]+)$/i);
    if (m) draft = { subject: m[1].trim(), body: m[2].trim() };
    await logAgent({
      agent: "backlink-scout",
      action: "draft-outreach",
      message: `Drafted outreach for ${prospect.domain}.`,
      claudeUsage: usage,
    });
  } catch (err) {
    if (!(err instanceof ClaudeNotConfiguredError)) throw err;
    // Template draft stands.
  }

  const row = await queryOne<{ id: string }>(
    `insert into backlink_outreach (prospect_id, channel, subject, body, approval_status)
     values ($1,'email',$2,$3,'pending') returning id`,
    [prospect.id, draft.subject, draft.body]
  );
  return NextResponse.json({ ok: true, id: row?.id, subject: draft.subject, body: draft.body });
}
