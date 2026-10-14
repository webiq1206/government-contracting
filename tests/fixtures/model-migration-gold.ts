/** Existing labeled synthetic smoke cases from scripts/gpt41-smoke.ts.
 * These are evaluation inputs/labels, not recorded GPT-6 answers. */
export const MODEL_MIGRATION_GOLD = [
  { id:"source-stated-cents", task:"reply-extraction", model:"gpt-6-luna", source:"Our firm total for all requested work is $1,234.56. Tax and delivery are included.",
    expected:{method:"ai",quoteAmount:1234.56}, outputCaps:[1600,3200] },
  { id:"range-needs-clarification", task:"reply-extraction", model:"gpt-6-luna", source:"Our estimate is between $10,000 and $12,000. We cannot provide a firm total until the site visit.",
    expected:{method:"ai",quoteAmount:null,missingFieldsNonempty:true}, outputCaps:[1600,3200] },
  { id:"out-of-order-amendments", task:"analysis-review", model:"gpt-6-sol",
    source:"Amendment 0002: Bid deadline is November 19, 2026 at 2 PM America/Denver. Signed acknowledgment is required.\nAmendment 0001: Bid deadline is November 16, 2026 at 2 PM America/Denver.\nOriginal notice: Bid deadline is November 12, 2026 at 2 PM America/Denver.",
    proposed:{deadline:"2026-11-16T21:00:00Z",signature_required:false,compliance_matrix:[]},portalDeadline:"2026-11-16T21:00:00Z",
    expected:{deadlineReconciliation:true,missingSignatureFlag:true},outputCaps:[4096] },
] as const;
