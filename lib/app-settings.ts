/**
 * Generic app-level settings (app_settings table), non-secret platform state
 * managed from the UI. First consumer: the automation master pause switch.
 * When paused, cron, queue enqueue, agent runs, and outbound email/SMS all
 * stop. Operator auth, password reset, and billing stay available.
 *
 * Every read degrades gracefully (returns the default) if the table doesn't
 * exist yet or the DB hiccups, so a pending migration can never wedge the
 * worker or the dashboard.
 */
import { query, queryOne } from "./db";
import { normalizeRules, type AutomationRules } from "./domain/intake";
import { LEGACY_ORG_ID } from "./tenant-context";

/**
 * Settings are per-organization, scoped by key prefix.
 *
 * app_settings.key is the table's primary key and predates organizations, so
 * "automation" was one row for the whole platform: any customer flipping the
 * pause switch stopped every other customer's automation. Rather than
 * migrate the primary key under a launch deadline, the org boundary lives in
 * the key itself: the founding org keeps the bare keys its existing rows
 * already use, every other org reads and writes "<orgId>:<key>". Same
 * isolation, zero data migration, and a later PK migration can fold the
 * prefix into a column without changing this module's callers.
 */
async function scopedKey(key: string): Promise<string> {
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    const orgId = await tryResolveTenantOrgId();
    if (orgId && orgId !== LEGACY_ORG_ID) return `${orgId}:${key}`;
  } catch {
    // Fall through to the platform-level key.
  }
  return key;
}

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await queryOne<{ value_json: T }>(
      `select value_json from app_settings where key = $1`,
      [await scopedKey(key)]
    );
    return row ? row.value_json : fallback;
  } catch {
    return fallback;
  }
}

async function setSetting(key: string, value: unknown, updatedBy?: string): Promise<void> {
  await query(
    `insert into app_settings (key, value_json, updated_at, updated_by)
     values ($1, $2, now(), $3)
     on conflict (key) do update
       set value_json = excluded.value_json, updated_at = now(), updated_by = excluded.updated_by`,
    [await scopedKey(key), JSON.stringify(value), updatedBy ?? null]
  );
}

// ---------------------------------------------------------------------------
// Automation master pause switch
// ---------------------------------------------------------------------------

export interface AutomationState {
  paused: boolean;
  /** ISO timestamp of the last state change, null if never toggled. */
  changed_at: string | null;
  /** Email of the operator who last toggled it. */
  changed_by: string | null;
}

export const AUTOMATION_PAUSED_ERROR =
  "Automation is fully paused. Nothing will run, send, or enqueue until you resume the master switch.";

const AUTOMATION_KEY = "automation";
const AUTOMATION_DEFAULT: AutomationState = { paused: false, changed_at: null, changed_by: null };

/**
 * Short in-memory cache so burst enqueue/send paths do not hammer the DB.
 * Keyed by the scoped key: settings are per-org now, and a single cached
 * value would hand one org's pause state to another for the cache window.
 */
const STATE_CACHE_MS = 2_000;
const stateCache = new Map<string, { at: number; state: AutomationState }>();

/** Current automation state. Default (and failure mode) is RUNNING. */
export async function getAutomationState(): Promise<AutomationState> {
  const cacheKey = await scopedKey(AUTOMATION_KEY);
  const hit = stateCache.get(cacheKey);
  if (hit && Date.now() - hit.at < STATE_CACHE_MS) {
    return hit.state;
  }
  const v = await getSetting<Partial<AutomationState>>(AUTOMATION_KEY, AUTOMATION_DEFAULT);
  const state: AutomationState = {
    paused: v.paused === true,
    changed_at: v.changed_at ?? null,
    changed_by: v.changed_by ?? null,
  };
  stateCache.set(cacheKey, { at: Date.now(), state });
  return state;
}

/** True when THIS organization's switch has stopped its automation. */
export async function isAutomationPaused(): Promise<boolean> {
  return (await getAutomationState()).paused;
}

/**
 * The platform kill switch, which is a different thing from any one
 * organization's pause and now has its own row.
 *
 * It used to be the same row. `getAutomationState` scopes its key by tenant,
 * and the founding organization keeps the bare key, so a read with no tenant
 * context landed on the founding organization's own setting. The worker read
 * it that way for every job, which produced two wrong answers at once:
 *
 *   - a customer paused their automation and their queued jobs kept running,
 *     because their switch was never the one being read
 *   - the founding organization paused its own automation and every customer
 *     on the platform stopped
 *
 * A separate key ends the conflation. It is deliberately NOT scoped, has no
 * default row, and defaults to running: an operator who has never touched it
 * has not asked for anything to stop.
 */
