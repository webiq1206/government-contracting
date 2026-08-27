import { query, queryOne } from "@/lib/db";
import { currentOrg } from "@/lib/data";
import { ownerName, type Owner } from "@/lib/domain/ownership";
import {
  checkStateChange,
  defaultVerification,
  parseRequirementState,
  parseVerification,
  REQUIREMENT_STATE_LABEL,
  type RequirementAudit,
  type RequirementState,
  type RequirementStateView,
  type VerificationKind,
} from "@/lib/domain/requirement-state";

/**
 * Reading and writing where each submission requirement has got to.
 *
 * Two things this module is careful about, and both of them are the kind of
 * care that only shows up when it is missing.
 *
 * The first is the organization. Every statement here scopes by the caller's
 * org, and it does so inside the SQL rather than in a check beforehand: the
 * insert selects its own org_id out of the opportunity row, so an opportunity
 * belonging to another company yields no row to insert from and the write
 * simply does not happen. A guard written as an early return is one a later
 * edit can delete without any test going red.
 *
 * The second is the audit trail. Every change writes an event, in the same
 * transaction-free order the reader depends on: the event describes what the
 * state row now says. The events table refuses updates and refuses deletes
 * while the opportunity exists, so what is written is what an auditor reads.
 */

export interface RequirementRecord {
  requirementId: string;
  state: RequirementState;
  verification: VerificationKind;
  /** Whether a person has confirmed the requirement was read correctly. */
  humanVerified: boolean;
  owner: Owner | null;
  dueAt: Date | null;
  blockingReason: string | null;
  note: string | null;
  updatedAt: Date;
  updatedBy: Owner | null;
}

export interface RequirementEvent {
  id: string;
  requirementId: string;
  fromState: RequirementState | null;
  toState: RequirementState;
  actorKind: "person" | "automation";
  actorLabel: string | null;
  note: string | null;
  at: Date;
}

/** The state row a requirement has when nobody has ever touched it. */
export function untouched(requirementId: string, verification: VerificationKind): RequirementRecord {
  return {
    requirementId,
    state: "not_started",
    verification,
    humanVerified: false,
    owner: null,
    dueAt: null,
    blockingReason: null,
    note: null,
    updatedAt: new Date(0),
    updatedBy: null,
  };
}

interface StateRow {
  requirement_id: string;
  state: string;
  verification: string;
  human_verified: boolean;
  due_at: Date | null;
  blocking_reason: string | null;
  note: string | null;
  updated_at: Date;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  editor_id: string | null;
  editor_name: string | null;
  editor_email: string | null;
}

function toRecord(r: StateRow): RequirementRecord {
  return {
    requirementId: r.requirement_id,
    state: parseRequirementState(r.state),
    verification: parseVerification(r.verification),
    humanVerified: r.human_verified,
    owner: r.owner_id
      ? { id: r.owner_id, name: ownerName({ name: r.owner_name, email: r.owner_email }) }
      : null,
    dueAt: r.due_at,
    blockingReason: r.blocking_reason,
    note: r.note,
    updatedAt: r.updated_at,
    updatedBy: r.editor_id
      ? { id: r.editor_id, name: ownerName({ name: r.editor_name, email: r.editor_email }) }
      : null,
  };
}

const SELECT_STATE = `
  select s.requirement_id, s.state, s.verification, s.human_verified, s.due_at,
         s.blocking_reason, s.note, s.updated_at,
         o.id as owner_id, o.name as owner_name, o.email as owner_email,
         e.id as editor_id, e.name as editor_name, e.email as editor_email
    from requirement_states s
    left join users o on o.id = s.owner_id
    left join users e on e.id = s.updated_by
`;

/**
 * Every recorded requirement state on one opportunity, keyed by requirement id.
 *
 * One query for the whole checklist rather than one per row: forty extracted
 * requirements is an ordinary number and a per-row lookup there is the shape
 * that turns a fast page slow without anybody changing the page.
 *
 * Requirements with no row are absent from the map rather than present as
 * `not_started`, because this function reports what was recorded. The caller
 * fills the gaps with `untouched`, which is where the requirement's own
 * verification kind is known.
 */
