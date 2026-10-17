/**
 * Scheduled jobs that still run when DISABLED_AGENTS is set.
 * The platform pause stops the scheduler for these too.
 */
export const ALWAYS_ON_SCHEDULED = new Set([
  "ai-provider-recovery-probe",
  "pursuit-continuation-sweep",
]);
