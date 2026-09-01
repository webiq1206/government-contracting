/**
 * Labels for the Today "is the platform working" rail.
 *
 * Color is never the only signal. Each state has a word an operator can
 * read, and a short explanation of what to do.
 */

export type SystemStatusKind =
  | "working"
  | "needs_attention"
  | "waiting"
  | "delayed"
  | "failed"
  | "disconnected"
  | "action_required";

export const SYSTEM_STATUS_LABEL: Record<SystemStatusKind, string> = {
  working: "Working",
  needs_attention: "Needs attention",
  waiting: "Waiting",
  delayed: "Delayed",
  failed: "Failed",
  disconnected: "Disconnected",
  action_required: "Action required",
};

export interface SystemStatusItem {
  id: string;
  label: string;
  kind: SystemStatusKind;
  detail: string;
  actionLabel?: string;
  href?: string;
}

export function inboxStatusItem(inbox: {
  connected: boolean;
  email: string | null;
  status: string;
  lastError: string | null;
}): SystemStatusItem {
  if (inbox.status === "revoked" || inbox.status === "expired") {
    return {
      id: "inbox",
      label: "Email inbox",
      kind: "action_required",
      detail: inbox.lastError
        ? `Google stopped the connection. ${inbox.lastError}`
        : "Google stopped the connection. Reconnect the mailbox to send and read email again.",
      actionLabel: "Fix email connection",
      href: "/settings/integrations",
    };
  }
  if (!inbox.connected || inbox.status === "none") {
    return {
      id: "inbox",
      label: "Email inbox",
      kind: "disconnected",
      detail:
        "No mailbox is connected, so outreach and reply collection cannot run. Connect Gmail under Settings, Integrations.",
      actionLabel: "Connect email",
      href: "/settings/integrations",
    };
  }
  if (inbox.status === "error") {
    return {
      id: "inbox",
      label: "Email inbox",
      kind: "failed",
      detail: inbox.lastError
        ? `Email last failed: ${inbox.lastError}`
        : "The last email send or sync failed. Open Integrations to retry.",
      actionLabel: "Fix email connection",
      href: "/settings/integrations",
    };
  }
  return {
    id: "inbox",
    label: "Email inbox",
    kind: "working",
    detail: inbox.email
      ? `Sending and reading from ${inbox.email}.`
      : "The mailbox is connected and can send.",
    href: "/settings/integrations",
  };
}

export function samStatusItem(configured: boolean): SystemStatusItem {
  if (!configured) {
    return {
      id: "sam",
      label: "Opportunity search",
      kind: "action_required",
      detail:
        "SAM.gov is not connected, so new government notices cannot be found automatically. Add the API key under Settings, Integrations.",
      actionLabel: "Connect SAM.gov",
      href: "/settings/integrations",
    };
  }
  return {
    id: "sam",
    label: "Opportunity search",
    kind: "working",
    detail: "SAM.gov is connected. New notices arrive on the regular search.",
    href: "/settings/integrations",
  };
}

export function automationStatusItem(input: {
  state: string;
  headline: string;
  detail: string;
}): SystemStatusItem {
  const map: Record<string, SystemStatusKind> = {
    healthy: "working",
    degraded: "needs_attention",
    blocked: "failed",
    paused: "waiting",
    not_configured: "action_required",
  };
  const kind = map[input.state] ?? "needs_attention";
  return {
    id: "automation",
    label: "Background work",
    kind,
    detail: input.detail || input.headline,
    actionLabel: kind === "working" ? undefined : "Open automation health",
    href: "/agents",
  };
}
