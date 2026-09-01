import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { RecapView } from "@/components/recap-view";
import { RecapDayPicker } from "@/components/recap-day-picker";
import { OppPeek } from "@/components/opp-peek";
import { SubPeek } from "@/components/sub-peek";
import { oppPeek, subPeek } from "@/lib/data";
import { parsePeekParam } from "@/lib/domain/search-results";
import { currentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { can } from "@/lib/domain/roles";
import {
  addLocalDays,
  localDateOf,
  localDayLabel,
  parseLocalDate,
  safeTimeZone,
} from "@/lib/domain/recap/day-window";
import { buildRecapFor } from "@/lib/recap/build";
import { getRecapSettings, getUserRecapPreference } from "@/lib/recap/settings";

export const dynamic = "force-dynamic";

/**
 * The recap, in the app.
 *
 * The email is a copy of this, not the other way round. Somebody who deleted
 * the mail, was added to the account last week, or simply prefers to look
 * rather than be told, gets the same eight sections and the same numbers here,
 * built by the same code, for any day they choose.
 *
 * Which day is decided in the reader's own zone, so "yesterday" means the
 * twenty-four hours they lived through rather than the server's.
 *
 * Viewing never ages the urgent list. Opening this page twice must not make
 * yesterday's problem two days old in tomorrow's mail.
 */
export default async function RecapPage({
  searchParams,
}: {
  searchParams?: { date?: string; peek?: string };
}) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/today");

  const orgId = user.organizationId;
  const pref = await getUserRecapPreference(user.id).catch(() => null);
  const timezone = safeTimeZone(pref?.timezone ?? null);

  const today = localDateOf(new Date(), timezone);
  const yesterday = addLocalDays(today, -1);
  const requested = searchParams?.date;
  const localDate = requested && parseLocalDate(requested) ? requested : yesterday;

  /*
   * How far back the picker allows. The account's first record, not an
   * arbitrary thirty days: an account that started last Tuesday should not be
   * offered three weeks of guaranteed-empty pages, and one that started two
   * years ago should not be stopped at a month.
   */
  const first = await queryOne<{ d: string | null }>(
    `select min(created_at)::date::text as d from opportunities where org_id = $1`,
    [orgId]
  ).catch(() => null);
  const earliest = first?.d ?? addLocalDays(today, -30);

  const settings = await getRecapSettings(orgId);
  const { recap } = await buildRecapFor({
    orgId,
    localDate,
    timezone,
    settings,
    recordAges: false,
  });

  const isToday = localDate === today;
  const canManage = can(user.orgRole, "manage_rules");

  /*
   * The open preview, as a query parameter.
   *
   * Every row in a recap points somewhere else, across nine destinations, so
   * finding out what one is about cost the page and the recap did not remember
   * where you were in it. The drawer answers it in place, and the day stays in
   * the URL beside it so a preview is still a link somebody can send.
   *
   * The kinds are the organization-scoped two. The platform recap passes
   * `["account"]` instead, and the loaders enforce it again: oppPeek and
   * subPeek both scope to the current organization.
   */
  const peek = parsePeekParam(searchParams?.peek);
  const [peekedOpp, peekedSub] = await Promise.all([
    peek?.kind === "opportunity" ? oppPeek(peek.id) : Promise.resolve(null),
    peek?.kind === "subcontractor" ? subPeek(peek.id) : Promise.resolve(null),
  ]);
  const peekHref = (value: string | null) => {
    const p = new URLSearchParams();
    if (requested) p.set("date", localDate);
    if (value) p.set("peek", value);
    const q = p.toString();
    return q ? `/recap?${q}` : "/recap";
  };

  return (
    <>
      <PageFrame
        title="Daily Recap"
        explanation="Everything that happened on one day, in the order it matters: what needs you, what broke, what moved, and what is due next."
        breadcrumbs={[{ label: "Performance", href: "/analytics" }]}
        status={
          recap.urgentCount > 0
            ? `${recap.urgentCount} urgent`
            : recap.quiet
              ? "A quiet day"
              : "Nothing urgent"
        }
        primaryAction={
          canManage ? (
            <Link href="/settings/recap" className="btn-secondary text-xs">
              Recap settings
            </Link>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="scroll-thin min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow-gold">{isToday ? "Today so far" : "Recap for"}</p>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {localDayLabel(localDate, timezone)}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Counted in {timezone}
              {pref?.timezoneIsDefault
                ? ", the default. Set your own on your account page so the day matches yours."
                : ", your own time zone."}
            </p>
          </div>
          <RecapDayPicker
            value={localDate}
            today={today}
            yesterday={yesterday}
            earliest={earliest}
          />
        </div>

        <RecapView
          recap={recap}
          peekHref={(v) => peekHref(v)}
          openPeek={searchParams?.peek ?? null}
        />
      </div>

      {peekedOpp && <OppPeek data={peekedOpp} closeHref={peekHref(null)} />}
      {peekedSub && (
        <SubPeek
          sub={peekedSub}
          closeHref={peekHref(null)}
          canManage={can(user.orgRole, "manage_subs")}
        />
      )}
      </div>
    </>
  );
}