export async function requirementStates(
  opportunityId: string
): Promise<Map<string, RequirementRecord>> {
  const orgId = await currentOrg();
  const rows = await query<StateRow>(
    `${SELECT_STATE} where s.opportunity_id = $2 and s.org_id = $1`,
    [orgId, opportunityId]
  );
  return new Map(rows.map((r) => [r.requirement_id, toRecord(r)]));
}

export interface RequirementPatch {
  state?: RequirementState;
  verification?: VerificationKind;
  humanVerified?: boolean;
  /** `null` unassigns, which is a real answer and not a failure to answer. */
  ownerId?: string | null;
  dueAt?: Date | null;
  blockingReason?: string | null;
  note?: string | null;
}

export interface ActorInfo {
  kind: "person" | "automation";
  /** The user id when a person acted, and the agent's name when one did not. */
  id?: string | null;
  label: string;
}

export type UpdateResult =
  | { ok: true; record: RequirementRecord }
  | { ok: false; status: 404 | 400 | 409; error: string };

/**
 * Apply a change to one requirement, and write down that it happened.
 *
 * Returns a refusal rather than throwing, because every caller is an API route
 * that has to answer a status code, and a thrown error there is a 500 that
 * tells an attacker the row exists.
 *
 * The refusals, in the order they are checked:
 *
 *   404  the opportunity is not this organization's, or does not exist. The
 *        two are deliberately indistinguishable.
 *   409  automation tried to do something only a person may do. That is the
 *        brief's rule, and it is checked here rather than in the form because
 *        the agents do not go through the form.
 *   400  the change would leave the row incoherent, which in practice means
 *        blocked or needing clarification with nothing said about why.
 */
export async function updateRequirement(
  opportunityId: string,
  requirementId: string,
  patch: RequirementPatch,
  actor: ActorInfo
): Promise<UpdateResult> {
  const orgId = await currentOrg();

  const before = await queryOne<StateRow>(
    `${SELECT_STATE} where s.opportunity_id = $2 and s.org_id = $1 and s.requirement_id = $3`,
    [orgId, opportunityId, requirementId]
  );

  /*
   * The opportunity has to exist and be ours before anything else is
   * considered. Without this an unknown requirement id on somebody else's
   * opportunity would fall through to the insert, where the org predicate
   * would stop it, and the caller would get a 400 about the insert rather
   * than the 404 they are owed.
   */
  const owned = await queryOne<{ id: string }>(
    `select id from opportunities where id = $2 and org_id = $1`,
    [orgId, opportunityId]
  );
  if (!owned) return { ok: false, status: 404, error: "No such opportunity." };

  const current = before ? toRecord(before) : untouched(requirementId, "upload");
  const nextState = patch.state ?? current.state;
  const nextVerification = patch.verification ?? current.verification;
  const nextHumanVerified = patch.humanVerified ?? current.humanVerified;

  const verdict = checkStateChange({
    from: current.state,
    to: nextState,
    by: actor.kind,
    verification: nextVerification,
    humanVerified: nextHumanVerified,
  });
  if (!verdict.ok) {
    return { ok: false, status: 409, error: verdict.reason ?? "That change is not allowed." };
  }

  const nextReason =
    patch.blockingReason !== undefined ? patch.blockingReason : current.blockingReason;
  /*
   * The database enforces this too, and that is the point of checking it
   * here: the check constraint is what makes it true, and this is what makes
   * the refusal readable. Letting the constraint fire would be a 500 with a
   * Postgres string in it.
   */
  if (
    (nextState === "blocked" || nextState === "needs_clarification") &&
    !(nextReason ?? "").trim()
  ) {
    return {
      ok: false,
      status: 400,
      error:
        nextState === "blocked"
          ? "Say what is blocking it. A blocked item with no reason tells the next person nothing."
          : "Say what is unclear, so somebody can ask the contracting officer the right question.",
    };
  }

  const ownerId = patch.ownerId !== undefined ? patch.ownerId : (current.owner?.id ?? null);
  const dueAt = patch.dueAt !== undefined ? patch.dueAt : current.dueAt;
  const note = patch.note !== undefined ? patch.note : current.note;

  /*
   * The org_id comes out of the opportunity row rather than from the caller,
   * so a requirement state can never be filed under an organization that does
   * not own the opportunity it describes. The `select ... where org_id` is the
   * tenant guard, in the statement that does the writing.
   */
  const written = await queryOne<StateRow>(
    `with upserted as (
       insert into requirement_states
         (org_id, opportunity_id, requirement_id, state, verification, human_verified,
          owner_id, due_at, blocking_reason, note, updated_at, updated_by)
       select o.org_id, o.id, $3, $4, $5, $6, $7::uuid, $8::timestamptz, $9, $10, now(), $11::uuid
         from opportunities o
        where o.id = $2 and o.org_id = $1
       on conflict (opportunity_id, requirement_id) do update
          set state = excluded.state,
              verification = excluded.verification,
              human_verified = excluded.human_verified,
              owner_id = excluded.owner_id,
              due_at = excluded.due_at,
              blocking_reason = excluded.blocking_reason,
              note = excluded.note,
              updated_at = now(),
              updated_by = excluded.updated_by
       returning *
     )
     select s.requirement_id, s.state, s.verification, s.human_verified, s.due_at,
            s.blocking_reason, s.note, s.updated_at,
            o.id as owner_id, o.name as owner_name, o.email as owner_email,
            e.id as editor_id, e.name as editor_name, e.email as editor_email
       from upserted s
       left join users o on o.id = s.owner_id
       left join users e on e.id = s.updated_by`,
    [
      orgId,
      opportunityId,
      requirementId,
      nextState,
      nextVerification,
      nextHumanVerified,
      ownerId,
      dueAt,
      nextReason,
      note,
      actor.kind === "person" ? (actor.id ?? null) : null,
    ]
  );
  if (!written) return { ok: false, status: 404, error: "No such opportunity." };

  await query(
    `insert into requirement_state_events
       (org_id, opportunity_id, requirement_id, from_state, to_state, actor_kind, actor_id, actor_label, note)
     select o.org_id, o.id, $3, $4, $5, $6, $7::uuid, $8, $9
       from opportunities o
      where o.id = $2 and o.org_id = $1`,
    [
      orgId,
      opportunityId,
      requirementId,
      before ? current.state : null,
      nextState,
      actor.kind,
      actor.kind === "person" ? (actor.id ?? null) : null,
      actor.label,
      describeChange(current, patch, nextState),
    ]
  );

  return { ok: true, record: toRecord(written) };
}

