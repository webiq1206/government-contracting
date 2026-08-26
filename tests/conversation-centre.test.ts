/**
 * What happened to a message, and who is waiting on whom.
 *
 * Two things get pinned hardest here. That a failure always beats engagement,
 * because "Opened" on a message that bounced is a confident wrong answer. And
 * that an out-of-office is not a reply, because counting it as one both
 * inflates the response rate and takes a subcontractor off the chase list on
 * the strength of a machine writing back.
 */
import { describe, it, expect } from "vitest";
import {
  messageState,
  isGenuineReply,
  isAutomatic,
  isFailure,
  MESSAGE_STATE_LABEL,
  MESSAGE_STATE_MEANING,
} from "@/lib/domain/message-state";
import {
  summarize,
  conversationCounts,
  matchesFilter,
  deliverability,
  formatRate,
  parseConversationFilter,
  preview,
  CONVERSATION_FILTERS,
  CONVERSATION_STATE_LABEL,
  type CentreMessage,
  type ThreadInput,
} from "@/lib/domain/conversation-centre";

const NOW = new Date("2026-08-26T12:00:00Z");
const at = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

function msg(over: Partial<CentreMessage> & { id: string }): CentreMessage {
  const base: CentreMessage = {
    id: over.id,
    direction: "outbound",
    delivery_state: "delivered",
    delivery_detail: null,
    opened_at: null,
    clicked_at: null,
    replied_at: null,
    subject: "Quote request",
    body: "Please quote the electrical scope.",
    created_at: at(-48),
    recipient_email: "sub@example.test",
    gmail_message_id: null,
    follow_up_at: null,
    meta: null,
    state: "sent",
  };
  const merged = { ...base, ...over };
  return { ...merged, state: messageState(merged) };
}

function thread(over: Partial<ThreadInput> & { messages: CentreMessage[] }): ThreadInput {
  return {
    threadKey: "t1",
    subcontractorId: "s1",
    subcontractorName: "Acme Electric",
    subcontractorEmail: "sub@example.test",
    opportunityId: "o1",
    opportunityTitle: "Base electrical upgrade",
    trade: "electrical",
    resolvedAt: null,
    readAt: null,
    ...over,
  };
}

describe("messageState", () => {
  it("puts failure above engagement", () => {
    /*
     * A message cannot bounce and be opened. If both are recorded the failure
     * wins, because the opposite order prints "Opened" over a message that
     * never arrived.
     */
    expect(
      messageState({
        direction: "outbound",
        delivery_state: "bounced",
        delivery_detail: "550 no such user",
        opened_at: at(-1),
        clicked_at: at(-1),
        replied_at: null,
        subject: null,
      })
    ).toBe("bounced");
  });

  it("separates a policy block from a bad address", () => {
    /*
     * The fixes are opposite. A bounce says correct the address; a block says
     * the address is probably right and the sending domain needs attention.
     */
    const block = messageState({
      direction: "outbound",
      delivery_state: "bounced",
      delivery_detail: "550 5.7.1 Message rejected due to spam policy",
      opened_at: null,
      clicked_at: null,
      replied_at: null,
      subject: null,
    });
    expect(block).toBe("blocked");
    expect(isFailure(block)).toBe(true);
  });

  it("reads engagement in order, strongest first", () => {
    const base = {
      direction: "outbound",
      delivery_state: "delivered",
      delivery_detail: null,
      subject: null,
    };
    expect(messageState({ ...base, opened_at: at(-2), clicked_at: at(-1), replied_at: at(-1) })).toBe("replied");
    expect(messageState({ ...base, opened_at: at(-2), clicked_at: at(-1), replied_at: null })).toBe("clicked");
    expect(messageState({ ...base, opened_at: at(-2), clicked_at: null, replied_at: null })).toBe("opened");
    expect(messageState({ ...base, opened_at: null, clicked_at: null, replied_at: null })).toBe("delivered");
  });

  it("does not claim delivery it has not been told about", () => {
    expect(
      messageState({
        direction: "outbound",
        delivery_state: "sent",
        delivery_detail: null,
        opened_at: null,
        clicked_at: null,
        replied_at: null,
        subject: null,
      })
    ).toBe("sent");
    expect(MESSAGE_STATE_LABEL.sent).toBe("Sent, no confirmation yet");
  });

  it("gives every state a label and a plain-English meaning", () => {
    for (const s of Object.keys(MESSAGE_STATE_LABEL) as (keyof typeof MESSAGE_STATE_LABEL)[]) {
      expect(MESSAGE_STATE_LABEL[s]).toBeTruthy();
      expect(MESSAGE_STATE_MEANING[s].length).toBeGreaterThan(15);
    }
  });
});

