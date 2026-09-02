/**
 * What can be done to a record from a list row, without opening it.
 *
 * Every surface in this product grew its own row controls: Today has a snooze
 * dropdown and a pursue button, the pipeline board has a card menu, the call
 * queue has nothing at all, and the roster has two links. The same
 * subcontractor could be stopped from one screen and not another, and the
 * rules for when a control was allowed lived in whichever component happened
 * to render it.
 *
 * This module is the one answer to "what can this person do to this record
 * right now". It takes the record's own facts and the viewer's role and
 * returns the actions, already ordered, already labelled, each carrying how it
 * runs and what it says afterwards. It touches nothing: no database, no fetch,
 * no React. That is what makes the gating testable, and it is why a rule fixed
 * here is fixed on every screen at once rather than on the one somebody
 * remembered.
 *
 * Two rules run through all of it:
 *
 * 1. An action the viewer's role cannot perform is absent, not disabled. A
 *    greyed-out button is a promise the server will refuse.
 * 2. An action that makes no sense for the record's state is absent too. There
 *    is no "pursue" on a won bid and no "skip call" on a call already made.
 */

import { can, type Capability } from "./roles";
import { MANUAL_MOVE_TARGETS, type ManualMoveTarget } from "./stage-move";

/** Who is looking, in the only terms this module needs. */
export interface ActionViewer {
  role: string | null | undefined;
}

export type RowActionRun =
  /** A mutation. The component POSTs it, with a confirmation if one is set. */
  | { via: "post"; endpoint: string; body?: Record<string, unknown> }
  /** Navigation: a call workspace, a reply composer, a phone dialler. */
  | { via: "link"; href: string }
  /**
   * A control that already exists and is too rich to be a button: passing with
   * a reason, skipping a call with a scope, stopping outreach after being told
   * what that cancels. The row opens the real control rather than growing a
   * second, thinner implementation of the same decision.
   */
  | { via: "widget"; widget: RowWidget };

export type RowWidget =
  | { name: "pass"; opportunityId: string; title: string }
  | { name: "move_stage"; opportunityId: string; stage: string }
  | { name: "reassign"; kind: "opportunity" | "subcontractor"; recordId: string }
  | {
      name: "skip_call";
      callCardId: string;
      companyName: string;
      trade: string | null;
    }
  | {
      name: "stop_outreach";
      subcontractorId: string;
      companyName: string;
      opportunityId: string | null;
      trade: string | null;
    }
  | { name: "abort_bid"; opportunityId: string; title: string };

export interface RowAction {
  /** Stable identity, for React keys and for tests to name what they assert. */
  key: string;
  label: string;
  /** One clause under the label in a menu, where the verb alone is thin. */
  hint?: string;
  /**
   * The one action worth a button of its own on the row. At most one per set;
   * everything else lives behind the overflow menu.
   */
  primary?: boolean;
  /** Renders in the warning tone. Not the same as needing a confirmation. */
  danger?: boolean;
  run: RowActionRun;
  /**
   * Asked before anything happens. Present only where the action cannot be
   * taken back with a click, because a confirmation on a reversible action
   * teaches people to click through confirmations.
   */
  confirm?: { title: string; body: string; confirmLabel: string };
  /**
   * What the row says afterwards, and how to take it back.
   *
   * The message lives in the toast rather than the row because acting usually
   * removes the row: a sentence rendered where the record was is a sentence
   * nobody reads.
   */
  toast?: {
    message: string;
    undo?: { endpoint: string; body?: Record<string, unknown> };
  };
}

// ---------------------------------------------------------------------------
// Stage knowledge
// ---------------------------------------------------------------------------

/**
 * Pipeline order, for the questions that are about position rather than name:
 * whether a stage can be sent back, and whether a bid is far enough along that
 * aborting it means something.
 */
export const STAGE_ORDER = [
  "monitoring",
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
  "won",
  "lost",
  "dismissed",
] as const;

/** Nothing is done to a record that has finished. */
const CLOSED_STAGES = new Set(["won", "lost", "dismissed", "archived"]);

/** Where pursue-or-pass is still the open question. */
const DECISION_STAGES = new Set(["monitoring", "scoring", "analysis"]);

/** Stages an agent produced, and can therefore be asked to produce again. */
const AGENT_STAGES = new Set([
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "bid_building",
]);

