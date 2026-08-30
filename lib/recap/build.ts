/**
 * One recap, assembled.
 *
 * The single door both surfaces come through: the morning email and the page
 * in the app call this and render what comes back. That is the whole reason it
 * exists. Two code paths producing "the same" recap would drift within a
 * month, and the first anybody would know of it is somebody acting on a page
 * that disagrees with the mail they were sent.
 *
 * The one difference between the two callers is aging. Sending records that an
 * urgent item was shown this morning; viewing must not, or opening the page
 * twice would age yesterday's problem past what the mail said.
 */
import { runWithOrg } from "../tenant-context";
import {
  dayWindow,
  localDayLabel,
  localDateOf,
  safeTimeZone,
} from "../domain/recap/day-window";
import { buildRecap, collectUrgent } from "../domain/recap/sections";
import type { Recap, RecapFacts, RecapSettings } from "../domain/recap/types";
import { gatherRecapFacts } from "./gather";
import { recordUrgentItems, urgentAges } from "./delivery";

export interface BuildInput {
  orgId: string;
  /** The local day to summarise, "YYYY-MM-DD". */
  localDate: string;
  timezone: string;
  settings: RecapSettings;
  /** Now. Injected so tests and previews can stand somewhere else in time. */
  now?: Date;
  /**
   * Record that today's urgent items were shown. True for a real send, false
   * everywhere else, including previews and test sends: a rehearsal must not
   * age the list the real mail will report on.
   */
  recordAges?: boolean;
}

export interface BuiltRecap {
  recap: Recap;
  facts: RecapFacts;
}

export async function buildRecapFor(input: BuildInput): Promise<BuiltRecap> {
  const now = input.now ?? new Date();
  const timezone = safeTimeZone(input.timezone);
  const { start, end } = dayWindow(input.localDate, timezone);

  /*
   * A day that has not finished yet.
   *
   * The page can ask for "today so far", and then the window's end is in the
   * future. The totals are still true, they are just not final, and the recap
   * says so rather than presenting a half day as a whole one.
   */
  const partial = end.getTime() > now.getTime();

  /*
   * Every query runs inside the tenant context as well as carrying the org id.
   * The id on each statement is what actually scopes the data; this is the
   * belt to that pair of braces, so any helper reached from here that resolves
   * the tenant from context resolves it to the same account rather than to
   * whichever one the worker happened to touch last.
   */
  const facts = await runWithOrg(input.orgId, () =>
    gatherRecapFacts({
      orgId: input.orgId,
      start,
      end,
      now,
      settings: input.settings,
    })
  );

  // Urgency is decided before ages are known, then the ages are attached. The
  // keys have to come from the same function the build uses, or an item could
  // be aged under one rule and displayed under another.
  const keys = collectUrgent(facts, input.settings, now).map((i) => i.key);
  const problemKeys = facts.problems.map((p) => p.key);
  const allKeys = [...keys, ...problemKeys];

  const ages =
    input.recordAges === true
      ? await recordUrgentItems(input.orgId, allKeys, input.localDate).catch(() => ({}))
      : await urgentAges(input.orgId, allKeys, input.localDate).catch(() => ({}));

  const recap = buildRecap(facts, input.settings, {
    scope: "org",
    localDate: input.localDate,
    timezone,
    dayLabel: localDayLabel(input.localDate, timezone),
    now,
    ages,
    partial,
  });

  return { recap, facts };
}

/** The day a recap sent this morning covers: the one that just finished. */
export function dayToSummarise(now: Date, timezone: string): string {
  const tz = safeTimeZone(timezone);
  const today = localDateOf(now, tz);
  const [y, m, d] = today.split("-").map((n) => Number(n));
  const previous = new Date(Date.UTC(y!, m! - 1, d!));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}
