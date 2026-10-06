/**
 * Labels for the Today "is the platform working" rail.
 *
 * Color is never the only signal. Each state has a word an operator can
 * read, and a short explanation of what to do.
 */

export type SystemStatusKind =
  | "working"
  | "configured"
  | "needs_attention"
  | "waiting"
  | "delayed"
  | "failed"
  | "disconnected"
  | "action_required";

export const SYSTEM_STATUS_LABEL: Record<SystemStatusKind, string> = {
  working: "Working",
  configured: "Configured · not verified here",
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
      detail: "Google stopped the connection. Review the saved email connection details before reconnecting.",
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
      detail: "A previous email send or sync failed. Review its recorded outcome and connection details before retrying.",
      actionLabel: "Fix email connection",
      href: "/settings/integrations",
    };
  }
  return {
    id: "inbox",
    label: "Email inbox",
    kind: "configured",
    detail: inbox.email
      ? `Mailbox configured for ${inbox.email}. Connection settings alone do not confirm a send or reply sync.`
      : "A mailbox connection is saved. Check recent sending and reply-sync evidence.",
    actionLabel: "Review email evidence",
    href: "/settings/integrations#gmail",
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
    kind: "configured",
    detail: "A SAM.gov key is configured. Review its last recorded use or test to confirm automatic search is working.",
    actionLabel: "Review search connection",
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
