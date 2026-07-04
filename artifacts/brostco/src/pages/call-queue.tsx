import { useState } from "react";
import { useGetCallCards, getGetCallCardsQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { countdown } from "@/lib/format";

interface CallCard {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  card_json: Record<string, unknown>;
  call_script: string | null;
  question_list: string[] | null;
  needs_project_history: boolean;
  status: string;
  company_name: string;
  phone: string | null;
  trade: string | null;
  opportunity_title: string | null;
  deadline: string | null;
}

function CallLogForm({ cardId, invalidateKey }: { cardId: string; invalidateKey: string[] }) {
  const [outcome, setOutcome] = useState("interested");
  const [notes, setNotes] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");

  return (
    <div className="space-y-3">
      <p className="label">Log call result</p>
      <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
        <option value="interested">Interested — will quote</option>
        <option value="quoted">Quoted</option>
        <option value="not_interested">Not interested</option>
        <option value="no_answer">No answer</option>
        <option value="callback">Callback scheduled</option>
        <option value="out_of_area">Out of area</option>
      </select>
      {outcome === "quoted" && (
        <input type="number" placeholder="Quote amount ($)" className="input" value={quoteAmount} onChange={(e) => setQuoteAmount(e.target.value)} />
      )}
      <textarea placeholder="Notes..." className="input min-h-[60px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <ActionButton
        endpoint={`/api/call-cards/${cardId}/log`}
        body={{ outcome, notes: notes || null, quote_amount: quoteAmount ? Number(quoteAmount) : null }}
        className="btn-primary w-full"
        invalidateKeys={[invalidateKey]}
      >
        Save & close
      </ActionButton>
    </div>
  );
}

function CallCardItem({ c }: { c: CallCard }) {
  const invalidateKey = getGetCallCardsQueryKey() as unknown as string[];
  const questions = c.question_list ?? [];
  const expiry = countdown(c.deadline);

  return (
    <div className="card space-y-4">
      <div className="space-y-1">
        <p className="text-lg font-semibold text-slate-100">{c.company_name}</p>
        <p className="text-sm text-slate-400">{c.trade ?? "General"}{c.opportunity_title ? ` · ${c.opportunity_title}` : ""}</p>
        <p className={`text-sm font-medium ${expiry === "overdue" ? "text-risk" : "text-review"}`}>⏱ Deadline {expiry}</p>
      </div>
      {c.phone ? (
        <a href={`tel:${c.phone}`} className="btn-primary block w-full py-3 text-center text-base">☎ Call {c.phone}</a>
      ) : (
        <p className="rounded-md border border-ink-700 px-3 py-3 text-center text-sm text-slate-500">No phone number on file</p>
      )}
      {c.needs_project_history && (
        <p className="rounded-md border border-review/40 bg-review/10 px-3 py-2 text-sm text-review">⚠ Collect project history — field is empty</p>
      )}
      {c.call_script && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">Call script</summary>
          <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-slate-300">{c.call_script}</p>
        </details>
      )}
      {questions.length > 0 && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">Questions ({questions.length})</summary>
          <ol className="list-decimal space-y-1.5 px-6 pb-3 text-sm text-slate-300">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </details>
      )}
      <div className="border-t border-ink-800 pt-3">
        <CallLogForm cardId={c.id} invalidateKey={invalidateKey} />
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
