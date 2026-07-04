/**
 * Cron scheduler — ticks once per minute and enqueues jobs for any agent whose
 * cron expression matches the current minute. Enqueuing (not direct execution)
 * keeps scheduling backend-agnostic and lets the queue provide retries/isolation.
 * A singletonKey per minute prevents duplicate enqueues if two ticks overlap.
 */
import { cronMatches } from "../lib/cron";
import { enqueue } from "../lib/queue";
import { scheduledAgents } from "../lib/agents/registry";
import { config } from "../lib/config";

let timer: NodeJS.Timeout | null = null;

export function startScheduler(): () => void {
  const schedule = scheduledAgents().filter(
    (s) => !config.worker.disabledAgents.includes(s.agent.name)
  );
  console.log(
    `[scheduler] ${schedule.length} scheduled job(s): ${schedule
      .map((s) => `${s.agent.name}(${s.cron})`)
      .join(", ")}`
  );

  async function tick() {
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${now.getUTCMonth()}${now.getUTCDate()}${now.getUTCHours()}${now.getUTCMinutes()}`;
    for (const { agent, cron } of schedule) {
      if (cronMatches(cron, now)) {
        await enqueue(
          agent.name,
          { trigger: "cron" },
          { singletonKey: `${agent.name}:${stamp}` }
        ).catch((e) => console.error(`[scheduler] enqueue ${agent.name} failed:`, e.message));
      }
    }
  }

  // Align to the top of the next minute, then run every 60s.
  const msToNextMinute = 60_000 - (Date.now() % 60_000);
  const startTimer = setTimeout(() => {
    void tick();
    timer = setInterval(() => void tick(), 60_000);
  }, msToNextMinute);

  return () => {
    clearTimeout(startTimer);
    if (timer) clearInterval(timer);
  };
}
