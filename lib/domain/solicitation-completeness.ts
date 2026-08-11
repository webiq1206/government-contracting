/**
 * Solicitation completeness: what must be present before Brost Co may advance
 * an opportunity into subcontractor sourcing. Pure so agents, APIs, and UI
 * share one source of truth.
 */

export type RetrievableBy = "auto" | "admin" | "either";

export type MissingInfoAction = {
  label: string;
  href?: string;
  modal?: "upload" | "review-missing" | "retry-agent" | "enter-quote" | "contact-trade";
  agent?: string;
  trade?: string;
};

export interface MissingInfoItem {
  key: string;
  what: string;
  why: string;
  retrievable: RetrievableBy;
  resolution: string;
  action: MissingInfoAction;
  /** When true, blocks progression into sub_research. */
  critical: boolean;
}

export type AttachmentFetchStatus =
  | "fetched"
  | "failed"
  | "too_large"
  | "unsupported"
  | "no_url"
  | "no_text";

export interface AttachmentFetchOutcome {
  name: string;
  url?: string | null;
  status: AttachmentFetchStatus;
  detail?: string;
}

export interface SolicitationCompleteness {
  ok: boolean;
  missing: MissingInfoItem[];
  /** Risk-flag keys to merge onto the opportunity when not ok. */
  riskFlags: string[];
  attachmentOutcomes: AttachmentFetchOutcome[];
}

const NA_RE = /^not specified/i;

