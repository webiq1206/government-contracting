/**
 * Plain-language reading of a paid-AI block.
 *
 * Daily request caps, monthly dollar budgets, pauses, and the platform
 * allowance are different stops. Copy here has to name the one that actually
 * fired, when it resets, and the Settings path that changes it. Raising the
 * monthly budget does not clear a daily request cap, and this module must
 * never say that it does.
 */

export type SpendingLimitKind =
  | "account_daily_requests"
  | "platform_daily_requests"
  | "paused"
  | "daily_dollars"
  | "monthly_dollars"
  | "unknown_costs"
  | "price_ceiling"
  | "generic";

export interface SpendingNotice {
  blocked: true;
  kind: SpendingLimitKind;
  title: string;
  detail: string;
  actionLabel: string;
  actionHref: string;
}

export interface SpendingFacts {
  dayRequests: number;
  /** Null means this account has no daily request cap. */
  dailyRequestLimit: number | null;
  paused: boolean;
  daySpend: number;
  dailyDollarLimit: number | null;
  monthSpend: number;
  monthlyDollarLimit: number | null;
  unknownCosts: number;
  platformDayRequests: number;
  platformDailyLimit: number | null;
  /** False when this account's paid calls use its own key, so the platform cap does not apply. */
  usesPlatformKey: boolean;
}

const SETTINGS = "/settings/api-usage";

/** The account daily-request refusal. Kept identical to the ledger sentence. */
export function accountDailyRequestBlock(limit: number): string {
  return `API_BUDGET: You reached today's request limit of ${limit}. It resets at midnight UTC. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.`;
}

/** The platform daily-request refusal. Kept identical to the ledger sentence. */
export function platformRequestCapMessage(): string {
  return "API_BUDGET: The platform's daily request allowance has been reached. New paid work is on hold. Ask the platform administrator to review API Usage limits, or wait until midnight UTC.";
}

export function pausedApiBlockMessage(): string {
  return "API_BUDGET: You paused API use. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.";
}

/** Admission could not take the ledger lock in time. Nothing was reserved. */
export function admissionBusyMessage(): string {
  return "API_BUDGET: The usage ledger is busy, so this paid call was not started. Nothing was charged. Try again in a moment. Open Settings, API Usage if this keeps happening. This wait is separate from the daily request limit and the monthly budget.";
}

function notice(
  kind: SpendingLimitKind,
  title: string,
  detail: string,
  actionLabel: string,
): SpendingNotice {
  return { blocked: true, kind, title, detail, actionLabel, actionHref: SETTINGS };
}

function whole(value: number): string {
  return String(Math.max(0, Math.trunc(value)));
}

