import { getProfileJson } from "./ai/companyProfile";
import { gatherTradeAttachments } from "./opportunity-attachments";
import { assessAttachmentPackage, describePackageProblems } from "./domain/attachment-package";
import { resolveOutreachVars, OUTREACH_VAR_SAMPLES } from "./domain/outreach-vars";
import { buildOutreachSections } from "./domain/outreach-sections";
import { renderOutreachBrief, scrubInternalFailureCopy } from "./domain/outreach-email";
import { validateOutboundEmail, describeProblems } from "./domain/outreach-validation";
import { renderTemplate, plainToHtml } from "./domain/template-render";
import { scrubGovtContacts, rewriteSamUrls } from "./integrations/scrub-contacts";
import type { OutreachAttachment } from "./integrations/email-transport";
import { loadOutreachPreviewPair } from "./outreach-preview";
import { sampleOutreachCopy } from "./domain/sample-outreach-copy";

export type TestPair = { opportunityId: string; subcontractorId: string; trade: string };

/** Build a controlled copy without changing the original recipient or starting follow-ups. */
export async function buildOutreachTest(orgId: string, template: { subject: string; body: string }, pair?: TestPair) {
  let vars = OUTREACH_VAR_SAMPLES;
  let attachments: OutreachAttachment[] = [];
  let sections = buildOutreachSections({ vars, scopeBoundary: "Sample HVAC scope for an email delivery test only." });
  let problems: string[] = [];
  if (pair) {
    const { opp, sub, trade } = await loadOutreachPreviewPair(orgId, pair);
    const profile = await getProfileJson();
    if (!profile) throw new Error("The company profile is unavailable. Nothing was sent.");
    const gathered = await gatherTradeAttachments(orgId, opp, trade);
    const pkg = assessAttachmentPackage(gathered);
    if (!pkg.ok) throw new Error(`The actual bid package is not sendable: ${describePackageProblems(pkg.problems)} Nothing was sent.`);
    const resolved = resolveOutreachVars({ sub, opportunity: opp,
      analysis: opp.solicitation_analysis ?? undefined, profile,
      trade, description: opp.description });
    const scrub = (s: string) => scrubInternalFailureCopy(scrubGovtContacts(rewriteSamUrls(s)).sanitised);
    vars = Object.fromEntries(Object.entries(resolved.vars).map(([k, v]) => [k, scrub(v)]));
    attachments = gathered.files;
    sections = buildOutreachSections({ vars, scopeBoundary: scrub(resolved.scopeBoundary),
      attachedNames: attachments.map(f => f.filename), links: gathered.links,
      pricingScheduleRequired: resolved.requirements.subRequirements.some(r => /pricing schedule|quote format/i.test(r.text)) });
    const detail = renderOutreachBrief(sections);
    problems = validateOutboundEmail({ subject: renderTemplate(template.subject, vars),
      body: scrubInternalFailureCopy(renderTemplate(template.body, vars)) + detail.plain,
      vars, missingRequired: resolved.missingRequired,
      attachedNames: attachments.map(f => f.filename), linkNames: gathered.links.map(l => l.name),
      documentsExpected: gathered.expected, quoteDueAt: resolved.quote.at, deadlineAt: opp.deadline,
      sampleValues: OUTREACH_VAR_SAMPLES, trade,
      tradeSpecific: resolved.requirements.tradeSpecific,
    }).map(p => describeProblems([p]));
    if (problems.length) throw new Error(`The actual quote request is not sendable: ${problems.join(" ")} Nothing was sent.`);
  }
  const note = pair
    ? "Controlled delivery test: this is a copy of a real bid pricing request. It was sent only to the test recipient. No quote or commitment is requested."
    : "Controlled delivery test: the project information below is sample data, with no bid documents attached. No quote or commitment is requested.";
  const testBody = pair ? template.body : sampleOutreachCopy(template.body);
  const plain = `${note}\n\n${scrubInternalFailureCopy(renderTemplate(testBody, vars))}`;
  const details = renderOutreachBrief(sections);
  return { subject: `[TEST] ${renderTemplate(template.subject, vars)}`,
    html: plainToHtml(plain) + details.html, text: plain + details.plain, attachments,
    mode: pair ? "real_bid" : "sample" };
}