const PLATFORM_AUTOMATION_KEY = "platform_automation";

export async function getPlatformAutomationState(): Promise<AutomationState> {
  const hit = stateCache.get(PLATFORM_AUTOMATION_KEY);
  if (hit && Date.now() - hit.at < STATE_CACHE_MS) return hit.state;
  // Read the key directly rather than through getSetting, which would scope it.
  const row = await queryOne<{ value_json: Partial<AutomationState> }>(
    `select value_json from app_settings where key = $1`,
    [PLATFORM_AUTOMATION_KEY]
  ).catch(() => null);
  const v = row?.value_json ?? {};
  const state: AutomationState = {
    paused: v.paused === true,
    changed_at: v.changed_at ?? null,
    changed_by: v.changed_by ?? null,
  };
  stateCache.set(PLATFORM_AUTOMATION_KEY, { at: Date.now(), state });
  return state;
}

/** True when the platform-wide kill switch has stopped every organization. */
export async function isPlatformAutomationPaused(): Promise<boolean> {
  return (await getPlatformAutomationState()).paused;
}

/**
 * Either switch. This is what an enforcement point wants to ask.
 *
 * A kill switch that does not stop sending is not a kill switch, so every
 * place that refuses to act while automation is paused has to consider both:
 * the platform switch and this organization's own. Separating the two states
 * without giving the enforcement points one question to ask would have made
 * the platform switch a label rather than a control.
 *
 * The runner deliberately does NOT use this: it checks the two separately so
 * its summary can say which one stopped the job, which is the difference
 * between "we are down" and "you turned this off".
 */
export async function isAutomationStopped(): Promise<boolean> {
  if (await isPlatformAutomationPaused()) return true;
  return isAutomationPaused();
}

export async function setPlatformAutomationPaused(
  paused: boolean,
  by: string
): Promise<AutomationState> {
  const state: AutomationState = {
    paused,
    changed_at: new Date().toISOString(),
    changed_by: by,
  };
  await query(
    `insert into app_settings (key, value_json, updated_at, updated_by)
     values ($1, $2::jsonb, now(), $3)
     on conflict (key) do update
       set value_json = excluded.value_json, updated_at = now(), updated_by = excluded.updated_by`,
    [PLATFORM_AUTOMATION_KEY, JSON.stringify(state), by]
  );
  stateCache.set(PLATFORM_AUTOMATION_KEY, { at: Date.now(), state });
  return state;
}

export async function setAutomationPaused(paused: boolean, by: string): Promise<AutomationState> {
  const state: AutomationState = {
    paused,
    changed_at: new Date().toISOString(),
    changed_by: by,
  };
  await setSetting(AUTOMATION_KEY, state, by);
  stateCache.set(await scopedKey(AUTOMATION_KEY), { at: Date.now(), state });
  return state;
}

/** Test helper: clear the in-memory pause cache between cases. */
export function clearAutomationStateCache(): void {
  stateCache.clear();
}

// ---------------------------------------------------------------------------
// Automation rules (intake gate, deadline thresholds, retention)
// ---------------------------------------------------------------------------

const RULES_KEY = "automation_rules";

/** Current rules; defaults (and failure mode) are the safe DEFAULT_RULES. */
export async function getAutomationRules(): Promise<AutomationRules> {
  const stored = await getSetting<Partial<AutomationRules> | null>(RULES_KEY, null);
  return normalizeRules(stored);
}

export async function setAutomationRules(
  rules: Partial<AutomationRules>,
  by: string
): Promise<AutomationRules> {
  const normalized = normalizeRules(rules);
  await setSetting(RULES_KEY, normalized, by);
  return normalized;
}

/**
 * Whether the phone-call step is part of this org's pipeline.
 *
 * Read by every path that would otherwise prepare a call: the failure mode is
 * `true` (calls on), because normalizeRules already treats a missing key as
 * on, and a DB hiccup must not silently switch a customer's workflow.
 */
export async function areCallsEnabled(): Promise<boolean> {
  return (await getAutomationRules()).calls_enabled;
}
