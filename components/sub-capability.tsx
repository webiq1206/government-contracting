"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPABILITY_PROMPTS,
  CERTIFICATIONS,
  CONTACT_ROLES,
  CONTACT_ROLE_LABEL,
  NOT_ON_FILE,
  PREFERRED_CONTACT,
  PREFERRED_CONTACT_LABEL,
  SOURCE_CONFIDENCE,
  SOURCE_CONFIDENCE_HINT,
  SOURCE_CONFIDENCE_LABEL,
  capabilityGaps,
  certificationLabel,
  countLabel,
  type CapabilityFacts,
} from "@/lib/domain/sub-capability";

interface Contact {
  id: string;
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  email_verified: boolean;
  is_primary: boolean;
  note: string | null;
}

interface License {
  id: string;
  trade: string;
  jurisdiction: string | null;
  number: string | null;
  status: string | null;
  expires_at: string | null;
}

/**
 * What a firm can take on, who to talk to there, and what they are licensed for.
 *
 * The record held identity and contact details and nothing about capability,
 * so the questions that decide whether a firm goes on a bid lived in
 * somebody's head. Every field here is optional and every empty one reads as
 * "Not on file" rather than as a zero: a firm nobody has asked about their
 * crew size does not have a crew of nobody.
 *
 * The gaps are listed as questions to ask rather than as a completeness
 * percentage. A score says a record is sixty percent done; a list says which
 * two calls would finish it.
 */
