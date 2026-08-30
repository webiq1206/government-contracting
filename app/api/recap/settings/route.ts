import { NextResponse } from "next/server";
import { requireCapability, requireUser } from "@/lib/api-auth";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { logAgent } from "@/lib/logger";
import { normalizeRecapSettings, type RecapSettings } from "@/lib/domain/recap/types";
import { getRecapSettings, setRecapSettings } from "@/lib/recap/settings";
import { orgMembersForRecap, recapRecipients } from "@/lib/recap/recipients";
import { deliveryHistory } from "@/lib/recap/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The recap's account-wide settings.
 *
 * Reading is open to any member: the page shows what the account has decided
 * and who is receiving it, which is the sort of thing a person should be able
 * to check before asking why they are not getting the mail. Writing is behind
 * `manage_rules`, the same gate as the automation rules, because these
 * settings change what other people receive rather than only the caller's own
 * preferences.
 */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  const settings = await getRecapSettings(orgId);
  const [members, recipients, history] = await Promise.all([
    orgMembersForRecap(orgId).catch(() => []),
    recapRecipients(orgId, settings).catch(() => []),
    deliveryHistory({ orgId, scope: "org", limit: 30, includeTests: true }).catch(() => []),
  ]);

  const receiving = new Set(recipients.map((r) => r.userId));

  return NextResponse.json({
    settings,
    members: members.map((m) => ({
      userId: m.userId,
      email: m.email,
      name: m.name,
      role: m.orgRole,
      timezone: m.timezone,
      timezoneIsDefault: m.timezoneIsDefault,
      optedOut: m.optedOut,
      receiving: receiving.has(m.userId),
    })),
    // The rendered copy is deliberately left out of the list: it is large, and
    // the one place it is wanted is a single delivery opened on purpose.
    history: history.map((h) => ({
      id: h.id,
      localDate: h.localDate,
      recipientEmail: h.recipientEmail,
      timezone: h.timezone,
      status: h.status,
      late: h.late,
      quiet: h.quiet,
      test: h.test,
      sentAt: h.sentAt,
      attempts: h.attempts,
      urgentCount: h.urgentCount,
      subject: h.subject,
      error: h.error,
      createdAt: h.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await requireCapability("manage_rules");
  if (auth instanceof NextResponse) return auth;

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Partial<RecapSettings>;
  const before = await getRecapSettings(orgId);
  const saved = await setRecapSettings(orgId, normalizeRecapSettings(body), auth.email);
  const recipients = await recapRecipients(orgId, saved).catch(() => []);

  /*
   * Logged as a change with both halves, because "who stopped receiving this"
   * is the question asked three weeks later and the answer is otherwise
   * unrecoverable: the settings row holds only the current state.
   */
  const changes: string[] = [];
  if (before.enabled !== saved.enabled) changes.push(saved.enabled ? "turned on" : "turned off");
  if (before.send_at !== saved.send_at) changes.push(`send time ${before.send_at} to ${saved.send_at}`);
  if (before.sections.join(",") !== saved.sections.join(","))
    changes.push(`sections now ${saved.sections.length} of 8`);
  if (before.recipient_roles.join(",") !== saved.recipient_roles.join(","))
    changes.push(`roles now ${saved.recipient_roles.join(" and ") || "none"}`);
  if (before.skip_when_empty !== saved.skip_when_empty)
    changes.push(saved.skip_when_empty ? "quiet days skipped" : "quiet days still sent");

  await logAgent({
    agent: "operator",
    action: "recap-settings-updated",
    level: "info",
    message: `Daily recap settings changed by ${auth.email}${
      changes.length > 0 ? `: ${changes.join(", ")}` : ""
    }. ${recipients.length} recipient(s) now eligible.`.slice(0, 500),
  });

  return NextResponse.json({
    settings: saved,
    recipients: recipients.map((r) => ({
      userId: r.userId,
      email: r.email,
      name: r.name,
      role: r.orgRole,
      timezone: r.timezone,
      timezoneIsDefault: r.timezoneIsDefault,
    })),
  });
}
