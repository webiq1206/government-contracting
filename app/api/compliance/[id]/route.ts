import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import {
  RECURRENCES as RECURRENCE_KEYS,
  nextDueDate,
} from "@/lib/domain/compliance-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Edit the operator-owned fields on a compliance item: the renewal date, a
 * status override, a reference/renewal link, a link to the proof document, and
 * notes. The Compliance Monitor never writes these, so an edit survives its
 * daily run.
 */

/*
 * The states a person may set by hand.
 *
 * "Expiring soon" and "Expired" are absent on purpose: both are arithmetic
 * over a date, and an override that says "expired" on a certificate valid for
 * another year is a claim the record cannot support. Change the date instead,
 * and the state follows.
 */
const STATUSES = new Set([
  "complete",
  "incomplete",
  "blocked",
  "needs_review",
  "conflicting",
  "cannot_monitor",
]);

const RECURRENCES = new Set<string>(RECURRENCE_KEYS);

/**
 * What actually changed, in the words it will be read in.
 *
 * Compared before against after rather than trusting the request, because a
 * form that posts every field would otherwise record an edit to each one on
 * every save, and a history full of changes nobody made is one people stop
 * reading.
 */
function describeChange(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): { kind: string; summary: string; fields: Record<string, unknown> } {
  const WATCHED: [string, string][] = [
    ["due_at_override", "the renewal date"],
    ["status_override", "the state"],
    ["notes", "the notes"],
    ["link_url", "the renewal link"],
    ["doc_url", "the document link"],
    ["time_zone", "the timezone"],
    ["recurrence", "how often it repeats"],
    ["window_days", "how far ahead it warns"],
    ["escalate_after_days", "when it escalates"],
    ["escalate_to", "who it escalates to"],
    ["conflict_detail", "the disagreement between sources"],
    ["needs_review_reason", "why it needs a person"],
    ["blocked_by", "what it is waiting on"],
    ["monitorable", "whether we can check it"],
    ["verified_at", "when somebody last confirmed it"],
  ];
  const fields: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const [col, phrase] of WATCHED) {
    const a = norm(before[col]);
    const b = norm(after[col]);
    if (a === b) continue;
    fields[col] = { from: a, to: b };
    parts.push(b === null ? `cleared ${phrase}` : `set ${phrase}`);
  }
  const kind = "verified_at" in fields
    ? "verified"
    : "status_override" in fields
      ? "state_changed"
      : "edited";
  return { kind, summary: parts.join(", "), fields };
}

