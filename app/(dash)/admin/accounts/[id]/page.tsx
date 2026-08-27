import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { requirePlatformAdmin, isPlatformAdmin } from "@/lib/platform-admin";
import { adminAccount, adminAccountMembers } from "@/lib/admin/accounts";
import { adminActionsForOrg } from "@/lib/admin/audit";
import { accessBlockedReason } from "@/lib/billing/entitlements";
import { AccountActions } from "@/components/admin/account-actions";
import { PlatformKeyGrants } from "@/components/admin/platform-key-grants";
import { platformKeyStates } from "@/lib/admin/platform-keys";
import { shortDate } from "@/lib/format";
import { deletionView } from "@/lib/domain/account-deletion";
import { EditorialTabs } from "@/components/editorial-tabs";
import { MemberRoles } from "@/components/admin/member-roles";
import {
  accountIntegrations,
  accountSessions,
  accountUsage,
} from "@/lib/admin/account-detail";
import {
  INTEGRATION_STATE_LABEL,
  stateTone,
} from "@/lib/domain/integration-state";

export const dynamic = "force-dynamic";

/**
 * One account, everything we know about it, and everything we can do to it.
 *
 * The read-only summary is deliberately above the actions: the most common
 * reason to be here is answering "why can this person not get in", and that is
 * usually answered by the Access line without touching anything.
 */
