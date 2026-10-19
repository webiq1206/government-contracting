/**
 * Render every email the platform sends, with realistic sample data, into
 * one HTML page for review.
 *
 *   npx tsx scripts/email-gallery.ts [output-dir]
 *
 * Writes index.html (every email side by side, as a recipient sees it) and
 * one file per email. Nothing is sent and no database is read. Run it after
 * changing any email copy or layout, and look at the result before shipping.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { composeSystemEmailHtml } from "../lib/domain/system-email";
import {
  complianceDigestEmail,
  invitationEmail,
  kpiDigestEmail,
  learningLoopEmail,
  operatorAlertEmail,
  passwordResetEmail,
  replyNotificationEmail,
  trialWarningEmail,
} from "../lib/domain/report-emails";
import { plainToHtml, renderTemplate } from "../lib/domain/template-render";
import { renderOutreachBrief } from "../lib/domain/outreach-email";
import { TEMPLATE_TOKEN_SAMPLES, previewBriefSections } from "../lib/domain/template-tokens";
import { signatureLines, wrapLetter } from "../lib/domain/outreach-letter";
import { buildDeclineThankYouEmail } from "../lib/domain/decline-closeout";
import { buildRecap } from "../lib/domain/recap/sections";
import { renderRecapEmail } from "../lib/domain/recap/email";
import { DEFAULT_RECAP_SETTINGS, type RecapFacts } from "../lib/domain/recap/types";

const APP = "https://brostco.com";
const out = resolve(process.argv[2] ?? "email-gallery");
mkdirSync(out, { recursive: true });

interface Sample { group: "Platform" | "Subcontractor"; name: string; to: string; subject: string; html: string; text: string }
const samples: Sample[] = [];
const platform = (name: string, to: string, e: { subject: string; html: string; text: string }) =>
  samples.push({ group: "Platform", name, to, ...e });
const plainPlatform = (name: string, to: string, subject: string, text: string) =>
  platform(name, to, { subject, text, html: composeSystemEmailHtml(APP, { subject, text }) });
const outreach = (name: string, subject: string, text: string, html = plainToHtml(text)) =>
  samples.push({ group: "Subcontractor", name, to: "estimating@acmemech.example", subject, text, html: wrapLetter(html) });

// ---- Platform: reports -----------------------------------------------------
const now = new Date("2026-10-19T12:00:00Z");
const facts: RecapFacts = {
  orgId: "11111111-1111-4111-8111-111111111111", orgName: "BROSTCO Holdings",
  totals: { opportunitiesDiscovered: 6, decisionsMade: 4, outreachSent: 12, outreachDelivered: 11, outreachFailed: 1,
    repliesReceived: 3, repliesNeedingReview: 1, draftsGenerated: 2, callsLogged: 1, quotesRecorded: 2, bidsSubmitted: 0,
    notesAdded: 0, subsAdded: 5, complianceResolved: 0, agentRuns: 1810, agentRunErrors: 3 },
  deadlines: [{ id: "o1", title: "Hangar 4 HVAC replacement", agency: "Department of the Air Force", deadline: "2026-10-21T21:00:00Z", stage: "quote_entry", status: "open", submitted: false, quotesIn: 1 }],
  replies: [], unansweredReplies: [], failedSends: [], compliance: [], reviewQueue: [], callQueue: [], draftsWaiting: [],
  problems: [{ key: "p1", title: "solicitation-analyst failed 3 times across 1 account", detail: "Waiting on an earlier attempt's lease.", count: 3, lastAt: now.toISOString(), severity: "warning" }],
  discovered: [], decided: [], submitted: [], outcomes: [], outreachSent: [], completed: [],
};
const recap = buildRecap(facts, DEFAULT_RECAP_SETTINGS, { localDate: "2026-10-18", dayLabel: "Sunday, October 18", scope: "org", timezone: "America/Denver", now, ages: {}, partial: false });
const rendered = renderRecapEmail(recap, { appUrl: APP, orgName: "BROSTCO Holdings" });
platform("Daily recap", "Account owners", rendered);

platform("Weekly KPIs", "Operator digest", kpiDigestEmail(APP, {
  win_rate: { overall: 0, won: 0, lost: 0 }, avg_margin_on_wins_pct: 0,
  pipeline_value: 15_775_075_000, pipeline_count: 2027, pipeline_valued: 412, active_contract_revenue: 0,
  cash_flow_projection: { basis: "active contract milestones", buckets: [{ days: 30, amount: 0 }, { days: 60, amount: 0 }, { days: 90, amount: 0 }] },
  pipeline_velocity: { by_stage: [{ stage: "monitoring", count: 1890 }, { stage: "scoring", count: 41 }, { stage: "analysis", count: 6 }, { stage: "sub_research", count: 3 }, { stage: "outreach", count: 2 }] },
  sub_reliability_rankings: [{ company_name: "Bunkley Electric Company", reliability_score: 88, is_preferred: true }, { company_name: "Acme Mechanical", reliability_score: 74, is_preferred: false }],
}));
platform("Learning loop (quiet week)", "Operator digest", learningLoopEmail(APP, { wins: 0, losses: 0, proposedVersion: null, subUpdated: 2027, subPromoted: 0, insights: [] }));
platform("Learning loop (with outcomes)", "Operator digest", learningLoopEmail(APP, {
  wins: 2, losses: 3, proposedVersion: 7, subUpdated: 2027, subPromoted: 4,
  insights: [{ label: "Pricing", text: "Wins came in 6 to 9 percent under the incumbent; both losses priced more than 12 percent over." }, { label: "Agencies", text: "Air Force base maintenance awards favoured firms with local past performance." }],
  summary: "Weight past performance and distance a little higher for facility maintenance work.",
}));
platform("Subcontractor replies", "Operator digest", replyNotificationEmail(APP, [
  { title: "Acme Mechanical, about Hangar 4 HVAC replacement", detail: "Quote of $184,500 saved automatically. Marked quoted, reply saved, call card queued.", snippet: "Attached is our price for the full HVAC scope, good for 30 days.", tone: "good", tag: "Quote saved" },
  { title: "Bunkley Electric Company, about Hangar 4 HVAC replacement", detail: "Nothing was changed automatically. They asked whether the controls work is in scope.", snippet: "Is the BAS integration part of this or by others?", tone: "critical", tag: "Needs your decision" },
  { title: "Hangar 4 HVAC replacement", detail: "Every trade is now priced. Moved to Bid Building automatically.", tone: "good", tag: "Fully priced" },
]));
platform("Compliance digest", "Operator digest", complianceDigestEmail(APP, [
  { name: "Bunkley Electric Company", items: ["General liability certificate expired Oct 12"], expired: true, working: true },
  { name: "Acme Mechanical", items: ["Workers' compensation certificate expires Oct 30"], expired: false, working: false },
]));

// ---- Platform: alerts ------------------------------------------------------
platform("Operator alert: pipeline stall", "Operator digest", operatorAlertEmail(APP, { subject: "Pursue work is waiting", text: "3 pursue item(s) have a brief and no subcontractor pairing, and sub-finder has not run in the last 6 hours.\nThe continuation sweep queued sourcing again. Nothing needs to be done unless this repeats." }));
platform("Operator alert: resolved", "Operator digest", operatorAlertEmail(APP, { subject: "Pursue work resumed", text: "Sourcing, verification and quote requests are moving again." }));
platform("Operator alert: hold sweep", "Operator digest", operatorAlertEmail(APP, { subject: "BrostCo released a stuck hold", text: "The hold sweep released work that had outlived its lease.\nAI work receipts past their 25 minute lease, handed back to the schedule: 6. The next scheduled run retries that work once." }));

// ---- Platform: account -----------------------------------------------------
platform("Password reset", "A user", passwordResetEmail(APP, { name: "Jared", resetUrl: `${APP}/reset-password?token=sample` }));
platform("Invitation", "A new customer", invitationEmail(APP, { inviterEmail: "info@webiq.co", planName: "Founding", interval: "year", terms: "Founding price locked for 12 months.", note: "Glad to have you aboard.", url: `${APP}/invite?token=sample`, expiry: "Mon Oct 26 2026" }));
platform("Trial ending", "A trial customer", trialWarningEmail(APP, { daysLeft: 3 }));
plainPlatform("Billing: payment failed", "Account owner", "Your BrostCo payment did not go through", [
  "Hi Jared,", "", "We could not charge $499.00. Your card was declined.", "", "We will try again on October 22. Updating your card before then avoids any interruption.", "", `Update your payment method: ${APP}/settings/billing`,
].join("\n"));
plainPlatform("Billing: payment succeeded", "Account owner", "Your BrostCo payment went through", [
  "Hi Jared,", "", "We received $499.00. Thank you.", "", "Your next renewal is November 19.", "", "Your invoice: https://invoice.stripe.com/i/sample",
].join("\n"));

// ---- Subcontractor ---------------------------------------------------------
const profile = { outreach_display_name: "Jared Brost", legal_name: "BROSTCO Holdings LLC", phone: "(406) 555-0142" };
const sig = signatureLines(profile);
const vars = { ...TEMPLATE_TOKEN_SAMPLES, sender_name: "Jared Brost", company_name: "BROSTCO Holdings LLC", phone: "(406) 555-0142" };
const rfqBody = renderTemplate([
  "Hi {{owner_name}},", "",
  "I'm {{sender_name}} with {{company_name}}. We're preparing a bid for {{trade}} work in {{location_city_state}} and would like your pricing for the scope below.", "",
  "Please review the complete scope, requirements, and attached bid documents. If your team can perform the complete trade scope, reply by {{quote_due_date}} with your price, availability, payment terms, and exclusions.", "",
  "If you can perform only part of the scope, please explain exactly what you can and cannot provide. If you're not interested, a quick \"pass\" is helpful. If someone else handles estimates, please point me in the right direction.", "",
  "Thanks,", "{{sender_name}}", "{{company_name}}", "{{phone}}",
].join("\n"), vars);
const brief = renderOutreachBrief(previewBriefSections());
outreach("Quote request (RFQ)", renderTemplate("Pricing request: {{trade}} | {{location_city_state}}", vars), rfqBody + brief.plain, plainToHtml(rfqBody) + brief.html);
const follow = renderTemplate([
  "Hi {{owner_name}},", "", "I'm following up on the {{trade}} pricing request for {{opportunity_title}} in {{location_city_state}}.", "",
  "Can your team provide pricing by {{quote_due_date}}? A quick \"interested\" or \"pass\" is enough for now. The complete scope, requirements, and documents are included in the original message below.", "",
  "Thanks,", "{{sender_name}}", "{{phone}}",
].join("\n"), vars);
outreach("48-hour follow-up", `Re: ${renderTemplate("Pricing request: {{trade}} | {{location_city_state}}", vars)}`, follow);
outreach("Last call", "Last call: HVAC pricing needed by October 21, 2026 at 3:00 PM MDT", [
  "Hi Dana,", "", "Quick heads up: we finalize our numbers on October 21, 2026 at 3:00 PM MDT, so today is the last day I can take a HVAC price for the job I emailed you about.", "",
  "If you can still quote it, just reply with your number. If not, no problem at all, a quick \"we'll pass\" lets me close the file.", "", "Thanks either way,", ...sig,
].join("\n"));
outreach("Clarification request", "Re: Pricing request: HVAC | Great Falls, MT", [
  "Hi Acme Mechanical,", "", "Thanks for getting back to us on Hangar 4 HVAC replacement. Before we can put your numbers in, we still need:", "",
  "- how long your price is good for", "- anything the price does not include", "", "Just reply to this email and we will take it from there.", "", "Thanks,", ...sig,
].join("\n"));
const decline = buildDeclineThankYouEmail({ firstName: "Dana", companyName: "Acme Mechanical", opportunityTitle: "Hangar 4 HVAC replacement", trade: "HVAC", senderName: "Jared Brost", senderCompany: "BROSTCO Holdings LLC", senderPhone: "(406) 555-0142" });
outreach("Decline thank-you", decline.subject, decline.text, decline.html);
const portal = `${APP}/sub/portal?token=sample`;
const chaseText = ["Hi,", "", "Good news: we won Hangar 4 HVAC replacement, and we have you down for it.", "", "Before work can start we need this on file for Acme Mechanical: a current certificate of insurance.", "",
  "You can send it here. It takes about five minutes and there is no account to make:", portal, "", "That link works for 14 days. Reply to this email if anything is not right.", "", "Thanks,", ...sig].join("\n");
outreach("Award paperwork request", "Before we can start on Hangar 4 HVAC replacement: your paperwork", chaseText,
  plainToHtml(chaseText).replace(portal, `<a href="${portal}">${portal}</a>`));

// ---- Write ----------------------------------------------------------------
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
for (const s of samples) writeFileSync(join(out, `${slug(s.name)}.html`), s.html);
const cards = samples.map((s) => `<section class="card"><header><span class="tag ${s.group === "Platform" ? "p" : "s"}">${s.group}</span><h2>${esc(s.name)}</h2>
<p class="meta"><b>To:</b> ${esc(s.to)}<br><b>Subject:</b> ${esc(s.subject)}</p></header>
<iframe title="${esc(s.name)}" srcdoc="${esc(s.html)}"></iframe>
<details><summary>Plain-text version</summary><pre>${esc(s.text)}</pre></details></section>`).join("\n");
writeFileSync(join(out, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email gallery</title>
<style>body{margin:0;padding:24px 16px;background:#e9eeee;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111a1f}h1{margin:0 0 4px;font-size:22px}
.lead{margin:0 0 20px;color:#45545c}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,700px),1fr));gap:20px}
.card{background:#fff;border:1px solid #d8e0de;border-radius:6px;padding:14px}.card h2{margin:4px 0;font-size:16px}.meta{margin:0 0 10px;font-size:13px;color:#45545c}
.tag{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.tag.p{color:#0b5e63}.tag.s{color:#95601b}
iframe{width:100%;height:900px;border:1px solid #d8e0de;border-radius:4px;background:#fff}pre{white-space:pre-wrap;font-size:12px;background:#f4f6f6;padding:10px}</style></head>
<body><h1>Every email the platform sends</h1><p class="lead">${samples.length} emails rendered with sample data. Platform emails come from BrostCo; subcontractor emails go out from the customer's own inbox, as that company.</p>
<div class="grid">${cards}</div></body></html>`);
console.log(`Wrote ${samples.length} emails to ${out}`);
