/**
 * The platform's reports and notices, composed from the email-shell parts.
 *
 * Each builder returns the subject, the branded HTML and a plain-text part
 * that says the same thing in the same order. They are pure, so the preview
 * script and the tests render exactly what a recipient receives.
 */
import {
  emailCallout,
  emailEmpty,
  emailFacts,
  emailHeading,
  emailLinkedText,
  emailList,
  emailRow,
  emailStats,
  emailText,
  escapeHtml,
} from "./email-shell";
import { renderSystemEmail, SYSTEM_BRAND_NAME } from "./system-email";
import { stageLabel } from "./journey";

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const num = (v: number) => v.toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Weekly KPIs
// ---------------------------------------------------------------------------

export interface KpiDigestInput {
  win_rate: { overall: number; won: number; lost: number };
  avg_margin_on_wins_pct: number;
  pipeline_value: number;
  /** Open bid opportunities, and how many of them carry a value estimate. */
  pipeline_count?: number;
  pipeline_valued?: number;
  active_contract_revenue: number;
  cash_flow_projection: { basis: string; buckets: { days: number; amount: number }[] };
  pipeline_velocity?: { by_stage: { stage: string; count: number }[] };
  sub_reliability_rankings?: { company_name: string; reliability_score: number | null; is_preferred: boolean }[];
}

const STAGE_ORDER = [
  "monitoring", "scoring", "analysis", "sub_research", "outreach", "call_queue",
  "quote_entry", "bid_building", "submitted", "won", "lost", "dismissed",
];

