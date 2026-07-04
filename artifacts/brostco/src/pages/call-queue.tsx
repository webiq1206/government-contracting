import { useState } from "react";
import { useGetCallCards, getGetCallCardsQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { countdown, currency, timeAgo } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";

interface CallCard {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  card_json: Record<string, unknown>;
  call_script: string | null;
  question_list: string[];
  needs_project_history: boolean;
  status: string;
  quote_amount: number | null;
  prior_quote_amount: number | null;
  company_name: string;
  phone: string | null;
  email: string | null;
  last_contacted: string | null;
  trade: string | null;
  opportunity_title: string | null;
  deadline: string | null;
  location_text: string | null;
  location_state: string | null;
  scope: string | null;
  bid_status: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  interested: "Interested — will quote",
  quoted: "Quoted — amount provided",
  not_interested: "Not interested",
  no_answer: "No answer",
  callback: "Callback scheduled",
  out_of_area: "Out of area",
};

function CallLogForm({ card, invalidateKey }: { card: CallCard; invalidateKey: string[] }) {
  const [outcome, setOutcome] = useState("interested");
  const [notes, setNotes] = useState("");
  const [quoteAmount, setQuoteAmount] = useState(card.prior_quote_amount != null ? String(card.prior_quote_amount) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const qc = useQueryClient();

  async function save() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/call-cards/${card.id}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          notes: notes || null,
          quote_amount: quoteAmount ? Number(quoteAmount) : null,
        }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError((data as Record<string, unknown>).error as string ?? "Failed"); return; }
      qc.invalidateQueries({ queryKey: invalidateKey });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="label">Log call result</p>
      <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
        {Object.entries(OUTCOME_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <div>
        <label className="label mb-1">Quote / Bid Amount (optional)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
          <input
            type="number"
            placeholder="0.00"
            className="input pl-7"
            value={quoteAmount}
            onChange={(e) => setQuoteAmount(e.target.value)}
          />
        </div>
        {card.prior_quote_amount != null && (
          <p className="mt-1 text-xs text-slate-500">Prior quote: {currency(card.prior_quote_amount)}</p>
        )}
      </div>
      <textarea
        placeholder="Call notes..."
        className="input min-h-[60px]"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {error && <p className="text-xs text-risk">{error}</p>}
      <button className="btn-primary w-full" onClick={save} disabled={loading}>
        {loading ? "Saving..." : "Save & close"}
      </button>
    </div>
  );
}

function StageBadge({ stage }: { stage: string | null }) {
  if (!stage) return null;
  const label = stage.replaceAll("_", " ");
  const color = stage === "call_queue" ? "bg-review/15 text-review"
    : stage === "quote_entry" ? "bg-brand-600/15 text-brand-400"
    : stage === "bid_building" ? "bg-pursue/15 text-pursue"
    : "bg-ink-700 text-slate-400";
  return <span className={`badge ${color}`}>{label}</span>;
}

function CallCardItem({ c }: { c: CallCard }) {
  const invalidateKey = getGetCallCardsQueryKey() as unknown as string[];
  const expiry = countdown(c.deadline);
  const location = c.location_text ?? c.location_state ?? null;
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const scopeText = c.scope ?? null;
  const scopePreview = scopeText && scopeText.length > 200 ? scopeText.slice(0, 200) + "…" : scopeText;

  return (
    <div className="card space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-slate-100 leading-tight">{c.company_name}</p>
          <p className="text-sm text-slate-400 mt-0.5">{c.trade ?? "General"}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StageBadge stage={c.bid_status} />
          {c.last_contacted && (
            <span className="text-xs text-slate-500">Last contact: {timeAgo(c.last_contacted)}</span>
          )}
        </div>
      </div>

      {/* Contact buttons */}
      <div className="flex gap-2">
        {c.phone ? (
          <a href={`tel:${c.phone}`} className="btn-primary flex-1 py-2.5 text-center text-sm">
            ☎ {c.phone}
          </a>
        ) : (
          <div className="flex-1 rounded-md border border-ink-700 px-3 py-2.5 text-center text-sm text-slate-500">
            No phone on file
          </div>
        )}
        {c.email && (
          <a href={`mailto:${c.email}`} className="btn-ghost px-3 py-2.5 text-sm">
            ✉ Email
          </a>
        )}
      </div>

      {/* Project info */}
      <div className="rounded-md border border-ink-700 bg-ink-950/60 px-3 py-2.5 space-y-1.5">
        <p className="text-sm font-medium text-slate-100">{c.opportunity_title ?? "Untitled opportunity"}</p>
        {location && <p className="text-xs text-slate-400">📍 {location}</p>}
        <div className="flex items-center gap-3 text-xs">
          {c.deadline && (
            <span className={expiry === "overdue" ? "text-risk font-medium" : "text-review"}>
              ⏱ Due {expiry}
            </span>
          )}
          {c.prior_quote_amount != null && (
            <span className="text-brand-400 font-mono">Prior quote: {currency(c.prior_quote_amount)}</span>
          )}
        </div>
      </div>

      {/* Scope of work */}
      {scopeText && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">
            Scope of work
          </summary>
          <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-slate-300">
            {scopeExpanded ? scopeText : scopePreview}
          </p>
          {scopeText.length > 200 && (
            <button
              className="px-3 pb-3 text-xs text-brand-400 hover:underline"
              onClick={() => setScopeExpanded((v) => !v)}
            >
              {scopeExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </details>
      )}

      {/* Warnings */}
      {c.needs_project_history && (
        <p className="rounded-md border border-review/40 bg-review/10 px-3 py-2 text-sm text-review">
          ⚠ Collect project history — field is empty
        </p>
      )}

      {/* Call script */}
      {c.call_script && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">Call script</summary>
          <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-slate-300">{c.call_script}</p>
        </details>
      )}

      {/* Questions — always shown */}
      <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">
          Questions to ask ({c.question_list.length})
        </summary>
        <ol className="list-decimal space-y-2 px-6 pb-3 text-sm text-slate-300">
          {c.question_list.map((q, i) => <li key={i}>{q}</li>)}
        </ol>
      </details>

      {/* Log form */}
      <div className="border-t border-ink-800 pt-3">
        <CallLogForm card={c} invalidateKey={invalidateKey} />
      </div>
    </div>
  );
}

export default function CallQueuePage() {
  const { data: cards = [], isLoading } = useGetCallCards();

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Call Queue"
        subtitle={isLoading ? "Loading..." : `${cards.length} subcontractor${cards.length === 1 ? "" : "s"} to contact.`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {cards.length === 0 && !isLoading ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-2xl">📞</p>
            <p className="mt-2 text-sm font-medium text-slate-200">Call queue is empty.</p>
            <p className="mt-1 text-xs text-slate-500">Cards appear here when the system queues a subcontractor for outreach.</p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4">
            {(cards as CallCard[]).map((c) => <CallCardItem key={c.id} c={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}