describe("isGenuineReply", () => {
  it("does not count an out-of-office as an answer", () => {
    const auto = {
      direction: "inbound",
      delivery_state: null,
      delivery_detail: null,
      opened_at: null,
      clicked_at: null,
      replied_at: null,
      subject: "Automatic reply: Out of office until Monday",
    };
    expect(isAutomatic(auto)).toBe(true);
    expect(isGenuineReply(auto)).toBe(false);
  });

  it("does not count a bounce notification as an answer", () => {
    for (const subject of [
      "Undeliverable: Quote request",
      "Delivery Status Notification (Failure)",
      "Mail delivery failed: returning message to sender",
      "Returned mail: see transcript for details",
      "Failure notice",
    ]) {
      expect(
        isGenuineReply({
          direction: "inbound",
          delivery_state: null,
          delivery_detail: null,
          opened_at: null,
          clicked_at: null,
          replied_at: null,
          subject,
        })
      ).toBe(false);
    }
  });

  it("counts a person writing back", () => {
    expect(
      isGenuineReply({
        direction: "inbound",
        delivery_state: null,
        delivery_detail: null,
        opened_at: null,
        clicked_at: null,
        replied_at: null,
        subject: "Re: Quote request",
      })
    ).toBe(true);
  });

  it("respects an explicit automatic flag from the poller", () => {
    expect(
      isAutomatic({ subject: "Re: Quote request", meta: { auto: true } })
    ).toBe(true);
  });
});

