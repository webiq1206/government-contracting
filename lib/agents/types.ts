import type { AgentContext, AgentResult } from "../types";

/**
 * Every agent is an isolated module exporting one AgentDefinition. Failures in
 * one agent are caught by the runner and never cascade to others.
 */
export interface AgentDefinition {
  /** Stable id, kebab-case, matches the queue name. */
  name: string;
  /** Human label for the dashboard. */
  label: string;
  /** One-line description of what it does. */
  description: string;
  /** Cron expression if this agent runs on a schedule (in addition to queue triggers). */
  cron?: string;
  /** If true, the agent runs even when Claude is not configured (rule-only agents). */
  worksWithoutClaude?: boolean;
  /**
   * How hard the paid AI work is, for an agent that cannot run without it.
   * The queue checks this tier's allowance before creating a job, so a held
   * budget stops work from being queued rather than queued, run and refused.
   * Defaults to routine.
   */
  aiTier?: "routine" | "complex";
  /** Explicit owner for platform-owned workflows that do not fan out. */
  ownerOrgId?: string;
  /** The unit of work. */
  handler: (ctx: AgentContext) => Promise<AgentResult>;
}

export type { AgentContext, AgentResult };
