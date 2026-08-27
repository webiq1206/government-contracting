import { query, queryOne, transaction } from "@/lib/db";
import {
  CERTIFICATIONS,
  CONTACT_ROLES,
  PREFERRED_CONTACT,
  SOURCE_CONFIDENCE,
  type CapabilityFacts,
  type ContactRole,
} from "@/lib/domain/sub-capability";

/**
 * Reading and writing what a firm can take on.
 *
 * Every write is org-scoped inside the statement rather than checked before
 * it, so a wrong id is a row that does not match rather than a row in another
 * tenant that does.
 *
 * Refusals are returned, not thrown. A capability form with an out-of-range
 * crew size is an ordinary thing for a person to type, and it should come
 * back as a sentence rather than a stack trace.
 */

export type CapResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export interface SubContact {
  id: string;
  name: string;
  role: ContactRole;
  email: string | null;
  phone: string | null;
  email_verified: boolean;
  is_primary: boolean;
  note: string | null;
}

export interface SubLicense {
  id: string;
  trade: string;
  jurisdiction: string | null;
  number: string | null;
  status: string | null;
  expires_at: string | null;
  verified_at: string | null;
  source: string | null;
}

const CERT_KEYS = new Set(CERTIFICATIONS.map((c) => c.key as string));

/** Fields a form may set, and what each one has to look like to be accepted. */
function validate(input: Record<string, unknown>): string | null {
  const positive = (k: string) => {
    const v = input[k];
    if (v == null) return null;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
      return `${k} has to be a whole number above zero, or left empty.`;
    }
    return null;
  };
  for (const k of ["crew_size", "concurrent_jobs", "service_radius_miles", "quote_validity_days"]) {
    const bad = positive(k);
    if (bad) return bad;
  }
  for (const k of ["min_project_cents", "max_project_cents", "bond_single_cents", "bond_aggregate_cents"]) {
    const v = input[k];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return `${k} has to be an amount of zero or more, or left empty.`;
    }
  }
  const min = input.min_project_cents as number | null | undefined;
  const max = input.max_project_cents as number | null | undefined;
  if (min != null && max != null && max < min) {
    return "The biggest job they take cannot be smaller than the smallest.";
  }
  const single = input.bond_single_cents as number | null | undefined;
  const agg = input.bond_aggregate_cents as number | null | undefined;
  if (single != null && agg != null && agg < single) {
    return "The total bond cannot be smaller than the single-job bond.";
  }
  if (input.bonded === false && (single != null || agg != null)) {
    return "A firm that is not bonded cannot have a bond amount. Clear one or the other.";
  }
  const pc = input.preferred_contact;
  if (pc != null && !PREFERRED_CONTACT.includes(pc as never)) {
    return "That is not a way to contact somebody.";
  }
  const sc = input.source_confidence;
  if (sc != null && !SOURCE_CONFIDENCE.includes(sc as never)) {
    return "That is not one of the confidence levels.";
  }
  const certs = input.certifications;
  if (certs != null) {
    if (!Array.isArray(certs)) return "Certifications have to be a list.";
    /*
     * Unknown keys refused rather than stored. A typo saved silently is a
     * certification that never matches a set-aside and never explains why.
     */
    const unknown = certs.filter((c) => typeof c !== "string" || !CERT_KEYS.has(c));
    if (unknown.length) return `Not a certification we know: ${unknown.join(", ")}.`;
  }
  const states = input.service_area_states;
  if (states != null) {
    if (!Array.isArray(states)) return "The service area has to be a list of states.";
    const bad = states.filter((s) => typeof s !== "string" || !/^[A-Za-z]{2}$/.test(s));
    if (bad.length) return `Not a state code: ${bad.join(", ")}.`;
  }
  return null;
}

/** The columns a capability form may write, in the order the statement uses. */
const CAP_COLUMNS = [
  "service_area_states",
  "service_radius_miles",
  "service_area_note",
  "crew_size",
  "concurrent_jobs",
  "min_project_cents",
  "max_project_cents",
  "bonded",
  "bond_single_cents",
  "bond_aggregate_cents",
  "bond_surety",
  "certifications",
  "payment_terms",
  "quote_validity_days",
  "preferred_contact",
  "time_zone",
  "source",
  "source_confidence",
] as const;

