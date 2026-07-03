import { callQueue } from "@/lib/data";
import type { CallCardRow } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { CallLogForm } from "@/components/call-log-form";
import { countdown } from "@/lib/format";

export const dynamic = "force-dynamic";

function CallCard({ c }: { c: CallCardRow }) {
  const questions = c.question_list ?? [];
  const expiry = countdown(c.deadline);
  return (
    <div className="card space-y-4">
      <div className="space-y-1">
        <p className="text-lg font-semibold text-slate-100">{c.company_name}</p>
        <p className="text-sm text-slate-400">
          {c.trade ?? "General"}
          {c.opportunity_title ? ` · ${c.opportunity_title}` : ""}
        </p>
        <p
          className={`text-sm font-medium ${
            expiry === "overdue" ? "text-risk" : "text-review"
          }`}
        >
          ⏱ Deadline {expiry}
        </p>
      </div>

      {c.phone ? (
        <a href={`tel:${c.phone}`} className="btn-primary w-full py-3 text-base">
          ☎ Call {c.phone}
        </a>
      ) : (
        <p className="rounded-md border border-ink-700 px-3 py-3 text-center text-sm text-slate-500">
          No phone number on file
        </p>
      )}

      {c.needs_project_history && (
        <p className="rounded-md border border-review/40 bg-review/10 px-3 py-2 text-sm text-review">
          ⚠ Collect project history — field is empty
        </p>
      )}

      {c.call_script && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">
            Call script
          </summary>
          <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-slate-300">
            {c.call_script}
          </p>
        </details>
      )}

      {questions.length > 0 && (
        <details className="rounded-md border border-ink-700 bg-ink-950/60" open>
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200">
            Questions ({questions.length})
          </summary>
          <ol className="list-decimal space-y-1.5 px-6 pb-3 text-sm text-slate-300">
            {questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </details>
      )}

      <div className="border-t border-ink-800 pt-3">
        <CallLogForm
          cardId={c.id}
          trade={c.trade}
          needsProjectHistory={c.needs_project_history}
        />
      </div>
    </div>
  );
}

export default async function CallQueuePage() {
  const cards = await callQueue();

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Call Queue"
        subtitle={`${cards.length} call${cards.length === 1 ? "" : "s"} to make · soonest deadline first`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-4">
        {cards.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-2xl">📞</p>
            <p className="mt-2 text-sm font-medium text-slate-200">
              No calls in the queue.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Subcontractor call cards will appear here, ready to tap-to-call.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-xl grid-cols-1 gap-4">
            {cards.map((c) => (
              <CallCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
