/** Public trial quantities. Shared by enforcement and marketing, without server imports. */
export type TrialMetric = "outreach_emails" | "ai_briefs" | "bid_packages";
export const TRIAL_LIMITS: Record<TrialMetric, number> = {
  outreach_emails: 10,
  ai_briefs: 10,
  bid_packages: 2,
};
export const TRIAL_ALLOWANCE_COPY = `${TRIAL_LIMITS.ai_briefs} AI bid briefs, ${TRIAL_LIMITS.outreach_emails} subcontractor emails and ${TRIAL_LIMITS.bid_packages} bid packages during your trial.`;
