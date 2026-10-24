/**
 * The half of a quote request the operator does not write.
 *
 * A template body can say hello and explain why we are writing. It cannot
 * carry a scope, because the scope is different for every trade on every
 * solicitation, and an operator who had to paste one in would paste the wrong
 * one eventually. So the editable template is the introduction and these
 * sections are appended beneath it, assembled from the resolved variables.
 *
 * The ordering is the order a subcontractor reads in: what and where the job
 * is, what they are pricing, what they have to satisfy, what we need answered,
 * what to send back, and what is attached. Anything the solicitation does not
 * say is left out rather than shown as a heading with nothing under it: an
 * empty "Requirements" section reads as "there are none", which is a claim we
 * cannot make.
 *
 * Pure.
 */

import type { BriefSection } from "./outreach-brief";

export interface SectionInput {
  vars: Record<string, string>;
  /**
   * The sentence bounding what this sub prices, from the resolver.
   *
   * Not {{scope_summary}}: that variable is the scope lines joined into a
   * standalone statement, and the bullets below already carry every one of
   * them. Printing both put the same three sentences on screen twice.
   */
  scopeBoundary?: string;
  /** Filenames riding along on the message, as the recipient will see them. */
  attachedNames?: string[];
  /** Documents too large to attach, offered as a link instead. */
  links?: { name: string; url: string }[];
  /** True when the solicitation set a pricing schedule or quote format. */
  pricingScheduleRequired?: boolean;
  /** The longer quote checklist belongs after interest, not on a cold invitation. */
  stage?: "initial" | "quote";
}