describe("summarize", () => {
  it("puts a message that never arrived above a reply that is waiting", () => {
    /*
     * A reply waiting is a conversation. A message that never arrived is a
     * subcontractor who does not know they were asked, and no amount of
     * waiting fixes it.
     */
    const t = thread({
      messages: [
        msg({ id: "a", direction: "inbound", subject: "Re: Quote request", created_at: at(-5) }),
        msg({ id: "b", delivery_state: "bounced", delivery_detail: "550 no such user", created_at: at(-2) }),
      ],
    });
    const s = summarize(t, NOW);
    expect(s.state).toBe("delivery_failed");
    expect(s.nextAction).toContain("Correct the email address");
  });

  it("asks for a reply when their message is the last word", () => {
    const s = summarize(
      thread({
        messages: [
          msg({ id: "a", created_at: at(-10) }),
          msg({ id: "b", direction: "inbound", subject: "Re: Quote request", created_at: at(-2) }),
        ],
      }),
      NOW
    );
    expect(s.state).toBe("needs_reply");
    expect(s.nextAction).toBe("Reply.");
  });

  it("does not ask for a reply when an out-of-office is the last word", () => {
    const s = summarize(
      thread({
        messages: [
          msg({ id: "a", created_at: at(-10) }),
          msg({ id: "b", direction: "inbound", subject: "Out of office", created_at: at(-2) }),
        ],
      }),
      NOW
    );
    expect(s.state).not.toBe("needs_reply");
  });

  it("calls a passed follow-up date overdue", () => {
    const s = summarize(
      thread({ messages: [msg({ id: "a", created_at: at(-100), follow_up_at: at(-20) })] }),
      NOW
    );
    expect(s.state).toBe("overdue");
    expect(s.followUpAt).toBe(at(-20));
  });

  it("is waiting on them while the follow-up is still ahead", () => {
    const s = summarize(
      thread({ messages: [msg({ id: "a", created_at: at(-10), follow_up_at: at(20) })] }),
      NOW
    );
    expect(s.state).toBe("awaiting_them");
    expect(s.reason).toContain("follow-up is scheduled");
  });

  it("counts unread as inbound messages newer than the last look", () => {
    const s = summarize(
      thread({
        readAt: at(-6),
        messages: [
          msg({ id: "a", direction: "inbound", subject: "Re: one", created_at: at(-10) }),
          msg({ id: "b", direction: "inbound", subject: "Re: two", created_at: at(-2) }),
          msg({ id: "c", direction: "inbound", subject: "Re: three", created_at: at(-1) }),
        ],
      }),
      NOW
    );
    expect(s.unreadCount).toBe(2);
  });

  it("treats a never-opened conversation as entirely unread", () => {
    const s = summarize(
      thread({
        readAt: null,
        messages: [
          msg({ id: "a", direction: "inbound", subject: "Re: one", created_at: at(-10) }),
          msg({ id: "b", created_at: at(-9) }),
        ],
      }),
      NOW
    );
    expect(s.unreadCount).toBe(1);
  });

  it("believes a person who marks a conversation finished", () => {
    /*
     * Including a bounced one. Somebody who resolves it has decided not to
     * chase that address, and a "Mark resolved" button that visibly does
     * nothing is worse than no button at all.
     */
    const resolved = summarize(
      thread({ resolvedAt: at(-1), messages: [msg({ id: "a", created_at: at(-2) })] }),
      NOW
    );
    expect(resolved.state).toBe("resolved");

    const bouncedThenResolved = summarize(
      thread({
        resolvedAt: at(-1),
        messages: [msg({ id: "a", delivery_state: "failed", created_at: at(-2) })],
      }),
      NOW
    );
    expect(bouncedThenResolved.state).toBe("resolved");
    // Still says what happened to the message, even while resolved.
    expect(bouncedThenResolved.failedState).toBe("failed");
  });

  it("stops believing a resolution that something has happened since", () => {
    /*
     * Resolved means resolved as of then. A message arriving afterwards is
     * exactly the case where a stale decision would hide live work.
     */
    const s = summarize(
      thread({
        resolvedAt: at(-10),
        messages: [
          msg({ id: "a", created_at: at(-12) }),
          msg({ id: "b", direction: "inbound", subject: "Re: quote", created_at: at(-2) }),
        ],
      }),
      NOW
    );
    expect(s.state).toBe("needs_reply");
  });

  it("takes the thread subject from the first message that has one", () => {
    const s = summarize(
      thread({
        messages: [
          msg({ id: "a", subject: "Quote request: base electrical", created_at: at(-10) }),
          msg({ id: "b", direction: "inbound", subject: "Re: Quote request: base electrical", created_at: at(-2) }),
        ],
      }),
      NOW
    );
    expect(s.subject).toBe("Quote request: base electrical");
  });

  it("names a sender it does not know rather than showing an empty row", () => {
    const s = summarize(
      thread({ subcontractorName: "", messages: [msg({ id: "a" })] }),
      NOW
    );
    expect(s.subcontractorName).toBe("Unknown sender");
  });

  it("gives every state a label", () => {
    for (const st of Object.keys(CONVERSATION_STATE_LABEL) as (keyof typeof CONVERSATION_STATE_LABEL)[]) {
      expect(CONVERSATION_STATE_LABEL[st]).toBeTruthy();
    }
  });
});

