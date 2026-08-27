import { query, queryOne } from "@/lib/db";
import { nextRole } from "@/lib/domain/sub-actions";

/**
 * Writing to one subcontractor's place on one bid.
 *
 * `opportunity_subs` has no org_id of its own: it belongs to the opportunity,
 * and the opportunity belongs to the organization. So every statement here
 * reaches the tenant through a join rather than trusting an id, and the join
 * lives inside the writing statement rather than in a check above it. A guard
 * written as an early return is one a later edit can delete without any test
 * going red, and the specific thing it would let through is one company
 * reassigning another company's subcontractors.
 */

export interface PairingRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  trade: string | null;
  outreach_state: string | null;
  role: "primary" | "backup" | null;
  removed_at: Date | null;
  removed_reason: string | null;
  company_name: string;
  email: string | null;
  phone: string | null;
}

/** One pairing, or null when it is not this organization's. */
export async function pairing(
  orgId: string,
  opportunityId: string,
  pairingId: string
): Promise<PairingRow | null> {
  return queryOne<PairingRow>(
    `select os.id, os.opportunity_id, os.subcontractor_id, os.trade, os.outreach_state,
            os.role, os.removed_at, os.removed_reason,
            s.company_name, s.email, s.phone
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id
       join subcontractors s on s.id = os.subcontractor_id
      where os.id = $3 and os.opportunity_id = $2 and o.org_id = $1`,
    [orgId, opportunityId, pairingId]
  );
}

export type WriteResult =
  | { ok: true }
  | { ok: false; status: 404 | 400 | 409; error: string };

/**
 * Make this firm the primary for its trade, or a backup, or neither.
 *
 * Asking for the role a pairing already has clears it. A control that does
 * nothing when pressed twice is one an operator presses twice, and unranking
 * is a real thing to want: three firms quoted and none of them is the one yet.
 *
 * Promoting demotes whoever held the slot, in the same statement, because the
 * database only permits one primary per trade and a read-then-write here would
 * fail on the unique index at exactly the moment two people are working the
 * same bid.
 */
export async function setPairingRole(
  orgId: string,
  opportunityId: string,
  pairingId: string,
  asked: "primary" | "backup"
): Promise<WriteResult & { role?: "primary" | "backup" | null }> {
  const row = await pairing(orgId, opportunityId, pairingId);
  if (!row) return { ok: false, status: 404, error: "No such subcontractor on this bid." };
  if (row.removed_at) {
    return {
      ok: false,
      status: 409,
      error: "This firm is off the bid. Put them back on it before ranking them.",
    };
  }

  const role = nextRole(row.role, asked);

  if (role === "primary") {
    // Demote the incumbent first, in a statement scoped the same way. Without
    // this the unique index refuses the promotion and the operator is told
    // their own bid is in an invalid state.
    await query(
      `update opportunity_subs os
          set role = 'backup'
         from opportunities o
        where o.id = os.opportunity_id and o.org_id = $1
          and os.opportunity_id = $2
          and coalesce(os.trade, '') = coalesce($3, '')
          and os.role = 'primary' and os.removed_at is null
          and os.id <> $4`,
      [orgId, opportunityId, row.trade, pairingId]
    );
  }

  const updated = await query<{ id: string }>(
    `update opportunity_subs os
        set role = $4
       from opportunities o
      where o.id = os.opportunity_id and o.org_id = $1
        and os.opportunity_id = $2 and os.id = $3
      returning os.id`,
    [orgId, opportunityId, pairingId, role]
  );
  if (updated.length === 0) {
    return { ok: false, status: 404, error: "No such subcontractor on this bid." };
  }
  return { ok: true, role };
}

/**
 * Take a firm off this bid, keeping everything that happened with them.
 *
 * Not a delete. The emails sent, the replies received and the calls logged are
 * the record of who was approached for this job, and that is exactly what
 * somebody asks for when a bid goes wrong. The row stays, marked, with the
 * reason attached, and the database refuses a removal that does not carry one.
 */
