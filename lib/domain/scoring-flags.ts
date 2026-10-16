/**
 * Risk flags written when a score is saved.
 *
 * `incomplete_scoring` stays until a later run finishes the score. A
 * finished run must drop it, or the recovery probe would queue the same
 * item forever.
 */

export function scoringRiskFlags(input: {
  existing: readonly string[];
  exclusions: readonly string[];
  flags: readonly string[];
  scoringIncomplete: boolean;
  preserveLifecycle: boolean;
  tier: string;
}): string[] {
  const kept = input.existing.filter(
    (flag) =>
      flag !== "awaiting_document_analysis" &&
      (input.scoringIncomplete || flag !== "incomplete_scoring")
  );
  const next = [
    ...kept,
    ...input.exclusions,
    ...input.flags,
    ...(input.preserveLifecycle && input.tier !== "pursue"
      ? ["score_changed_after_document_analysis"]
      : []),
  ];
  return [...new Set(next)];
}
