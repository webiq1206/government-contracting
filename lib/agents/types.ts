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
  /** The unit of work. */
  handler: (ctx: AgentContext) => Promise<AgentResult>;
}

export type { AgentContext, AgentResult };
