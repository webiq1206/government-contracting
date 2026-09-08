import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { tenantTransaction } from "@/lib/db";
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
    ["recurrence_months", "the custom repeat interval"],
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

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Expected a compliance update object." }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "The compliance update is not valid JSON." }, { status: 400 });
  }
  type Failure = { ok: false; status: 400 | 404; error: string };
  type Success = {
    ok: true;
    label: string;
    changes: ReturnType<typeof describeChange>;
  };

  let result: Failure | Success;
  try {
    result = await tenantTransaction(orgId, async (client): Promise<Failure | Success> => {
      /*
       * Lock the whole before-image. The update and immutable history row use
       * this same connection, so an event failure rolls the change back and a
       * concurrent edit cannot make the before/after story false.
       */
      const selected = await client.query<Record<string, unknown>>(
        `select *
           from compliance_items
          where id = $1 and org_id = $2
          for update`,
        [params.id, orgId]
      );
      const item = selected.rows[0];
      if (!item) return { ok: false, status: 404, error: "Not found" };

      for (const action of ["verified", "renewed"] as const) {
        if (action in body && typeof body[action] !== "boolean") {
          return {
            ok: false,
            status: 400,
            error: `${action === "verified" ? "Verified" : "Renewed"} must be true or false.`,
          };
        }
      }

      if (
        body.renewed === true &&
        (body.verified === true ||
          "due_at_override" in body ||
          "status_override" in body ||
          "recurrence" in body ||
          "recurrence_months" in body)
      ) {
        return {
          ok: false,
          status: 400,
          error: "Renew the item separately from changing its date, state, schedule, or verification.",
        };
      }

      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;

      if ("due_at_override" in body) {
        const raw = body.due_at_override;
        let dt: string | null = null;
        if (raw != null && typeof raw !== "string") {
          return { ok: false, status: 400, error: "The renewal date must be a date or empty." };
        }
        if (typeof raw === "string" && raw.trim() !== "") {
          const parsed = new Date(raw);
          if (Number.isNaN(parsed.getTime())) {
            return { ok: false, status: 400, error: "That date is not valid." };
          }
          dt = parsed.toISOString();
        }
        sets.push(`due_at_override=$${i++}`);
        values.push(dt);
      }

      if ("status_override" in body) {
        if (body.status_override != null && typeof body.status_override !== "string") {
          return { ok: false, status: 400, error: "The state must be text or empty." };
        }
        const raw =
          typeof body.status_override === "string" ? body.status_override.trim() : "";
        if (raw !== "" && !STATUSES.has(raw)) {
          return { ok: false, status: 400, error: "Unknown status." };
        }
        sets.push(`status_override=$${i++}`);
        values.push(raw === "" ? null : raw);
      }

      for (const col of [
        "notes",
        "link_url",
        "doc_url",
        "time_zone",
        "conflict_detail",
        "needs_review_reason",
        "blocked_by",
        "escalate_to",
      ] as const) {
        if (col in body) {
          if (body[col] != null && typeof body[col] !== "string") {
            return {
              ok: false,
              status: 400,
              error: `${col.replaceAll("_", " ")} must be text or empty.`,
            };
          }
          const v = typeof body[col] === "string" ? body[col].trim() : "";
          if ((col === "link_url" || col === "doc_url") && v) {
            try {
              const parsed = new URL(v);
              if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error();
            } catch {
              return {
                ok: false,
                status: 400,
                error: `${col === "link_url" ? "The renewal link" : "The document link"} must be a full http or https URL.`,
              };
            }
          }
          if (col === "time_zone" && v) {
            try {
              new Intl.DateTimeFormat("en-US", { timeZone: v }).format(new Date());
            } catch {
              return {
                ok: false,
                status: 400,
                error: "The timezone is not recognized. Use a name such as America/Denver.",
              };
            }
          }
          sets.push(`${col}=$${i++}`);
          values.push(v === "" ? null : v);
        }
      }

      if ("recurrence" in body) {
        if (body.recurrence != null && typeof body.recurrence !== "string") {
          return { ok: false, status: 400, error: "The schedule must be text or empty." };
        }
        const raw = typeof body.recurrence === "string" ? body.recurrence.trim() : "";
        if (raw !== "" && !RECURRENCES.has(raw)) {
          return { ok: false, status: 400, error: "That is not a schedule." };
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
          if (typeof raw !== "number" && typeof raw !== "string") {
            return {
              ok: false,
              status: 400,
              error: `${col.replaceAll("_", " ")} must be a whole number or empty.`,
            };
          }
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
            return {
              ok: false,
              status: 400,
              error: "That has to be a whole number above zero, or left empty.",
            };
          }
          sets.push(`${col}=$${i++}`);
          values.push(n);
        }
      }

      const effectiveRecurrence =
        "recurrence" in body
          ? typeof body.recurrence === "string"
            ? body.recurrence.trim()
            : ""
          : String(item.recurrence ?? "");
      const effectiveMonths =
        "recurrence_months" in body
          ? Number(body.recurrence_months)
          : Number(item.recurrence_months);
      if (
        effectiveRecurrence === "custom" &&
        (!Number.isInteger(effectiveMonths) || effectiveMonths <= 0)
      ) {
        return {
          ok: false,
          status: 400,
          error: "A custom schedule needs a whole number of months above zero.",
        };
      }

      if ("monitorable" in body) {
        if (typeof body.monitorable !== "boolean") {
          return { ok: false, status: 400, error: "Monitorable must be true or false." };
        }
        sets.push(`monitorable=$${i++}`);
        values.push(body.monitorable);
      }

      if (body.verified === true) {
        sets.push("verified_at=now()");
        sets.push(`verified_by=$${i++}`);
        values.push(auth.id);
        sets.push("satisfied_at=coalesce(satisfied_at, now())");
      }

      if (body.renewed === true) {
        const from = item.due_at_override ?? item.due_at;
        const next = nextDueDate(
          from as string | Date | null,
          item.recurrence as string | null,
          item.recurrence_months as number | null
        );
        if (!next) {
          return {
            ok: false,
            status: 400,
            error: "This item has no schedule and no date to roll forward from.",
          };
        }
        sets.push(`due_at_override=$${i++}`);
        values.push(next);
        sets.push("satisfied_at=now()");
        sets.push("status_override=null");
      }

      if (sets.length === 0) {
        return { ok: false, status: 400, error: "Nothing to update." };
      }

      values.push(params.id, orgId);
      const updated = await client.query<Record<string, unknown>>(
        `update compliance_items
            set ${sets.join(", ")}, updated_at=now()
          where id=$${i} and org_id=$${i + 1}
          returning *`,
        values
      );
      const after = updated.rows[0];
      if (!after) throw new Error("The compliance item changed while it was being saved.");

      const changes = describeChange(item, after);
      if (changes.summary) {
        await client.query(
          `insert into compliance_item_events
             (org_id, item_id, kind, summary, changes, actor_id, actor_label)
           values ($1,$2,$3,$4,$5::jsonb,$6::uuid,$7)`,
          [
            orgId,
            params.id,
            body.verified === true ? "verified" : body.renewed === true ? "renewed" : changes.kind,
            changes.summary,
            JSON.stringify(changes.fields),
            auth.id,
            auth.email,
          ]
        );
      }

      await client.query(
        `insert into agent_logs
           (org_id, agent, action, level, status, message)
         values ($1,'operator','compliance-edit','info','ok',$2)`,
        [
          orgId,
          `Operator ${auth.email} edited compliance item "${String(item.label ?? "this item")}": ${changes.summary || "no change"}`,
        ]
      );

      return {
        ok: true,
        label: String(item.label ?? "this item"),
        changes,
      };
    });
  } catch (error) {
    console.error("[compliance] item edit rolled back:", error);
    return NextResponse.json(
      {
        error:
          "The change could not be saved with its compliance history. " +
          "Nothing is confirmed changed. Try again.",
        retryable: true,
      },
      { status: 503 }
    );
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true });
}

