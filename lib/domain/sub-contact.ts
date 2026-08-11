/**
 * Plain-English labels for subcontractor contactability and per-opportunity
 * outreach state. Shared by the opportunity Subs panel and the /subs list.
 */

export const OUTREACH_LABEL: Record<string, string> = {
  pending: "Not contacted yet",
  sent: "Email sent",
  draft: "Draft (no email transport)",
  send_failed: "Send failed",
  no_email: "No email on file",
  email_unverified: "Email unverified",
  followed_up: "Followed up",
  responsive: "Responded",
  unresponsive: "No response",
  declined: "Declined",
};

export const OUTREACH_HINT: Record<string, string> = {
  pending: "Sub Finder paired them, but outreach has not gone out yet.",
  sent: "An outreach email was sent for this opportunity.",
  draft: "Outreach was prepared but could not send (no email transport).",
  send_failed: "The last send attempt failed. Check Integrations or retry from the sub record.",
  no_email: "No email address is on file for this sub.",
  email_unverified: "An email is on file but has not been verified yet.",
  followed_up: "A follow-up email was sent after the initial outreach.",
  responsive: "They replied or were reached — warm lead for this opportunity.",
  unresponsive: "No reply after outreach and follow-up.",
  declined: "They declined to bid on this opportunity.",
};

export const CONTACT_STATUS_LABEL: Record<string, string> = {
  verified: "Email verified",
  unverified: "Email unverified",
  no_email_found: "No email found",
  no_website: "No website",
};

export const CONTACT_STATUS_HINT: Record<string, string> = {
  verified: "Sub Verify confirmed a working email on their record.",
  unverified: "An email is saved but has not been verified yet.",
  no_email_found: "Contact research could not find an email for this company.",
  no_website: "No website was found, so email research could not run.",
};

export function outreachLabel(state: string | null | undefined): string {
  if (!state) return "Unknown";
  return OUTREACH_LABEL[state] ?? state.replace(/_/g, " ");
}

export function outreachHint(state: string | null | undefined): string {
  if (!state) return "Outreach status is not set for this pairing.";
  return OUTREACH_HINT[state] ?? "Status of outreach for this opportunity.";
}

export function contactStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null;
  return CONTACT_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

export function contactStatusHint(status: string | null | undefined): string {
  if (!status) return "Contact research has not classified this sub yet.";
  return CONTACT_STATUS_HINT[status] ?? "How contactable this sub is across the roster.";
}

/** Badge color classes for outreach state (bg + text). */
export function outreachBadgeClass(state: string | null | undefined): string {
  switch (state) {
    case "responsive":
      return "bg-pursue/15 text-pursue";
    case "sent":
    case "followed_up":
      return "bg-accent/10 text-accent-strong";
    case "declined":
    case "send_failed":
      return "bg-risk/15 text-risk";
    case "unresponsive":
    case "no_email":
    case "email_unverified":
    case "draft":
      return "bg-review/15 text-review";
    default:
      return "bg-slate-200 text-slate-600";
  }
}

export function contactBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "verified":
      return "bg-pursue/15 text-pursue";
    case "unverified":
      return "bg-review/15 text-review";
    default:
      return "bg-slate-200 text-slate-600";
  }
}