export async function saveCapability(input: {
  orgId: string;
  subcontractorId: string;
  actorId: string | null;
  fields: Record<string, unknown>;
}): Promise<CapResult> {
  const bad = validate(input.fields);
  if (bad) return { ok: false, status: 400, error: bad };

  /*
   * Only the columns the form actually sent.
   *
   * A statement that wrote all eighteen every time would clear a bonding
   * figure somebody entered last week whenever a different tab saved the
   * service area, and the loss would be silent.
   */
  const touched = CAP_COLUMNS.filter((c) => c in input.fields);
  if (touched.length === 0) return { ok: true };

  const params: unknown[] = [input.orgId, input.subcontractorId, input.actorId];
  const sets = touched.map((c) => {
    params.push(normalize(c, input.fields[c]));
    return `${c} = $${params.length}`;
  });

  const rows = await query<{ id: string }>(
    `update subcontractors
        set ${sets.join(", ")},
            capability_updated_at = now(),
            capability_updated_by = $3::uuid,
            updated_at = now()
      where id = $2 and org_id = $1
      returning id`,
    params
  ).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : "";
    // The database says the same things this module does, so a constraint it
    // catches first still comes back as a sentence.
    if (/subcontractors_capacity_ck/.test(message)) {
      throw new CapabilityRefusal("Those numbers do not work together. Check the job sizes and bond amounts.");
    }
    if (/subcontractors_bond_ck/.test(message)) {
      throw new CapabilityRefusal("A firm that is not bonded cannot have a bond amount.");
    }
    throw e;
  });

  return rows.length > 0
    ? { ok: true }
    : { ok: false, status: 404, error: "No such subcontractor." };
}

export class CapabilityRefusal extends Error {}

function normalize(column: string, value: unknown): unknown {
  if (value === "" ) return null;
  if (column === "service_area_states" && Array.isArray(value)) {
    return value.map((s) => String(s).toUpperCase());
  }
  return value ?? null;
}

export async function capabilityOf(
  orgId: string,
  subcontractorId: string
): Promise<CapabilityFacts | null> {
  const row = await queryOne<Record<string, unknown>>(
    `select ${CAP_COLUMNS.join(", ")} from subcontractors where id = $1 and org_id = $2`,
    [subcontractorId, orgId]
  );
  if (!row) return null;
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    serviceAreaStates: (row.service_area_states as string[] | null) ?? null,
    serviceRadiusMiles: n(row.service_radius_miles),
    serviceAreaNote: (row.service_area_note as string | null) ?? null,
    crewSize: n(row.crew_size),
    concurrentJobs: n(row.concurrent_jobs),
    minProjectCents: n(row.min_project_cents),
    maxProjectCents: n(row.max_project_cents),
    bonded: (row.bonded as boolean | null) ?? null,
    bondSingleCents: n(row.bond_single_cents),
    bondAggregateCents: n(row.bond_aggregate_cents),
    bondSurety: (row.bond_surety as string | null) ?? null,
    certifications: (row.certifications as string[] | null) ?? null,
    paymentTerms: (row.payment_terms as string | null) ?? null,
    quoteValidityDays: n(row.quote_validity_days),
    preferredContact: (row.preferred_contact as string | null) ?? null,
    timeZone: (row.time_zone as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    sourceConfidence: (row.source_confidence as string | null) ?? null,
  };
}

export async function contactsOf(orgId: string, subcontractorId: string): Promise<SubContact[]> {
  return query<SubContact>(
    `select id, name, role, email, phone, email_verified, is_primary, note
       from subcontractor_contacts
      where subcontractor_id = $1 and org_id = $2
      order by is_primary desc, name asc`,
    [subcontractorId, orgId]
  );
}

