/**
 * Unified opportunity activity: agent automation + human communications in one
 * chronological feed so operators are not hunting across panels.
 */

export type ActivityKind = "system" | "email" | "call" | "note" | "human";

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
export function buildActivityTimeline(input: {
  logs?: ActivityLogInput[] | null;
  communications?: ActivityCommInput[] | null;
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

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return events.slice(0, input.limit ?? 40);
}
