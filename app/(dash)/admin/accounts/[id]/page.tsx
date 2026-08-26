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

  const [members, audit, keyStates] = await Promise.all([
    adminAccountMembers(org.id),
    adminActionsForOrg(org.id),
    platformKeyStates(org.id),
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
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
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
          {/* The single most important thing about this account, so it sits
              with the access line rather than only in the danger zone at the
              foot of the page. */}
          {org.deletion_scheduled_at && (
            <p className="pt-1 text-sm font-medium text-risk">
              {deletionView(org.deletion_scheduled_at).headline}, on{" "}
              {shortDate(org.deletion_scheduled_at)}. It can still be cancelled.
            </p>
          )}
        </div>

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

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">People ({members.length})</h2>
          <ul className="divide-y divide-border/60 panel-inset text-sm">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2">
                <span className="font-medium">{m.email}</span>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {m.role}
                </span>
                {m.name && <span className="text-muted-foreground">{m.name}</span>}
                {m.aliases.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    also signs in as {m.aliases.join(", ")}
                  </span>
                )}
              </li>
            ))}
            {members.length === 0 && (
              <li className="px-4 py-4 text-muted-foreground">Nobody is on this account.</li>
            )}
          </ul>
        </section>

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
          canImpersonate={
            Boolean(org.owner_user_id) &&
            org.owner_user_id !== auth.id &&
            !isPlatformAdmin(org.owner_email ?? "")
          }
        />

        <PlatformKeyGrants
          orgId={org.id}
          orgName={org.name}
          states={keyStates}
          isTrial={org.access === "trial"}
        />

        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Admin history for this account</h2>
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
        </section>
      </div>
    </>
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
