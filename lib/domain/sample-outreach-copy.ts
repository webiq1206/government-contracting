/**
 * The standard introduction assumes real bid attachments. A sample delivery
 * deliberately attaches nothing; adjust that sentence only in the sample copy.
 * Saved templates and real-bid package checks are left untouched.
 */
export function sampleOutreachCopy(body: string): string {
  return body.replace(
    /Please review the complete scope, requirements, and attached bid documents\./gi,
    "Please review the sample scope and requirements below. No bid documents are attached to this delivery test."
  ).replace(
    /The complete scope, requirements, and bid documents are included again below and attached to this email\./gi,
    "The sample scope and requirements are included below. No bid documents are attached to this delivery test."
  ).replace(
    /The complete scope, requirements, and documents are included in the original message below\./gi,
    "The sample scope and requirements are included below. This delivery test has no original email thread or bid documents."
  );
}