function lines(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((l) => l.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

function has(v: string | undefined): boolean {
  return Boolean((v ?? "").trim());
}

/**
 * What we ask for back.
 *
 * Mostly fixed, because vagueness here is what generates the round of
 * follow-up questions that costs more time than the quote saves. The
 * conditional lines are added only when the solicitation created the
 * condition, so a subcontractor is never asked for a pricing schedule that
 * does not exist.
 */
export function quoteChecklist(input: { pricingScheduleRequired?: boolean }): string[] {
  const items = [
    "Your complete price for the scope above",
    "Whether the price is firm or an estimate",
    "Anything excluded, and any assumptions you priced against",
    "Payment terms and lead time",
    "How long the quote stays valid",
    "Your availability, and the earliest you could start",
  ];
  if (input.pricingScheduleRequired) {
    // Only when the solicitation actually set a format.
    items.splice(1, 0, "Itemized pricing on the attached pricing schedule");
  }
  items.push("Taxes, mobilization and freight, if they are not already included");
  items.push("Any alternates worth considering, and your supporting quote document");
  return items;
}

export function buildOutreachSections(input: SectionInput): BriefSection[] {
  const v = input.vars;
  if (input.stage !== "quote") {
    const unique = (items:string[]) => [...new Set(items.map(s=>s.trim()).filter(Boolean))];
    const project = unique([
      [v.opportunity_title,v.solicitation_number ? `(${v.solicitation_number})` : ""].filter(Boolean).join(" "),
      [v.trade,v.location_city_state].filter(Boolean).join(" · "),
      [has(v.quote_due_date) ? `Quote requested by ${v.quote_due_date}` : "",
        has(v.deadline) ? `agency bid due ${v.deadline}` : ""].filter(Boolean).join("; "),
      [has(v.estimated_start_date) ? `Estimated start: ${v.estimated_start_date}` : "",
        has(v.project_duration) ? `Performance: ${v.project_duration}` : ""].filter(Boolean).join("; "),
    ]);
    const scope=unique(lines(v.trade_scope_requirements).length
      ? lines(v.trade_scope_requirements) : has(v.scope_summary) ? [v.scope_summary] : []);
    const requirements=unique(lines(v.subcontractor_requirements));
    const sections:BriefSection[]=[];
    if(project.length)sections.push({heading:"Project",items:project});
    if(scope.length)sections.push({heading:"Scope",items:scope});
    // All sourced applicable requirements survive. No word/line cap can hide
    // a real obligation merely to make a message look shorter.
    if(requirements.length)sections.push({heading:"Requirements for this scope",items:requirements});
    const documents=documentItems(input.attachedNames?.length ?? 0,input.links ?? []);
    if(documents.length)sections.push({heading:"Project documents",items:documents});
    sections.push({heading:"Next step",items:[
      "Can you cover this scope at this location and provide a quote by the requested date?",
      "If it is not a fit, a brief reply is enough; we will close this request.",
    ]});
    return sections;
  }
  const sections: BriefSection[] = [];

  // --- Project -------------------------------------------------------------
  const project: string[] = [];
  if (has(v.opportunity_title)) project.push(`Project: ${v.opportunity_title}`);
  if (has(v.location_city_state)) project.push(`Location: ${v.location_city_state}`);
  if (has(v.agency)) project.push(`Agency: ${v.agency}`);
  if (has(v.solicitation_number)) project.push(`Solicitation: ${v.solicitation_number}`);
  if (has(v.trade)) project.push(`Trade requested: ${v.trade}`);
  if (has(v.quote_due_date)) project.push(`Your quote is due: ${v.quote_due_date}`);
  /*
   * Our bid deadline is shown, and labelled as ours, because a subcontractor
   * who can see both dates understands why theirs is earlier. Hiding it makes
   * the quote date look arbitrary and invites a request to extend it.
   */
  if (has(v.deadline)) project.push(`Our bid to the agency is due: ${v.deadline}`);
  if (has(v.estimated_start_date)) project.push(`Estimated start: ${v.estimated_start_date}`);
  if (has(v.project_duration)) project.push(`Project duration: ${v.project_duration}`);
  if (project.length) sections.push({ heading: "Project", items: project });

  // --- Scope ---------------------------------------------------------------
  const scopeLines = lines(v.trade_scope_requirements);
  const scopeItems = scopeLines.length
    ? [...scopeLines, ...(has(input.scopeBoundary) ? [input.scopeBoundary!] : [])]
    : has(v.scope_summary)
      ? [v.scope_summary]
      : [];
  if (scopeItems.length) sections.push({ heading: "Scope to price", items: scopeItems });

  // --- Requirements --------------------------------------------------------
  const reqs = lines(v.subcontractor_requirements);
  if (reqs.length) sections.push({ heading: "Requirements", items: reqs });

  // --- Questions -----------------------------------------------------------
  const questions = lines(v.questions);
  if (questions.length) {
    sections.push({ heading: "Questions we need answered", items: questions });
  }

  // --- What to send back ---------------------------------------------------
  sections.push({
    heading: "What to include with your quote",
    items: quoteChecklist({ pricingScheduleRequired: input.pricingScheduleRequired }),
  });

  // --- Documents -----------------------------------------------------------
  /*
   * A pointer, not an inventory. The email used to list every filename here,
   * which duplicated what the recipient's mail client already shows and made
   * the message read like a manifest. The attachments themselves are now
   * selected for this trade and renamed to say what they are, so the email
   * only needs to say: what you need is attached, read it before you price.
   * Documents too large to attach still get their one link, because a link
   * is the only way the recipient can know they exist.
   */
  const attached = (input.attachedNames ?? []).filter(Boolean);
  const links = (input.links ?? []).filter((l) => l?.name && l?.url);
  if (attached.length || links.length) {
    sections.push({ heading: "Documents", items: documentItems(attached.length, links) });
  }

  return sections;
}

/**
 * The Documents section's lines, shared with the operator-facing brief so the
 * preview and the sent email can never phrase this differently.
 */
export function documentItems(
  attachedCount: number,
  links: { name: string; url: string }[]
): string[] {
  const items: string[] = [];
  if (attachedCount > 0) {
    items.push(
      attachedCount === 1
        ? "The attached document has the details you need to price this scope. Please review it before preparing your quote."
        : `The ${attachedCount} attached documents have the plans, specifications, and requirements you need to price this scope. Please review them before preparing your quote.`
    );
  }
  items.push(
    ...links.map((l) =>
      attachedCount > 0
        ? `Project documents: ${l.url}`
        : `Review the project documents: ${l.url}`
    )
  );
  return items;
}
