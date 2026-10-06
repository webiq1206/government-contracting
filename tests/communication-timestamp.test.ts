import { afterEach, describe, expect, it, vi } from "vitest";
import { communicationTimestamp } from "../lib/domain/communication-timestamp";

afterEach(() => vi.unstubAllEnvs());

describe("stored communication timestamps", () => {
  it("renders the same explicit UTC time in server and browser timezones", () => {
    const outputs = ["UTC", "America/Denver", "Pacific/Auckland"].map((zone) => {
      vi.stubEnv("TZ", zone);
      return communicationTimestamp("2026-10-06T03:03:00Z");
    });
    expect(outputs).toEqual(Array(3).fill({
      label: "Oct 6, 2026, 3:03 AM UTC", dateTime: "2026-10-06T03:03:00.000Z",
    }));
  });

  it.each([
    "2026-10-06T03:03:00Z",
    "2026-10-05T21:03:00-06:00",
    "2026-10-05T21:03:00-0600",
    "2026-10-06 03:03:00+00",
    "2026-10-06 03:03:00.000000+00",
    new Date("2026-10-06T03:03:00Z"),
  ])("preserves an explicit instant from %s", (input) => {
    expect(communicationTimestamp(input)).toEqual({
      label: "Oct 6, 2026, 3:03 AM UTC", dateTime: "2026-10-06T03:03:00.000Z",
    });
  });

  it("handles year boundaries and retains exact machine-readable milliseconds", () => {
    expect(communicationTimestamp("2026-12-31T18:00:00.123456-06:00")).toEqual({
      label: "Jan 1, 2027, 12:00 AM UTC", dateTime: "2027-01-01T00:00:00.123Z",
    });
  });

  it.each([
    null, undefined, "", "not a date", "2026-10-06", "2026-10-06T03:03:00",
    "2026-10-06 03:03:00", "2026-02-30T03:03:00Z", "2026-10-06T24:00:00Z",
    "2026-10-06T03:03:00+99:00", new Date("invalid"),
  ])("does not invent a timezone or date for %s", (input) => {
    expect(communicationTimestamp(input)).toEqual({ label: "Time unavailable", dateTime: undefined });
  });
});
