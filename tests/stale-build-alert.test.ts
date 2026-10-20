import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), alert: vi.fn() }));
vi.mock("../lib/db", () => ({ queryOne: mocks.queryOne }));
vi.mock("../lib/outage-alert", () => ({ deliverOutageAlert: mocks.alert }));

import { parseMainFreshness } from "../lib/runtime-evidence";
import { alertIfStaleBuild } from "../lib/stale-build-alert";

const main = "a".repeat(40);
const checkedAt = "2026-10-20T18:00:00.000Z";
const build = { buildId: "build-1", sourceCommit: "b".repeat(40) };
const stamp = (mainEvidence: unknown) => JSON.stringify({ schema: 2, mainEvidence });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryOne.mockResolvedValue({ key: "claimed" });
  mocks.alert.mockResolvedValue("email");
});

describe("build freshness against GitHub main", () => {
  it("parses a stale build", () => {
    expect(parseMainFreshness(stamp({ upToDate: false, missingCommits: 3, originMain: main, fetched: true, checkedAt })))
      .toEqual({ upToDate: false, missingCommits: 3, originMain: main, fetched: true, checkedAt });
  });

  it("reads anything it cannot trust as unknown, never as stale", () => {
    expect(parseMainFreshness(undefined)).toBeNull();
    expect(parseMainFreshness("not json")).toBeNull();
    expect(parseMainFreshness(stamp(undefined))).toBeNull();
    expect(parseMainFreshness(stamp({ upToDate: false, missingCommits: 3, checkedAt: "never" }))).toBeNull();
    expect(parseMainFreshness(stamp({ upToDate: false, missingCommits: -1, checkedAt })))
      .toMatchObject({ upToDate: null, missingCommits: null });
    expect(parseMainFreshness(stamp({ upToDate: false, missingCommits: 2, originMain: "x", checkedAt })))
      .toMatchObject({ upToDate: false, originMain: null, fetched: false });
  });

  it("alerts once per build when production is behind main", async () => {
    const stale = parseMainFreshness(stamp({ upToDate: false, missingCommits: 4, originMain: main, fetched: true, checkedAt }));
    expect(await alertIfStaleBuild(stale, build)).toBe(true);
    expect(mocks.queryOne.mock.calls[0][1][0]).toBe("platform:stale-build-alerted:build-1");
    expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({
      subject: "Production is running an out-of-date build",
      text: expect.stringContaining("missing 4 commit(s)"),
      tone: "critical",
    }));

    mocks.alert.mockClear();
    mocks.queryOne.mockResolvedValue(null);
    expect(await alertIfStaleBuild(stale, build)).toBe(false);
    expect(mocks.alert).not.toHaveBeenCalled();
  });

  it("stays silent when the build is current or its freshness is unknown", async () => {
    expect(await alertIfStaleBuild(parseMainFreshness(stamp({ upToDate: true, missingCommits: 0, checkedAt })), build)).toBe(false);
    expect(await alertIfStaleBuild(parseMainFreshness(stamp({ upToDate: null, missingCommits: null, checkedAt })), build)).toBe(false);
    expect(await alertIfStaleBuild(null, build)).toBe(false);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
