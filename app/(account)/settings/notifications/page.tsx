import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { currentUser } from "@/lib/auth";
import { getOrganization } from "@/lib/organizations";
import { adminAccountMembers } from "@/lib/admin/accounts";
import { config } from "@/lib/config";
import { systemMail } from "@/lib/integrations/system-mail";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";
import {
  categoryStatuses,
  deliverySummary,
  type CategoryStatus,
} from "@/lib/domain/notification-prefs";

export const dynamic = "force-dynamic";

/**
 * What this account is told, and what it is not.
 *
 * The audit asks for notification preferences separating eight kinds of alert
 * and explaining which critical ones cannot be switched off. Building that as
 * a page of toggles would have been the easy half and the dishonest one,
 * because most of these messages are not sent to a customer at all: every
 * digest is gated on the operations organization and one deployment-wide
 * address. A switch that turns off something already silent is a promise the
 * product does not keep, and the operator finds out on the day the message
 * they relied on does not arrive.
 *
 * So this states delivery as it is. Where a preference would be honoured it is
 * offered; where nothing is sent, the page says so and points at the screen
 * that does carry the information.
 */
export default async function NotificationSettingsPage() {
  const user = await currentUser().catch(() => null);
  const org = user?.organizationId ? await getOrganization(user.organizationId) : null;
  const members = org ? await adminAccountMembers(org.id).catch(() => []) : [];
  const owner = members.find((m) => m.role === "owner") ?? members[0] ?? null;

  const statuses = categoryStatuses({
    isOperationsOrg: org?.id === LEGACY_ORG_ID,
    hasOperationsAddress: Boolean(config.systemMail.digestTo),
    mailEnabled: await systemMail.enabled().catch(() => false),
    ownerEmail: owner?.email ?? null,
  });
  const summary = deliverySummary(statuses);
  const emailed = statuses.filter((s) => s.reachesAccount);

  return (
    <>
      <PageFrame
        title="Notifications"
        explanation="Which alerts reach you by email, which live only in the product, and which cannot be switched off."
        breadcrumbs={[{ label: "Settings", href: "/settings/profile" }]}
        status={
          emailed.length === 0
            ? "No email reaches this account"
            : `${emailed.length} of ${statuses.length} kinds emailed`
        }
      />
      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5">
        <div className="callout-panel max-w-3xl text-sm leading-relaxed text-slate-700">
          <p>{summary}</p>
          <p className="mt-2 text-xs text-slate-600">
            This page describes what actually happens rather than offering switches. A
            control that turns off a message nobody sends would be a promise this product
            does not keep, and the way you would find out is the day you needed it.
          </p>
        </div>

        <ul className="max-w-3xl space-y-3">
          {statuses.map((s) => (
            <li key={s.key}>
              <Category status={s} />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Category({ status }: { status: CategoryStatus }) {
  // A mandatory alert that is not being delivered is the most dangerous state
  // on this page, so it is the loudest.
  const tone = status.deliveryGap
    ? "border-risk/50 bg-risk/5"
    : status.route === "account_owner"
      ? "border-pursue/40 bg-pursue/5"
      : status.route === "not_sent"
        ? "border-border bg-surface"
        : "border-review/40 bg-review/5";

  return (
    <article className={`rounded-md border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{status.label}</h2>
        <span
          className={`badge ${
            status.deliveryGap
              ? "bg-risk/15 text-risk"
              : status.route === "account_owner"
                ? "bg-pursue/15 text-pursue"
                : status.route === "not_sent"
                  ? "bg-slate-200 text-slate-600"
                  : "bg-review/15 text-review"
          }`}
        >
          {status.deliveryGap
            ? "Not reaching you"
            : status.route === "account_owner"
              ? "Emailed to you"
            : status.route === "operations_address"
              ? "Emailed elsewhere"
              : status.route === "not_sent"
                ? "Not produced"
                : "In the product only"}
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{status.covers}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{status.statement}</p>
      {status.canDisable ? (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          {status.reachesAccount
            ? "Can be switched off."
            : "There is nothing to switch off while this is not being sent."}
        </p>
      ) : status.deliveryGap ? (
        <p className="mt-1.5 text-xs leading-relaxed text-risk">
          <span className="label mr-1.5 inline">Not reaching you:</span>
          This cannot be switched off and is also not being delivered, so nobody is told.{" "}
          {status.whyMandatory}
        </p>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          <span className="label mr-1.5 inline">Always on:</span>
          {status.whyMandatory}
        </p>
      )}
      {status.inAppAt && (
        <Link
          href={status.inAppAt.href}
          className="tap mt-2 inline-flex text-xs font-medium text-accent hover:underline"
        >
          Open {status.inAppAt.label}
        </Link>
      )}
    </article>
  );
}
