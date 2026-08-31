import Link from "next/link";
import { DetailDrawer, DrawerFact, DrawerSection } from "@/components/detail-drawer";
import { activityOf } from "@/lib/domain/account-activity";
import { shortDate } from "@/lib/format";
import type { AdminAccountRow } from "@/lib/admin/accounts";

const ACCESS_LABEL: Record<string, { text: string; tone: string }> = {
  full: { text: "Full access", tone: "bg-pursue/15 text-pursue" },
  trial: { text: "Trial", tone: "bg-review/15 text-review" },
  none: { text: "Locked out", tone: "bg-risk/15 text-risk" },
};

/**
 * One account, read without leaving the table.
 *
 * A support question is nearly always "what is going on with this one", and
 * answering it meant leaving a filtered, sorted table for a record page and
 * coming back to a table that had forgotten both the filter and the row.
 *
 * Read-only on purpose. Everything that CHANGES an account -- comping it,
 * suspending it, scheduling a deletion, signing in as somebody -- is on the
 * record page behind a confirmation, and none of those belong on a control an
 * administrator reaches while scanning a list. This answers the question; the
 * record page is where you act on the answer.
 */
export function AdminAccountPeek({
  account,
  closeHref,
  nav,
}: {
  account: AdminAccountRow;
  closeHref: string;
  nav?: {
    prevHref: string | null;
    nextHref: string | null;
    index: number;
    total: number;
  };
}) {
  const access = ACCESS_LABEL[account.access] ?? {
    text: account.access,
    tone: "bg-muted text-muted-foreground",
  };
  const activity = activityOf(account.last_active_at, account.created_at);

  return (
    <DetailDrawer
      title={account.name}
      subtitle={account.owner_email ?? "No owner on this account"}
      closeHref={closeHref}
      openHref={`/admin/accounts/${account.id}`}
      openLabel="Open the account"
      nav={nav}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/admin/accounts/${account.id}`} className="btn-ghost text-xs">
            Everything about this account
          </Link>
          {nav?.nextHref && (
            <Link href={nav.nextHref} className="btn-primary ml-auto text-xs">
              Next account
            </Link>
          )}
        </div>
      }
    >
      <DrawerSection title="What they can actually do">
        <DrawerFact
          label="Access"
          value={<span className={`badge ${access.tone}`}>{access.text}</span>}
          hint="What the product will let them do right now, which is not always what Stripe says."
        />
        <DrawerFact
          label="Stripe status"
          value={account.subscription_status}
          unknown="No subscription on file"
        />
        <DrawerFact label="Plan" value={account.plan_key} unknown="None" />
        <DrawerFact
          label="Trial ends"
          value={account.trial_ends_at ? shortDate(account.trial_ends_at) : null}
          unknown="Not on a trial"
        />
      </DrawerSection>

      <DrawerSection title="Anything holding it open or shut">
        <DrawerFact
          label="Comped"
          value={account.billing_exempt ? "Yes" : null}
          unknown="No"
          hint={account.billing_exempt_reason ?? undefined}
        />
        <DrawerFact
          label="Suspended"
          value={account.suspended_at ? shortDate(account.suspended_at) : null}
          unknown="No"
          hint={account.suspended_reason ?? undefined}
        />
        <DrawerFact
          label="Deletion scheduled"
          value={
            account.deletion_scheduled_at ? shortDate(account.deletion_scheduled_at) : null
          }
          unknown="No"
          hint={account.deletion_reason ?? undefined}
        />
        <DrawerFact
          label="Discount"
          value={
            account.discount_code ??
            account.pending_concession_label ??
            account.pending_concession_code
          }
          unknown="None"
          hint={
            account.discount_ends_at
              ? `Runs out ${shortDate(account.discount_ends_at)}`
              : undefined
          }
        />
      </DrawerSection>

      <DrawerSection title="Who and when">
        <DrawerFact label="Owner" value={account.owner_name ?? account.owner_email} unknown="Nobody" />
        <DrawerFact label="People on it" value={String(account.member_count)} />
        <DrawerFact label="Joined" value={shortDate(account.created_at)} />
        <DrawerFact
          label="Last real sign-in"
          value={
            activity.state === "never" ? null : `${activity.daysSince} days ago`
          }
          unknown="Nobody has ever signed in"
          hint={activity.meaning}
        />
        <DrawerFact label="Kind" value={account.classification} />
      </DrawerSection>

      <DrawerSection title="Stripe">
        <DrawerFact
          label="Customer"
          value={account.stripe_customer_id}
          unknown="Never reached checkout"
        />
        <DrawerFact
          label="Subscription"
          value={account.stripe_subscription_id}
          unknown="None"
        />
      </DrawerSection>
    </DetailDrawer>
  );
}
