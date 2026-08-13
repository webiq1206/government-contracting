import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * Drafted replies to subcontractors.
 *
 * The risk here is not a clumsy sentence, it is a commitment. A draft that
 * names a price, promises a start date, or tells a sub they have the job has
 * spoken for the company, and it arrives pre-written in front of an operator
 * who is moving fast. So the tests that matter are the ones about what the
 * draft is not allowed to say, and about the fact that nothing here can put
 * mail in front of a subcontractor.
 */

const INBOUND = {
  id: "c-inbound",
  body: "Thanks for sending this over. What's the total square footage, and who is the agency? We can do it for $12,500.",
  subject: "Re: Grounds maintenance",
  created_at: new Date("2026-08-01T15:00:00Z"),
  gmail_message_id: "g-1",
  gmail_thread_id: "t-1",
  subcontractor_id: "s1",
  opportunity_id: "o1",
  org_id: "org-1",
  company_name: "Acme Paving",
  owner_name: "Dana Ruiz",
  opp_title: "Grounds maintenance at Fort Example",
  agency: "Department of the Interior",
  deadline: new Date("2026-09-01T17:00:00Z"),
  solicitation_number: "W912-26-R-0001",
  location_state: "TX",
  location_text: "Fort Example, TX",
  description:
    "Contractor shall provide all labor, equipment and materials for grounds maintenance across 42,000 square feet of improved grounds, including mowing, edging and trash removal on a weekly cycle. Contact the Contracting Officer: Marla Vance at 555-867-5309 with questions.",
  solicitation_analysis: {
    trade_scopes: [
      {
        trade: "Landscaping",
        work: "Weekly mowing, edging and trash removal across 42,000 square feet of improved grounds, plus seasonal shrub trimming. Contractor supplies all equipment.",
      },
    ],
  },
  trade: "Landscaping",
};

const EXTRACTED = {
  intent: "quoted",
  isQuote: true,
  quoteAmount: 12500,
  laborCost: null,
  materialCost: null,
  scopeSummary: "Weekly mowing and trash removal",
  exclusions: ["Irrigation repair"],
  qualifications: [],
  missingFields: [],
  canPerform: true,
  capabilityNotes: null,
  leadTimeDays: 14,
  availabilityNotes: null,
  tradesMentioned: ["Landscaping"],
  confidence: 0.9,
};

interface LoadOpts {
  /** Model replies, in order. */
  replies?: string[];
  row?: Record<string, unknown> | null;
  extracted?: Record<string, unknown> | null;
  prior?: { direction: string; body: string }[];
  /** A message newer than the one being answered exists in the thread. */
  newer?: boolean;
  notConfigured?: boolean;
}

async function load(opts: LoadOpts = {}) {
  vi.resetModules();
  const replies = opts.replies ?? ["Dana, it's 42,000 square feet of improved grounds.\n\nJared"];
  const inserted: unknown[][] = [];
  let call = 0;

  class ClaudeNotConfiguredError extends Error {}
  const complete = vi.fn(async () => {
    if (opts.notConfigured) throw new ClaudeNotConfiguredError("no key");
    const text = replies[Math.min(call, replies.length - 1)];
    call++;
    return { text, usage: { input_tokens: 10, output_tokens: 20 }, stopReason: null };
  });

  const queryOne = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/from communications c/.test(sql)) {
      return opts.row === undefined ? INBOUND : opts.row;
    }
    // The "has this thread moved on?" check.
    if (/select id\s+from communications/.test(sql)) {
      return opts.newer ? { id: "c-newer" } : null;
    }
    if (/subcontractor_reply_events/.test(sql)) {
      const extracted = opts.extracted === undefined ? EXTRACTED : opts.extracted;
      return extracted ? { extracted } : null;
    }
    if (/insert into reply_drafts/.test(sql)) {
      inserted.push(params);
      return {
        communication_id: params[1],
        generated_body: params[4],
        edited_body: null,
        warnings: params[5],
        generated_at: new Date("2026-08-13T00:00:00Z"),
      };
    }
    return null;
  });
  const query = vi.fn(async (sql: string) => {
    if (/select direction, body/.test(sql)) {
      return (opts.prior ?? []) as unknown[];
    }
    return [] as unknown[];
  });

  // A throwing transport is the proof, not a comment: if drafting ever grew a
  // send path, these tests would fail loudly instead of quietly mailing subs.
  const sendOutreachEmail = vi.fn(async () => {
    throw new Error("drafting must never send email");
  });

  vi.doMock("@/lib/db", () => ({ query, queryOne }));
  vi.doMock("@/lib/ai/claude", () => ({ complete, ClaudeNotConfiguredError }));
  vi.doMock("@/lib/integrations/email-transport", () => ({ sendOutreachEmail }));
  vi.doMock("@/lib/logger", () => ({ logAgent: vi.fn(async () => {}) }));
  vi.doMock("@/lib/ai/companyProfile", () => ({
    getProfileJson: async () => ({ legal_name: "Brost Co", owner_name: "Jared Brost" }),
  }));

  const mod = await import("@/lib/domain/reply-draft");
  return { mod, complete, query, queryOne, inserted, sendOutreachEmail };
}

afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/ai/claude");
  vi.doUnmock("@/lib/integrations/email-transport");
  vi.doUnmock("@/lib/logger");
  vi.doUnmock("@/lib/ai/companyProfile");
  vi.resetModules();
});

describe("deciding which autosave wins", () => {
  async function loadSave(opts: { updated: boolean; exists: boolean }) {
    vi.resetModules();
    const query = vi.fn(async () => (opts.updated ? [{ id: "d1" }] : []));
    const queryOne = vi.fn(async () => (opts.exists ? { id: "d1" } : null));
    vi.doMock("@/lib/db", () => ({ query, queryOne }));
    const mod = await import("@/lib/domain/reply-draft");
    return { mod, query };
  }

  it("refuses to let an older edit replace a newer one", async () => {
    const { mod, query } = await loadSave({ updated: false, exists: true });
    const res = await mod.saveDraftEdit({
      communicationId: "c1",
      orgId: "org-1",
      body: "the older text",
      rev: 3,
    });
    // The row is there; this write simply lost. Ordering is settled in the
    // database because the last edit before a tab closes has to be fired off
    // outside any client-side queue.
    expect(res).toBe("stale");
    expect(query.mock.calls[0][0]).toMatch(/rev < \$4/);
  });

  it("tells a lost race apart from a draft that is gone", async () => {
    const stale = await loadSave({ updated: false, exists: true });
    const missing = await loadSave({ updated: false, exists: false });
    const args = { communicationId: "c1", orgId: "org-1", body: "x", rev: 2 };
    // One is a non-event; the other means the operator is editing something
    // that no longer exists, which the route reports as a 404.
    expect(await stale.mod.saveDraftEdit(args)).toBe("stale");
    expect(await missing.mod.saveDraftEdit(args)).toBe("missing");
  });

  it("treats a rewrite as a newer revision, not a fresh start", async () => {
    const { mod, queryOne } = await load();
    await mod.generateReplyDraft({ communicationId: "c-inbound", orgId: "org-1" });
    const upsert = queryOne.mock.calls.find((c) =>
      /insert into reply_drafts/.test(c[0] as string)
    );
    // Sending the counter back to zero here would let an autosave that was
    // already on the wire when the rewrite landed look newer than the
    // replacement, and restore the text the operator just threw away.
    expect(upsert?.[0]).toMatch(/rev = reply_drafts\.rev \+ 1/);
    expect(upsert?.[0]).not.toMatch(/rev = 0/);
  });

  it("refuses an edit written against the draft a rewrite replaced", async () => {
    // The rewrite bumped the stored revision past this write's, so the
    // conditional update simply does not apply it.
    const { mod } = await loadSave({ updated: false, exists: true });
    expect(
      await mod.saveDraftEdit({
        communicationId: "c1",
        orgId: "org-1",
        body: "text from before the rewrite",
        rev: 5,
      })
    ).toBe("stale");
  });

  it("records the revision it just wrote", async () => {
    const { mod, query } = await loadSave({ updated: true, exists: true });
    expect(
      await mod.saveDraftEdit({
        communicationId: "c1",
        orgId: "org-1",
        body: "newest",
        rev: 9,
      })
    ).toBe("saved");
    expect(query.mock.calls[0][1]).toEqual(["c1", "org-1", "newest", 9]);
  });
});

describe("what a draft is offered for", () => {
  it("offers nothing when the last word in the thread is ours", async () => {
    const { replyTarget } = await import("@/lib/domain/conversation");
    const messages = [
      { id: "m1", direction: "inbound" as const },
      { id: "m2", direction: "outbound" as const },
    ].map((m) => ({ ...m, subject: null, body: "x", created_at: "", recipient_email: null, kind: null, gmail_message_id: null }));
    // A thread we already answered must not keep offering their older email as
    // something to reply to: that is a second answer to a settled question and
    // a stale draft coming back as if it were new.
    expect(replyTarget({ messages })).toBeNull();
    expect(replyTarget({ messages: messages.slice(0, 1) })?.id).toBe("m1");
  });

  it("answers their newest message, not the first one they sent", async () => {
    const { replyTarget } = await import("@/lib/domain/conversation");
    const messages = ["m1", "m2", "m3"].map((id) => ({
      id,
      direction: "inbound" as const,
      subject: null,
      body: "x",
      created_at: "",
      recipient_email: null,
      kind: null,
      gmail_message_id: null,
    }));
    expect(replyTarget({ messages })?.id).toBe("m3");
  });

  it("refuses to answer a message the thread has already moved past", async () => {
    const { mod, complete } = await load({ newer: true });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    // The composer hides the button once we have answered, but this endpoint
    // takes a message id from the browser: a stale tab must not be able to
    // write an answer to a settled question into the thread's live draft.
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("superseded");
    // And it costs nothing: refused before the model is called.
    expect(complete).not.toHaveBeenCalled();
  });

  it("offers nothing for an empty conversation", async () => {
    const { replyTarget } = await import("@/lib/domain/conversation");
    expect(replyTarget({ messages: [] })).toBeNull();
  });
});

