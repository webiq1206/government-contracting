/**
 * Agent registry, the single place that knows about every agent. The worker
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
import { complianceAuditor } from "./compliance-auditor";
import { bidBuilder } from "./bid-builder";
import { complianceMonitor } from "./compliance-monitor";
import { learningLoop } from "./learning-loop";
import { analyticsEngine } from "./analytics-engine";
import { sourcesSoughtResponder } from "./sources-sought-responder";
import { backlinkScout } from "./backlink-scout";

// Maintenance jobs (time-based plumbing).
import {
  outreachFollowup,
  reviewExpirySweep,
  replyPoll,
  stalledPipelineSweep,
  deadlineMonitor,
  expiredOpportunitySweep,
  retentionSweep,
  logRetentionSweep,
  backlinkOutreachSweep,
} from "./maintenance";

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
  complianceAuditor,
  complianceMonitor,
  learningLoop,
  analyticsEngine,
  sourcesSoughtResponder,
  backlinkScout,
];

export const MAINTENANCE: AgentDefinition[] = [
  outreachFollowup,
  reviewExpirySweep,
  replyPoll,
  stalledPipelineSweep,
  deadlineMonitor,
  expiredOpportunitySweep,
  retentionSweep,
  logRetentionSweep,
  backlinkOutreachSweep,
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
    { agent: stalledPipelineSweep, cron: "0 */2 * * *" }, // every 2h (matches the tightest STALL_HOURS window)
    { agent: deadlineMonitor, cron: "0 */6 * * *" }, // every 6 hours
    { agent: expiredOpportunitySweep, cron: "15 * * * *" }, // hourly at :15
    { agent: retentionSweep, cron: "45 3 * * *" }, // daily at 03:45
    { agent: logRetentionSweep, cron: "30 3 * * *" }, // daily at 03:30
    { agent: backlinkOutreachSweep, cron: "*/20 * * * *" } // every 20 min
  );
  return scheduled;
}
