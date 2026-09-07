import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  jobRunCompletion,
  shouldQueueRetry,
  withDownstreamEnqueueFailures,
} from "@/lib/agents/runner";

const read = (path: string) => readFileSync(path, "utf8");

describe("automation residual failure truth", () => {
  it("persists structured handler failures as failed job runs", () => {
    expect(jobRunCompletion({ ok: true, summary: "done" })).toEqual({ status: "ok" });
    expect(jobRunCompletion({ ok: false, summary: "provider unavailable" })).toEqual({
      status: "error",
      error: "provider unavailable",
    });

    const runner = read("lib/agents/runner.ts");
    expect(runner).toContain("const completion = jobRunCompletion(finalResult)");
    const handlerCompletion = runner.slice(
      runner.indexOf("const completion = jobRunCompletion(finalResult)"),
      runner.indexOf(
        "} catch (err)",
        runner.indexOf("const completion = jobRunCompletion(finalResult)")
      )
    );
    expect(handlerCompletion).toContain("completion.status");
    expect(handlerCompletion).toContain("completion.error");
    expect(handlerCompletion).not.toContain('"ok"');
  });

  it("makes a refused downstream step visible without replaying completed parent work", () => {
    const result = withDownstreamEnqueueFailures(
      {
        ok: true,
        summary: "Canonical work completed.",
        data: { recordId: "record-1" },
        enqueued: [{ agent: "child-agent", payload: { recordId: "record-1" } }],
      },
      [{ agent: "child-agent", reason: "queue connection refused" }]
    );

    expect(result.ok).toBe(false);
    expect(result.permanent).toBe(true);
    expect(result.humanActionRequired).toBe(true);
    expect(shouldQueueRetry(result)).toBe(false);
    expect(result.enqueued).toEqual([]);
    expect(result.summary).toContain("child-agent: queue connection refused");
    expect(result.summary).toContain("completed parent step will not run again");
    expect(result.data).toMatchObject({
      recordId: "record-1",
      canonicalWorkCompleted: true,
      downstreamEnqueueFailures: [
        { agent: "child-agent", reason: "queue connection refused" },
      ],
    });
  });

  it("keeps an underlying retryable handler failure retryable", () => {
    const result = withDownstreamEnqueueFailures(
      { ok: false, summary: "Provider rate limited the handler." },
      [{ agent: "child-agent", reason: "queue unavailable" }]
    );

    expect(result.ok).toBe(false);
    expect(result.permanent).toBeUndefined();
    expect(shouldQueueRetry(result)).toBe(true);
  });

  it("requires a durable run before the handler or downstream queue starts", () => {
    const runner = read("lib/agents/runner.ts");
    const opening = runner.slice(
      runner.indexOf("let jobRun:"),
      runner.indexOf("if (missing.length > 0)")
    );
    expect(opening).toContain('action: "job-run-start-failed"');
    expect(opening).toContain("No agent work was performed");
    expect(opening).not.toContain(".catch(() => null)");

    const downstream = runner.slice(
      runner.indexOf("const downstreamFailures"),
      runner.indexOf("} catch (err)", runner.indexOf("const downstreamFailures"))
    );
    expect(downstream).toContain("if (!queued)");
    expect(downstream).toContain('action: "downstream-enqueue-failed"');
    expect(downstream).toContain("jobRunCompletion(finalResult)");
    expect(downstream).not.toMatch(/queued\.catch|enqueue .* failed.*console\.error/);
  });

  it("never reports an unperformed score or missing bid package as verified", () => {
    const source = read("lib/agents/reverify.ts");
    expect(source).toContain('failed.push("scoring_and_eligibility")');
    expect(source).toContain("does not independently re-score judgment-based dimensions");
    expect(source).toContain("No bid package exists for this opportunity");
    expect(source).toContain("if (!bid.package_ready)");
    expect(source).toContain('const incomplete = run.state === "partially_verified"');
    expect(source).toContain("ok: !incomplete");
    expect(source).toContain('action: "source-unreadable"');
    expect(source).toContain('action: "document-unreadable"');
    expect(source).not.toMatch(/searchOpportunities\([\s\S]{0,350}\.catch\(/);
    expect(source).not.toMatch(/from bids[\s\S]{0,300}\.catch\(\(\) => null\)/);
  });

  it("fails call preparation closed when tenant or suppression facts cannot be established", () => {
    const source = read("lib/agents/call-prep.ts");
    expect(source).toMatch(/from opportunities where id = \$1 and org_id = \$2/);
    expect(source).toMatch(/from subcontractors where id = \$1 and org_id = \$2/);
    expect(source).toContain("this subcontractor is no longer assigned to the opportunity");
    expect(source).toMatch(/const stopped = await suppressionBlocking\([\s\S]*?orgId\s*\);/);
    expect(source).not.toMatch(/suppressionBlocking\([\s\S]{0,400}\.catch\(\(\) => null\)/);
    expect(source).toMatch(/insert into call_cards\s*\(org_id,/);
  });

  it("blocks a call workspace whose history or caller identity is unavailable", () => {
    const source = read("app/api/call-cards/[id]/workspace/route.ts");
    expect(source).toContain("Promise.allSettled");
    expect(source).toContain("communication and quote history could not be verified");
    expect(source).toContain("caller identity could not be verified");
    expect(source).toContain("Complete the Company Profile before starting this call");
    expect(source).not.toContain("getProfileJson().catch(() => null)");
  });

  it("does not turn failed fanout, queueing, bounce writes, or notifications into healthy counts", () => {
    const source = read("lib/agents/maintenance.ts");
    expect(source).toMatch(/async function activeOrgIds[\s\S]*?if \(fanout\.error\)[\s\S]*?throw new Error/);
    expect(source).toContain("ok: queueFailures === 0");
    expect(source).toContain("scoringQueued++");
    expect(source).toContain("analysisQueued++");
    expect(source).toContain("ok: retryFailures === 0");
    expect(source).toContain("replyPollErrors++");
    expect(source).toContain("send.errors + followUp.errors + replyPollErrors");
    expect(source).toContain('action: "thread-read-failed"');
    expect(source).toContain('action: "followup-count-failed"');
    expect(source).toContain('action: "deadline-sms-failed"');
    expect(source).toContain("ok: alertFailures === 0");
    expect(source).not.toMatch(/threadMessageId\([\s\S]{0,180}\.catch\(/);
    expect(source).not.toContain("const sentSoFar = (priorRow?.n ?? 0) + 1");

    const bounce = source.slice(
      source.indexOf("async function recordBounce"),
      source.indexOf("async function followUpForOrg")
    );
    expect(bounce).not.toContain(".catch(");
    expect(bounce).toContain('action: "bounce-unmatched"');

    const notification = source.slice(
      source.indexOf("// One notification email per poll"),
      source.indexOf("return {", source.indexOf("// One notification email per poll"))
    );
    expect(notification).toContain("systemMail.deliverable()");
    expect(notification).toContain('action: "reply-notification-failed"');
    expect(notification).not.toContain(".catch(() => undefined)");
  });
});
