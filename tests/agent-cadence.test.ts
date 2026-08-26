import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scheduledAgents } from "@/lib/agents/registry";
import { agentCadence, agentSchedules } from "@/lib/agent-cadence";
import { describeCron } from "@/lib/domain/cron-describe";

describe("the cadence helper", () => {
  it("describes a scheduled agent in English", () => {
    expect(agentCadence("opportunity-monitor")).toBe(describeCron(schedule("opportunity-monitor")));
  });

  it("returns null for an agent nothing schedules, rather than inventing one", () => {
    expect(agentCadence("scoring-engine")).toBeNull();
    expect(agentCadence("not-an-agent")).toBeNull();
  });

  it("maps every scheduled agent", () => {
    const map = agentSchedules();
    for (const { agent, cron } of scheduledAgents()) expect(map[agent.name]).toBe(cron);
  });
});

function schedule(name: string): string | null {
  return scheduledAgents().find((s) => s.agent.name === name)?.cron ?? null;
}

/** "0 *\/3 * * *" -> 3. Only the shapes the registry uses. */
function hoursBetweenRuns(cron: string | null): number | null {
  if (!cron) return null;
  const [min, hour, dom, mon, dow] = cron.trim().split(/\s+/);
  if (dom !== "*" || mon !== "*" || dow !== "*") return 24;
  if (/^\*\/\d+$/.test(hour)) return Number(hour.slice(2));
  if (hour === "*") return /^\*\/\d+$/.test(min) ? Number(min.slice(2)) / 60 : 1;
  return 24;
}

describe("the constants derived from a schedule", () => {
  /**
   * MONITOR_STALL_HOURS in pipeline-pulse is 7, which is two missed
   * three-hourly slots plus slack. Widening the monitor's schedule past that
   * would turn the "discovery has not run" warning into one that never fires,
   * silently. This is the test that comment points at.
   */
  it("keeps the monitor scheduled often enough for the stall warning to mean anything", () => {
    const gap = hoursBetweenRuns(schedule("opportunity-monitor"));
    expect(gap).not.toBeNull();
    expect(gap!).toBeLessThanOrEqual(3);
  });
});

/**
 * The drift this whole helper exists to stop.
 *
 * Four places told the operator how often SAM.gov is polled, all four by
 * typing the number into a sentence. Three of them said two hours for months
 * after the registry moved to three, and nothing in the repository noticed,
 * because prose cannot be wrong loudly.
 *
 * A cadence in a user-facing string is now a test failure. Say it by calling
 * agentCadence(), or do not say it.
 */
const CADENCE_PHRASE = /every (?:\d+|two|three|four|six|twelve|another) hours?/i;

const ROOTS = ["app", "components", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);
/**
 * The registry is where a cadence belongs, so it is the one file allowed to
 * write one down. Every other mention is a copy.
 */
const SOURCE_OF_TRUTH = join("lib", "agents", "registry.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no page states a cadence of its own", () => {
  it("finds no hardcoded run frequency in any page, component or library string", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        if (file === SOURCE_OF_TRUTH) continue;
        const text = readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          // Comments are allowed to explain history; strings are what a
          // customer reads.
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
          if (CADENCE_PHRASE.test(line)) offenders.push(`${file}:${i + 1}: ${trimmed}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