/**
 * Where "move it to" is offered, and to what.
 *
 * Named from the stages the move endpoint accepts rather than from a list
 * typed out here. A hand-kept copy had already lost scoring and the call
 * queue, so two moves the server allows could not be made from a row, and the
 * row's idea of the pipeline would have drifted further every time a stage
 * moved.
 */
const MOVE_LABEL: Record<ManualMoveTarget, string> = {
  scoring: "Scoring",
  analysis: "Analysis",
  sub_research: "Find subs",
  outreach: "Outreach",
  call_queue: "Call queue",
  quote_entry: "Quotes",
  bid_building: "Bid building",
  submitted: "Submitted",
};

export const MOVE_TARGETS: { stage: string; label: string }[] = MANUAL_MOVE_TARGETS.map(
  (stage) => ({ stage, label: MOVE_LABEL[stage] })
);

function stageIndex(stage: string): number {
  const at = (STAGE_ORDER as readonly string[]).indexOf(stage);
  return at === -1 ? 0 : at;
}

function allowed(viewer: ActionViewer, capability: Capability): boolean {
  return can(viewer.role, capability);
}

// ---------------------------------------------------------------------------
// Snooze, which four record kinds share
// ---------------------------------------------------------------------------

const SNOOZE_NOTE =
  "Deadline alerts and follow-ups keep running while it is out of the way.";

/**
 * Hide it for a bit, and bring it back.
 *
 * Two fixed offsets rather than a picker: a row control is used mid-scroll,
 * and a date picker there is a decision where a tap was wanted. The full
 * picker still lives on the record.
 */