function blank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") {
    const s = v.trim();
    return s.length === 0 || NA_RE.test(s) || s === "-" || s === "—";
  }
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function textMentions(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

export interface CompletenessInput {
  solicitationNumber?: string | null;
  agency?: string | null;
  deadline?: string | null;
  locationState?: string | null;
  locationText?: string | null;
  naicsCode?: string | null;
  setAsideType?: string | null;
  valueEstimated?: number | null;
  description?: string | null;
  storedDocumentCount: number;
  attachmentOutcomes: AttachmentFetchOutcome[];
  analysis: {
    scope_plain_language?: string | null;
    project_overview?: string | null;
    draft_sow?: string | null;
    location?: string | null;
    estimated_value?: string | null;
    set_aside?: string | null;
    submission_method?: string | null;
    submission_requirements?: string[] | null;
    required_forms?: { name: string }[] | null;
    special_requirements?: string[] | null;
    qa_addenda?: unknown[] | null;
    compliance_matrix?: unknown[] | null;
    required_trades?: string[] | null;
  } | null;
  /** Admin waived attachment requirement for this opportunity. */
  attachmentsWaived?: boolean;
}

/**
 * Evaluate whether an opportunity has enough solicitation information to
 * leave analysis and begin subcontractor sourcing.
 */
export function evaluateSolicitationCompleteness(
  input: CompletenessInput
): SolicitationCompleteness {
  const missing: MissingInfoItem[] = [];
  const riskFlags: string[] = [];
  const analysis = input.analysis;
  const blob = [
    input.description ?? "",
    analysis?.scope_plain_language ?? "",
    analysis?.project_overview ?? "",
    analysis?.draft_sow ?? "",
    ...(analysis?.special_requirements ?? []),
    ...(analysis?.submission_requirements ?? []),
  ].join("\n");

  if (blank(input.solicitationNumber)) {
    missing.push({
      key: "solicitation_number",
      what: "Solicitation number",
      why: "Subs and bid forms need the official notice ID. Without it, quotes and submissions are ambiguous.",
      retrievable: "either",
      resolution: "Re-run Solicitation Analyst after SAM refresh, or enter the number on the opportunity.",
      action: { label: "Retry analysis", modal: "retry-agent", agent: "solicitation-analyst" },
      critical: true,
    });
  }

  if (blank(input.agency)) {
    missing.push({
      key: "agency",
      what: "Agency",
      why: "Agency identity drives set-aside rules, forms, and how the bid is addressed.",
      retrievable: "auto",
      resolution: "Refresh the notice from SAM and re-run Solicitation Analyst.",
      action: { label: "Retry analysis", modal: "retry-agent", agent: "solicitation-analyst" },
      critical: true,
    });
  }

  if (!input.deadline) {
    missing.push({
      key: "deadline",
      what: "Due date and time",
      why: "Without a deadline Brost Co cannot schedule outreach, follow-ups, or submission.",
      retrievable: "either",
      resolution: "Confirm the response date on SAM and re-run analysis, or set it manually.",
      action: { label: "Review missing information", href: "#overview", modal: "review-missing" },
      critical: true,
    });
    riskFlags.push("missing_deadline");
  }

  const hasLocation =
    !blank(input.locationState) ||
    !blank(input.locationText) ||
    !blank(analysis?.location);
  if (!hasLocation) {
    missing.push({
      key: "location",
      what: "Place of performance",
      why: "Location determines which subcontractors to source and whether the job fits your service area.",
      retrievable: "either",
      resolution: "Re-run analysis after documents are attached, or enter the city/state on the opportunity.",
      action: { label: "Review missing information", href: "#overview", modal: "review-missing" },
      critical: true,
    });
  }

  if (blank(input.naicsCode)) {
    missing.push({
      key: "naics",
      what: "NAICS code",
      why: "NAICS drives eligibility, comps, and which subs match the work.",
      retrievable: "auto",
      resolution: "Refresh from SAM and re-run Solicitation Analyst.",
      action: { label: "Retry analysis", modal: "retry-agent", agent: "solicitation-analyst" },
      critical: true,
    });
  }

  const scope =
    analysis?.scope_plain_language ||
    analysis?.draft_sow ||
    analysis?.project_overview ||
    "";
  if (blank(scope) || NA_RE.test(scope.trim())) {
    missing.push({
      key: "scope",
      what: "Scope of work",
      why: "Without a clear scope Brost Co cannot brief subcontractors or price the bid accurately.",
      retrievable: "either",
      resolution: "Attach the PWS/SOW (or full notice PDF) and re-run Solicitation Analyst.",
      action: { label: "Upload documents", href: "#attachments", modal: "upload" },
      critical: true,
    });
    riskFlags.push("unverified_scope");
  }

  const setAside = input.setAsideType ?? analysis?.set_aside;
  if (blank(setAside)) {
    missing.push({
      key: "set_aside",
      what: "Set-aside status",
      why: "You must know whether the bid is unrestricted or reserved before spending effort or committing a sub team.",
      retrievable: "either",
      resolution: "Confirm set-aside on the notice (use Unrestricted if none) and re-run analysis.",
      action: { label: "Review missing information", href: "#overview", modal: "review-missing" },
      critical: true,
    });
    riskFlags.push("unverified_set_aside");
  }

  const fetchedOk = input.attachmentOutcomes.filter(
    (o) => o.status === "fetched" || o.status === "no_text" || o.status === "unsupported"
  ).length;
  const failed = input.attachmentOutcomes.filter(
    (o) => o.status === "failed" || o.status === "too_large" || o.status === "no_url"
  );
  const hasStoredDocs = input.storedDocumentCount > 0 || fetchedOk > 0;
  if (!input.attachmentsWaived && !hasStoredDocs) {
    missing.push({
      key: "attachments",
      what: "Solicitation attachments",
      why: "Plans, specs, and forms live in the attachments. Pricing from the portal blurb alone is incomplete.",
      retrievable: "either",
      resolution:
        failed.length > 0
          ? `Failed to collect: ${failed.map((f) => f.name).join(", ")}. Upload them manually or retry analysis.`
          : "No documents were linked on the notice. Upload the solicitation package, then retry analysis.",
      action: { label: "Upload documents", href: "#attachments", modal: "upload" },
      critical: true,
    });
    riskFlags.push("missing_attachments");
  } else if (failed.length > 0) {
    missing.push({
      key: "attachments_partial",
      what: "Some attachments could not be collected",
      why: "Referenced files are missing from Brost Co storage, so scope or forms may be incomplete.",
      retrievable: "either",
      resolution: `Missing or failed: ${failed.map((f) => `${f.name}${f.detail ? ` (${f.detail})` : ""}`).join("; ")}.`,
      action: { label: "Upload missing files", href: "#attachments", modal: "upload" },
      critical: true,
    });
    riskFlags.push("missing_attachments");
  }

  const hasSubmission =
    !blank(analysis?.submission_method) ||
    (analysis?.submission_requirements?.length ?? 0) > 0 ||
    (analysis?.required_forms?.length ?? 0) > 0 ||
    (analysis?.compliance_matrix?.length ?? 0) > 0;
  if (!hasSubmission) {
    missing.push({
      key: "submission_requirements",
      what: "Submission and pricing requirements",
      why: "Without knowing how to submit and what forms/pricing sheets are required, the bid package cannot be built correctly.",
      retrievable: "either",
      resolution: "Attach instructions-to-offerors / bid forms and re-run Solicitation Analyst.",
      action: { label: "Retry analysis", modal: "retry-agent", agent: "solicitation-analyst" },
      critical: true,
    });
  }

  // Referenced-but-absent soft requirements become blockers when mentioned.
  if (
    input.valueEstimated == null &&
    blank(analysis?.estimated_value) &&
    textMentions(blob, ["estimated value", "igce", "independent government", "contract value", "nte", "not to exceed"])
  ) {
    missing.push({
      key: "value",
      what: "Estimated or stated contract value",
      why: "The documents reference a value, but Brost Co could not extract it. Pricing comps and sub expectations need a number or an explicit unknown.",
      retrievable: "either",
      resolution: "Re-run analysis after attaching the pricing sheet/IGCE, or confirm value is truly unstated.",
      action: { label: "Review missing information", href: "#overview", modal: "review-missing" },
      critical: true,
    });
    riskFlags.push("unverified_value");
  } else if (input.valueEstimated == null && blank(analysis?.estimated_value)) {
    missing.push({
      key: "value",
      what: "Estimated contract value",
      why: "Unknown value makes it harder to judge fit and brief subs. Confirm it is unstated or extract it from the package.",
      retrievable: "either",
      resolution: "Attach pricing documents and retry analysis, or acknowledge value is not listed.",
      action: { label: "Review missing information", href: "#overview", modal: "review-missing" },
      critical: false,
    });
    riskFlags.push("unverified_value");
  }

  if (
    textMentions(blob, ["wage determination", "davis-bacon", "sca ", "service contract act"]) &&
    !textMentions(blob, ["wage determination attached", "wd "])
  ) {
    const hasWageDoc = input.attachmentOutcomes.some((o) =>
      /wage|davis|sca/i.test(o.name)
    );
    if (!hasWageDoc) {
      missing.push({
        key: "wage_determination",
        what: "Wage determination",
        why: "The solicitation references wage rules. Subs need the determination to price labor correctly.",
        retrievable: "either",
        resolution: "Upload the wage determination PDF and re-run analysis.",
        action: { label: "Upload documents", href: "#attachments", modal: "upload" },
        critical: true,
      });
    }
  }

  if (
    textMentions(blob, ["drawing", "plans", "blueprint", "sheet a-", "floor plan"]) &&
    !input.attachmentOutcomes.some((o) => /plan|drawing|blueprint|exhibit/i.test(o.name))
  ) {
    missing.push({
      key: "drawings",
      what: "Plans or drawings",
      why: "The notice references drawings/plans that are not in Brost Co yet.",
      retrievable: "either",
      resolution: "Upload the plan set or linked exhibits, then retry analysis.",
      action: { label: "Upload documents", href: "#attachments", modal: "upload" },
      critical: true,
    });
  }

  if (
    textMentions(blob, ["amendment", "addendum", "addenda"]) &&
    (analysis?.qa_addenda?.length ?? 0) === 0
  ) {
    missing.push({
      key: "amendments",
      what: "Amendments / addenda",
      why: "Amendments change scope and deadlines. They must be captured before outreach and submission.",
      retrievable: "either",
      resolution: "Upload every amendment and re-run Solicitation Analyst.",
      action: { label: "Upload documents", href: "#attachments", modal: "upload" },
      critical: true,
    });
  }

  const criticalMissing = missing.filter((m) => m.critical);
  return {
    ok: criticalMissing.length === 0,
    missing,
    riskFlags: [...new Set(riskFlags)],
    attachmentOutcomes: input.attachmentOutcomes,
  };
}

/** First-name (or configured) display name for sub-facing outreach. */
export function outreachDisplayName(profile: {
  outreach_display_name?: string | null;
  owner_name?: string | null;
  legal_name?: string | null;
}): string {
  const configured = profile.outreach_display_name?.trim();
  if (configured) return configured;
  const owner = profile.owner_name?.trim();
  if (owner) {
    const first = owner.split(/\s+/)[0];
    if (first) return first;
  }
  return profile.legal_name?.trim() || "Brost Co";
}

/** True when trade scope text is too thin to send to a subcontractor. */
export function isPlaceholderScope(text: string | null | undefined): boolean {
  if (!text?.trim()) return true;
  return NA_RE.test(text.trim()) || text.trim().length < 40;
}