/**
 * What the audit line says happened.
 *
 * A state change describes itself. A change that leaves the state alone does
 * not, and those are the ones an audit most often turns on: an owner swapped
 * the week before the deadline, a due date moved, somebody attested that the
 * extraction had been read correctly. Recording only state changes would make
 * those invisible while leaving the trail looking complete.
 */
function describeChange(
  current: RequirementRecord,
  patch: RequirementPatch,
  nextState: RequirementState
): string {
  const parts: string[] = [];
  if (nextState !== current.state) {
    parts.push(
      `${REQUIREMENT_STATE_LABEL[current.state]} to ${REQUIREMENT_STATE_LABEL[nextState]}`
    );
  }
  if (patch.ownerId !== undefined && patch.ownerId !== (current.owner?.id ?? null)) {
    parts.push(patch.ownerId ? "Owner changed" : "Owner cleared");
  }
  if (patch.dueAt !== undefined && dateValue(patch.dueAt) !== dateValue(current.dueAt)) {
    parts.push(patch.dueAt ? "Due date set" : "Due date cleared");
  }
  if (patch.verification !== undefined && patch.verification !== current.verification) {
    parts.push("What it takes to prove this changed");
  }
  if (patch.humanVerified !== undefined && patch.humanVerified !== current.humanVerified) {
    parts.push(
      patch.humanVerified
        ? "Confirmed the requirement was read correctly"
        : "Withdrew the confirmation that it was read correctly"
    );
  }
  if (patch.blockingReason !== undefined && patch.blockingReason !== current.blockingReason) {
    parts.push("Reason updated");
  }
  if (patch.note !== undefined && patch.note !== current.note) parts.push("Note updated");
  return parts.length > 0 ? parts.join(". ") : "Saved with no change";
}

function dateValue(d: Date | null | undefined): number | null {
  return d ? d.getTime() : null;
}

/**
 * Everything that has happened to one requirement, newest first.
 *
 * This is the audit history the brief asks each requirement to carry. It reads
 * the append-only table directly: there is no summarised version, because a
 * summary of an audit trail is a place for a disagreement to hide.
 */