export default async function AdminAccountPage({ params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();

  const org = await adminAccount(params.id);
  if (!org) notFound();

  const [members, audit, keyStates, usage, integrations, sessions] = await Promise.all([
    adminAccountMembers(org.id),
    adminActionsForOrg(org.id),
    platformKeyStates(org.id),
    accountUsage(org.id),
    accountIntegrations(org.id),
    accountSessions(org.id),
  ]);

  // Two places a discount can live, and the admin should not have to know
  // which: what Stripe is charging them, or what we promised before they had
  // anything to charge.
  const currentDiscount = org.discount_percent_off
    ? `${Number(org.discount_percent_off)}% off${
        org.discount_code ? ` (${org.discount_code})` : ""
      }${org.discount_ends_at ? ` until ${shortDate(org.discount_ends_at)}` : ""}`
    : org.discount_amount_off_cents
      ? `$${(org.discount_amount_off_cents / 100).toLocaleString("en-US")} off${
          org.discount_code ? ` (${org.discount_code})` : ""
        }`
      : org.pending_concession_label
        ? `${org.pending_concession_label} Applies at checkout${
            org.pending_concession_code ? ` (${org.pending_concession_code})` : ""
          }.`
        : null;

  const accessText =
    org.access === "full"
      ? org.billing_exempt
        ? "Full access (comped, not billed)"
        : "Full access"
      : org.access === "trial"
        ? `On trial until ${org.trial_ends_at ? shortDate(org.trial_ends_at) : "an unknown date"}`
        : accessBlockedReason(org);

  return (
    <>
      <PageFrame
        breadcrumbs={[
          { label: "Platform admin", href: "/admin" },
          { label: "Accounts", href: "/admin/accounts" },
          { label: org.name },
        ]}
        title={org.name}
        status={org.suspended_at ? "Suspended" : (org.subscription_status ?? "no status")}
        explanation={
          org.owner_email
            ? `Owned by ${org.owner_email}. Everything this account can currently do, and why.`
            : "No owner on this account, which is worth fixing before anything else here."
        }
      />
      {/* The access line stays above the tabs: the most common reason to be
          here is "why can this person not get in", and that must not depend
          on which tab was open last. */}
      <div className="px-5 pt-4">
        <div
          className={`rounded-lg border p-4 ${
            org.access === "none"
              ? "border-risk/40 bg-risk/5"
              : "border-border bg-surface/50"
          }`}
        >
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            What this account can do right now
          </div>
          <p className="pt-1 font-medium">{accessText}</p>
          {org.billing_exempt && org.billing_exempt_reason && (
            <p className="pt-1 text-sm text-muted-foreground">
              Comped: {org.billing_exempt_reason}
            </p>
          )}
          {org.suspended_at && (
            <p className="pt-1 text-sm text-risk">
              Suspended {shortDate(org.suspended_at)}
              {org.suspended_reason ? `: ${org.suspended_reason}` : ""}
            </p>
          )}
          {org.deletion_scheduled_at && (
            <p className="pt-1 text-sm font-medium text-risk">
              {deletionView(org.deletion_scheduled_at).headline}, on{" "}
              {shortDate(org.deletion_scheduled_at)}. It can still be cancelled.
            </p>
          )}
        </div>
      </div>

      <EditorialTabs
        ariaLabel="Account detail"
        layout="fill"
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <div className="space-y-6 p-5">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 panel-inset p-4 text-sm sm:grid-cols-3">
                  <Field label="Plan" value={org.plan_key ?? "-"} />
                  <Field label="Stripe status" value={org.subscription_status ?? "-"} />
                  <Field
                    label="Trial ends"
                    value={org.trial_ends_at ? shortDate(org.trial_ends_at) : "-"}
                  />
                  <Field label="Stripe customer" value={org.stripe_customer_id ?? "-"} />
                  <Field label="Subscription" value={org.stripe_subscription_id ?? "-"} />
                  <Field label="Created" value={shortDate(org.created_at)} />
                </dl>
                {/* What the account has actually done, so "is this customer
                    using the product" is answered here rather than by
                    guessing from a login date. */}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 panel-inset p-4 text-sm sm:grid-cols-4">
                  <Count label="Opportunities" n={usage.opportunities} />
                  <Count label="Pursued" n={usage.pursued} />
                  <Count label="Bids" n={usage.bids} />
                  <Count label="Submitted" n={usage.submitted} />
                  <Count label="Contracts" n={usage.contracts} />
                  <Count label="Subcontractors" n={usage.subcontractors} />
                  <Count label="Outreach sent" n={usage.outreachSent} />
                  <Count label="Replies in" n={usage.repliesIn} />
                </dl>
                <div>
                  <a
                    href={`/api/admin/accounts/${org.id}/export`}
                    className="btn-ghost inline-flex text-xs"
                    download
                  >
                    Export this account&rsquo;s data (JSON)
                  </a>
                  <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                    Business records only: never sessions, credentials or payment
                    internals. Every export is recorded in this account&rsquo;s admin
                    history.
                  </p>
                </div>
              </div>
            ),
          },
          {
            id: "people",
            label: `People (${members.length})`,
            content: (
              <div className="p-5">
                <MemberRoles orgId={org.id} members={members} />
                <div className="mt-6">
                  <h2 className="text-sm font-semibold">Recent sign-ins</h2>
                  {sessions.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No sessions on record for this account.
                    </p>
                  ) : (
                    <ul className="mt-2 divide-y divide-border/60 panel-inset text-sm">
                      {sessions.map((sess, i) => (
                        <li key={i} className="flex flex-wrap gap-x-2 px-4 py-2">
                          <span className="font-medium">{sess.email}</span>
                          <span className="text-muted-foreground">
                            signed in {shortDate(sess.created_at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: "integrations",
            label: "Integrations",
            content: (
              <div className="space-y-3 p-5">
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  The same verdicts the customer sees on their own Integrations page,
                  from the same rules, so support and the customer are never reading
                  two different answers to &ldquo;is it working&rdquo;. No secret is
                  shown here, only whether one exists and what it last did.
                </p>
                <ul className="divide-y divide-border/60 panel-inset text-sm">
                  {integrations.map((it) => (
                    <li key={it.id} className="px-4 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="font-medium">{it.label}</span>
                        <span
                          className={
                            stateTone(it.verdict.state) === "red"
                              ? "text-risk"
                              : stateTone(it.verdict.state) === "amber"
                                ? "text-review"
                                : stateTone(it.verdict.state) === "green"
                                  ? "text-pursue"
                                  : "text-muted-foreground"
                          }
                        >
                          {INTEGRATION_STATE_LABEL[it.verdict.state]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {it.verdict.reason}
                        {it.lastSuccessAt ? ` Last real work ${shortDate(it.lastSuccessAt)}.` : ""}
                        {it.lastTestedAt ? ` Last tested ${shortDate(it.lastTestedAt)}.` : ""}
                      </p>
                      {it.lastError && (
                        <p className="mt-0.5 text-xs text-risk">{it.lastError}</p>
                      )}
                      {it.quotaNote && (
                        <p className="mt-0.5 text-xs text-review">{it.quotaNote}</p>
                      )}
                    </li>
                  ))}
                </ul>
                <PlatformKeyGrants
                  orgId={org.id}
                  orgName={org.name}
                  states={keyStates}
                  isTrial={org.access === "trial"}
                />
              </div>
            ),
          },
          {
            id: "actions",
            label: "Actions",
            content: (
              <div className="p-5">
                <AccountActions
                  orgId={org.id}
                  orgName={org.name}
                  billingExempt={org.billing_exempt}
                  suspended={Boolean(org.suspended_at)}
                  currentDiscount={currentDiscount}
                  ownerEmail={org.owner_email}
                  deletionScheduledAt={org.deletion_scheduled_at}
                  deletionRequestedBy={org.deletion_requested_by}
                  deletionReason={org.deletion_reason}
                  classification={org.classification}
                  canImpersonate={
                    Boolean(org.owner_user_id) &&
                    org.owner_user_id !== auth.id &&
                    !isPlatformAdmin(org.owner_email ?? "")
                  }
                />
              </div>
            ),
          },
          {
            id: "audit",
            label: `History (${audit.length})`,
            content: (
              <div className="p-5">
                <div className="panel-inset">
                  {audit.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No administrator has touched this account.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60 text-sm">
                      {audit.map((a) => (
                        <li key={a.id} className="flex flex-wrap gap-x-2 px-4 py-2">
                          <span className="text-muted-foreground">{shortDate(a.created_at)}</span>
                          <span className="font-medium">{a.admin_email}</span>
                          <span>{a.action.replace(/_/g, " ")}</span>
                          {a.detail?.reason ? (
                            <span className="text-muted-foreground">{String(a.detail.reason)}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

/**
 * A count that can be absent.
 *
 * Null renders as "not read", never as 0: "this account has sent no
 * outreach" and "we could not read the outreach table" lead to opposite
 * conversations with a customer.
 */
function Count({ label, n }: { label: string; n: number | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`num font-medium ${n == null ? "text-muted-foreground" : ""}`}>
        {n == null ? "not read" : n.toLocaleString("en-US")}
      </dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
