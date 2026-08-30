import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { RecapView } from "@/components/recap-view";
import { RecapDayPicker } from "@/components/recap-day-picker";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  addLocalDays,
  dayWindow,
  localDateOf,
  localDayLabel,
  parseLocalDate,
  safeTimeZone,
} from "@/lib/domain/recap/day-window";
import { getUserRecapPreference } from "@/lib/recap/settings";
import { buildPlatformRecap, gatherPlatformFacts } from "@/lib/recap/platform";

export const dynamic = "force-dynamic";

/**
 * The platform's own recap.
 *
 * Platform Health answers "is it working right now". This answers "what
 * happened yesterday, and to whom": broken integrations, failing jobs, mail
 * that did not arrive, and accounts that have gone silent, each named with the
 * account it belongs to.
 *
 * Admin only, and 404 for everybody else: this page names other people's
 * accounts, so the surface should not even be discoverable from a customer
 * session.
 */
export default async function PlatformRecapPage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();

  const pref = await getUserRecapPreference(auth.id).catch(() => null);
  const timezone = safeTimeZone(pref?.timezone ?? null);

  const now = new Date();
  const today = localDateOf(now, timezone);
  const yesterday = addLocalDays(today, -1);
  const requested = searchParams?.date;
  const localDate = requested && parseLocalDate(requested) ? requested : yesterday;

  const window = dayWindow(localDate, timezone);
  const facts = await gatherPlatformFacts(window.start, window.end);
  const recap = buildPlatformRecap(facts, {
    localDate,
    timezone,
    now,
    partial: localDate === today,
  });

  return (
    <>
      <PageFrame
        title="Platform Recap"
        explanation="What happened across every account on one day: what broke, whose mail did not arrive, and who has gone quiet."
        breadcrumbs={[{ label: "Admin", href: "/admin/health" }]}
        status={
          recap.urgentCount > 0 ? `${recap.urgentCount} needing attention` : "Nothing urgent"
        }
        primaryAction={
          <Link href="/admin/health" className="btn-secondary text-xs">
            Platform health
          </Link>
        }
      />
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow-gold">Across every account</p>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {localDayLabel(localDate, timezone)}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Counted in {timezone}</p>
          </div>
          <RecapDayPicker
            value={localDate}
            today={today}
            yesterday={yesterday}
            earliest={addLocalDays(today, -90)}
          />
        </div>

        <RecapView recap={recap} />
      </div>
    </>
  );
}
