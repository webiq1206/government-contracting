/**
 * Agent registry — the single place that knows about every agent. The worker
 * registers a queue handler for each and schedules the cron ones. The dashboard
 * reads this to render the Agents view. Adding an agent = add one import here.
 */
import type { AgentDefinition } from "./types";

// The 13-agent roster (SYS-05).
import { opportunityMonitor } from "./opportunity-monitor";
import { scoringEngine } from "./scoring-engine";
import { solicitationAnalyst } from "./solicitation-analyst";
import { pricingResearch } from "./pricing-research";
import { subFinder } from "./sub-finder";
import { subVerify } from "./sub-verify";
import { outreach } from "./outreach";
import { callPrep } from "./call-prep";
import { bidBuilder } from "./bid-builder";
import { complianceMonitor } from "./compliance-monitor";
import { learningLoop } from "./learning-loop";
import { analyticsEngine } from "./analytics-engine";
import { sourcesSoughtResponder } from "./sources-sought-responder";

// Maintenance jobs (time-based plumbing).
import { outreachFollowup, reviewExpirySweep, replyPoll, stalledPipelineSweep } from "./maintenance";

export const ROSTER: AgentDefinition[] = [
  opportunityMonitor,
  scoringEngine,
  solicitationAnalyst,
  pricingResearch,
  subFinder,
  subVerify,
  outreach,
  callPrep,
  bidBuilder,
  complianceMonitor,
  learningLoop,
  analyticsEngine,
  sourcesSoughtResponder,
];

export const MAINTENANCE: AgentDefinition[] = [
  outreachFollowup,
  reviewExpirySweep,
  replyPoll,
  stalledPipelineSweep,
];

export const ALL_AGENTS: AgentDefinition[] = [...ROSTER, ...MAINTENANCE];

const BY_NAME = new Map(ALL_AGENTS.map((a) => [a.name, a]));

export function getAgent(name: string): AgentDefinition | undefined {
  return BY_NAME.get(name);
}

/** Cron-scheduled agents/jobs and their expressions. */
export function scheduledAgents(): { agent: AgentDefinition; cron: string }[] {
  const scheduled = ALL_AGENTS.filter((a) => a.cron).map((a) => ({
    agent: a,
    cron: a.cron!,
  }));
  // Maintenance jobs run on fixed internal schedules (not declared on the def).
  scheduled.push(
    { agent: outreachFollowup, cron: "*/15 * * * *" }, // every 15 min
    { agent: reviewExpirySweep, cron: "*/10 * * * *" }, // every 10 min
    { agent: replyPoll, cron: "*/15 * * * *" }, // every 15 min
    { agent: stalledPipelineSweep, cron: "0 8 * * *" } // daily at 08:00
  );
  return scheduled;
}