export async function saveContact(input: {
  orgId: string;
  subcontractorId: string;
  contactId?: string | null;
  name: string;
  role: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  note?: string | null;
}): Promise<CapResult & { id?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, status: 400, error: "A person needs a name." };
  if (!CONTACT_ROLES.includes(input.role as ContactRole)) {
    return { ok: false, status: 400, error: "That is not one of the roles." };
  }
  const email = input.email?.trim() || null;
  const phone = input.phone?.trim() || null;
  if (!email && !phone) {
    // Otherwise the entry is a name in a box: it cannot be used for anything.
    return { ok: false, status: 400, error: "Add an email or a phone number, or there is no way to reach them." };
  }

  return transaction(async (client) => {
    // The record has to belong to this organization before anything is written
    // against it, and the check happens inside the transaction that writes.
    const owner = await client.query<{ id: string }>(
      `select id from subcontractors where id = $1 and org_id = $2 for update`,
      [input.subcontractorId, input.orgId]
    );
    if (owner.rowCount === 0) {
      return { ok: false as const, status: 404, error: "No such subcontractor." };
    }

    if (input.isPrimary) {
      /*
       * Demote the incumbent in its own statement before promoting. The
       * partial unique index would otherwise refuse the write, and the
       * operator would see a constraint name instead of a changed primary.
       */
      await client.query(
        `update subcontractor_contacts set is_primary = false, updated_at = now()
          where subcontractor_id = $1 and org_id = $2 and is_primary = true
            and ($3::uuid is null or id <> $3::uuid)`,
        [input.subcontractorId, input.orgId, input.contactId ?? null]
      );
    }

    if (input.contactId) {
      const res = await client.query<{ id: string }>(
        `update subcontractor_contacts
            set name = $4, role = $5, email = $6, phone = $7,
                is_primary = $8, note = $9, updated_at = now(),
                -- A changed address has not been verified yet, whatever the
                -- old one had earned.
                email_verified = case when coalesce(email,'') is distinct from coalesce($6,'')
                                      then false else email_verified end
          where id = $3 and subcontractor_id = $1 and org_id = $2
          returning id`,
        [
          input.subcontractorId, input.orgId, input.contactId,
          name, input.role, email, phone, Boolean(input.isPrimary), input.note?.trim() || null,
        ]
      );
      return res.rowCount
        ? { ok: true as const, id: input.contactId }
        : { ok: false as const, status: 404, error: "No such contact." };
    }

    const res = await client.query<{ id: string }>(
      `insert into subcontractor_contacts
         (org_id, subcontractor_id, name, role, email, phone, is_primary, note)
       values ($2,$1,$3,$4,$5,$6,$7,$8) returning id`,
      [
        input.subcontractorId, input.orgId, name, input.role, email, phone,
        Boolean(input.isPrimary), input.note?.trim() || null,
      ]
    );
    return { ok: true as const, id: res.rows[0]?.id };
  });
}

export async function removeContact(input: {
  orgId: string;
  subcontractorId: string;
  contactId: string;
}): Promise<CapResult> {
  const rows = await query<{ id: string }>(
    `delete from subcontractor_contacts
      where id = $3 and subcontractor_id = $1 and org_id = $2
      returning id`,
    [input.subcontractorId, input.orgId, input.contactId]
  );
  return rows.length > 0
    ? { ok: true }
    : { ok: false, status: 404, error: "No such contact." };
}

export async function licensesOf(orgId: string, subcontractorId: string): Promise<SubLicense[]> {
  return query<SubLicense>(
    `select id, trade, jurisdiction, number, status,
            expires_at::text as expires_at, verified_at::text as verified_at, source
       from subcontractor_licenses
      where subcontractor_id = $1 and org_id = $2
      order by trade asc, coalesce(jurisdiction,'') asc`,
    [subcontractorId, orgId]
  );
}

export async function saveLicense(input: {
  orgId: string;
  subcontractorId: string;
  trade: string;
  jurisdiction?: string | null;
  number?: string | null;
  status?: string | null;
  expiresAt?: string | null;
  source?: string | null;
}): Promise<CapResult> {
  const trade = input.trade.trim();
  if (!trade) return { ok: false, status: 400, error: "Which trade is the licence for?" };
  if (input.status && !["active", "expired", "suspended", "not_found"].includes(input.status)) {
    return { ok: false, status: 400, error: "That is not a licence status." };
  }
  const rows = await query<{ id: string }>(
    `insert into subcontractor_licenses
       (org_id, subcontractor_id, trade, jurisdiction, number, status, expires_at, source)
     select $1, s.id, $3, $4, $5, $6, $7::date, $8
       from subcontractors s where s.id = $2 and s.org_id = $1
     on conflict (subcontractor_id, lower(trade), coalesce(lower(jurisdiction), ''))
     do update set
       -- coalesce the other way round on a person's edit: what they typed
       -- wins, and a field they left blank keeps what was there.
       number     = coalesce(excluded.number, subcontractor_licenses.number),
       status     = coalesce(excluded.status, subcontractor_licenses.status),
       expires_at = coalesce(excluded.expires_at, subcontractor_licenses.expires_at),
       source     = coalesce(excluded.source, subcontractor_licenses.source)
     returning id`,
    [
      input.orgId, input.subcontractorId, trade,
      input.jurisdiction?.trim() || null, input.number?.trim() || null,
      input.status ?? null, input.expiresAt || null, input.source ?? null,
    ]
  );
  return rows.length > 0
    ? { ok: true }
    : { ok: false, status: 404, error: "No such subcontractor." };
}

export async function removeLicense(input: {
  orgId: string;
  subcontractorId: string;
  licenseId: string;
}): Promise<CapResult> {
  const rows = await query<{ id: string }>(
    `delete from subcontractor_licenses
      where id = $3 and subcontractor_id = $1 and org_id = $2
      returning id`,
    [input.subcontractorId, input.orgId, input.licenseId]
  );
  return rows.length > 0 ? { ok: true } : { ok: false, status: 404, error: "No such licence." };
}