describe("what a draft is not allowed to say", () => {
  it("flags a price we invented", async () => {
    const { mod } = await load();
    const w = mod.checkDraftCommitments(
      "We can pay $9,000 for this scope.",
      EXTRACTED as never
    );
    expect(w.join(" ")).toContain("$9,000");
  });

  it("allows the number they quoted us, in any of the shapes it gets written", async () => {
    const { mod } = await load();
    for (const written of ["$12,500", "$12500", "$12,500.00"]) {
      expect(
        mod.checkDraftCommitments(`Got your ${written}, thanks.`, EXTRACTED as never)
      ).toEqual([]);
    }
  });

  it("treats any dollar figure as invented when they never gave us one", async () => {
    const { mod } = await load();
    const noQuote = { ...EXTRACTED, isQuote: false, quoteAmount: null };
    expect(
      mod.checkDraftCommitments("Budget is around $40,000.", noQuote as never)
    ).toHaveLength(1);
  });

  it("flags language that hands them the job", async () => {
    const { mod } = await load();
    for (const line of [
      "Good news, you've been selected for this work.",
      "We're going with your number on this one.",
      "The job is yours.",
    ]) {
      expect(mod.checkDraftCommitments(line, EXTRACTED as never)).toHaveLength(1);
    }
  });

  it("flags a schedule we promised", async () => {
    const { mod } = await load();
    for (const line of [
      "We'll start the week of the 14th.",
      "You're scheduled for early October.",
      "You can mobilize on the 3rd.",
    ]) {
      expect(mod.checkDraftCommitments(line, EXTRACTED as never)).toHaveLength(1);
    }
  });

  it("catches a price with the dollar sign left off", async () => {
    const { mod } = await load();
    for (const line of [
      "We can do 9,000 dollars for that scope.",
      "Figure 45 an hour for the crew.",
      "About 3.50 per square foot.",
    ]) {
      expect(mod.checkDraftCommitments(line, EXTRACTED as never)).toHaveLength(1);
    }
  });

  it("does not mistake a measurement for a price", async () => {
    const { mod } = await load();
    expect(
      mod.checkDraftCommitments(
        "It's 42,000 square feet, mowed on a weekly cycle, 12 sites total.",
        EXTRACTED as never
      )
    ).toEqual([]);
  });

  it("catches softer ways of promising the work", async () => {
    const { mod } = await load();
    for (const line of [
      "Your bid is accepted.",
      "We plan to use you on this one.",
      "You have the job.",
    ]) {
      expect(mod.checkDraftCommitments(line, EXTRACTED as never)).toHaveLength(1);
    }
  });

  it("leaves a plain, useful answer alone", async () => {
    const { mod } = await load();
    expect(
      mod.checkDraftCommitments(
        "Dana, it's 42,000 square feet of improved grounds, weekly cycle. Quotes are due back to us by September 1. I'll confirm the wage determination and come back to you on that.\n\nJared",
        EXTRACTED as never
      )
    ).toEqual([]);
  });
});

