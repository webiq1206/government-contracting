/**
 * The bid package a subcontractor actually needs, as structure rather than prose.
 *
 * The outreach email used to hand them one paragraph. buildOutreachPacket
 * joined the trade scope, the place of performance, the bid deadline, the
 * related requirements and the instructions with a space, and that blob went
 * into {{scope_summary}}. Everything else, project name, solicitation number,
 * document list, was appended underneath as a second block, so the deadline
 * appeared twice and the one thing being asked for, the price, was a clause in
 * the middle of a wall of text.
 *
 * A subcontractor reading that on a phone cannot see what the job is, where it
 * is, what to send back, or by when, without reading every word. So they ask,
 * or they guess, or they do not reply.
 *
 * This assembles the same facts as titled sections of short lines: what the
 * project is, what we want priced, when it is due, what to send back, what to
 * watch for, and which documents are attached. It also reports what is
 * missing, because an email that cannot answer "what am I pricing" should not
 * be sent at all.
 *
 * Pure. Never invents a fact: every line comes from the analysis, the
 * opportunity, or the fixed instructions.
 */

import { toScannable } from "./scannable";
import { documentItems } from "./outreach-sections";
import { isPlaceholderScope } from "./solicitation-completeness";
import { resolveSubWork } from "./sub-work";

export interface BriefSection {
  heading: string;
  /** Short lines. Rendered as bullets, one idea each. */
  items: string[];
}

/** Something the email needs and does not have. */
export interface MissingPiece {
  key:
    | "scope"
    | "project_name"
    | "location"
    | "deadline"
    | "documents"
    | "quantities";
  /** Written for the operator who has to fix it. */
  detail: string;
  /** Blocking pieces stop the send; the rest are worth knowing about. */
  blocking: boolean;
}

export interface OutreachBrief {
  sections: BriefSection[];
  missing: MissingPiece[];
  /** False when anything blocking is missing. */
  ready: boolean;
  tradeSpecific: boolean;
}

export interface OutreachBriefInput {
  trade?: string | null;
  analysis?: {
    trade_scopes?: { trade: string; work: string }[] | null;
    draft_sow?: string | null;
    scope_plain_language?: string | null;
    project_overview?: string | null;
    location?: string | null;
    special_requirements?: string[] | null;
    key_dates?: { label: string; date: string }[] | null;
    prebid_meeting?: { required?: boolean; details?: string } | null;
    site_visit?: { required?: boolean; details?: string } | null;
    questions_for_subs?: string[] | null;
  } | null;
  description?: string | null;
  title?: string | null;
  agency?: string | null;
  solicitationNumber?: string | null;
  locationState?: string | null;
  locationText?: string | null;
  deadlineLabel?: string | null;
  /** Documents that will ride along, so the brief can list them. */
  attachedNames?: string[];
  links?: { name: string; url: string }[];
  /** True when this opportunity has documents that ought to be included. */
  documentsExpected?: boolean;
}

/** A number with a unit: the sign a scope says how much, not just what. */
const QUANTITY_RE =
  /\b\d[\d,.]*\s*(sq\.?\s?ft|square feet|sf|lf|linear feet|ea\b|each|tons?|gallons?|cy\b|cubic yards?|units?|fixtures?|doors?|windows?|panels?|acres?|hours?|%)/i;

/** "Not specified" and its friends: present in the data, worthless in an email. */
const NOT_SPECIFIED_RE = /^(not specified|n\/?a|tbd|unknown|none)\b/i;

/**
 * Trim a field and drop the placeholders the extractor leaves behind.
 *
 * Deliberately not isPlaceholderScope: that treats anything under 40
 * characters as a placeholder, which is the right call for a scope and the
 * wrong one for "Robins AFB" or "Sep 4, 2026".
 */
function clean(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s || s === "-" || s === "\u2014") return "";
  return NOT_SPECIFIED_RE.test(s) ? "" : s;
}

/** Split scope text into short lines; the analyst is asked for one task each. */
function scopeLines(work: string): string[] {
  const parsed = toScannable(work);
  if (!parsed) return [];
  if (parsed.kind === "bullets") return parsed.items;
  // A single paragraph stays whole rather than being chopped mid-thought.
  return [parsed.text];
}

