/**
 * One unexpected word must not cost the entire analysis.
 *
 * `.default()` only fires on undefined, so a model answering "certifications"
 * instead of "certification" threw, and the throw takes the whole object with
 * it: scope, deadline, trades, contacts, every requirement. The retry usually
 * repeated the same word. These hold the coercion in place, and hold it to
 * the safe side.
 */
import { describe, it, expect } from "vitest";
import { AnalysisSchema } from "../lib/agents/solicitation-analyst";

const base = { past_perf_classification: "not_required" };

describe("AnalysisSchema", () => {
  it("keeps the analysis when a requirement uses a near-miss category", () => {
    const parsed = AnalysisSchema.parse({
      ...base,
      scope_plain_language: "Replace 14 rooftop units.",
      compliance_matrix: [
        { id: "reps", title: "Reps and certs", category: "certifications" },
        { id: "sf1449", title: "Offer form", category: "Form" },
        { id: "ack", title: "Amendment acknowledgment", category: "amendments" },
        { id: "sched", title: "Bid schedule", category: "cost proposal" },
        { id: "tech", title: "Technical volume", category: "technical" },
        { id: "wild", title: "Something else", category: "banana" },
      ],
    });
    expect(parsed.scope_plain_language).toBe("Replace 14 rooftop units.");
    expect(parsed.compliance_matrix.map((r) => r.category)).toEqual([
      "certification",
      "form",
      "acknowledgment",
      "pricing",
      "narrative",
      "other",
    ]);
  });

  it("sends an unrecognised satisfier to the operator, never to auto-generated", () => {
    const parsed = AnalysisSchema.parse({
      ...base,
      compliance_matrix: [
        { id: "a", title: "A", satisfied_by: "needs signature" },
        { id: "b", title: "B", satisfied_by: "company profile" },
        { id: "c", title: "C", satisfied_by: "platform generates" },
        { id: "d", title: "D", satisfied_by: "who knows" },
      ],
    });
    expect(parsed.compliance_matrix.map((r) => r.satisfied_by)).toEqual([
      "operator_signature",
      "from_profile",
      "auto_generated",
      "operator_provided",
    ]);
  });

  it("blocks for a human when past performance came back unreadable", () => {
    // prime_only stops the pipeline and asks a person, which is the safe
    // direction when we do not actually know the rule.
    expect(
      AnalysisSchema.parse({ past_perf_classification: "unclear" }).past_perf_classification
    ).toBe("prime_only");
    expect(
      AnalysisSchema.parse({ past_perf_classification: "team accepted" })
        .past_perf_classification
    ).toBe("team_accepted");
  });

  it("keeps the analysis when one matrix row is truncated", () => {
    const parsed = AnalysisSchema.parse({
      ...base,
      scope_plain_language: "Replace 14 rooftop units.",
      compliance_matrix: [
        { id: "reps", title: "Reps and certs", category: "certification" },
        { id: "broken" },
      ],
    });
    expect(parsed.scope_plain_language).toBe("Replace 14 rooftop units.");
    expect(parsed.compliance_matrix).toHaveLength(1);
    expect(parsed.compliance_matrix[0].title).toBe("Reps and certs");
  });

  it("survives a matrix row with the wrong type in a scalar field", () => {
    const parsed = AnalysisSchema.parse({
      ...base,
      compliance_matrix: [
        { id: "a", title: "A", mandatory: "yes", signature_required: 1, source: 42 },
      ],
    });
    expect(parsed.compliance_matrix).toHaveLength(1);
    expect(parsed.compliance_matrix[0].mandatory).toBe(true);
    expect(parsed.compliance_matrix[0].signature_required).toBe(false);
  });
});
