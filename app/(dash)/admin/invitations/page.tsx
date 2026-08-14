import { notFound } from "next/navigation";
import { PageHeader } from "@/components/badges";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { listInvitations, invitationState, INVITATION_DAYS } from "@/lib/admin/invitations";
import { describeConcession } from "@/lib/billing/concessions";
import { InvitationForm } from "@/components/admin/invitation-form";
import { InvitationActions } from "@/components/admin/invitation-actions";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  outstanding: "bg-accent/15 text-accent-strong",
  accepted: "bg-pursue/15 text-pursue",
  revoked: "bg-slate-200 text-slate-600",
  expired: "bg-risk/15 text-risk",
};

const STATE_LABEL: Record<string, string> = {
  outstanding: "Waiting",
  accepted: "Accepted",
  revoked: "Withdrawn",
  expired: "Expired",
};

/**
 * Who has been invited, on what terms, and what happened.
 *
 * Outstanding invitations sort first: they are the only rows anyone can still
 * act on, and the reason to open this page is almost always "did that one ever
 * go through".
 */
export default async function AdminInvitationsPage() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();

  const rows = await listInvitations();
  const now = new Date();
  const ranked = rows
    .map((r) => ({ row: r, state: invitationState(r, now) }))
    .sort((a, b) => {
      const rank = (s: string) => (s === "outstanding" ? 0 : s === "expired" ? 1 : 2);
      return (
        rank(a.state) - rank(b.state) || b.row.created_at.localeCompare(a.row.created_at)
      );
    });

  const waiting = ranked.filter((r) => r.state === "outstanding").length;

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Invitations"
        subtitle="Bring somebody onto the platform on terms you choose, instead of the public trial everyone else gets."
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <InvitationForm />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            Sent invitations{waiting > 0 ? ` (${waiting} still waiting)` : ""}
          </h2>
          <p className="text-xs text-muted-foreground">
            A link is good for {INVITATION_DAYS} days and works once. Sending a
            new link replaces the old one.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="bg-surface text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Terms</th>
                  {/*
                    "Reference", not "Code": this string is not redeemable and
                    is not something to give the customer. It exists so an
                    audit entry can be matched to a row here.
                  */}
                  <th className="px-4 py-2 font-medium">Reference</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Sent</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ row, state }) => (
                  <tr key={row.id} className="border-t border-border/60 align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{row.email}</div>
                      <div className="text-xs text-muted-foreground">
                        by {row.invited_by_email}
                      </div>
                      {row.note && (
                        <div className="pt-0.5 text-xs text-muted-foreground">{row.note}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {describeConcession({
                        kind: row.concession_kind,
                        percent: row.concession_percent,
                        months: row.concession_months,
                      })}
                      <div className="text-xs">
                        {row.plan_key} · {row.billing_interval === "year" ? "annual" : "monthly"}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {row.concession_code ?? "-"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_TONE[state]}`}
                      >
                        {STATE_LABEL[state]}
                      </span>
                      {state === "outstanding" && (
                        <div className="pt-1 text-xs text-muted-foreground">
                          until {shortDate(row.expires_at)}
                        </div>
                      )}
                      {state === "accepted" && !row.terms_applied_at && (
                        // The account was created but the terms never landed on
                        // it. Rare, and invisible to the customer until an
                        // invoice, so it is said here in full.
                        <div className="pt-1 text-xs text-risk">
                          Terms did not apply. This account is on standard
                          pricing; grant the discount from its account page.
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {shortDate(row.last_sent_at)}
                      {row.sent_count > 1 && (
                        <span className="text-xs"> ({row.sent_count}×)</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <InvitationActions
                        id={row.id}
                        email={row.email}
                        canResend={state === "outstanding" || state === "expired"}
                      />
                    </td>
                  </tr>
                ))}
                {ranked.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Nobody has been invited yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
