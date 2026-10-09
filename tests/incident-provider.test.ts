import { describe, expect, it } from "vitest";
import { incidentProvider } from "@/lib/incidents";

describe("incident provider identity", () => {
  it.each([
    [{ sample: "OpenAI account has insufficient credit" }, "openai"],
    [{ sample: "Anthropic rejected the API key" }, "anthropic"],
    [{ sample: "HTTP 403", affectedWorkflows: ["Backlink Scout"] }, "ahrefs"],
  ])("identifies the service from saved incident evidence", (input, provider) => {
    expect(incidentProvider(input)).toBe(provider);
  });

  it("does not guess when evidence names more than one provider", () => {
    expect(incidentProvider({ sample: "OpenAI and Anthropic both refused" })).toBeNull();
  });
});