export function buildOutreachBrief(input: OutreachBriefInput): OutreachBrief {
  const a = input.analysis ?? {};
  const missing: MissingPiece[] = [];
  const sections: BriefSection[] = [];

  // --- What the job is -----------------------------------------------------
  const title = clean(input.title);
  const location =
    clean(a.location) ||
    [input.locationText, input.locationState].filter(Boolean).join(", ").trim();
  const projectItems = [
    title ? `Project: ${title}` : "",
    location ? `Location: ${location}` : "",
    clean(input.agency) ? `Agency: ${input.agency}` : "",
    clean(input.solicitationNumber) ? `Solicitation: ${input.solicitationNumber}` : "",
    clean(input.trade) ? `Trade: ${input.trade}` : "",
  ].filter(Boolean);
  if (projectItems.length) sections.push({ heading: "Project", items: projectItems });

  if (!title) {
    missing.push({
      key: "project_name",
      detail: "No project name on the opportunity, so the email cannot say what job this is.",
      blocking: true,
    });
  }
  if (!location) {
    missing.push({
      key: "location",
      detail:
        "No place of performance. A subcontractor cannot price travel, crew or haulage without it.",
      blocking: true,
    });
  }

  // --- What we want priced -------------------------------------------------
  const subWork = resolveSubWork({
    trade: input.trade,
    analysis: a,
    description: input.description,
    maxChars: 1800,
  });
  const lines = scopeLines(subWork.work);
  if (lines.length) {
    sections.push({ heading: "Scope we need priced", items: lines });
  }
  if (!lines.length || isPlaceholderScope(subWork.work)) {
    missing.push({
      key: "scope",
      detail:
        "No usable scope for this trade. Enrich the solicitation package and re-run analysis before contacting anyone.",
      blocking: true,
    });
  } else if (!QUANTITY_RE.test(subWork.work)) {
    // Not blocking: plenty of real scopes are qualitative. Still worth saying,
    // because a quote against an unquantified scope is a guess.
    missing.push({
      key: "quantities",
      detail:
        "The scope names no quantities or measurements, so any price back will be an estimate.",
      blocking: false,
    });
  }

  // --- When ----------------------------------------------------------------
  const scheduleItems: string[] = [];
  if (input.deadlineLabel) {
    scheduleItems.push(`Our bid is due ${input.deadlineLabel}. Please reply before then.`);
  } else {
    missing.push({
      key: "deadline",
      detail: "No bid deadline, so the email cannot tell them when a quote is needed.",
      blocking: true,
    });
  }
  for (const d of a.key_dates ?? []) {
    const label = clean(d?.label);
    const date = clean(d?.date);
    if (label && date) scheduleItems.push(`${label}: ${date}`);
    if (scheduleItems.length >= 6) break;
  }
  if (a.prebid_meeting?.required) {
    scheduleItems.push(
      `Pre-bid meeting: ${clean(a.prebid_meeting.details) || "required, details to follow"}`
    );
  }
  if (a.site_visit?.required) {
    scheduleItems.push(
      `Site visit: ${clean(a.site_visit.details) || "required, details to follow"}`
    );
  }
  if (scheduleItems.length) sections.push({ heading: "Schedule", items: scheduleItems });

  // --- What we need back ---------------------------------------------------
  // Fixed, because vagueness here is what generates the follow-up questions.
  sections.push({
    heading: "What to send back",
    items: [
      "Your lump-sum price for the scope above",
      "Whether it is a firm quote or an estimate",
      "Payment terms and lead time",
      "Anything you are excluding, and any alternates worth considering",
      "Earliest you could start if we win",
    ],
  });

  // --- Anything else they need to price against ----------------------------
  const notes = (a.special_requirements ?? [])
    .map((s) => clean(String(s)))
    .filter(Boolean)
    .filter((s) => s.length <= 220)
    .filter((s) => {
      const trade = (input.trade ?? "").toLowerCase();
      if (!trade) return /wage|insurance|bond|licen|schedule|material|spec/i.test(s);
      return (
        s.toLowerCase().includes(trade) ||
        /wage|insurance|bond|licen|schedule|material|spec|install/i.test(s)
      );
    })
    .slice(0, 5);
  const questions = (a.questions_for_subs ?? [])
    .map((q) => clean(String(q)))
    .filter(Boolean)
    .slice(0, 3);
  if (notes.length || questions.length) {
    sections.push({
      heading: "Worth knowing",
      items: [...notes, ...questions],
    });
  }

  // --- Documents -----------------------------------------------------------
  // A pointer, not an inventory: the mail client already lists the files, and
  // they are selected and renamed for this recipient before they get here.
  const attached = (input.attachedNames ?? []).filter(Boolean);
  const links = (input.links ?? []).filter((l) => l?.name && l?.url);
  if (attached.length || links.length) {
    sections.push({
      heading: "Documents",
      items: documentItems(attached.length, links),
    });
  }
  if (input.documentsExpected && !attached.length && !links.length) {
    missing.push({
      key: "documents",
      detail:
        "This solicitation has documents but none could be attached or linked, so they would be pricing blind.",
      blocking: true,
    });
  }

  return {
    sections,
    missing,
    ready: !missing.some((m) => m.blocking),
    tradeSpecific: subWork.tradeSpecific,
  };
}

/** One line per blocking problem, for the operator and the agent log. */
export function describeMissing(missing: MissingPiece[]): string {
  return missing
    .filter((m) => m.blocking)
    .map((m) => m.detail)
    .join(" ");
}