export async function requirementHistory(
  opportunityId: string,
  requirementId: string
): Promise<RequirementEvent[]> {
  const orgId = await currentOrg();
  const rows = await query<{
    id: string;
    requirement_id: string;
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_label: string | null;
    note: string | null;
    at: Date;
  }>(
    `select id, requirement_id, from_state, to_state, actor_kind, actor_label, note, at
       from requirement_state_events
      where org_id = $1 and opportunity_id = $2 and requirement_id = $3
      order by at desc, id desc
      limit 200`,
    [orgId, opportunityId, requirementId]
  );
  return rows.map((r) => ({
    id: r.id,
    requirementId: r.requirement_id,
    fromState: r.from_state ? parseRequirementState(r.from_state) : null,
    toState: parseRequirementState(r.to_state),
    actorKind: r.actor_kind === "automation" ? "automation" : "person",
    actorLabel: r.actor_label,
    note: r.note,
    at: r.at,
  }));
}

/**
 * The whole opportunity's history in one query, keyed by requirement id.
 *
 * The checklist shows each requirement's trail inline, and forty separate
 * lookups to draw one page is the per-row query problem again.
 */
export async function requirementHistories(
  opportunityId: string
): Promise<Map<string, RequirementEvent[]>> {
  const orgId = await currentOrg();
  const rows = await query<{
    id: string;
    requirement_id: string;
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_label: string | null;
    note: string | null;
    at: Date;
  }>(
    `select id, requirement_id, from_state, to_state, actor_kind, actor_label, note, at
       from requirement_state_events
      where org_id = $1 and opportunity_id = $2
      order by at desc, id desc
      limit 2000`,
    [orgId, opportunityId]
  );
  const out = new Map<string, RequirementEvent[]>();
  for (const r of rows) {
    const list = out.get(r.requirement_id) ?? [];
    list.push({
      id: r.id,
      requirementId: r.requirement_id,
      fromState: r.from_state ? parseRequirementState(r.from_state) : null,
      toState: parseRequirementState(r.to_state),
      actorKind: r.actor_kind === "automation" ? "automation" : "person",
      actorLabel: r.actor_label,
      note: r.note,
      at: r.at,
    });
    out.set(r.requirement_id, list);
  }
  return out;
}

/**
 * The checklist's tracked state and history, ready to hand to a browser.
 *
 * Every requirement gets an entry, including the ones nobody has touched, and
 * those are marked `untouched` rather than dressed up as `not_started`. The
 * difference matters on screen: "not started" is somebody saying they have not
 * begun, and an empty row is nobody having said anything at all.
 *
 * The default verification comes off the extraction rather than out of the
 * air. A requirement the analysis marked signature_required needs a signature,
 * one the platform generates is one the platform can check, and everything
 * else is assumed to need a document until a person says otherwise. That last
 * default is deliberately the strict one: it means automation will not close
 * an item the extraction was vague about.
 */
export async function requirementViews(
  opportunityId: string,
  requirements: { id: string; needsSignature?: boolean; producedByPlatform: boolean }[]
): Promise<{
  states: Record<string, RequirementStateView>;
  history: Record<string, RequirementAudit[]>;
}> {
  const [recorded, histories] = await Promise.all([
    requirementStates(opportunityId),
    requirementHistories(opportunityId),
  ]);

  const states: Record<string, RequirementStateView> = {};
  for (const r of requirements) {
    const row = recorded.get(r.id);
    if (row) {
      states[r.id] = {
        state: row.state,
        verification: row.verification,
        humanVerified: row.humanVerified,
        owner: row.owner,
        dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        blockingReason: row.blockingReason,
        note: row.note,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy?.name ?? null,
        untouched: false,
      };
    } else {
      states[r.id] = {
        state: "not_started",
        verification: defaultVerification(r),
        humanVerified: false,
        owner: null,
        dueAt: null,
        blockingReason: null,
        note: null,
        updatedAt: null,
        updatedBy: null,
        untouched: true,
      };
    }
  }

  const history: Record<string, RequirementAudit[]> = {};
  for (const r of requirements) {
    const events = histories.get(r.id);
    if (!events) continue;
    history[r.id] = events.map((e) => ({
      id: e.id,
      fromState: e.fromState,
      toState: e.toState,
      actorKind: e.actorKind,
      actorLabel: e.actorLabel,
      note: e.note,
      at: e.at.toISOString(),
    }));
  }

  return { states, history };
}
