"use client";

/**
 * Call Workspace — a slide-over that gives the operator EVERYTHING they need
 * during a sub outreach call on one screen: contractor contact + click-to-call,
 * project context, plain-English scope summary, attachments, prior interaction
 * history, a guided script, and a structured capture form. Saving closes the
 * card and updates every related view (subs, quotes, communications, dashboard)
 * via a single atomic API call plus router.refresh().
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CallCardRow } from "@/lib/data";
import { currency, shortDate } from "@/lib/format";

type Attachment = { name?: string; url?: string; storage_path?: string } & Record<
  string,
  unknown
>;

interface Comm {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
}

interface Quote {
  id: string;
  trade: string | null;
  quote_amount: number;
  payment_terms: string | null;
  is_out_of_range: boolean | null;
  created_at: string;
}

export interface CallWorkspaceData {
  card: CallCardRow;
  communications: Comm[];
  quotes: Quote[];
}

// Guided call script — the questions the operator should ask, in order.
const GUIDED_QUESTIONS = [
  "Can your company perform this scope of work?",
  "Are you interested in bidding this project?",
  "Have you reviewed the attached plans and specifications?",
  "Do you have any questions about the scope?",
  "What is your quoted price?",
  "Is that a firm quote or an estimate?",
  "What assumptions or exclusions should we note?",
  "When could you begin the project?",
  "Can you meet the required schedule?",
  "Are there any concerns that could impact your bid?",
  "Is there anything else we should know?",
];

interface FormState {
  can_perform: "yes" | "no" | "";
  interested: "yes" | "no" | "";
  bid_submitted: "yes" | "no" | "";
  quote_amount: string;
  price_type: "firm" | "estimate" | "";
  start_date: string;
  completion_date: string;
  availability: string;
  certs_confirmed: boolean;
  insurance_confirmed: boolean;
  bonding_confirmed: boolean;
  experience_level: "high" | "medium" | "low" | "";
  confidence: number; // 1..5
  recommendation: "recommend" | "backup" | "reject" | "";
  followup_required: boolean;
  followup_date: string;
  followup_reason: string;
  outcome: "success" | "no_answer" | "not_interested" | "declined" | "skipped" | "";
  assumptions: string;
  notes: string;
}

function initialForm(card: CallCardRow): FormState {
  const prev = (card.response_json ?? {}) as Partial<FormState>;
  return {
    can_perform: (prev.can_perform as FormState["can_perform"]) ?? "",
    interested: (prev.interested as FormState["interested"]) ?? "",
    bid_submitted: (prev.bid_submitted as FormState["bid_submitted"]) ?? "",
    quote_amount:
      prev.quote_amount != null
        ? String(prev.quote_amount)
        : card.quote_amount != null
          ? String(card.quote_amount)
          : "",
    price_type: (prev.price_type as FormState["price_type"]) ?? "",
    start_date: (prev.start_date as string) ?? "",
    completion_date: (prev.completion_date as string) ?? "",
    availability: (prev.availability as string) ?? "",
    certs_confirmed: Boolean(prev.certs_confirmed),
    insurance_confirmed: Boolean(prev.insurance_confirmed),
    bonding_confirmed: Boolean(prev.bonding_confirmed),
    experience_level:
      (prev.experience_level as FormState["experience_level"]) ?? "",
    confidence: typeof prev.confidence === "number" ? prev.confidence : 3,
    recommendation: (prev.recommendation as FormState["recommendation"]) ?? "",
    followup_required: Boolean(prev.followup_required),
    followup_date: (prev.followup_date as string) ?? "",
    followup_reason: (prev.followup_reason as string) ?? "",
    outcome: (prev.outcome as FormState["outcome"]) ?? "",
    assumptions: (prev.assumptions as string) ?? "",
    notes: (prev.notes as string) ?? "",
  };
}

export function CallWorkspace({
  data,
  onClose,
}: {
  data: CallWorkspaceData;
  onClose: () => void;
}) {
  const router = useRouter();
  const { card, communications, quotes } = data;
  const [form, setForm] = useState<FormState>(() => initialForm(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const attachments: Attachment[] = Array.isArray(card.attachments_json)
    ? (card.attachments_json as Attachment[])
    : [];
  const analysis = (card.solicitation_analysis ?? {}) as Record<string, unknown>;
  const plainScope =
    (analysis.scope_plain_language as string | undefined) ??
    (analysis.project_overview as string | undefined) ??
    card.description?.slice(0, 800) ??
    null;
  const quals = (analysis.qualifications ?? {}) as Record<string, unknown>;
  const requiredCerts = Array.isArray(quals.certifications)
    ? (quals.certifications as string[])
    : [];
  const requiredLicenses = Array.isArray(quals.licenses)
    ? (quals.licenses as string[])
    : [];
  const requiredInsurance = Array.isArray(quals.insurance)
    ? (quals.insurance as string[])
    : [];
  const requiredBonding = Array.isArray(quals.bonding)
    ? (quals.bonding as string[])
    : [];

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function save(closeAfter: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-cards/${card.id}/save-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: form, closeCard: closeAfter }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed. Try again.");
        setSaving(false);
        return;
      }
      setSavedOk(true);
      router.refresh();
      if (closeAfter) {
        setTimeout(onClose, 400);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="scroll-thin flex h-full w-full max-w-3xl flex-col overflow-y-auto bg-background shadow-2xl"
      >
        {/* Sticky header */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">{card.trade ?? "General"} · Call Card</p>
              <h2 className="mt-1 truncate font-serif text-2xl font-semibold text-foreground">
                {card.company_name}
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-500">
                {card.owner_name ? `${card.owner_name} · ` : ""}
                {card.opportunity_title}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="rounded-md border border-border p-2 text-slate-500 hover:bg-surface"
            >
              ✕
            </button>
          </div>
          {/* Action bar */}
          <div className="mt-4 flex flex-wrap gap-2">
            {card.phone && (
              <a
                href={`tel:${card.phone}`}
                className="btn-primary inline-flex items-center gap-2"
              >
                📞 Call {card.phone}
              </a>
            )}
            {card.email && (
              <a href={`mailto:${card.email}`} className="btn-ghost">
                ✉ Email
              </a>
            )}
            {card.website && (
              <a
                href={card.website.startsWith("http") ? card.website : `https://${card.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost"
              >
                🌐 Website
              </a>
            )}
          </div>
        </header>

        <div className="space-y-6 p-6">
          {/* CONTEXT — everything the operator needs to know before dialing */}
          <Section title="Project context">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <Fact label="Agency" value={card.agency ?? "—"} />
              <Fact
                label="Value"
                value={card.value_estimated != null ? currency(card.value_estimated) : "—"}
              />
              <Fact label="Location" value={card.location_state ?? "—"} />
              <Fact label="Industry code (NAICS)" value={card.naics_code ?? "—"} />
              <Fact label="Set-aside" value={card.set_aside_type ?? "—"} />
              <Fact
                label="Bid due"
                value={card.deadline ? shortDate(card.deadline) : "—"}
              />
              <Fact
                label="Solicitation"
                value={card.solicitation_number ?? "—"}
              />
              <Fact
                label="Trade you're pricing"
                value={card.trade ?? "—"}
              />
              <Fact
                label="Service area"
                value={
                  [card.city, card.state].filter(Boolean).join(", ") || "—"
                }
              />
            </dl>
          </Section>

          {/* PLAIN-ENGLISH SCOPE */}
          {plainScope && (
            <Section title="Scope of work (plain English)">
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {plainScope}
              </p>
            </Section>
          )}

          {/* REQUIRED QUALIFICATIONS */}
          {(requiredCerts.length ||
            requiredLicenses.length ||
            requiredInsurance.length ||
            requiredBonding.length) > 0 && (
            <Section title="Required qualifications">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {requiredCerts.length > 0 && (
                  <ReqBlock label="Certifications" items={requiredCerts} />
                )}
                {requiredLicenses.length > 0 && (
                  <ReqBlock label="Licenses" items={requiredLicenses} />
                )}
                {requiredInsurance.length > 0 && (
                  <ReqBlock label="Insurance" items={requiredInsurance} />
                )}
                {requiredBonding.length > 0 && (
                  <ReqBlock label="Bonding" items={requiredBonding} />
                )}
              </div>
            </Section>
          )}

          {/* ATTACHMENTS — always visible when present */}
          {attachments.length > 0 && (
            <Section
              title={`Documents & attachments (${attachments.length})`}
              subtitle="Send these to the contractor before the call if they haven't reviewed them."
            >
              <ul className="space-y-1.5">
                {attachments.map((a, i) => {
                  const href =
                    a.storage_path != null
                      ? `/api/files/${a.storage_path}`
                      : a.url;
                  const label =
                    a.name ??
                    (typeof a.storage_path === "string"
                      ? a.storage_path.split("/").pop()
                      : "Attachment");
                  return (
                    <li key={i} className="flex items-center gap-3 text-sm">
                      <span className="text-slate-500">📎</span>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent-strong hover:underline"
                        >
                          {label}
                        </a>
                      ) : (
                        <span className="text-slate-500">{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {/* PRIOR HISTORY */}
          {(communications.length > 0 || quotes.length > 0) && (
            <Section title="Prior interaction with this contractor">
              {quotes.length > 0 && (
                <div className="mb-3">
                  <p className="label mb-1.5">Previous quotes</p>
                  <ul className="space-y-1 text-sm">
                    {quotes.map((q) => (
                      <li
                        key={q.id}
                        className="flex items-center justify-between border-b border-border py-1 last:border-b-0"
                      >
                        <span className="text-slate-700">
                          {q.trade ?? "Quote"} · {shortDate(q.created_at)}
                        </span>
                        <span className="num font-medium">
                          {currency(q.quote_amount)}
                          {q.is_out_of_range ? (
                            <span className="ml-1 text-xs text-review">⚠</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {communications.length > 0 && (
                <div>
                  <p className="label mb-1.5">Recent communications</p>
                  <ul className="space-y-1 text-sm">
                    {communications.slice(0, 5).map((c) => (
                      <li
                        key={c.id}
                        className="border-b border-border py-1 last:border-b-0 text-slate-700"
                      >
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                          {c.channel} · {c.direction}
                        </span>{" "}
                        · {shortDate(c.created_at)}
                        {c.subject && (
                          <div className="text-xs text-slate-500">{c.subject}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}

          {/* GUIDED SCRIPT + CAPTURE — the actual call workspace */}
          <Section
            title="Call script + capture"
            subtitle="Ask each question in order and record the answers below. You can save a draft at any point and come back later; nothing is final until you press Save & complete call."
          >
            <ol className="mb-5 space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              {GUIDED_QUESTIONS.map((q, i) => (
                <li key={i} className="list-decimal">
                  {q}
                </li>
              ))}
            </ol>

            {/* CAPTURE FORM */}
            <div className="space-y-5">
              <Group title="Fit & interest">
                <Trio label="Can perform the work">
                  <YesNo value={form.can_perform} onChange={(v) => set("can_perform", v)} />
                </Trio>
                <Trio label="Interested in bidding">
                  <YesNo value={form.interested} onChange={(v) => set("interested", v)} />
                </Trio>
                <Trio label="Bid submitted">
                  <YesNo value={form.bid_submitted} onChange={(v) => set("bid_submitted", v)} />
                </Trio>
              </Group>

              <Group title="Pricing">
                <div>
                  <label className="label">Quoted price</label>
                  <input
                    type="number"
                    step="1"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.quote_amount}
                    onChange={(e) => set("quote_amount", e.target.value)}
                    placeholder="e.g. 42500"
                  />
                </div>
                <div>
                  <label className="label">Price type</label>
                  <select
                    className="input mt-1 w-full"
                    value={form.price_type}
                    onChange={(e) =>
                      set("price_type", e.target.value as FormState["price_type"])
                    }
                  >
                    <option value="">—</option>
                    <option value="firm">Firm quote</option>
                    <option value="estimate">Estimate</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Assumptions / exclusions</label>
                  <textarea
                    className="input mt-1 min-h-[70px] w-full"
                    value={form.assumptions}
                    onChange={(e) => set("assumptions", e.target.value)}
                    placeholder="e.g. Excludes permit fees; assumes daytime access; based on schematic drawings."
                  />
                </div>
              </Group>

              <Group title="Schedule & availability">
                <div>
                  <label className="label">Est. start date</label>
                  <input
                    type="date"
                    className="input mt-1 w-full"
                    value={form.start_date}
                    onChange={(e) => set("start_date", e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Est. completion</label>
                  <input
                    type="date"
                    className="input mt-1 w-full"
                    value={form.completion_date}
                    onChange={(e) => set("completion_date", e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Availability notes</label>
                  <input
                    type="text"
                    className="input mt-1 w-full"
                    value={form.availability}
                    onChange={(e) => set("availability", e.target.value)}
                    placeholder="e.g. Fully booked through end of month; could start early September."
                  />
                </div>
              </Group>

              <Group title="Qualifications confirmed">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={form.certs_confirmed}
                    onChange={(e) => set("certs_confirmed", e.target.checked)}
                  />
                  Certifications
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={form.insurance_confirmed}
                    onChange={(e) => set("insurance_confirmed", e.target.checked)}
                  />
                  Insurance
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={form.bonding_confirmed}
                    onChange={(e) => set("bonding_confirmed", e.target.checked)}
                  />
                  Bonding
                </label>
                <div>
                  <label className="label">Experience level</label>
                  <select
                    className="input mt-1 w-full"
                    value={form.experience_level}
                    onChange={(e) =>
                      set(
                        "experience_level",
                        e.target.value as FormState["experience_level"]
                      )
                    }
                  >
                    <option value="">—</option>
                    <option value="high">High: has bid similar projects</option>
                    <option value="medium">Medium: related experience</option>
                    <option value="low">Low: new to this scope</option>
                  </select>
                </div>
              </Group>

              <Group title="Recommendation & follow-up">
                <div>
                  <label className="label">Confidence (1–5)</label>
                  <div className="mt-1 flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => set("confidence", n)}
                        className={`h-8 w-8 rounded-md border text-sm ${
                          form.confidence === n
                            ? "border-accent bg-accent-soft text-accent-strong"
                            : "border-border text-slate-500 hover:bg-surface"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Recommendation</label>
                  <select
                    className="input mt-1 w-full"
                    value={form.recommendation}
                    onChange={(e) =>
                      set(
                        "recommendation",
                        e.target.value as FormState["recommendation"]
                      )
                    }
                  >
                    <option value="">—</option>
                    <option value="recommend">Recommend for bid</option>
                    <option value="backup">Backup / second choice</option>
                    <option value="reject">Not a fit</option>
                  </select>
                </div>
                <div>
                  <label className="label">Call outcome</label>
                  <select
                    className="input mt-1 w-full"
                    value={form.outcome}
                    onChange={(e) =>
                      set("outcome", e.target.value as FormState["outcome"])
                    }
                  >
                    <option value="">—</option>
                    <option value="success">Reached and got a quote</option>
                    <option value="no_answer">No answer / voicemail</option>
                    <option value="not_interested">Not interested</option>
                    <option value="declined">Declined to bid</option>
                    <option value="skipped">Skip / try later</option>
                  </select>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={form.followup_required}
                      onChange={(e) => set("followup_required", e.target.checked)}
                    />
                    Follow-up required
                  </label>
                </div>
                {form.followup_required && (
                  <>
                    <div>
                      <label className="label">Follow-up date</label>
                      <input
                        type="date"
                        className="input mt-1 w-full"
                        value={form.followup_date}
                        onChange={(e) => set("followup_date", e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Follow-up reason</label>
                      <input
                        type="text"
                        className="input mt-1 w-full"
                        value={form.followup_reason}
                        onChange={(e) => set("followup_reason", e.target.value)}
                        placeholder="e.g. Waiting on updated drawings; needs owner approval."
                      />
                    </div>
                  </>
                )}
              </Group>

              <Group title="Internal notes" full>
                <textarea
                  className="input min-h-[100px] w-full sm:col-span-2"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Anything worth knowing next time we work with this sub."
                />
              </Group>
            </div>

            {error && (
              <p className="mt-3 rounded-md border border-risk/40 bg-risk/5 px-3 py-2 text-sm text-risk">
                {error}
              </p>
            )}
            {savedOk && (
              <p className="mt-3 rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent-strong">
                Saved. Related records updated.
              </p>
            )}
          </Section>
        </div>

        {/* Sticky footer actions */}
        <footer className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-border bg-background/95 px-6 py-4 backdrop-blur">
          <button onClick={onClose} className="btn-ghost" disabled={saving}>
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => save(false)}
              className="btn-ghost"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save draft"}
            </button>
            <button
              onClick={() => save(true)}
              className="btn-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save & complete call"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

/* ---------- Small presentational helpers ---------- */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <div className="mb-3">
        <h3 className="font-serif text-lg font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

function ReqBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="label mb-1">{label}</p>
      <ul className="list-inside list-disc space-y-0.5 text-slate-700">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function Group({
  title,
  children,
  full,
}: {
  title: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow mb-2">{title}</p>
      <div
        className={
          full
            ? "grid grid-cols-1"
            : "grid grid-cols-1 gap-3 sm:grid-cols-2"
        }
      >
        {children}
      </div>
    </div>
  );
}

function Trio({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function YesNo({
  value,
  onChange,
}: {
  value: "yes" | "no" | "";
  onChange: (v: "yes" | "no" | "") => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(["yes", "no"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? "" : opt)}
          className={`px-4 py-1.5 text-sm ${
            value === opt
              ? opt === "yes"
                ? "bg-accent text-white"
                : "bg-risk text-white"
              : "text-slate-500 hover:bg-surface"
          }`}
        >
          {opt === "yes" ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}
