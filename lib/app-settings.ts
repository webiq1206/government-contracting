/**
 * Generic app-level settings (app_settings table), non-secret platform state
 * managed from the UI. First consumer: the automation pause switch, which the
 * worker's scheduler consults every tick so the operator can stop/start the
 * cron loop without touching the process.
 *
 * Every read degrades gracefully (returns the default) if the table doesn't
 * exist yet or the DB hiccups, so a pending migration can never wedge the
 * worker or the dashboard.
 */
import { query, queryOne } from "./db";
import { normalizeRules, type AutomationRules } from "./domain/intake";

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await queryOne<{ value_json: T }>(
      `select value_json from app_settings where key = $1`,
      [key]
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
    [key, JSON.stringify(value), updatedBy ?? null]
  );
}

// ---------------------------------------------------------------------------
// Automation pause switch
// ---------------------------------------------------------------------------

export interface AutomationState {
  paused: boolean;
  /** ISO timestamp of the last state change, null if never toggled. */
  changed_at: string | null;
  /** Email of the operator who last toggled it. */
  changed_by: string | null;
}

const AUTOMATION_KEY = "automation";
const AUTOMATION_DEFAULT: AutomationState = { paused: false, changed_at: null, changed_by: null };

/** Current automation state. Default (and failure mode) is RUNNING. */
export async function getAutomationState(): Promise<AutomationState> {
  const v = await getSetting<Partial<AutomationState>>(AUTOMATION_KEY, AUTOMATION_DEFAULT);
  return {
    paused: v.paused === true,
    changed_at: v.changed_at ?? null,
    changed_by: v.changed_by ?? null,
  };
}

export async function setAutomationPaused(paused: boolean, by: string): Promise<AutomationState> {
  const state: AutomationState = {
    paused,
    changed_at: new Date().toISOString(),
    changed_by: by,
  };
  await setSetting(AUTOMATION_KEY, state, by);
  return state;
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
