/**
 * Plain-English "what we need this subcontractor to do" — used on calls,
 * outreach emails, opportunity coverage, and Today so operators can speak
 * to the work without re-reading the full solicitation.
 */

export interface TradeScope {
  trade: string;
  /** Layperson description of the work this trade must perform. */
  work: string;
}

export type SubWorkSource =
  | "trade_scope"
  | "draft_sow"
  | "scope"
  | "overview"
  | "description"
  | "none";

export interface SubWorkDescription {
  trade: string | null;
  /** Ready-to-read work description (may be empty). */
  work: string;
  source: SubWorkSource;
  /** True when the text is specifically about this trade. */
  tradeSpecific: boolean;
}

const NA = "not specified in the provided documents";

function clean(s: string | null | undefined): string {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (t.toLowerCase() === NA) return "";
  return t;
}

function normalizeTrade(t: string | null | undefined): string {
  return (t ?? "").trim().toLowerCase();
}

/** Pull trade_scopes from analysis JSON whether typed or raw. */
export function tradeScopesFromAnalysis(
  analysis: { trade_scopes?: TradeScope[] | null } | Record<string, unknown> | null | undefined
): TradeScope[] {
  if (!analysis || typeof analysis !== "object") return [];
  const raw = (analysis as { trade_scopes?: unknown }).trade_scopes;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const trade = clean(String((row as TradeScope).trade ?? ""));
      const work = clean(String((row as TradeScope).work ?? ""));
      if (!trade || !work) return null;
      return { trade, work };
    })
    .filter((x): x is TradeScope => Boolean(x));
}

/**
 * Resolve the best plain-English work description for a subcontractor call
 * or email. Prefers per-trade scopes from the analyst, then the concise
 * draft SOW, then the full scope / overview / notice description.
 */
export function resolveSubWork(input: {
  trade?: string | null;
  analysis?:
    | {
        trade_scopes?: TradeScope[] | null;
        draft_sow?: string | null;
        scope_plain_language?: string | null;
        project_overview?: string | null;
      }
    | Record<string, unknown>
    | null;
  description?: string | null;
  /** Soft cap for compact UI / email vars. Full text when omitted. */
  maxChars?: number;
}): SubWorkDescription {
  const trade = clean(input.trade) || null;
  const analysis = (input.analysis ?? null) as {
    trade_scopes?: TradeScope[] | null;
    draft_sow?: string | null;
    scope_plain_language?: string | null;
    project_overview?: string | null;
  } | null;

  const scopes = tradeScopesFromAnalysis(analysis);
  let work = "";
  let source: SubWorkSource = "none";
  let tradeSpecific = false;

  if (trade) {
    const match = scopes.find((s) => normalizeTrade(s.trade) === normalizeTrade(trade));
    if (match) {
      work = match.work;
      source = "trade_scope";
      tradeSpecific = true;
    }
  }

  if (!work) {
    const draft = clean(analysis?.draft_sow);
    if (draft) {
      work = draft;
      source = "draft_sow";
    }
  }
  if (!work) {
    const scope = clean(analysis?.scope_plain_language);
    if (scope) {
      work = scope;
      source = "scope";
    }
  }
  if (!work) {
    const overview = clean(analysis?.project_overview);
    if (overview) {
      work = overview;
      source = "overview";
    }
  }
  if (!work) {
    const desc = clean(input.description);
    if (desc) {
      work = desc;
      source = "description";
    }
  }

  if (input.maxChars != null && work.length > input.maxChars) {
    const cut = work.slice(0, input.maxChars);
    const lastBreak = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
    work = (lastBreak > input.maxChars * 0.5 ? cut.slice(0, lastBreak + 1) : cut).trim() + "…";
  }

  return { trade, work, source, tradeSpecific };
}

/** One-line opener suitable for a call script or email lead-in. */
export function subWorkTalkingPoint(work: SubWorkDescription): string | null {
  if (!work.work) return null;
  const trade = work.trade ? `${work.trade} work` : "the work";
  const snippet = work.work.replace(/\s+/g, " ").trim();
  const short =
    snippet.length > 180
      ? snippet.slice(0, 177).replace(/\s+\S*$/, "") + "…"
      : snippet;
  return `We need you for ${trade}: ${short}`;
}