/** Delete an operator-created item. Monitor-managed items can't be deleted here
 *  (the monitor would just recreate them), so this only removes source='operator'. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "manage_compliance" });
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  type DeleteResult =
    | { ok: true }
    | { ok: false; status: 400 | 404 | 409; error: string };

  try {
    const result = await tenantTransaction(orgId, async (client): Promise<DeleteResult> => {
      const selected = await client.query<{ id: string; label: string; source: string }>(
        `select id, label, coalesce(source,'monitor') as source
           from compliance_items
          where id=$1 and org_id=$2
          for update`,
        [params.id, orgId]
      );
      const item = selected.rows[0];
      if (!item) return { ok: false, status: 404, error: "Not found" };
      if (item.source !== "operator") {
        return {
          ok: false,
          status: 400,
          error: "This item is tracked automatically and can't be deleted.",
        };
      }

      const documents = await client.query<{ count: string }>(
        `select count(*)::text as count
           from compliance_item_documents
          where item_id = $1 and org_id = $2`,
        [params.id, orgId]
      );
      if (Number(documents.rows[0]?.count ?? 0) > 0) {
        return {
          ok: false,
          status: 409,
          error:
            "Remove the files on this item before deleting it. This prevents stored evidence from being orphaned.",
        };
      }

      const removed = await client.query<{ id: string }>(
        `delete from compliance_items
          where id=$1 and org_id=$2 and source='operator'
          returning id`,
        [params.id, orgId]
      );
      if (removed.rows.length !== 1) {
        throw new Error("The compliance item changed while it was being deleted.");
      }

      /*
       * The item history cascades with its parent, so this tenant audit row is
       * the durable deletion record. It commits with the delete; if it cannot
       * be recorded, the item remains.
       */
      await client.query(
        `insert into agent_logs
           (org_id, agent, action, level, status, message)
         values ($1,'operator','compliance-delete','info','ok',$2)`,
        [orgId, `${auth.email} deleted compliance item "${item.label}".`]
      );

      return { ok: true };
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[compliance] item delete rolled back:", error);
    return NextResponse.json(
      {
        error:
          "The item could not be deleted with its audit record. Nothing is confirmed deleted. Try again.",
        retryable: true,
      },
      { status: 503 }
    );
  }
}
