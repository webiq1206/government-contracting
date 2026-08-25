/**
 * Unified opportunity activity: everything that happened, in one feed.
 *
 * "Unified" was previously two sources, agent logs and communications, and an
 * opportunity whose history was a quote, an uploaded document or a prepared
 * call therefore rendered the words "No activity" over a record that plainly
 * had some. That is worse than an empty panel: it is the page asserting
 * something false about work the operator can see elsewhere on the same
 * screen, and it teaches them not to believe the panel at all.
 *
 * The sources below are the ones the record is actually made of. Anything
 * dated that a person or an agent did belongs here; nothing else does.
 */

export type ActivityKind =
  | "system"
  | "email"
  | "call"
  | "note"
  | "human"
  | "quote"
  | "document";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  /** Optional actor label (agent name or "You"). */
  actor: string | null;
}

export interface ActivityLogInput {
  agent?: unknown;
  action?: unknown;
  message?: unknown;
  reasoning?: unknown;
  created_at?: unknown;
}

export interface ActivityCommInput {
  id?: unknown;
  channel?: unknown;
  direction?: unknown;
  subject?: unknown;
  body?: unknown;
  created_at?: unknown;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function channelKind(channel: string | null): ActivityKind {
  if (channel === "email") return "email";
  if (channel === "call") return "call";
  if (channel === "note") return "note";
  return "human";
}

/**
 * Merge agent logs and communications, newest first. Caps the result so the
 * opportunity page stays scannable.
 */
/** A quote received from a subcontractor. */
export interface ActivityQuoteInput {
  id?: unknown;
  company_name?: unknown;
  trade?: unknown;
  quote_amount?: unknown;
  created_at?: unknown;
}

/** A document attached to the solicitation or produced for the bid. */
export interface ActivityDocInput {
  id?: unknown;
  filename?: unknown;
  doc_type?: unknown;
  source?: unknown;
  created_at?: unknown;
}

/** A prepared or completed call. */
export interface ActivityCallInput {
  id?: unknown;
  company_name?: unknown;
  trade?: unknown;
  status?: unknown;
  created_at?: unknown;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function buildActivityTimeline(input: {
  logs?: ActivityLogInput[] | null;
  communications?: ActivityCommInput[] | null;
  quotes?: ActivityQuoteInput[] | null;
  documents?: ActivityDocInput[] | null;
  calls?: ActivityCallInput[] | null;
  limit?: number;
}): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const [i, l] of (input.logs ?? []).entries()) {
    const at = str(l.created_at);
    if (!at) continue;
    const agent = str(l.agent) ?? "system";
    const action = str(l.action);
    const message = str(l.message);
    const reasoning = str(l.reasoning);
    events.push({
      id: `log-${i}-${at}`,
      at,
      kind: agent === "operator" ? "human" : "system",
      title: action ? `${agent}: ${action}` : agent,
      detail: message ?? reasoning,
      actor: agent === "operator" ? "You" : agent,
    });
  }

  for (const c of input.communications ?? []) {
    const at = str(c.created_at);
    if (!at) continue;
    const channel = str(c.channel) ?? "note";
    const direction = str(c.direction);
    const subject = str(c.subject);
    const body = str(c.body);
    const dirLabel =
      direction === "inbound" ? "received" : direction === "outbound" ? "sent" : "";
    events.push({
      id: `comm-${str(c.id) ?? at}`,
      at,
      kind: channelKind(channel),
      title: subject ?? `${channel}${dirLabel ? ` ${dirLabel}` : ""}`,
      detail: body && body !== subject ? body.slice(0, 280) : null,
      // Outbound email is the platform's doing; notes and calls are a person's.
      actor:
        direction === "inbound"
          ? "Subcontractor"
          : channel === "email"
            ? "Brost Co"
            : "You",
    });
  }

  // A price arriving is the single most consequential thing that happens on a
  // solicitation, and it was the one event the feed did not carry.
  for (const q of input.quotes ?? []) {
    const at = str(q.created_at);
    if (!at) continue;
    const amount = num(q.quote_amount);
    const who = str(q.company_name) ?? "A subcontractor";
    const trade = str(q.trade);
    events.push({
      id: `quote-${str(q.id) ?? at}`,
      at,
      kind: "quote",
      title: `Quote from ${who}${trade ? ` for ${trade}` : ""}`,
      detail: amount != null ? money(amount) : null,
      actor: who,
    });
  }

  for (const d of input.documents ?? []) {
    const at = str(d.created_at);
    if (!at) continue;
    const name = str(d.filename) ?? str(d.doc_type) ?? "a document";
    // A file we pulled from the solicitation and a file a person uploaded are
    // different facts about the record, and the feed should not blur them.
    const fromUs = str(d.source) === "upload";
    events.push({
      id: `doc-${str(d.id) ?? at}`,
      at,
      kind: "document",
      title: `${fromUs ? "Uploaded" : "Attached"} ${name}`,
      detail: str(d.doc_type),
      actor: fromUs ? "You" : "Brost Co",
    });
  }

  for (const c of input.calls ?? []) {
    const at = str(c.created_at);
    if (!at) continue;
    const who = str(c.company_name) ?? "a subcontractor";
    const trade = str(c.trade);
    const done = str(c.status) === "done";
    events.push({
      id: `call-${str(c.id) ?? at}`,
      at,
      kind: "call",
      title: `${done ? "Called" : "Call prepared for"} ${who}${trade ? ` about ${trade}` : ""}`,
      detail: null,
      actor: "You",
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, input.limit ?? 40);
}