function usd(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function requestCounts(used: number | undefined, ceiling: number | undefined): string {
  if (used == null || ceiling == null) return "";
  const remaining = Math.max(0, ceiling - used);
  return `${whole(used)} of ${whole(ceiling)} paid requests used today (${whole(remaining)} remaining, ceiling ${whole(ceiling)}). `;
}

function dollarCounts(used: number | undefined, ceiling: number | undefined, label: string): string {
  if (used == null || ceiling == null) return "";
  const remaining = Math.max(0, ceiling - used);
  return `$${usd(used)} of $${usd(ceiling)} ${label} ($${usd(remaining)} remaining, ceiling $${usd(ceiling)}). `;
}

function dailyRequestNotice(
  used?: number,
  ceiling?: number,
  monthly?: { spend: number; limit: number } | null,
): SpendingNotice {
  const month =
    monthly && monthly.limit > 0
      ? ` Monthly budget is $${usd(monthly.spend)} of $${usd(monthly.limit)} ($${usd(Math.max(0, monthly.limit - monthly.spend))} remaining) and is not this stop.`
      : "";
  return notice(
    "account_daily_requests",
    "Paid AI stopped at today's request limit",
    `${requestCounts(used, ceiling)}This account reached its daily request limit. It resets at midnight UTC. Open Settings, API Usage to review or change that daily limit. Raising the monthly budget does not clear a daily request limit.${month}`,
    "Review daily request limit",
  );
}

function platformNotice(used?: number, ceiling?: number): SpendingNotice {
  return notice(
    "platform_daily_requests",
    "Paid AI stopped at the platform daily allowance",
    `${requestCounts(used, ceiling)}The platform's daily request allowance has been reached. It resets at midnight UTC. Ask the platform administrator to review API Usage limits. Raising this account's monthly budget does not clear that daily allowance.`,
    "Open API Usage",
  );
}

function pausedNotice(facts?: Pick<SpendingFacts, "dayRequests" | "dailyRequestLimit" | "monthSpend" | "monthlyDollarLimit">): SpendingNotice {
  const requests =
    facts?.dailyRequestLimit != null
      ? ` Daily requests are ${whole(facts.dayRequests)} of ${whole(facts.dailyRequestLimit)} (${whole(facts.dailyRequestLimit - facts.dayRequests)} remaining, ceiling ${whole(facts.dailyRequestLimit)}).`
      : "";
  const month =
    facts?.monthlyDollarLimit != null
      ? ` Monthly budget is $${usd(facts.monthSpend)} of $${usd(facts.monthlyDollarLimit)} ($${usd(Math.max(0, facts.monthlyDollarLimit - facts.monthSpend))} remaining).`
      : "";
  return notice(
    "paused",
    "Paid AI is paused",
    `API use is paused for this account.${requests}${month} A pause is separate from the daily request limit and the monthly budget. Open Settings, API Usage to resume paid work.`,
    "Review API pause",
  );
}

function dailyDollarNotice(used?: number, ceiling?: number): SpendingNotice {
  return notice(
    "daily_dollars",
    "Paid AI stopped at today's dollar limit",
    `${dollarCounts(used, ceiling, "spent or reserved today")}Today's dollar allowance cannot cover another paid request. It resets at midnight UTC. Open Settings, API Usage to review the daily dollar limit. This stop is separate from the daily request count, and raising the monthly budget does not clear today's dollar limit.`,
    "Review daily dollar limit",
  );
}

function monthlyNotice(used?: number, ceiling?: number): SpendingNotice {
  return notice(
    "monthly_dollars",
    "Paid AI stopped at the monthly budget",
    `${dollarCounts(used, ceiling, "spent or reserved this month")}The monthly dollar budget cannot cover another paid request. It resets at midnight UTC on the first day of next month. Open Settings, API Usage to review the monthly budget. Changing the daily request limit does not raise the monthly budget.`,
    "Review monthly budget",
  );
}

function unknownNotice(): SpendingNotice {
  return notice(
    "unknown_costs",
    "Paid AI is waiting on unconfirmed costs",
    "Earlier requests are still awaiting confirmation of their cost, so a dollar allowance cannot admit more paid work. Open Settings, API Usage to review the unresolved charges. This is not cleared by changing the daily request limit.",
    "Review API Usage",
  );
}

function ceilingNotice(): SpendingNotice {
  return notice(
    "price_ceiling",
    "Paid AI needs a price ceiling",
    "This service needs a price ceiling before a dollar limit can protect spending. Ask the platform administrator to set one, or set a request-count limit under Settings, API Usage.",
    "Open API Usage",
  );
}

function admissionBusyNotice(): SpendingNotice {
  return notice(
    "generic",
    "Paid AI is waiting on the usage ledger",
    "The usage ledger is busy, so this paid call was not started and nothing was charged. Try again in a moment. Open Settings, API Usage if this keeps happening. This wait is separate from the daily request limit and the monthly budget.",
    "Open API Usage",
  );
}

function genericNotice(): SpendingNotice {
  return notice(
    "generic",
    "Paid AI is blocked by a usage limit",
    "New paid work is stopped by an API usage limit. Open Settings, API Usage to see which limit applies and when it resets. Do not assume raising the monthly budget clears a daily request limit.",
    "Open API Usage",
  );
}

function textOf(message: string): string {
  return message.toLowerCase().replace(/’/g, "'");
}

/** Classify a ledger or log sentence. Null when the text is not a paid-AI block. */
export function noticeForBudgetMessage(message: string | null | undefined): SpendingNotice | null {
  if (!message?.trim()) return null;
  const text = textOf(message);
  const budgetish =
    /api_budget:|api use is paused|you paused api use|api limit cannot cover|maximum request cost|hard dollar limit|request allowance|request limit|price ceiling|awaiting confirmation/.test(
      text,
    );
  if (!budgetish) return null;
  const requestCap = /request limit of (\d+)/i.exec(message);
  const money = /\$([0-9]+(?:\.[0-9]+)?) is spent or reserved against a \$([0-9]+(?:\.[0-9]+)?) limit/i.exec(message);
  const spent = money ? Number(money[1]) : undefined;
  const capAmount = money ? Number(money[2]) : undefined;
  if (/usage ledger is busy/.test(text)) return admissionBusyNotice();
  if (/platform's daily request allowance/.test(text)) {
    const ceiling = requestCap ? Number(requestCap[1]) : undefined;
    return platformNotice(ceiling, ceiling);
  }
  if (/today's request limit|reached its daily request limit/.test(text)) {
    const ceiling = requestCap ? Number(requestCap[1]) : undefined;
    return dailyRequestNotice(ceiling, ceiling);
  }
  if (/you paused api use|api use is paused/.test(text)) return pausedNotice();
  if (/daily allowance cannot cover|today's dollar allowance cannot cover/.test(text)) return dailyDollarNotice(spent, capAmount);
  if (/monthly allowance cannot cover|monthly dollar budget|this month against/.test(text)) return monthlyNotice(spent, capAmount);
  if (/awaiting confirmation/.test(text)) return unknownNotice();
  if (/price ceiling|maximum request cost|hard dollar limit/.test(text)) return ceilingNotice();
  if (/daily request limit/.test(text) && !/does not raise the monthly budget/.test(text)) return dailyRequestNotice();
  if (/api_budget:/.test(text)) return genericNotice();
  return null;
}

/**
 * Which limit is binding right now.
 *
 * Account daily requests win over the platform allowance, a pause, dollar
 * caps, and unfinished charges. Unconfirmed costs were a red herring when
 * the request counter was already full.
 */
export function noticeForFacts(facts: SpendingFacts): SpendingNotice | null {
  if (
    facts.dailyRequestLimit != null &&
    facts.dayRequests >= facts.dailyRequestLimit
  ) {
    return dailyRequestNotice(facts.dayRequests, facts.dailyRequestLimit, {
      spend: facts.monthSpend,
      limit: facts.monthlyDollarLimit ?? 0,
    });
  }
  if (
    facts.usesPlatformKey &&
    facts.platformDailyLimit != null &&
    facts.platformDayRequests >= facts.platformDailyLimit
  ) {
    return platformNotice(facts.platformDayRequests, facts.platformDailyLimit);
  }
  if (facts.paused) return pausedNotice(facts);
  if (
    facts.dailyDollarLimit != null &&
    facts.dailyDollarLimit > 0 &&
    facts.daySpend >= facts.dailyDollarLimit
  ) {
    return dailyDollarNotice(facts.daySpend, facts.dailyDollarLimit);
  }
  if (
    facts.monthlyDollarLimit != null &&
    facts.monthlyDollarLimit > 0 &&
    facts.monthSpend >= facts.monthlyDollarLimit
  ) {
    return monthlyNotice(facts.monthSpend, facts.monthlyDollarLimit);
  }
  if (
    facts.unknownCosts > 0 &&
    ((facts.dailyDollarLimit != null && facts.dailyDollarLimit > 0) ||
      (facts.monthlyDollarLimit != null && facts.monthlyDollarLimit > 0))
  ) {
    return unknownNotice();
  }
  return null;
}

/** A string health classification already understands, for the limit that is binding. */
export function blockMessageForFacts(facts: SpendingFacts): string | null {
  const notice = noticeForFacts(facts);
  if (!notice) return null;
  const spent = (value: number) => value.toFixed(2);
  switch (notice.kind) {
    case "account_daily_requests":
      return accountDailyRequestBlock(facts.dailyRequestLimit ?? 0);
    case "platform_daily_requests":
      return platformRequestCapMessage();
    case "paused":
      return pausedApiBlockMessage();
    case "daily_dollars":
      return `API_BUDGET: Your daily allowance cannot cover another request: $${spent(facts.daySpend)} is spent or reserved against a $${spent(facts.dailyDollarLimit ?? 0)} limit. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.`;
    case "monthly_dollars":
      return `API_BUDGET: Your monthly allowance cannot cover another request: $${spent(facts.monthSpend)} is spent or reserved against a $${spent(facts.monthlyDollarLimit ?? 0)} limit. New paid work has stopped to protect your budget. Open Settings, API Usage to review limits or resume work.`;
    case "unknown_costs":
      return `API_BUDGET: ${facts.unknownCosts} earlier request${facts.unknownCosts === 1 ? " is" : "s are"} still awaiting confirmation of ${facts.unknownCosts === 1 ? "its" : "their"} cost, so your allowance cannot admit more paid work while the evidence remains unresolved. Review API Usage; unverified costs remain held.`;
    default:
      return "API_BUDGET: New paid work has stopped. Open Settings, API Usage to review limits or resume work.";
  }
}

/**
 * What a reply card should say when the assistant stopped because of a limit.
 * Idempotent: a reason that is already this sentence comes back unchanged.
 * Never describes the stop as a pattern match.
 */
export function spendingHoldCopy(text: string | null | undefined): string | null {
  const found = noticeForBudgetMessage(text);
  if (!found) return null;
  const sentence = `${found.detail} Confirm what this reply meant. Nothing was decided for you.`;
  return text?.includes("Nothing was decided for you.") && text.includes(found.detail)
    ? text
    : sentence;
}