describe("counts and filters", () => {
  const list = [
    summarize(thread({ threadKey: "n", messages: [msg({ id: "1", created_at: at(-10) }), msg({ id: "2", direction: "inbound", subject: "Re: x", created_at: at(-1) })] }), NOW),
    summarize(thread({ threadKey: "f", messages: [msg({ id: "3", delivery_state: "failed" })] }), NOW),
    summarize(thread({ threadKey: "o", messages: [msg({ id: "4", created_at: at(-100), follow_up_at: at(-20) })] }), NOW),
    summarize(thread({ threadKey: "w", messages: [msg({ id: "5", created_at: at(-2), follow_up_at: at(30) })] }), NOW),
  ];

  it("counts each conversation once, in its worst state", () => {
    const c = conversationCounts(list);
    expect(c.needsReply).toBe(1);
    expect(c.deliveryFailed).toBe(1);
    expect(c.overdue).toBe(1);
    expect(c.unread).toBe(1);
  });

  it("matches each filter to exactly its conversations", () => {
    expect(list.filter((c) => matchesFilter(c, "all"))).toHaveLength(4);
    expect(list.filter((c) => matchesFilter(c, "needs_reply")).map((c) => c.threadKey)).toEqual(["n"]);
    expect(list.filter((c) => matchesFilter(c, "delivery_failed")).map((c) => c.threadKey)).toEqual(["f"]);
    expect(list.filter((c) => matchesFilter(c, "overdue")).map((c) => c.threadKey)).toEqual(["o"]);
    expect(list.filter((c) => matchesFilter(c, "awaiting_them")).map((c) => c.threadKey)).toEqual(["w"]);
  });

  it("falls open to everything on a bad filter", () => {
    expect(parseConversationFilter("nonsense")).toBe("all");
    expect(parseConversationFilter(undefined)).toBe("all");
    expect(parseConversationFilter(["needs_reply"])).toBe("needs_reply");
    expect(CONVERSATION_FILTERS).toContain("all");
  });
});

describe("deliverability", () => {
  it("reports no rate rather than 0% when nothing has been sent", () => {
    /*
     * A brand new account showing "0% delivered" is being told its mail is
     * failing. It is both false and the most alarming possible reading of no
     * data.
     */
    const d = deliverability([]);
    expect(d.deliveryRate).toBeNull();
    expect(d.responseRate).toBeNull();
    expect(d.bounceRate).toBeNull();
    expect(formatRate(null)).toBe("Nothing sent yet");
  });

  it("computes rates over outbound mail only", () => {
    const d = deliverability([
      msg({ id: "1", delivery_state: "delivered" }),
      msg({ id: "2", delivery_state: "delivered" }),
      msg({ id: "3", delivery_state: "bounced", delivery_detail: "550 no such user" }),
      msg({ id: "4", delivery_state: "failed" }),
      msg({ id: "5", direction: "inbound", subject: "Re: quote" }),
    ]);
    expect(d.sent).toBe(4);
    expect(d.deliveryRate).toBeCloseTo(0.5);
    expect(d.bounceRate).toBeCloseTo(0.25);
    expect(d.failed).toBe(1);
    expect(formatRate(d.deliveryRate)).toBe("50%");
  });

  it("does not let automatic mail inflate the response rate", () => {
    const d = deliverability([
      msg({ id: "1", delivery_state: "delivered" }),
      msg({ id: "2", delivery_state: "delivered" }),
      msg({ id: "3", direction: "inbound", subject: "Out of office" }),
      msg({ id: "4", direction: "inbound", subject: "Undeliverable: quote" }),
    ]);
    expect(d.responseRate).toBe(0);
  });

  it("never reports a response rate above 100%", () => {
    // Two people on one thread can both write back to one outbound message.
    const d = deliverability([
      msg({ id: "1", delivery_state: "delivered" }),
      msg({ id: "2", direction: "inbound", subject: "Re: quote" }),
      msg({ id: "3", direction: "inbound", subject: "Re: quote again" }),
    ]);
    expect(d.responseRate).toBe(1);
    expect(formatRate(d.responseRate)).toBe("100%");
  });
});

describe("preview", () => {
  it("strips markup and collapses whitespace", () => {
    expect(preview("<p>Hello   there</p>\n<p>second</p>")).toBe("Hello there second");
  });

  it("says nothing rather than something wrong for an empty body", () => {
    expect(preview(null)).toBe("");
    expect(preview("")).toBe("");
  });

  it("cuts long text at the limit", () => {
    const out = preview("x".repeat(300), 40);
    expect(out.length).toBe(40);
    expect(out.endsWith("…")).toBe(true);
  });
});