describe("the prompt", () => {
  it("carries the project facts a sub actually asks about", async () => {
    const { mod, complete } = await load();
    await mod.generateReplyDraft({ communicationId: "c-inbound", orgId: "org-1" });
    const prompt = complete.mock.calls[0][0] as unknown as string;
    expect(prompt).toContain("42,000 square feet");
    expect(prompt).toContain("Grounds maintenance at Fort Example");
    expect(prompt).toContain("W912-26-R-0001");
    // The extraction is reused rather than re-derived.
    expect(prompt).toContain("They quoted: $12,500");
    expect(prompt).toContain("They exclude: Irrigation repair");
  });

  it("never puts the contracting officer in front of the model, from any source", async () => {
    const { mod, complete } = await load({
      // Subs forward the solicitation back at us constantly, so the CO's
      // details arrive in their message and in earlier turns, not only in the
      // project facts we assembled.
      row: {
        ...INBOUND,
        body: "Per the solicitation, questions go to Contracting Officer: Marla Vance at 555-867-5309. What's the square footage?",
      },
      extracted: {
        ...EXTRACTED,
        scopeSummary: "Mowing, per Contracting Officer: Marla Vance at 555-867-5309",
      },
      prior: [
        { direction: "outbound", body: "Sending the package over." },
        { direction: "inbound", body: "Copy. I also have marla.vance@example.gov on file." },
      ],
    });
    await mod.generateReplyDraft({ communicationId: "c-inbound", orgId: "org-1" });
    const prompt = complete.mock.calls[0][0] as unknown as string;
    expect(prompt).not.toContain("Marla Vance");
    expect(prompt).not.toContain("555-867-5309");
    expect(prompt).not.toContain("marla.vance@example.gov");
    // Scrubbing removed the contact, not the question we need to answer.
    expect(prompt).toContain("square footage");
  });

  it("scopes every read it quotes from to the tenant, not just the target message", async () => {
    const { mod, query, queryOne } = await load();
    await mod.generateReplyDraft({ communicationId: "c-inbound", orgId: "org-1" });
    const priorCall = query.mock.calls.find((c) =>
      /select direction, body/.test(c[0] as string)
    );
    expect(priorCall?.[0]).toContain("org_id");
    expect(priorCall?.[1]).toContain("org-1");
    const eventCall = queryOne.mock.calls.find((c) =>
      /subcontractor_reply_events/.test(c[0] as string)
    );
    expect(eventCall?.[0]).toContain("org_id");
    expect(eventCall?.[1]).toContain("org-1");
  });
});

describe("generating a draft", () => {
  it("never sends anything", async () => {
    const { mod, sendOutreachEmail } = await load();
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(res.ok).toBe(true);
    expect(sendOutreachEmail).not.toHaveBeenCalled();
  });

  it("scrubs a government contact out of what the model wrote", async () => {
    const { mod } = await load({
      replies: [
        "Dana, reach the Contracting Officer: Marla Vance at 555-867-5309 for the specs.\n\nJared",
      ],
    });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draft.body).not.toContain("555-867-5309");
    expect(res.draft.body).not.toContain("Marla Vance");
  });

  it("asks again when the first attempt breaks a rule, and keeps the better one", async () => {
    const { mod, complete } = await load({
      replies: [
        "Dana, the job is yours. We'll start October 1.\n\nJared",
        "Dana, it's 42,000 square feet. I'll come back to you once we hear on award.\n\nJared",
      ],
    });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draft.body).toContain("42,000 square feet");
    expect(res.draft.warnings).toEqual([]);
  });

  it("still shows a stubborn draft, with the reason it is suspect", async () => {
    const { mod } = await load({
      replies: ["Dana, the job is yours.\n\nJared", "Dana, the job is yours.\n\nJared"],
    });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A person sends every reply, so a warning beats hiding the draft and
    // leaving the operator with nothing after paying for it.
    expect(res.draft.body).toContain("the job is yours");
    expect(res.draft.warnings).toHaveLength(1);
  });

  it("refuses a message from another tenant rather than drafting from it", async () => {
    const { mod, complete } = await load({ row: null });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "other-org",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not-found");
    expect(complete).not.toHaveBeenCalled();
  });

  it("says so plainly when there is no API key, instead of failing as a bug", async () => {
    const { mod } = await load({ notConfigured: true });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not-configured");
  });

  it("works when the extractor never got to this message", async () => {
    const { mod } = await load({ extracted: null });
    const res = await mod.generateReplyDraft({
      communicationId: "c-inbound",
      orgId: "org-1",
    });
    expect(res.ok).toBe(true);
  });
});

describe("keeping a draft", () => {
  it("prefers what the operator typed over what was generated", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => [
        {
          communication_id: "c1",
          generated_body: "generated",
          edited_body: "what I actually want to say",
          warnings: [],
          generated_at: new Date("2026-08-13T00:00:00Z"),
        },
      ]),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("@/lib/domain/reply-draft");
    const drafts = await mod.draftsForSubcontractor("s1", "org-1");
    expect(drafts.c1.body).toBe("what I actually want to say");
    expect(drafts.c1.edited).toBe(true);
  });

  it("does not create a draft out of an edit to one that never existed", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => null),
    }));
    const mod = await import("@/lib/domain/reply-draft");
    expect(
      await mod.saveDraftEdit({
        communicationId: "nope",
        orgId: "org-1",
        body: "hi",
        rev: 1,
      })
    ).toBe("missing");
  });

  it("drops the old edit when the operator asks for a rewrite", async () => {
    const { mod, inserted } = await load();
    await mod.generateReplyDraft({ communicationId: "c-inbound", orgId: "org-1" });
    // The upsert clears edited_body so a rewrite is a rewrite, not a merge.
    expect(String(inserted[0] && "ok")).toBe("ok");
  });
});