export function kpiDigestEmail(appUrl: string, k: KpiDigestInput): BuiltEmail {
  const decided = k.win_rate.won + k.win_rate.lost;
  const winRate = decided > 0 ? `${k.win_rate.overall}%` : "No decisions yet";
  const winNote = `${k.win_rate.won} won, ${k.win_rate.lost} lost`;
  const margin = k.win_rate.won > 0 ? `${k.avg_margin_on_wins_pct}%` : "No wins yet";
  const coverage =
    k.pipeline_count != null && k.pipeline_valued != null
      ? `${num(k.pipeline_valued)} of ${plural(k.pipeline_count, "open opportunity", "open opportunities")} publish an estimate`
      : undefined;
  const stages = (k.pipeline_velocity?.by_stage ?? [])
    .filter((s) => s.count > 0 && !["won", "lost", "dismissed"].includes(s.stage))
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const subs = (k.sub_reliability_rankings ?? []).slice(0, 5);

  const subject = `${SYSTEM_BRAND_NAME} weekly KPIs: ${decided > 0 ? `${k.win_rate.overall}% win rate` : "no bid decisions yet"}, ${usd(k.pipeline_value)} pipeline`;
  const cash = k.cash_flow_projection.buckets.map((b) => ({ label: `Next ${b.days} days`, value: usd(b.amount) }));

  const blocks = [
    emailStats([
      { label: "Win rate", value: winRate, note: decided > 0 ? winNote : undefined },
      { label: "Average margin on wins", value: margin },
      { label: "Pipeline value", value: usd(k.pipeline_value), note: coverage },
      { label: "Active contract revenue", value: usd(k.active_contract_revenue) },
    ]),
    emailHeading("Cash flow", `Projected from ${k.cash_flow_projection.basis || "active contract milestones"}.`),
    k.active_contract_revenue > 0 ? emailFacts(cash) : emailEmpty("No active contracts yet, so there is no cash flow to project."),
    emailHeading("Pipeline by stage", "Open bid opportunities, where each one is now."),
    stages.length
      ? emailFacts(stages.map((s) => ({ label: stageLabel(s.stage), value: num(s.count) })))
      : emailEmpty("No open opportunities in the pipeline."),
    ...(subs.length
      ? [
          emailHeading("Most reliable subcontractors"),
          emailFacts(
            subs.map((s) => ({
              label: `${s.company_name}${s.is_preferred ? " (preferred)" : ""}`,
              value: s.reliability_score == null ? "Not scored" : `${Math.round(s.reliability_score)}/100`,
            }))
          ),
        ]
      : []),
  ];

  const html = renderSystemEmail(appUrl, {
    title: "Weekly KPIs",
    eyebrow: "Weekly report",
    preheader: `${decided > 0 ? `${winRate} win rate (${winNote})` : "No bid decisions yet"}. ${usd(k.pipeline_value)} in the pipeline.`,
    blocks,
    action: { label: "Open analytics", href: "/analytics" },
  });

  const text = [
    "Weekly KPIs",
    "",
    `Win rate: ${winRate}${decided > 0 ? ` (${winNote})` : ""}`,
    `Average margin on wins: ${margin}`,
    `Pipeline value: ${usd(k.pipeline_value)}${coverage ? ` (${coverage})` : ""}`,
    `Active contract revenue: ${usd(k.active_contract_revenue)}`,
    "",
    "Cash flow",
    ...(k.active_contract_revenue > 0 ? cash.map((c) => `- ${c.label}: ${c.value}`) : ["- No active contracts yet."]),
    "",
    "Pipeline by stage",
    ...(stages.length ? stages.map((s) => `- ${stageLabel(s.stage)}: ${num(s.count)}`) : ["- No open opportunities."]),
    ...(subs.length
      ? ["", "Most reliable subcontractors", ...subs.map((s) => `- ${s.company_name}: ${s.reliability_score == null ? "not scored" : `${Math.round(s.reliability_score)}/100`}`)]
      : []),
    "",
    `Open analytics: ${appUrl.replace(/\/+$/, "")}/analytics`,
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Learning loop
// ---------------------------------------------------------------------------

export interface LearningLoopInput {
  wins: number;
  losses: number;
  /** Version number of a proposed scoring-weight change, when one was made. */
  proposedVersion: number | null;
  subUpdated: number;
  subPromoted: number;
  insights: { label: string; text: string }[];
  summary?: string | null;
}

export function learningLoopEmail(appUrl: string, r: LearningLoopInput): BuiltEmail {
  const analysed = r.wins + r.losses;
  const subject =
    analysed > 0
      ? `${SYSTEM_BRAND_NAME} learning loop: ${r.wins} won, ${r.losses} lost this week`
      : `${SYSTEM_BRAND_NAME} learning loop: no new outcomes this week`;
  const weights = r.proposedVersion != null
    ? `Proposed scoring weights version ${r.proposedVersion}. Review it before it takes effect.`
    : "No scoring-weight change was proposed this week.";
  const insights = r.insights.filter((i) => i.text.trim());

  const blocks = [
    emailStats([
      { label: "Outcomes analyzed", value: num(analysed) },
      { label: "Won / lost", value: `${num(r.wins)} / ${num(r.losses)}` },
      { label: "Subcontractor scores updated", value: num(r.subUpdated) },
      { label: "Promoted to preferred", value: num(r.subPromoted) },
    ]),
    r.proposedVersion != null ? emailCallout("Action:", weights, "warning") : emailText(weights),
    ...(insights.length
      ? [emailHeading("What the outcomes say"), ...insights.map((i) => emailRow({ title: i.label, detail: i.text }))]
      : analysed === 0
        ? [emailText("No bids were won or lost since the last report, so there was nothing new to learn from. Subcontractor scores were still refreshed from their latest responses.")]
        : []),
    r.summary?.trim() ? emailHeading("Summary") + emailText(r.summary.trim()) : "",
  ];

  const html = renderSystemEmail(appUrl, {
    title: "Learning loop",
    eyebrow: "Weekly report",
    preheader: analysed > 0
      ? `${plural(analysed, "outcome")} analyzed. ${weights}`
      : `No new outcomes. ${plural(r.subUpdated, "subcontractor score")} refreshed.`,
    blocks,
    action: r.proposedVersion != null
      ? { label: "Review scoring weights", href: "/today" }
      : { label: "Open analytics", href: "/analytics" },
  });

  const text = [
    "Learning loop, weekly report",
    "",
    `Outcomes analyzed: ${analysed} (${r.wins} won, ${r.losses} lost)`,
    `Subcontractor scores updated: ${num(r.subUpdated)}`,
    `Promoted to preferred: ${num(r.subPromoted)}`,
    "",
    weights,
    ...(insights.length ? ["", "What the outcomes say", ...insights.map((i) => `- ${i.label}: ${i.text}`)] : []),
    ...(r.summary?.trim() ? ["", "Summary", r.summary.trim()] : []),
  ].join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Subcontractor replies
// ---------------------------------------------------------------------------

export interface ReplyNoticeItem {
  /** Who and what: "Acme Roofing, about Hangar repairs". */
  title: string;
  /** What the system did, in a sentence or two. */
  detail: string;
  /** The start of the reply, quoted. */
  snippet?: string;
  /** "critical" when a person must decide something. */
  tone?: "critical" | "warning" | "normal" | "good";
  tag?: string;
}

export function replyNotificationEmail(appUrl: string, items: ReplyNoticeItem[]): BuiltEmail {
  const count = items.length;
  const subject = `${SYSTEM_BRAND_NAME}: ${plural(count, "subcontractor update")}`;
  const decide = items.filter((i) => i.tone === "critical").length;
  const html = renderSystemEmail(appUrl, {
    title: `${plural(count, "update")} from subcontractors`,
    eyebrow: "Replies",
    preheader: decide
      ? `${plural(decide, "reply needs", "replies need")} your decision.`
      : "Each reply has been read and filed.",
    blocks: [
      emailText(
        decide
          ? `Each reply has been read and filed. ${plural(decide, "item needs", "items need")} your decision and ${decide === 1 ? "is" : "are"} marked.`
          : "Each reply has been read and filed. Nothing needs your decision."
      ),
      ...items.map((i) =>
        emailRow({
          title: i.title,
          detail: i.detail,
          note: i.snippet ? `"${i.snippet}"` : undefined,
          tone: i.tone ?? "normal",
          tag: i.tag,
        })
      ),
    ],
    action: { label: "Open Today", href: "/today" },
  });
  const text = [
    `${plural(count, "update")} from subcontractors`,
    "",
    ...items.flatMap((i) => [`- ${i.tag ? `[${i.tag}] ` : ""}${i.title}: ${i.detail}`, i.snippet ? `  "${i.snippet}"` : ""]).filter(Boolean),
    "",
    `Open Today: ${appUrl.replace(/\/+$/, "")}/today`,
  ].join("\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Operator alerts
// ---------------------------------------------------------------------------

/**
 * An operator alert: what happened, in the alert's own words, with a way in
 * to Automation Health. The tone sets the banner colour and its label.
 */
export function operatorAlertEmail(
  appUrl: string,
  input: { subject: string; text: string; tone?: "critical" | "warning" | "good" }
): BuiltEmail {
  const tone = input.tone ?? inferAlertTone(input.subject);
  const label = tone === "good" ? "Resolved." : tone === "critical" ? "Needs attention." : "Heads up.";
  const paragraphs = input.text.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  const [lead, ...rest] = paragraphs;
  const subject = /brost\s?co/i.test(input.subject) ? input.subject : `${SYSTEM_BRAND_NAME}: ${input.subject}`;
  const title = input.subject.replace(/^\s*(?:brost\s?co|brostco)\s*[:,]?\s*/i, "");
  const html = renderSystemEmail(appUrl, {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    eyebrow: "Automation alert",
    preheader: lead,
    hidePreheader: true,
    blocks: [
      lead ? emailCallout(label, lead, tone) : "",
      ...rest.map((p) => (/^[-*•]\s+/.test(p) ? emailList([p.replace(/^[-*•]\s+/, "")]) : emailLinkedText(p))),
    ],
    action: { label: "Open Automation Health", href: "/automation" },
  });
  const text = [input.text.trim(), "", `Automation Health: ${appUrl.replace(/\/+$/, "")}/automation`].join("\n");
  return { subject, html, text };
}

function inferAlertTone(subject: string): "critical" | "warning" | "good" {
  if (/\b(?:resumed|recovered|restored|cleared|working again|back)\b/i.test(subject)) return "good";
  if (/\b(?:needs a person|failed|down|stopped|outage|refused|cannot)\b/i.test(subject)) return "critical";
  return "warning";
}

// ---------------------------------------------------------------------------
// Account email: password reset, invitation, trial
// ---------------------------------------------------------------------------

export function passwordResetEmail(appUrl: string, input: { name?: string | null; resetUrl: string }): BuiltEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const subject = `Reset your ${SYSTEM_BRAND_NAME} password`;
  const html = renderSystemEmail(appUrl, {
    title: "Reset your password",
    preheader: "This link works for one hour.",
    blocks: [
      emailText(greeting),
      emailText(`Someone asked to reset the password for your ${SYSTEM_BRAND_NAME} account. Use the button below to choose a new one. The link works for one hour.`),
    ],
    action: { label: "Reset password", href: input.resetUrl },
    footer: ["If you did not ask for this, you can ignore this email. Your password has not changed."],
  });
  const text = [
    greeting,
    "",
    `Someone asked to reset the password for your ${SYSTEM_BRAND_NAME} account. Use this link to choose a new one. It works for one hour:`,
    input.resetUrl,
    "",
    "If you did not ask for this, you can ignore this email. Your password has not changed.",
  ].join("\n");
  return { subject, html, text };
}

export function invitationEmail(
  appUrl: string,
  input: { inviterEmail: string; planName: string; interval: "month" | "year"; terms: string; note?: string | null; url: string; expiry: string }
): BuiltEmail {
  const subject = `${input.inviterEmail} invited you to ${SYSTEM_BRAND_NAME}`;
  const billed = input.interval === "year" ? "annually" : "monthly";
  const html = renderSystemEmail(appUrl, {
    title: `You're invited to ${SYSTEM_BRAND_NAME}`,
    preheader: `${input.inviterEmail} set up an account for you.`,
    blocks: [
      emailText(`${input.inviterEmail} has invited you to ${SYSTEM_BRAND_NAME}.`),
      emailText(`${SYSTEM_BRAND_NAME} finds federal contracting opportunities that fit your company, scores them, and runs the subcontractor outreach for the ones worth bidding.`),
      emailFacts([
        { label: "Plan", value: input.planName },
        { label: "Billing", value: billed.charAt(0).toUpperCase() + billed.slice(1) },
      ]),
      emailText(`Terms: ${input.terms}`),
      input.note ? emailCallout("Note:", input.note, "normal") : "",
    ],
    action: { label: "Set up your account", href: input.url },
    footer: [`This link works until ${input.expiry}, and only once. If you were not expecting it, you can ignore it.`],
  });
  const text = [
    `${input.inviterEmail} has invited you to ${SYSTEM_BRAND_NAME}.`,
    "",
    `${SYSTEM_BRAND_NAME} finds federal contracting opportunities that fit your company, scores them, and runs the subcontractor outreach for the ones worth bidding.`,
    "",
    `Your plan: ${input.planName}, billed ${billed}.`,
    `Your terms: ${input.terms}`,
    ...(input.note ? ["", input.note] : []),
    "",
    "Set up your account here:",
    input.url,
    "",
    `This link works until ${input.expiry}, and only once.`,
    "",
    "If you were not expecting this, you can ignore it and nothing will happen.",
  ].join("\n");
  return { subject, html, text };
}

export function trialWarningEmail(appUrl: string, input: { daysLeft: number }): BuiltEmail {
  const when = input.daysLeft <= 1 ? "tomorrow" : `in ${input.daysLeft} days`;
  const subject = `Your ${SYSTEM_BRAND_NAME} trial ends ${when}`;
  const billingUrl = `${appUrl.replace(/\/+$/, "")}/settings/billing`;
  const html = renderSystemEmail(appUrl, {
    title: `Your trial ends ${when}`,
    preheader: "Everything you set up stays as it is when you choose a plan.",
    blocks: [
      emailText(`Your free trial of ${SYSTEM_BRAND_NAME} ends ${when}.`),
      emailText("Everything you have set up stays exactly as it is: your company profile, the opportunities found for you, your subcontractors, and any quotes already received. Choosing a plan lifts the trial limits and keeps the automation running."),
    ],
    action: { label: "Choose a plan", href: billingUrl },
    footer: [`If ${SYSTEM_BRAND_NAME} is not the right fit, you do not need to do anything. Nothing has been charged and no card is on file.`],
  });
  const text = [
    `Your free trial of ${SYSTEM_BRAND_NAME} ends ${when}.`,
    "",
    "Everything you have set up stays exactly as it is: your company profile, the opportunities found for you, your subcontractors, and any quotes already received. Choosing a plan lifts the trial limits and keeps the automation running.",
    "",
    `Choose a plan: ${billingUrl}`,
    "",
    `If ${SYSTEM_BRAND_NAME} is not the right fit, you do not need to do anything. Nothing has been charged and no card is on file.`,
  ].join("\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Subcontractor compliance
// ---------------------------------------------------------------------------

export interface ComplianceDigestEntry {
  name: string;
  items: string[];
  expired: boolean;
  working: boolean;
}

export function complianceDigestEmail(appUrl: string, entries: ComplianceDigestEntry[]): BuiltEmail {
  const working = entries.filter((e) => e.working && e.expired).length;
  const lapsed = entries.filter((e) => e.expired).length;
  const expiring = entries.length - lapsed;
  const subject = working
    ? `Subcontractor insurance: ${working} uninsured on live contracts`
    : `Subcontractor insurance: ${lapsed} lapsed, ${expiring} expiring`;
  const order = (e: ComplianceDigestEntry) => (e.working && e.expired ? 0 : e.expired ? 1 : 2);
  const sorted = [...entries].sort((a, b) => order(a) - order(b));
  const html = renderSystemEmail(appUrl, {
    title: "Subcontractor paperwork",
    eyebrow: "Compliance",
    preheader: subject,
    blocks: [
      working
        ? emailCallout("Stop work:", `${plural(working, "subcontractor")} on a live contract ${working === 1 ? "has" : "have"} lapsed insurance. Stop their work until a current certificate is in hand.`, "critical")
        : "",
      emailText("Insurance and tax documents that need attention. Anyone lapsed is blocked from new work until a current certificate is on file."),
      ...sorted.map((e) =>
        emailRow({
          title: e.name,
          detail: e.items.join("; "),
          tag: e.working && e.expired ? "Lapsed on a live contract" : e.expired ? "Lapsed" : "Expiring",
          tone: e.working && e.expired ? "critical" : e.expired ? "critical" : "warning",
        })
      ),
    ],
    action: { label: "Open compliance", href: "/compliance" },
  });
  const text = [
    "Insurance and tax documents that need attention:",
    "",
    ...sorted.map((e) => `- ${e.working && e.expired ? "[ON A LIVE CONTRACT] " : ""}${e.expired ? "LAPSED" : "Expiring"}: ${e.name} - ${e.items.join("; ")}`),
    "",
    "Anyone listed as LAPSED is blocked from receiving work until a current certificate is on file.",
    ...(working ? ["Anyone marked ON A LIVE CONTRACT is already working. Stop their work until a current certificate is in hand."] : []),
  ].join("\n");
  return { subject, html, text };
}

/** Escape helper re-exported for callers that build a snippet. */
export { escapeHtml };