function norm(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === "" ? null : s;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_compliance" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  /*
   * The whole row, not just the label.
   *
   * Every edit used to go to a flat application log this page never reads, so
   * "who moved this date and on what authority" had nowhere to be answered
   * from. On federal work that is the question an auditor asks, and answering
   * it needs the values before as well as after.
   */
  const item = await queryOne<Record<string, unknown>>(
    `select * from compliance_items where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const label = String(item.label ?? "this item");

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if ("due_at_override" in body) {
    const raw = body.due_at_override;
    let dt: string | null = null;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "That date is not valid." }, { status: 400 });
      }
      dt = parsed.toISOString();
    }
    sets.push(`due_at_override=$${i++}`);
    values.push(dt);
  }

  if ("status_override" in body) {
    const raw = typeof body.status_override === "string" ? body.status_override.trim() : "";
    if (raw !== "" && !STATUSES.has(raw)) {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
    sets.push(`status_override=$${i++}`);
    values.push(raw === "" ? null : raw);
  }

  for (const col of [
    "notes", "link_url", "doc_url",
    // The facts a compliance item needs to be worked, none of which the
    // editor could reach: which timezone the date lives in, why two sources
    // disagree, why a machine reading wants a person, and what has to happen
    // first.
    "time_zone", "conflict_detail", "needs_review_reason", "blocked_by", "escalate_to",
  ] as const) {
    if (col in body) {
      const v = typeof body[col] === "string" ? (body[col] as string).trim() : "";
      sets.push(`${col}=$${i++}`);
      values.push(v === "" ? null : v);
    }
  }

  if ("recurrence" in body) {
    const raw = typeof body.recurrence === "string" ? body.recurrence.trim() : "";
    if (raw !== "" && !RECURRENCES.has(raw)) {
      return NextResponse.json({ error: "That is not a schedule." }, { status: 400 });
    }
    sets.push(`recurrence=$${i++}`);
    values.push(raw === "" ? null : raw);
  }

  for (const col of ["window_days", "escalate_after_days", "recurrence_months"] as const) {
    if (col in body) {
      const raw = body[col];
      if (raw == null || raw === "") {
        sets.push(`${col}=$${i++}`);
        values.push(null);
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        return NextResponse.json(
          { error: "That has to be a whole number of days above zero, or left empty." },
          { status: 400 }
        );
      }
      sets.push(`${col}=$${i++}`);
      values.push(n);
    }
  }

  if ("monitorable" in body) {
    sets.push(`monitorable=$${i++}`);
    values.push(Boolean(body.monitorable));
  }

  /*
   * Marking an item verified is a claim a person makes, so it records who
   * made it. Distinct from last_checked_at, which is when a machine looked.
   */
  if (body.verified === true) {
    sets.push(`verified_at=now()`);
    sets.push(`verified_by=$${i++}`);
    values.push(auth.id);
    sets.push(`satisfied_at=coalesce(satisfied_at, now())`);
  }

  /*
   * Renewing a recurring item rolls its date forward rather than leaving it
   * expired. Every renewal used to be a new item somebody had to remember to
   * create, which is exactly the memory this board exists to replace.
   *
   * Rolled from the date that just passed, not from today, so an item renewed
   * three weeks late still lands on its real anniversary instead of drifting
   * later every year.
   */
  if (body.renewed === true) {
    const from = item.due_at_override ?? item.due_at;
    const next = nextDueDate(
      from as string | Date | null,
      item.recurrence as string | null,
      item.recurrence_months as number | null
    );
    if (!next) {
      return NextResponse.json(
        { error: "This item has no schedule and no date to roll forward from." },
        { status: 400 }
      );
    }
    sets.push(`due_at_override=$${i++}`);
    values.push(next);
    // Renewed means satisfied again, and the old override no longer applies.
    sets.push(`satisfied_at=now()`);
    sets.push(`status_override=null`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  values.push(params.id);
  const after = await queryOne<Record<string, unknown>>(
    `update compliance_items set ${sets.join(", ")}, updated_at=now() where id=$${i}
     returning *`,
    values
  );

  /*
   * The history this record never had.
   *
   * Written from the before and after rather than from the request, so a
   * field the request named but did not actually change does not appear as a
   * change. A log that reports edits nobody made is one people stop reading.
   */
  const changes = describeChange(item, after ?? {});
  if (changes.summary) {
    await query(
      `insert into compliance_item_events
         (org_id, item_id, kind, summary, changes, actor_id, actor_label)
       values ($1,$2,$3,$4,$5::jsonb,$6::uuid,$7)`,
      [
        orgId, params.id,
        body.verified === true ? "verified" : changes.kind,
        changes.summary, JSON.stringify(changes.fields), auth.id, auth.email,
      ]
    ).catch(() => {});
  }

  await logAgent({
    agent: "operator",
    action: "compliance-edit",
    level: "info",
    message: `Operator ${auth.email} edited compliance item "${label}": ${changes.summary || "no change"}`,
  });

  return NextResponse.json({ ok: true });
}

/** Delete an operator-created item. Monitor-managed items can't be deleted here
 *  (the monitor would just recreate them), so this only removes source='operator'. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_compliance" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const item = await queryOne<{ id: string; label: string; source: string }>(
    `select id, label, coalesce(source,'monitor') as source from compliance_items where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.source !== "operator") {
    return NextResponse.json(
      { error: "This item is tracked automatically and can't be deleted." },
      { status: 400 }
    );
  }

  await query(`delete from compliance_items where id=$1`, [params.id]);
  await logAgent({
    agent: "operator",
    action: "compliance-delete",
    level: "info",
    message: `${auth.email} deleted compliance item "${item.label}".`,
  });
  return NextResponse.json({ ok: true });
}