export async function removePairing(
  orgId: string,
  opportunityId: string,
  pairingId: string,
  reason: string,
  actorId: string | null
): Promise<WriteResult> {
  const clean = reason.trim();
  if (!clean) {
    return {
      ok: false,
      status: 400,
      error: "Say why they are coming off the bid. A removal with no reason tells nobody anything.",
    };
  }
  const rows = await query<{ id: string }>(
    `update opportunity_subs os
        set removed_at = now(), removed_reason = $4, removed_by = $5::uuid,
            -- A firm off the bid holds no rank. Leaving them primary would
            -- leave the trade with a primary nobody is talking to.
            role = null
       from opportunities o
      where o.id = os.opportunity_id and o.org_id = $1
        and os.opportunity_id = $2 and os.id = $3 and os.removed_at is null
      returning os.id`,
    [orgId, opportunityId, pairingId, clean, actorId]
  );
  if (rows.length === 0) {
    return { ok: false, status: 404, error: "No such subcontractor on this bid." };
  }
  return { ok: true };
}

/** Put a removed firm back on the bid. The removal stays in the record. */
export async function restorePairing(
  orgId: string,
  opportunityId: string,
  pairingId: string
): Promise<WriteResult> {
  const rows = await query<{ id: string }>(
    `update opportunity_subs os
        set removed_at = null, removed_reason = null, removed_by = null
       from opportunities o
      where o.id = os.opportunity_id and o.org_id = $1
        and os.opportunity_id = $2 and os.id = $3
      returning os.id`,
    [orgId, opportunityId, pairingId]
  );
  return rows.length > 0
    ? { ok: true }
    : { ok: false, status: 404, error: "No such subcontractor on this bid." };
}

/**
 * Correct a subcontractor's email or phone.
 *
 * The commonest reason outreach fails is an address somebody mistyped, and
 * until now fixing it meant leaving the bid, finding the firm's own record,
 * editing it and coming back. Blank clears the field, which is the honest way
 * to record that the address on file does not work: a wrong email that stays
 * on the record is one automation keeps sending to.
 */
export async function correctContact(
  orgId: string,
  opportunityId: string,
  pairingId: string,
  patch: { email?: string | null; phone?: string | null }
): Promise<WriteResult> {
  const row = await pairing(orgId, opportunityId, pairingId);
  if (!row) return { ok: false, status: 404, error: "No such subcontractor on this bid." };

  const email = patch.email === undefined ? undefined : (patch.email?.trim() || null);
  const phone = patch.phone === undefined ? undefined : (patch.phone?.trim() || null);
  if (email !== undefined && email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: "That does not look like an email address." };
  }

  const rows = await query<{ id: string }>(
    `update subcontractors
        set email = case when $3::boolean then $4 else email end,
            /*
             * A hand-corrected address is not a verified one. Marking it
             * verified here would let outreach send to it as though a bounce
             * check had passed, which is the failure this correction exists
             * to recover from.
             */
            email_verified = case when $3::boolean then false else email_verified end,
            phone = case when $5::boolean then $6 else phone end
      where id = $2 and org_id = $1
      returning id`,
    [orgId, row.subcontractor_id, email !== undefined, email, phone !== undefined, phone]
  );
  return rows.length > 0
    ? { ok: true }
    : { ok: false, status: 404, error: "No such subcontractor on this bid." };
}

/**
 * The active pairings on one bid, with their ranks.
 *
 * Removed rows are excluded here and read separately, because a list that
 * mixes them reads as a longer roster than the bid actually has.
 */
export async function activePairings(
  orgId: string,
  opportunityId: string
): Promise<PairingRow[]> {
  return query<PairingRow>(
    `select os.id, os.opportunity_id, os.subcontractor_id, os.trade, os.outreach_state,
            os.role, os.removed_at, os.removed_reason,
            s.company_name, s.email, s.phone
       from opportunity_subs os
       join opportunities o on o.id = os.opportunity_id
       join subcontractors s on s.id = os.subcontractor_id
      where os.opportunity_id = $2 and o.org_id = $1 and os.removed_at is null
      order by os.trade nulls last, os.role nulls last, s.company_name`,
    [orgId, opportunityId]
  );
}
