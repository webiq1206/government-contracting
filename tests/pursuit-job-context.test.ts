import { describe, expect, it } from "vitest";
import {
  expectedPursuitVersion,
  runWithPursuitVersion,
} from "@/lib/pursuit-job-context";

describe("pursuit job generation context", () => {
  it("carries the queue-time version through awaited work", async () => {
    const result = await runWithPursuitVersion(
      { opportunityId: "opp-1", version: 7 },
      async () => {
        await Promise.resolve();
        return expectedPursuitVersion("opp-1");
      }
    );
    expect(result).toBe(7);
  });

  it("does not apply one opportunity's fence to another opportunity", () => {
    runWithPursuitVersion({ opportunityId: "opp-1", version: 7 }, () => {
      expect(expectedPursuitVersion("opp-1")).toBe(7);
      expect(expectedPursuitVersion("opp-2")).toBeNull();
    });
    expect(expectedPursuitVersion("opp-1")).toBeNull();
  });

  it("keeps nested job contexts isolated", () => {
    runWithPursuitVersion({ opportunityId: "outer", version: 2 }, () => {
      runWithPursuitVersion({ opportunityId: "inner", version: 9 }, () => {
        expect(expectedPursuitVersion("inner")).toBe(9);
        expect(expectedPursuitVersion("outer")).toBeNull();
      });
      expect(expectedPursuitVersion("outer")).toBe(2);
    });
  });
});
