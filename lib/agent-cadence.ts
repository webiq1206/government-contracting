/**
 * How often an agent runs, said once.
 *
 * Four places used to tell the operator how often SAM.gov is polled, all four
 * by typing the number into a sentence, and three of them said two hours after
 * the registry had been changed to three. A cadence stated anywhere other than
 * the registry is a copy, and a copy of a number nothing checks drifts.
 *
 * Server-only: importing the registry pulls in every agent module.
 */
import { scheduledAgents } from "./agents/registry";
import { describeCron } from "./domain/cron-describe";

/** Agent name to cron expression, exactly as the scheduler has it. */
export function agentSchedules(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const { agent, cron } of scheduledAgents()) out[agent.name] = cron;
  return out;
}

/**
 * A sentence like "Every 3 hours", or null when this agent has no schedule of
 * its own. Null is the honest answer for a queue-driven agent, and callers
 * must say something other than a cadence rather than guess one.
 */
export function agentCadence(name: string): string | null {
  const found = scheduledAgents().find((s) => s.agent.name === name);
  return found ? describeCron(found.cron) : null;
}
