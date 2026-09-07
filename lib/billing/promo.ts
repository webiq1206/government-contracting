/**
 * Founding customer promotion: $497/mo locked for life of the subscription.
 * Window is 5 days from go-live. Ends_at is stored in app_settings and is
 * never a hardcoded "5 days remaining" string in the UI.
 */
import { queryOne } from "../db";

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

function validTimestamp(value: string | null, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new Error(`Founding promotion setting ${field} must be a timestamp string.`);
  }
  const parsed = new Date(value);
  if (!value.trim() || Number.isNaN(parsed.getTime())) {
    throw new Error(`Founding promotion setting ${field} is not a valid timestamp.`);
  }
  return parsed.toISOString();
}

function readPromo(value: PromoJson | null | undefined): {
  startedAt: string | null;
  endsAt: string | null;
  durationDays: number;
} {
  if (value != null && (typeof value !== "object" || Array.isArray(value))) {
    throw new Error("Founding promotion settings must be a JSON object.");
  }
  const durationDays = value?.duration_days ?? DEFAULT_DURATION_DAYS;
  if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 3650) {
    throw new Error("Founding promotion setting duration_days must be a positive whole number.");
  }

  const startedAt = validTimestamp(value?.started_at ?? null, "started_at");
  const endsAt = validTimestamp(value?.ends_at ?? null, "ends_at");
  if (startedAt && endsAt && new Date(startedAt).getTime() > new Date(endsAt).getTime()) {
    throw new Error("Founding promotion settings are invalid because started_at is after ends_at.");
  }
  return { startedAt, endsAt, durationDays };
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
  let row = await queryOne<{ value_json: PromoJson }>(
    `select value_json from app_settings where key = $1`,
    [SETTINGS_KEY]
  );

  let { startedAt, endsAt, durationDays } = readPromo(row?.value_json);

  // Env override wins (ops can pin an exact end timestamp without migrating).
  const envEnd = process.env.FOUNDING_PROMO_ENDS_AT?.trim();
  if (envEnd) {
    const d = new Date(envEnd);
    if (Number.isNaN(d.getTime())) {
      throw new Error("FOUNDING_PROMO_ENDS_AT is set but is not a valid timestamp.");
    }
    endsAt = d.toISOString();
    if (!startedAt) {
      startedAt = new Date(d.getTime() - durationDays * 86_400_000).toISOString();
    }
  }

  if (!endsAt && startIfMissing) {
    const start = new Date();
    const end = new Date(start.getTime() + durationDays * 86_400_000);
    const proposed: PromoJson = {
      started_at: start.toISOString(),
      ends_at: end.toISOString(),
      duration_days: durationDays,
    };
    const written = await queryOne<{ value_json: PromoJson }>(
      `insert into app_settings (key, value_json, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update
         set value_json = excluded.value_json, updated_at = now()
       where app_settings.value_json->>'ends_at' is null
       returning value_json`,
      [SETTINGS_KEY, JSON.stringify(proposed)]
    );

    /*
     * A simultaneous request may have started the window between our SELECT
     * and INSERT. In that case the conflict WHERE clause correctly refuses to
     * overwrite it, but RETURNING produces no row. Read the winner instead of
     * returning our different, never-persisted timestamps.
     */
    row = written ??
      (await queryOne<{ value_json: PromoJson }>(
        `select value_json from app_settings where key = $1`,
        [SETTINGS_KEY]
      ));
    if (!row) {
      throw new Error("The founding promotion window could not be saved or read back.");
    }
    ({ startedAt, endsAt, durationDays } = readPromo(row.value_json));
    if (!endsAt) {
      throw new Error("The founding promotion window was not persisted with an end time.");
    }
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
