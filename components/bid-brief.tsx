import type { SolicitationAnalysis } from "@/lib/types";
import { shortDate } from "@/lib/format";

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
 * The Bid Brief — a complete, plain-English summary of a solicitation so the
 * operator can decide to pursue in a couple of minutes, with the full original
 * documents one click away. Renders defensively: sections with no content are
 * skipped, and anything the analyst couldn't find shows "Not specified".
 */
export function BidBrief({
  analysis,
  documents,
}: {
  analysis: SolicitationAnalysis;
  documents: DocRow[];
}) {
  const q = analysis.qualifications ?? {};

  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <p className="eyebrow">Plain-English summary</p>
          <h2 className="mt-1 font-serif text-2xl font-semibold text-foreground">Bid Brief</h2>
        </div>
        {documents.length > 0 && (
          <a href="#attachments" className="btn-ghost text-xs">
            {documents.length} attachment{documents.length === 1 ? "" : "s"} ↓
          </a>
        )}
      </div>

      <div className="space-y-7 px-6 py-6">
        {/* Recommendation */}
        {has(analysis.pursue_recommendation) && (
          <div className="callout-panel">
            <p className="eyebrow text-accent">Recommendation</p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-200">
              {analysis.pursue_recommendation}
            </p>
          </div>
        )}

        {/* Key facts */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label="Bid due" value={analysis.due_date} strong />
          <Fact label="Estimated value" value={analysis.estimated_value} />
          <Fact label="Location" value={analysis.location} />
          <Fact label="Submission" value={analysis.submission_method} />
        </div>

        {has(analysis.project_overview) && (
          <Section title="Project overview">
            <p className="text-sm leading-relaxed text-slate-200">{analysis.project_overview}</p>
          </Section>
        )}

        {has(analysis.scope_plain_language) && (
          <Section title="Scope of work">
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-200">
              {analysis.scope_plain_language}
            </p>
          </Section>
        )}

        {/* Qualifications */}
        {Object.values(q).some((v) => Array.isArray(v) && v.length > 0) && (
          <Section title="Required qualifications">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <List label="Certifications" items={q.certifications} />
              <List label="Licenses" items={q.licenses} />
              <List label="Insurance" items={q.insurance} />
              <List label="Bonding" items={q.bonding} />
              <List label="Experience" items={q.experience} />
              <List label="Other" items={q.other} />
            </div>
          </Section>
        )}

        {/* Meetings / site visits */}
        {(analysis.prebid_meeting || analysis.site_visit) && (
          <Section title="Pre-bid meeting & site visit">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Meeting label="Pre-bid meeting" info={analysis.prebid_meeting} />
              <Meeting label="Site visit" info={analysis.site_visit} />
            </div>
          </Section>
        )}

        {/* Submission + evaluation */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {analysis.submission_requirements?.length > 0 && (
            <Section title="Submission requirements">
              <Bullets items={analysis.submission_requirements} />
            </Section>
          )}
          {analysis.evaluation_criteria?.length > 0 && (
            <Section title="Evaluation criteria">
              <Bullets items={analysis.evaluation_criteria} />
            </Section>
          )}
        </div>

        {/* Required forms */}
        {analysis.required_forms?.length > 0 && (
          <Section title="Required forms & documents">
            <ul className="space-y-1.5 text-sm">
              {analysis.required_forms.map((f, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium text-slate-100">{f.name}</span>
                  {f.note && <span className="text-slate-500">— {f.note}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Key dates */}
        {analysis.key_dates?.length > 0 && (
          <Section title="Key dates & milestones">
            <ul className="divide-y divide-border">
              {analysis.key_dates.map((d, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
                  <span className="text-slate-300">{d.label}</span>
                  <span className="num text-slate-100">{d.date}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Q&A / addenda */}
        {analysis.qa_addenda?.length > 0 && (
          <Section title="Amendments & Q&A">
            <ul className="space-y-2 text-sm">
              {analysis.qa_addenda.map((a, i) => (
                <li key={i} className="accent-left">
                  <span className="font-medium text-slate-100">{a.label}</span>
                  {a.date && <span className="ml-2 text-xs text-slate-500">{a.date}</span>}
                  <p className="mt-0.5 text-slate-300">{a.summary}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Special requirements */}
        {analysis.special_requirements?.length > 0 && (
          <Section title="Special requirements">
            <Bullets items={analysis.special_requirements} />
          </Section>
        )}

        {/* Attention items */}
        {analysis.attention_items?.length > 0 && (
          <Section title="Risks & items needing attention">
            <div className="space-y-2">
              {analysis.attention_items.map((a, i) => (
                <p key={i} className="warning-strip">
                  {a}
                </p>
              ))}
            </div>
          </Section>
        )}

        {/* Contacts */}
        {analysis.contacts?.length > 0 && (
          <Section title="Contacts">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {analysis.contacts.map((c, i) => (
                <div key={i} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium text-slate-100">{c.name ?? "Contact"}</p>
                  {c.role && <p className="text-xs text-slate-500">{c.role}</p>}
                  {c.email && (
                    <a className="mt-1 block text-accent hover:underline" href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  )}
                  {c.phone && <p className="text-slate-300">{c.phone}</p>}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Attachments */}
        <div id="attachments" className="section-prominent">
          <p className="eyebrow mb-3">Original documents</p>
          {documents.length === 0 ? (
            <p className="text-sm text-slate-500">
              No attachments were captured for this opportunity yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 text-slate-100">
                    <span className="text-slate-400">▤</span>
                    {d.name}
                    {d.kind !== "solicitation" && (
                      <span className="badge bg-surface-raised text-slate-400">{d.kind}</span>
                    )}
                  </span>
                  <span className="flex items-center gap-3 text-xs">
                    <a
                      className="text-accent hover:underline"
                      href={
                        d.storage_path
                          ? `/api/files/${d.storage_path}`
                          : d.meta?.source_url ?? "#"
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                    {d.meta?.source_url && (
                      <a
                        className="text-slate-500 hover:text-foreground hover:underline"
                        href={d.meta.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Original ↗
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
          strong ? "font-semibold text-foreground" : "text-slate-200"
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
        <li key={i} className="flex gap-2 text-sm text-slate-200">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-accent" />
          <span className="leading-relaxed">{it}</span>
        </li>
      ))}
    </ul>
  );
}

function List({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-300">{label}</p>
      <Bullets items={items} />
    </div>
  );
}

function Meeting({
  label,
  info,
}: {
  label: string;
  info: { required: boolean; details?: string } | null;
}) {
  if (!info) return null;
  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-100">{label}</p>
        <span className={`badge ${info.required ? "bg-review/15 text-review" : "bg-surface-raised text-slate-400"}`}>
          {info.required ? "Required" : "Optional"}
        </span>
      </div>
      {info.details && <p className="mt-1.5 leading-relaxed text-slate-300">{info.details}</p>}
    </div>
  );
}
