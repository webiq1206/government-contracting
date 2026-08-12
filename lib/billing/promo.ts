/**
 * Founding customer promotion: $497/mo locked for life of the subscription.
 * Window is 5 days from go-live. Ends_at is stored in app_settings and is
 * never a hardcoded "5 days remaining" string in the UI.
 */
import { query, queryOne } from "../db";

const SETTINGS_KEY = "founding_promo";
const DEFAULT_DURATION_DAYS = 5;

export interface PromoWindow {
  active: boolean;
  startedAt: string | null;
  endsAt: string | null;
  durationDays: number;
  /** Whole milliseconds remaining (0 when expired). */
  remainingMs: number;
}

interface PromoJson {
  ends_at?: string | null;
  started_at?: string | null;
  duration_days?: number;
}

/**
 * Read (and lazily start) the founding promo window.
 * First call with no ends_at starts the clock: now + duration_days.
 * Pass `startIfMissing: false` on read-only paths that should not start the promo.
 */
export async function getFoundingPromo(opts?: {
  startIfMissing?: boolean;
}): Promise<PromoWindow> {
  const startIfMissing = opts?.startIfMissing !== false;
  const row = await queryOne<{ value_json: PromoJson }>(
    `select value_json from app_settings where key = $1`,
    [SETTINGS_KEY]
  ).catch(() => null);

  let startedAt = row?.value_json?.started_at ?? null;
  let endsAt = row?.value_json?.ends_at ?? null;
  const durationDays = Number(row?.value_json?.duration_days) || DEFAULT_DURATION_DAYS;

  // Env override wins (ops can pin an exact end timestamp without migrating).
  const envEnd = process.env.FOUNDING_PROMO_ENDS_AT?.trim();
  if (envEnd) {
    const d = new Date(envEnd);
    if (!Number.isNaN(d.getTime())) {
      endsAt = d.toISOString();
      if (!startedAt) {
        startedAt = new Date(d.getTime() - durationDays * 86_400_000).toISOString();
      }
    }
  }

  if (!endsAt && startIfMissing) {
    const start = new Date();
    const end = new Date(start.getTime() + durationDays * 86_400_000);
    startedAt = start.toISOString();
    endsAt = end.toISOString();
    await query(
      `insert into app_settings (key, value_json, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update
         set value_json = excluded.value_json, updated_at = now()
       where app_settings.value_json->>'ends_at' is null`,
      [
        SETTINGS_KEY,
        JSON.stringify({
          started_at: startedAt,
          ends_at: endsAt,
          duration_days: durationDays,
        }),
      ]
    ).catch(() => {});
  }

  const endMs = endsAt ? new Date(endsAt).getTime() : 0;
  const remainingMs = endsAt ? Math.max(0, endMs - Date.now()) : 0;
  return {
    active: Boolean(endsAt) && remainingMs > 0,
    startedAt,
    endsAt,
    durationDays,
    remainingMs,
  };
}

export function isPromoActive(window: PromoWindow): boolean {
  return window.active;
}
