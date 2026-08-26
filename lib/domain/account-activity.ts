/**
 * Whether anybody from an account has actually used it.
 *
 * A platform admin list showed access, plan and subscription status, and
 * nothing at all about use. Those three are the same for an account that
 * signed up this morning, an account working every day, and an account paying
 * a monthly fee that nobody has signed into since March. They are very
 * different accounts, and only one of them needs a phone call.
 *
 * The distinction that matters most is between never and not lately. An
 * account nobody has ever signed into is a failed onboarding: something in the
 * welcome email, the invitation or the first screen did not work, and it is
 * recoverable. An account that was used and stopped is churn already under
 * way. Collapsing them into "inactive" loses the only part that says what to
 * do.
 */

export type ActivityState = "never" | "dormant" | "quiet" | "active";

export interface ActivityView {
  state: ActivityState;
  label: string;
  /** What it suggests, for somebody deciding whether to make contact. */
  meaning: string;
  /** Days since the last sign-in, or null when there has never been one. */
  daysSince: number | null;
  /** Whether it is worth an administrator's attention. */
  attention: boolean;
}

/** Not seen for this long, and the account is going quiet rather than merely resting. */
export const DORMANT_DAYS = 30;
/** A gap worth noticing, but not yet worth acting on. */
export const QUIET_DAYS = 7;

const DAY = 86_400_000;

function days(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY);
}

function asDate(v: Date | string | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function activityOf(
  lastActiveAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined,
  now = new Date()
): ActivityView {
  const last = asDate(lastActiveAt);
  const created = asDate(createdAt);

  if (!last) {
    const age = created ? days(created, now) : null;
    return {
      state: "never",
      label: "Never signed in",
      // An account created an hour ago has not failed at anything yet, and
      // telling an administrator to chase it would waste both their time.
      meaning:
        age == null
          ? "Nobody has signed in, and there is no signup date to judge that against."
          : age <= 1
            ? "Signed up today and has not signed in yet, which is normal for the first few hours."
            : `Signed up ${age} days ago and nobody has ever signed in. Something in the welcome email or the first screen did not work.`,
      daysSince: null,
      attention: age != null && age > 1,
    };
  }

  const since = days(last, now);
  if (since >= DORMANT_DAYS) {
    return {
      state: "dormant",
      label: `Last signed in ${since} days ago`,
      meaning:
        "This account was used and stopped. If it is still being charged, that is a cancellation waiting to happen.",
      daysSince: since,
      attention: true,
    };
  }
  if (since >= QUIET_DAYS) {
    return {
      state: "quiet",
      label: `Last signed in ${since} days ago`,
      meaning: "A normal gap for a contractor between bids, but worth watching if it lengthens.",
      daysSince: since,
      attention: false,
    };
  }
  return {
    state: "active",
    label: since <= 0 ? "Signed in today" : `Last signed in ${since} day${since === 1 ? "" : "s"} ago`,
    meaning: "In regular use.",
    daysSince: since,
    attention: false,
  };
}

export const ACTIVITY_FILTERS: { value: ActivityState; label: string }[] = [
  { value: "never", label: "Never signed in" },
  { value: "dormant", label: `Dormant (${DORMANT_DAYS}+ days)` },
  { value: "quiet", label: `Quiet (${QUIET_DAYS}+ days)` },
  { value: "active", label: "In regular use" },
];
