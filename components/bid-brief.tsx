import type { SolicitationAnalysis } from "@/lib/types";
import { ScannableText } from "@/components/scannable-text";
import { BidRequirements } from "@/components/bid-requirements";
import { buildOpportunityBrief } from "@/lib/domain/opportunity-brief";

interface DocRow {
  id: string;
  name: string;
  kind: string;
  storage_path?: string | null;
  meta?: { source_url?: string } | null;
}

const NA = "Not specified in the provided documents";
const has = (s?: string | null) => Boolean(s && s.trim() && s !== NA);

/**
 * Format a date-ish string cleanly (e.g. a raw JS Date/ISO the analyst returned,
 * "Tue Aug 18 2026 13:27:22 GMT+0000 (Coordinated Universal Time)") into
 * "Aug 18, 2026". Anything that isn't a real, full date (e.g. "Not specified",
 * "TBD", "2026") is returned untouched.
 */
function fmtDate(v?: string): string | undefined {
  if (!v) return v;
  const s = v.trim();
  if (s.length < 8) return v; // too short to be a full date (guards "2026", "Q1")
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The Bid Brief: what the job is, what it takes to bid it, and when.
 *
 * The previous version put the recommendation and the project overview at the
 * top, which the page already shows immediately above, and then hid the scope,
 * the qualifications, the required forms, the submission instructions, the
 * mandatory site visit and the key dates inside one collapsed "More from the
 * solicitation" block. Everything capable of getting a bid rejected was behind
 * that disclosure, which is exactly the material someone new to federal bidding
 * does not know to go looking for.
 *
 * Now the order follows the questions a reader actually has: what is this, what
 * would disqualify me, what else is required, when is it due. Only genuinely
 * secondary material (how bids are scored, the amendment log, who to phone)
 * stays collapsed.
 */
export function BidBrief({
  analysis,
  documents,
}: {
  analysis: SolicitationAnalysis;
  documents: DocRow[];
}) {
  const requirements = buildOpportunityBrief({
    complianceMatrix: analysis.compliance_matrix,
    submissionRequirements: analysis.submission_requirements,
    requiredForms: analysis.required_forms,
    qualifications: analysis.qualifications,
    prebidMeeting: analysis.prebid_meeting,
    siteVisit: analysis.site_visit,
    specialRequirements: analysis.special_requirements,
  });

  // Only things that do not belong in the requirement list or the date list.
  const hasSecondary =
    (analysis.evaluation_criteria?.length ?? 0) > 0 ||
    (analysis.qa_addenda?.length ?? 0) > 0 ||
    (analysis.contacts?.length ?? 0) > 0;

  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          {/* "Why this fits" is the panel above this card. This one is the
              solicitation itself, so it says so. */}
          <p className="eyebrow-gold">The solicitation, in plain English</p>
          <h2 className="mt-1 font-display text-2xl font-normal text-foreground">Bid Brief</h2>
        </div>
        {documents.length > 0 && (
          <a href="#attachments" className="btn-ghost text-xs">
            {documents.length} attachment{documents.length === 1 ? "" : "s"} ↓
          </a>
        )}
      </div>

      <div className="space-y-7 px-6 py-6">
        {/* The recommendation is not repeated here: the page states it directly
            above this card, and saying it twice is what made the brief feel
            like a document rather than an answer. */}
        {/* The due date and the location are in the page header, on screen from
            every tab, so this row carries only what the header does not. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Fact label="Estimated value" value={analysis.estimated_value} />
          <Fact label="How to submit" value={analysis.submission_method} strong />
        </div>

        {(has(analysis.project_overview) || has(analysis.scope_plain_language)) && (
          <Section title="What this job is">
            {has(analysis.project_overview) && (
              <ScannableText text={analysis.project_overview} className="text-slate-800" />
            )}
            {has(analysis.scope_plain_language) && (
              <div className={has(analysis.project_overview) ? "mt-3" : ""}>
                <ScannableText
                  text={analysis.scope_plain_language}
                  className="text-slate-800"
                />
              </div>
            )}
          </Section>
        )}

        {/* The centre of the brief: everything required to bid, classified, with
            the fatal items first. Previously this lived inside a collapsed
            block, or nowhere at all in the case of the compliance matrix. */}
        <BidRequirements brief={requirements} />

        {analysis.key_dates?.length > 0 && (
          <Section title="Dates that matter">
            <ul className="divide-y divide-border">
              {analysis.key_dates.map((d, i) => (
                <li
                  key={i}
                  className="flex items-baseline justify-between gap-4 py-1.5 text-sm"
                >
                  <span className="text-slate-700">{d.label}</span>
                  <span className="num text-slate-900">{fmtDate(d.date)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(analysis.trade_scopes?.length ?? 0) > 0 && (
          <Section title="What each trade needs to do">
            <p className="mb-3 text-xs text-slate-500">
              Plain-English work descriptions for calls and outreach: one per
              required trade.
            </p>
            <ul className="space-y-3">
              {analysis.trade_scopes!.map((ts) => (
                <li
                  key={ts.trade}
                  className="panel-inset px-3 py-2.5"
                >
                  <p className="text-sm font-medium text-slate-900">{ts.trade}</p>
                  <ScannableText text={ts.work} className="mt-1 text-slate-700" />
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Attention items are also hoisted to AttentionStrip; keep a compact
            pointer here so the brief still answers "what's risky?" when scanned. */}
        {analysis.attention_items?.length > 0 && (
          <div className="rounded-md border border-review/30 bg-review/5 px-3 py-2.5">
            <p className="eyebrow text-review">Risks flagged in this brief</p>
            <ul className="mt-2 space-y-1">
              {analysis.attention_items.slice(0, 4).map((a, i) => (
                <li key={i} className="text-sm text-slate-800">
                  {a}
                </li>
              ))}
            </ul>
            {analysis.attention_items.length > 4 && (
              <a href="#attention" className="mt-2 inline-block text-xs text-accent hover:underline">
                See all attention items ↑
              </a>
            )}
          </div>
        )}

        {hasSecondary && (
          <details className="group panel-inset">
            <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="eyebrow">More from the solicitation</p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    How bids are scored, the amendment log, and who to contact
                  </p>
                </div>
                <span
                  aria-hidden
                  className="text-slate-500 transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </div>
            </summary>
            <div className="space-y-7 border-t border-border px-4 py-5">
              {analysis.evaluation_criteria?.length > 0 && (
                <Section title="How bids are scored">
                  <p className="mb-2 text-xs text-slate-500">
                    What the agency weighs when comparing offers. Useful for deciding how
                    much effort to spend, but nothing here can disqualify a bid.
                  </p>
                  <Bullets items={analysis.evaluation_criteria} />
                </Section>
              )}

              {analysis.qa_addenda?.length > 0 && (
                <Section title="Amendments & Q&A">
                  <ul className="space-y-2 text-sm">
                    {analysis.qa_addenda.map((a, i) => (
                      <li key={i} className="accent-left">
                        <span className="font-medium text-slate-900">{a.label}</span>
                        {a.date && (
                          <span className="ml-2 text-xs text-slate-500">{fmtDate(a.date)}</span>
                        )}
                        <p className="mt-0.5 text-slate-700">{a.summary}</p>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {analysis.contacts?.length > 0 && (
                <Section title="Contacts">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {analysis.contacts.map((c, i) => (
                      <div key={i} className="panel-inset p-3 text-sm">
                        <p className="font-medium text-slate-900">{c.name ?? "Contact"}</p>
                        {c.role && <p className="text-xs text-slate-500">{c.role}</p>}
                        {c.email && (
                          <a
                            className="mt-1 block text-accent hover:underline"
                            href={`mailto:${c.email}`}
                          >
                            {c.email}
                          </a>
                        )}
                        {c.phone && (
                          <a
                            className="mt-0.5 block text-accent hover:underline"
                            href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
                          >
                            {c.phone}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </details>
        )}

        {/* The full document list lives on the Files tab, which shows kind,
            size and the SAM.gov original. Repeating it here gave two lists of
            the same files with different affordances. This points at it. */}
        {documents.length > 0 && (
          <div className="section-prominent">
            <p className="eyebrow mb-2">Original documents</p>
            <p className="text-sm text-slate-600">
              {documents.length} file{documents.length === 1 ? "" : "s"} from the
              solicitation.{" "}
              <a href="#attachments" className="text-accent hover:underline">
                Open them on the Files tab
              </a>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value?: string; strong?: boolean }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p
        className={`mt-1 text-sm ${
          strong ? "font-semibold text-foreground" : "text-slate-800"
        } ${!has(value) ? "text-slate-500" : ""}`}
      >
        {has(value) ? value : "Not specified"}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-2.5">{title}</h3>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm text-slate-800">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-accent" />
          <span className="leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  );
}