function snoozeActions(
  kind: "opportunity" | "call_card",
  id: string,
  snoozedUntil: string | null | undefined
): RowAction[] {
  const undo = { endpoint: "/api/snooze", body: { kind, id, until: null } };

  if (snoozedUntil) {
    return [
      {
        key: "wake",
        label: "Bring it back now",
        hint: "Ends the snooze and puts it back on the queue.",
        run: { via: "post", endpoint: "/api/snooze", body: { kind, id, until: null } },
        toast: { message: "Back on the queue." },
      },
    ];
  }

  return [
    {
      key: "snooze_tomorrow",
      label: "Snooze until tomorrow",
      hint: SNOOZE_NOTE,
      run: {
        via: "post",
        endpoint: "/api/snooze",
        body: { kind, id, until: "tomorrow" },
      },
      toast: { message: "Hidden until tomorrow.", undo },
    },
    {
      key: "snooze_3d",
      label: "Snooze for 3 days",
      hint: SNOOZE_NOTE,
      run: { via: "post", endpoint: "/api/snooze", body: { kind, id, until: "3d" } },
      toast: { message: "Hidden for 3 days.", undo },
    },
  ];
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export interface OpportunityActionFacts {
  id: string;
  title?: string | null;
  stage: string;
  /** `archived` after a pass. Anything else is a live record. */
  status?: string | null;
  /** When the row was read with it. Absent means "not asked", not "active". */
  pursuitState?: string | null;
  snoozedUntil?: string | null;
  /** True where the surface can offer an owner picker. */
  canReassign?: boolean;
}

export function opportunityRowActions(
  o: OpportunityActionFacts,
  viewer: ActionViewer
): RowAction[] {
  const closed = CLOSED_STAGES.has(o.stage) || o.status === "archived";
  const title = o.title?.trim() || "this opportunity";
  const out: RowAction[] = [];

  const decide = allowed(viewer, "decide");
  const endpoint = `/api/opportunities/${o.id}/action`;

  if (closed) {
    /*
     * A passed record keeps exactly one action: undoing the pass. Everything
     * else would be work on a record somebody has already decided about, and
     * a won or lost bid has no next move at all from a list row.
     */
    if (decide && o.stage === "dismissed") {
      out.push({
        key: "restore",
        label: "Put it back in play",
        hint: "Returns it to review with its scoring intact.",
        run: { via: "post", endpoint, body: { action: "restore" } },
        toast: { message: `${title} is back in review.` },
      });
    }
    return out;
  }

  if (decide && DECISION_STAGES.has(o.stage)) {
    out.push({
      key: "pursue",
      label: "Pursue",
      hint: "Starts sub research and outreach for this bid.",
      primary: true,
      run: { via: "post", endpoint, body: { action: "pursue" } },
      toast: { message: `Pursuing ${title}.` },
    });
  }

  if (decide && o.stage !== "submitted") {
    out.push({
      key: "pass",
      label: "Pass on it",
      hint: "Needs a reason, and can be undone.",
      danger: true,
      run: { via: "widget", widget: { name: "pass", opportunityId: o.id, title } },
    });
  }

  if (decide) {
    out.push(...snoozeActions("opportunity", o.id, o.snoozedUntil));
    out.push({
      key: "move_stage",
      label: "Move to a stage",
      hint: "For when the record is behind where the work actually is.",
      run: {
        via: "widget",
        widget: { name: "move_stage", opportunityId: o.id, stage: o.stage },
      },
    });
    if (stageIndex(o.stage) > 1) {
      out.push({
        key: "send_back",
        label: "Send back a stage",
        hint: "Re-opens the previous step so it can run again.",
        run: { via: "post", endpoint, body: { action: "send_back" } },
        toast: { message: "Sent back a stage." },
      });
    }
  }

  /*
   * Re-running is gated the way the endpoint gates it, on `decide` rather than
   * on `run_agents`. Reading the capability name and guessing looked right and
   * was wrong: a team member can decide, the action route lets them re-run,
   * and a stricter row would have hidden a working button from the people who
   * hit stalled scoring most often.
   */
  if (decide && AGENT_STAGES.has(o.stage)) {
    out.push({
      key: "rerun",
      label: "Re-run this stage",
      hint: "Asks the agent for this stage to have another go.",
      run: { via: "post", endpoint, body: { action: "rerun" } },
      toast: { message: "Queued for another run." },
    });
  }

  /*
   * Aborting is offered only once there is a pursuit to abort, and never as a
   * quiet one-click: it stops every queued message and call for the bid. It
   * has no undo here on purpose. Coming back from an abort is a restart, which
   * rebuilds against a solicitation that may have been amended since, and that
   * is a decision for the record page rather than a row.
   *
   * It opens the record's own abort control rather than posting. The endpoint
   * requires a structured reason and the phrase typed back, so a row that
   * posted `{ action: "abort" }` behind a yes/no dialog would have failed on
   * every click, and the operator would have been told "that could not be
   * recorded" for an action the product plainly offers them.
   */
  if (
    allowed(viewer, "outreach") &&
    stageIndex(o.stage) >= stageIndex("sub_research") &&
    o.stage !== "submitted" &&
    o.pursuitState !== "aborted"
  ) {
    out.push({
      key: "abort_bid",
      label: "Abort this bid",
      danger: true,
      hint: "Stops all outreach and automation for it. Asks for a reason.",
      run: {
        via: "widget",
        widget: { name: "abort_bid", opportunityId: o.id, title },
      },
    });
  }

  if (decide && o.canReassign !== false) {
    out.push({
      key: "reassign",
      label: "Change who has it",
      run: {
        via: "widget",
        widget: { name: "reassign", kind: "opportunity", recordId: o.id },
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Call cards
// ---------------------------------------------------------------------------

export interface CallCardActionFacts {
  id: string;
  companyName: string;
  trade?: string | null;
  subcontractorId?: string | null;
  opportunityId?: string | null;
  /** queued / pending / called / skipped. */
  status?: string | null;
  snoozedUntil?: string | null;
  outreachStopped?: boolean;
  /** Where the guided call workspace opens. */
  openHref?: string;
}

export function callCardRowActions(
  c: CallCardActionFacts,
  viewer: ActionViewer
): RowAction[] {
  const out: RowAction[] = [];
  const done = c.status === "called" || c.status === "completed";
  const skipped = c.status === "skipped";

  if (allowed(viewer, "outreach") && !done) {
    out.push({
      key: "start_call",
      label: skipped ? "Open the card" : "Start the call",
      primary: true,
      run: { via: "link", href: c.openHref ?? `/call-queue?open=${c.id}` },
    });
  }

  if (allowed(viewer, "outreach") && !done && !skipped) {
    out.push({
      key: "skip_call",
      label: "Skip this call",
      hint: "Asks why, so the queue can be fixed rather than just shortened.",
      run: {
        via: "widget",
        widget: {
          name: "skip_call",
          callCardId: c.id,
          companyName: c.companyName,
          trade: c.trade ?? null,
        },
      },
    });
  }

  if (allowed(viewer, "decide") && !done && !skipped) {
    out.push(...snoozeActions("call_card", c.id, c.snoozedUntil));
  }

  if (allowed(viewer, "outreach") && c.subcontractorId && !c.outreachStopped) {
    out.push({
      key: "stop_outreach",
      label: "Stop outreach to them",
      danger: true,
      hint: "Shows what it cancels before anything stops.",
      run: {
        via: "widget",
        widget: {
          name: "stop_outreach",
          subcontractorId: c.subcontractorId,
          companyName: c.companyName,
          opportunityId: c.opportunityId ?? null,
          trade: c.trade ?? null,
        },
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationActionFacts {
  threadKey: string;
  subcontractorId: string | null;
  subcontractorName: string;
  opportunityId?: string | null;
  trade?: string | null;
  /** The thread, open, on whichever surface is asking. */
  openHref: string;
  outreachStopped?: boolean;
}

/** Append a query parameter to a href that may or may not already have one. */
function withParam(href: string, key: string, value: string): string {
  const [path, hash = ""] = href.split("#");
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}${key}=${value}${hash ? `#${hash}` : ""}`;
}

export function conversationRowActions(
  c: ConversationActionFacts,
  viewer: ActionViewer
): RowAction[] {
  const out: RowAction[] = [];
  if (!allowed(viewer, "outreach") || !c.subcontractorId) return out;

  out.push({
    key: "reply",
    label: "Reply",
    primary: true,
    run: { via: "link", href: withParam(c.openHref, "compose", "reply") },
  });

  /*
   * Asking for something missing is the most common reply in this inbox and
   * the one most likely to be put off, so it gets its own entry. It opens the
   * same composer with the question already written: there is no separate
   * "request information" mutation, and inventing one would be a second way
   * to put mail in front of a subcontractor.
   */
  out.push({
    key: "request_info",
    label: "Ask them for what is missing",
    hint: "Opens a reply with the question already written.",
    run: { via: "link", href: withParam(c.openHref, "compose", "request_info") },
  });

  if (!c.outreachStopped) {
    out.push({
      key: "stop_outreach",
      label: "Stop outreach to them",
      danger: true,
      hint: "Shows what it cancels before anything stops.",
      run: {
        via: "widget",
        widget: {
          name: "stop_outreach",
          subcontractorId: c.subcontractorId,
          companyName: c.subcontractorName,
          opportunityId: c.opportunityId ?? null,
          trade: c.trade ?? null,
        },
      },
    });
  }

  return out;
}

/**
 * The prefilled body behind "ask them for what is missing".
 *
 * A first line and a sign-off, and nothing in the middle pretending to know
 * which detail is outstanding. The operator names it in one sentence, which is
 * faster than deleting a paragraph of guesses.
 */
export function requestInfoMessage(opts: {
  companyName?: string | null;
  trade?: string | null;
  opportunityTitle?: string | null;
}): string {
  const who = opts.companyName?.trim();
  const trade = opts.trade?.trim();
  const bid = opts.opportunityTitle?.trim();
  const about = [trade, bid].filter(Boolean).join(" on ");
  return [
    who ? `Hi ${who},` : "Hi,",
    "",
    about
      ? `Following up on ${about}. Before we can move ahead I need one more thing from you:`
      : "Following up on our last message. Before we can move ahead I need one more thing from you:",
    "",
    "",
    "Send it over when you get a chance and I will take it from there.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Subcontractors
// ---------------------------------------------------------------------------

export interface SubActionFacts {
  id: string;
  companyName: string;
  phone?: string | null;
  email?: string | null;
  emailVerified?: boolean;
  outreachStopped?: boolean;
  canReassign?: boolean;
}

export function subcontractorRowActions(
  s: SubActionFacts,
  viewer: ActionViewer
): RowAction[] {
  const out: RowAction[] = [];

  if (s.phone) {
    out.push({
      key: "call_sub",
      label: "Call",
      primary: true,
      run: { via: "link", href: `tel:${s.phone.replace(/[^\d+]/g, "")}` },
    });
  }

  /*
   * An unverified address is not offered. Writing to one opens a mail client
   * addressed somewhere that has not passed a check, which is how a bid loses
   * a quote to a bounce nobody saw.
   */
  if (s.email && s.emailVerified && allowed(viewer, "outreach")) {
    out.push({
      key: "email_sub",
      label: "Email",
      primary: !s.phone,
      run: { via: "link", href: `mailto:${s.email}` },
    });
  }

  if (allowed(viewer, "outreach") && !s.outreachStopped) {
    out.push({
      key: "stop_outreach",
      label: "Stop outreach to them",
      danger: true,
      hint: "Shows what it cancels before anything stops.",
      run: {
        via: "widget",
        widget: {
          name: "stop_outreach",
          subcontractorId: s.id,
          companyName: s.companyName,
          opportunityId: null,
          trade: null,
        },
      },
    });
  }

  if (allowed(viewer, "decide") && s.canReassign !== false) {
    out.push({
      key: "reassign",
      label: "Change who has it",
      run: {
        via: "widget",
        widget: { name: "reassign", kind: "subcontractor", recordId: s.id },
      },
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Today's queue, which is a view of all of the above
// ---------------------------------------------------------------------------

/**
 * What a queue row knows about itself.
 *
 * Deliberately the subset of WorkItem this needs rather than the type itself:
 * the queue builds rows from five different reads, and a function that only
 * asks for what it uses can be given a row from any of them.
 */
export interface WorkItemActionFacts {
  record?: { kind: string; id: string } | null;
  opportunityId?: string | null;
  href: string;
  actionLabel: string;
  /** Present on rows where the decision itself is the task. */
  decide?: boolean;
  snooze?: { kind: "opportunity" | "call_card"; id: string } | null;
  call?: { companyName: string; trade?: string | null; subcontractorId?: string | null } | null;
  title?: string | null;
}

export function workItemRowActions(
  item: WorkItemActionFacts,
  viewer: ActionViewer
): RowAction[] {
  const kind = item.record?.kind;

  if (kind === "call_card" && item.record) {
    return callCardRowActions(
      {
        id: item.record.id,
        companyName: item.call?.companyName ?? "this subcontractor",
        trade: item.call?.trade ?? null,
        subcontractorId: item.call?.subcontractorId ?? null,
        opportunityId: item.opportunityId ?? null,
        openHref: item.href,
      },
      viewer
    );
  }

  if (kind === "opportunity" && item.record) {
    const out: RowAction[] = [];
    if (item.decide && allowed(viewer, "decide")) {
      out.push({
        key: "pursue",
        label: "Pursue",
        primary: true,
        run: {
          via: "post",
          endpoint: `/api/opportunities/${item.record.id}/action`,
          body: { action: "pursue" },
        },
        toast: { message: `Pursuing ${item.title?.trim() || "it"}.` },
      });
      out.push({
        key: "pass",
        label: "Pass on it",
        danger: true,
        hint: "Needs a reason, and can be undone.",
        run: {
          via: "widget",
          widget: {
            name: "pass",
            opportunityId: item.record.id,
            title: item.title?.trim() || "this opportunity",
          },
        },
      });
    }
    if (item.snooze && allowed(viewer, "decide")) {
      out.push(...snoozeActions(item.snooze.kind, item.snooze.id, null));
    }
    return out;
  }

  /*
   * Everything else (a reply to read, a pairing waiting on somebody) can still
   * be snoozed where the queue said so, and nothing else: the work on those
   * rows is reading something, and there is no version of that which happens
   * from a list.
   */
  if (item.snooze && allowed(viewer, "decide")) {
    return snoozeActions(item.snooze.kind, item.snooze.id, null);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Presentation split
// ---------------------------------------------------------------------------

/**
 * One button and a menu.
 *
 * The primary is the action the row exists to make easy; everything else is
 * one tap further away. A row with three buttons on it is a row nobody reads,
 * and on a phone it is a row whose buttons overlap.
 */
export function splitRowActions(actions: RowAction[]): {
  primary: RowAction | null;
  secondary: RowAction[];
} {
  const at = actions.findIndex((a) => a.primary);
  if (at === -1) return { primary: null, secondary: actions };
  return {
    primary: actions[at],
    secondary: actions.filter((_, i) => i !== at),
  };
}