export function SubCapability({
  subcontractorId,
  capability,
  contacts,
  licenses,
  trades,
  canEdit,
  updatedAt,
}: {
  subcontractorId: string;
  capability: CapabilityFacts;
  contacts: Contact[];
  licenses: License[];
  /** The trades this firm is on the roster for, offered as licence subjects. */
  trades: string[];
  canEdit: boolean;
  updatedAt: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ bad: boolean; text: string } | null>(null);
  const [form, setForm] = useState(() => toForm(capability));
  const [panel, setPanel] = useState<"contact" | "license" | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  const gaps = capabilityGaps(capability);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/subs/${subcontractorId}/capability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setMessage({ bad: true, text: data.error ?? "That did not save." });
        return false;
      }
      setMessage({ bad: false, text: data.message ?? "Saved." });
      router.refresh();
      return true;
    } catch {
      setMessage({ bad: true, text: "Could not reach the server. Nothing was saved." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCapability() {
    const fields = fromForm(form);
    if (fields instanceof Error) {
      setMessage({ bad: true, text: fields.message });
      return;
    }
    if (await post({ action: "capability", fields })) setEditing(false);
  }

  return (
    <div className="space-y-6 px-5 py-6">
      <section className="card">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">What they can take on</h2>
            <p className="text-xs text-muted-foreground">
              {updatedAt
                ? `Last updated ${updatedAt}.`
                : "Nobody has filled this in yet."}
            </p>
          </div>
          {canEdit && !editing && (
            <button type="button" className="tap text-xs text-accent hover:underline" onClick={() => {
              setForm(toForm(capability));
              setEditing(true);
            }}>
              Edit
            </button>
          )}
        </div>

        {gaps.length > 0 && !editing && (
          <div className="mb-4 rounded-md border border-border bg-surface-raised px-3 py-2.5">
            <p className="text-xs font-medium text-foreground">
              {gaps.length === 1 ? "One question this record cannot answer" : `${gaps.length} questions this record cannot answer`}
            </p>
            <ul className="mt-1 space-y-0.5">
              {gaps.map((g) => {
                const p = CAPABILITY_PROMPTS.find((x) => x.key === g)!;
                return (
                  <li key={g} className="text-xs text-muted-foreground">
                    {p.label}: {p.ask}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {editing ? (
          <div className="space-y-4">
            <Row label="States they will work in" hint="Two-letter codes, separated by commas.">
              <input className="input h-11 w-full lg:h-9" value={form.states}
                onChange={(e) => setForm({ ...form, states: e.target.value })}
                placeholder="TX, NM" />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="How far they travel" hint="Miles from their yard.">
                <input className="input h-11 w-full lg:h-9" inputMode="numeric" value={form.radius}
                  onChange={(e) => setForm({ ...form, radius: e.target.value })} placeholder="Leave empty if unknown" />
              </Row>
              <Row label="Anything else about where they work">
                <input className="input h-11 w-full lg:h-9" value={form.areaNote}
                  onChange={(e) => setForm({ ...form, areaNote: e.target.value })} />
              </Row>
              <Row label="Crew size">
                <input className="input h-11 w-full lg:h-9" inputMode="numeric" value={form.crew}
                  onChange={(e) => setForm({ ...form, crew: e.target.value })} placeholder="Leave empty if unknown" />
              </Row>
              <Row label="Jobs they run at once">
                <input className="input h-11 w-full lg:h-9" inputMode="numeric" value={form.concurrent}
                  onChange={(e) => setForm({ ...form, concurrent: e.target.value })} placeholder="Leave empty if unknown" />
              </Row>
              <Row label="Smallest job they take" hint="Dollars.">
                <input className="input h-11 w-full lg:h-9" inputMode="decimal" value={form.minProject}
                  onChange={(e) => setForm({ ...form, minProject: e.target.value })} />
              </Row>
              <Row label="Biggest job they take" hint="Dollars.">
                <input className="input h-11 w-full lg:h-9" inputMode="decimal" value={form.maxProject}
                  onChange={(e) => setForm({ ...form, maxProject: e.target.value })} />
              </Row>
            </div>

            <Row label="Bonded" hint="Leave as not asked until somebody has checked.">
              <select className="input h-11 w-full lg:h-9" value={form.bonded}
                onChange={(e) => setForm({ ...form, bonded: e.target.value })}>
                <option value="">Nobody has asked</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Row>
            {form.bonded === "yes" && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Row label="Single job" hint="Dollars.">
                  <input className="input h-11 w-full lg:h-9" inputMode="decimal" value={form.bondSingle}
                    onChange={(e) => setForm({ ...form, bondSingle: e.target.value })} />
                </Row>
                <Row label="Total" hint="Dollars.">
                  <input className="input h-11 w-full lg:h-9" inputMode="decimal" value={form.bondAggregate}
                    onChange={(e) => setForm({ ...form, bondAggregate: e.target.value })} />
                </Row>
                <Row label="Surety">
                  <input className="input h-11 w-full lg:h-9" value={form.surety}
                    onChange={(e) => setForm({ ...form, surety: e.target.value })} />
                </Row>
              </div>
            )}

            <fieldset>
              <legend className="label mb-1">Certifications</legend>
              <div className="flex flex-wrap gap-2">
                {CERTIFICATIONS.map((c) => {
                  const on = form.certs.includes(c.key);
                  return (
                    <button key={c.key} type="button" aria-pressed={on}
                      onClick={() => setForm({
                        ...form,
                        certs: on ? form.certs.filter((k) => k !== c.key) : [...form.certs, c.key],
                      })}
                      className={
                        on
                          ? "inline-flex min-h-11 items-center rounded-md border border-accent bg-accent-soft px-3 text-sm text-accent-strong lg:min-h-0 lg:py-1.5"
                          : "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-sm text-foreground hover:bg-surface lg:min-h-0 lg:py-1.5"
                      }>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Payment terms">
                <input className="input h-11 w-full lg:h-9" value={form.paymentTerms}
                  onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} placeholder="Net 30" />
              </Row>
              <Row label="How long their quotes stand" hint="Days.">
                <input className="input h-11 w-full lg:h-9" inputMode="numeric" value={form.quoteValidity}
                  onChange={(e) => setForm({ ...form, quoteValidity: e.target.value })} />
              </Row>
              <Row label="Best way to reach them">
                <select className="input h-11 w-full lg:h-9" value={form.preferredContact}
                  onChange={(e) => setForm({ ...form, preferredContact: e.target.value })}>
                  <option value="">Nobody has asked</option>
                  {PREFERRED_CONTACT.map((c) => (
                    <option key={c} value={c}>{PREFERRED_CONTACT_LABEL[c]}</option>
                  ))}
                </select>
              </Row>
              <Row label="How much of this to believe" hint={
                form.sourceConfidence
                  ? SOURCE_CONFIDENCE_HINT[form.sourceConfidence as keyof typeof SOURCE_CONFIDENCE_HINT]
                  : "A record built from a listing is not the same kind of fact as one confirmed on a call."
              }>
                <select className="input h-11 w-full lg:h-9" value={form.sourceConfidence}
                  onChange={(e) => setForm({ ...form, sourceConfidence: e.target.value })}>
                  <option value="">Not stated</option>
                  {SOURCE_CONFIDENCE.map((c) => (
                    <option key={c} value={c}>{SOURCE_CONFIDENCE_LABEL[c]}</option>
                  ))}
                </select>
              </Row>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" disabled={busy} onClick={() => void saveCapability()}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { setEditing(false); setMessage(null); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Fact label="Where they work" value={areaLabel(capability)} />
            <Fact label="Crew" value={countLabel(capability.crewSize, "person", "people")} />
            <Fact label="Jobs at once" value={countLabel(capability.concurrentJobs, "job", "jobs")} />
            <Fact label="Job size they take" value={sizeLabel(capability)} />
            <Fact label="Bonding" value={bondLabel(capability)} />
            <Fact
              label="Certifications"
              value={
                (capability.certifications ?? []).length
                  ? capability.certifications!.map(certificationLabel).join(", ")
                  : NOT_ON_FILE
              }
            />
            <Fact label="Payment terms" value={capability.paymentTerms?.trim() || NOT_ON_FILE} />
            <Fact
              label="Quotes stand for"
              value={countLabel(capability.quoteValidityDays, "day", "days")}
            />
            <Fact
              label="Best way to reach them"
              value={
                capability.preferredContact
                  ? PREFERRED_CONTACT_LABEL[capability.preferredContact as keyof typeof PREFERRED_CONTACT_LABEL] ?? capability.preferredContact
                  : NOT_ON_FILE
              }
            />
            <Fact
              label="How much of this to believe"
              value={
                capability.sourceConfidence
                  ? SOURCE_CONFIDENCE_LABEL[capability.sourceConfidence as keyof typeof SOURCE_CONFIDENCE_LABEL] ?? capability.sourceConfidence
                  : NOT_ON_FILE
              }
              hint={
                capability.sourceConfidence
                  ? SOURCE_CONFIDENCE_HINT[capability.sourceConfidence as keyof typeof SOURCE_CONFIDENCE_HINT]
                  : "Nobody has said where this record came from."
              }
            />
          </dl>
        )}
      </section>

      <section className="card">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">People here</h2>
          {canEdit && (
            <button type="button" className="tap text-xs text-accent hover:underline"
              aria-expanded={panel === "contact"}
              onClick={() => { setEditingContact(null); setPanel(panel === "contact" ? null : "contact"); }}>
              Add somebody
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {/*
            The reason this is a list and not one owner_name: a quote request
            that lands with the foreman does not get priced.
          */}
          A firm is reached through a person. Marking who prices work is what stops a quote
          request landing with somebody who does not.
        </p>

        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody recorded. Outreach falls back to the address on the company itself.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-foreground">
                    {c.name}
                    <span className="text-muted-foreground">
                      {" · "}
                      {CONTACT_ROLE_LABEL[c.role as keyof typeof CONTACT_ROLE_LABEL] ?? c.role}
                    </span>
                    {c.is_primary && (
                      <span className="badge ml-2 bg-accent-soft text-accent-strong">First call</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.email ?? "No email"}
                    {c.email && !c.email_verified && " (not verified)"}
                    {" · "}
                    {c.phone ?? "No phone"}
                  </p>
                  {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-3">
                    <button type="button" className="tap text-xs text-accent hover:underline"
                      onClick={() => { setEditingContact(c); setPanel("contact"); }}>
                      Edit
                    </button>
                    <button type="button" className="tap text-xs text-risk hover:underline" disabled={busy}
                      onClick={() => void post({ action: "remove_contact", contact_id: c.id })}>
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {panel === "contact" && (
          <ContactForm
            key={editingContact?.id ?? "new"}
            contact={editingContact}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (payload) => {
              if (await post({ action: "contact", ...payload })) setPanel(null);
            }}
          />
        )}
      </section>

      <section className="card">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Licences</h2>
          {canEdit && (
            <button type="button" className="tap text-xs text-accent hover:underline"
              aria-expanded={panel === "license"}
              onClick={() => setPanel(panel === "license" ? null : "license")}>
              Add a licence
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {/*
            One flat licence number could not say that a firm is licensed for
            mechanical work and not for electrical, which is exactly the
            question a bid asks.
          */}
          One per trade, because being licensed for one trade says nothing about another.
        </p>

        {licenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            None recorded. Nobody has checked what this firm is licensed for.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {licenses.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-foreground">
                    {l.trade}
                    {l.jurisdiction ? ` · ${l.jurisdiction}` : ""}
                    {l.number ? ` · ${l.number}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {/* Null status is "nobody has checked", which is not "not active". */}
                    {l.status ? licenseStatusLabel(l.status) : "Nobody has checked this"}
                    {l.expires_at ? ` · expires ${l.expires_at}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <button type="button" className="tap text-xs text-risk hover:underline" disabled={busy}
                    onClick={() => void post({ action: "remove_license", license_id: l.id })}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {panel === "license" && (
          <LicenseForm
            trades={trades}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSave={async (payload) => {
              if (await post({ action: "license", ...payload })) setPanel(null);
            }}
          />
        )}
      </section>

      {message && (
        <p role="status" className={`text-xs ${message.bad ? "text-risk" : "text-muted-foreground"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${value === NOT_ON_FILE ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </dd>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ContactForm({
  contact, busy, onCancel, onSave,
}: {
  contact: Contact | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "estimator");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [primary, setPrimary] = useState(Boolean(contact?.is_primary));
  const [note, setNote] = useState(contact?.note ?? "");
  const reachable = Boolean(email.trim() || phone.trim());

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-raised p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Name">
          <input className="input h-11 w-full lg:h-9" value={name} onChange={(e) => setName(e.target.value)} />
        </Row>
        <Row label="What they do here">
          <select className="input h-11 w-full lg:h-9" value={role} onChange={(e) => setRole(e.target.value)}>
            {CONTACT_ROLES.map((r) => (
              <option key={r} value={r}>{CONTACT_ROLE_LABEL[r]}</option>
            ))}
          </select>
        </Row>
        <Row label="Email">
          <input className="input h-11 w-full lg:h-9" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Row>
        <Row label="Phone">
          <input className="input h-11 w-full lg:h-9" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Row>
      </div>
      <Row label="Anything worth knowing">
        <input className="input h-11 w-full lg:h-9" value={note} onChange={(e) => setNote(e.target.value)} />
      </Row>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
        Go to this person first
      </label>
      {!reachable && (
        <p className="text-xs text-muted-foreground">
          Add an email or a phone number. Without one this is a name in a box.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy || !name.trim() || !reachable}
          onClick={() => void onSave({
            contact_id: contact?.id, name, role, email, phone, is_primary: primary, note,
          })}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function LicenseForm({
  trades, busy, onCancel, onSave,
}: {
  trades: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: Record<string, unknown>) => void | Promise<void>;
}) {
  const [trade, setTrade] = useState(trades[0] ?? "");
  const [jurisdiction, setJurisdiction] = useState("");
  const [number, setNumber] = useState("");
  const [status, setStatus] = useState("");
  const [expires, setExpires] = useState("");

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-surface-raised p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Row label="Trade">
          <input className="input h-11 w-full lg:h-9" list="sub-trades" value={trade}
            onChange={(e) => setTrade(e.target.value)} />
          <datalist id="sub-trades">
            {trades.map((t) => <option key={t} value={t} />)}
          </datalist>
        </Row>
        <Row label="Where it is issued" hint="State or city.">
          <input className="input h-11 w-full lg:h-9" value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)} />
        </Row>
        <Row label="Number">
          <input className="input h-11 w-full lg:h-9" value={number} onChange={(e) => setNumber(e.target.value)} />
        </Row>
        <Row label="Status" hint="Leave unset until somebody has actually checked.">
          <select className="input h-11 w-full lg:h-9" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Nobody has checked</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="suspended">Suspended</option>
            <option value="not_found">Not found on the register</option>
          </select>
        </Row>
        <Row label="Expires">
          <input type="date" className="input h-11 w-full lg:h-9" value={expires}
            onChange={(e) => setExpires(e.target.value)} />
        </Row>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn" disabled={busy || !trade.trim()}
          onClick={() => void onSave({
            trade, jurisdiction, number, status: status || null, expires_at: expires || null,
          })}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function licenseStatusLabel(status: string): string {
  return (
    {
      active: "Active",
      expired: "Expired",
      suspended: "Suspended",
      not_found: "Not found on the register",
    }[status] ?? status
  );
}

function areaLabel(c: CapabilityFacts): string {
  const parts: string[] = [];
  const states = c.serviceAreaStates ?? [];
  if (states.length) parts.push(states.join(", "));
  if (c.serviceRadiusMiles != null) parts.push(`within ${c.serviceRadiusMiles} miles`);
  if (c.serviceAreaNote?.trim()) parts.push(c.serviceAreaNote.trim());
  return parts.length ? parts.join(" · ") : NOT_ON_FILE;
}

function sizeLabel(c: CapabilityFacts): string {
  const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
  if (c.minProjectCents == null && c.maxProjectCents == null) return NOT_ON_FILE;
  if (c.minProjectCents != null && c.maxProjectCents != null) {
    return `${dollars(c.minProjectCents)} to ${dollars(c.maxProjectCents)}`;
  }
  if (c.minProjectCents != null) return `${dollars(c.minProjectCents)} and up`;
  return `up to ${dollars(c.maxProjectCents!)}`;
}

function bondLabel(c: CapabilityFacts): string {
  if (c.bonded == null) return NOT_ON_FILE;
  if (!c.bonded) return "Not bonded";
  const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
  const parts: string[] = [];
  if (c.bondSingleCents != null) parts.push(`${dollars(c.bondSingleCents)} per job`);
  if (c.bondAggregateCents != null) parts.push(`${dollars(c.bondAggregateCents)} total`);
  if (c.bondSurety?.trim()) parts.push(c.bondSurety.trim());
  // Bonded with no figure is a claim, not an amount, and it says so.
  return parts.length ? `Bonded · ${parts.join(" · ")}` : "Bonded, amount not on file";
}

interface FormState {
  states: string; radius: string; areaNote: string;
  crew: string; concurrent: string; minProject: string; maxProject: string;
  bonded: string; bondSingle: string; bondAggregate: string; surety: string;
  certs: string[]; paymentTerms: string; quoteValidity: string;
  preferredContact: string; sourceConfidence: string;
}

function toForm(c: CapabilityFacts): FormState {
  const money = (cents: number | null | undefined) =>
    cents == null ? "" : String(Math.round(cents / 100));
  return {
    states: (c.serviceAreaStates ?? []).join(", "),
    radius: c.serviceRadiusMiles == null ? "" : String(c.serviceRadiusMiles),
    areaNote: c.serviceAreaNote ?? "",
    crew: c.crewSize == null ? "" : String(c.crewSize),
    concurrent: c.concurrentJobs == null ? "" : String(c.concurrentJobs),
    minProject: money(c.minProjectCents),
    maxProject: money(c.maxProjectCents),
    bonded: c.bonded == null ? "" : c.bonded ? "yes" : "no",
    bondSingle: money(c.bondSingleCents),
    bondAggregate: money(c.bondAggregateCents),
    surety: c.bondSurety ?? "",
    certs: c.certifications ?? [],
    paymentTerms: c.paymentTerms ?? "",
    quoteValidity: c.quoteValidityDays == null ? "" : String(c.quoteValidityDays),
    preferredContact: c.preferredContact ?? "",
    sourceConfidence: c.sourceConfidence ?? "",
  };
}

/**
 * The form back into columns, refusing rather than coercing.
 *
 * An empty box is null, not zero. Somebody who clears the crew size is saying
 * they do not know it, and writing 0 would say the firm has nobody.
 */
function fromForm(f: FormState): Record<string, unknown> | Error {
  const num = (raw: string, label: string): number | null | Error => {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return new Error(`${label} has to be a number, or left empty.`);
    return n;
  };
  const out: Record<string, unknown> = {};
  const states = f.states.split(",").map((s) => s.trim()).filter(Boolean);
  const badState = states.find((s) => !/^[A-Za-z]{2}$/.test(s));
  if (badState) return new Error(`"${badState}" is not a two-letter state code.`);
  out.service_area_states = states.length ? states : null;

  for (const [key, raw, label, cents] of [
    ["service_radius_miles", f.radius, "How far they travel", false],
    ["crew_size", f.crew, "Crew size", false],
    ["concurrent_jobs", f.concurrent, "Jobs at once", false],
    ["quote_validity_days", f.quoteValidity, "Quote validity", false],
    ["min_project_cents", f.minProject, "Smallest job", true],
    ["max_project_cents", f.maxProject, "Biggest job", true],
  ] as [string, string, string, boolean][]) {
    const v = num(raw, label);
    if (v instanceof Error) return v;
    out[key] = v == null ? null : cents ? Math.round(v * 100) : Math.round(v);
  }

  out.service_area_note = f.areaNote.trim() || null;
  out.bonded = f.bonded === "" ? null : f.bonded === "yes";
  if (f.bonded === "yes") {
    for (const [key, raw, label] of [
      ["bond_single_cents", f.bondSingle, "Single-job bond"],
      ["bond_aggregate_cents", f.bondAggregate, "Total bond"],
    ] as [string, string, string][]) {
      const v = num(raw, label);
      if (v instanceof Error) return v;
      out[key] = v == null ? null : Math.round(v * 100);
    }
    out.bond_surety = f.surety.trim() || null;
  } else {
    // Clearing the amounts with the flag, so the record cannot hold a bond
    // figure for a firm it also says is not bonded.
    out.bond_single_cents = null;
    out.bond_aggregate_cents = null;
    out.bond_surety = null;
  }

  out.certifications = f.certs.length ? f.certs : null;
  out.payment_terms = f.paymentTerms.trim() || null;
  out.preferred_contact = f.preferredContact || null;
  out.source_confidence = f.sourceConfidence || null;
  return out;
}
