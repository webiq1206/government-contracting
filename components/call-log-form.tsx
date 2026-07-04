"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CallLogFormProps {
  cardId: string;
  trade: string | null;
  needsProjectHistory: boolean;
}

/** Mobile-first form to log a completed call, optional quote, and project history. */
export function CallLogForm({
  cardId,
  trade,
  needsProjectHistory,
}: CallLogFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [notes, setNotes] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");

  const [phName, setPhName] = useState("");
  const [phScope, setPhScope] = useState("");
  const [phValue, setPhValue] = useState("");
  const [phYear, setPhYear] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const body: Record<string, unknown> = {
      notes,
      responses: { notes },
    };

    const amount = Number(quoteAmount);
    if (quoteAmount.trim() !== "" && Number.isFinite(amount) && amount > 0) {
      body.quote = {
        quote_amount: amount,
        payment_terms: paymentTerms || null,
        trade,
      };
    }

    if (needsProjectHistory && phName.trim() !== "") {
      body.project_history = [
        {
          name: phName,
          scope: phScope,
          value: Number(phValue) || 0,
          year: Number(phYear) || 0,
        },
      ];
    }

    try {
      const res = await fetch(`/api/call-cards/${cardId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to log call");
        return;
      }
      setDone(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-md border border-pursue/40 bg-pursue/10 px-3 py-3 text-sm text-pursue">
        ✅ Call logged.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label className="label">Call notes</label>
        <textarea
          className="input mt-1 min-h-[88px] text-base"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did they say? Availability, interest, pricing signals…"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Quote amount (optional)</label>
          <input
            type="number"
            inputMode="decimal"
            className="input mt-1 text-base"
            value={quoteAmount}
            onChange={(e) => setQuoteAmount(e.target.value)}
            placeholder="$"
          />
        </div>
        <div>
          <label className="label">Payment terms (optional)</label>
          <input
            type="text"
            className="input mt-1 text-base"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            placeholder="e.g. Net 30"
          />
        </div>
      </div>

      {needsProjectHistory && (
        <div className="space-y-3 rounded-md border border-review/40 bg-review/5 p-3">
          <p className="text-xs font-medium text-review">
            ⚠ Collect one past project (history is empty)
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              type="text"
              className="input text-base"
              value={phName}
              onChange={(e) => setPhName(e.target.value)}
              placeholder="Project name"
            />
            <input
              type="text"
              className="input text-base"
              value={phScope}
              onChange={(e) => setPhScope(e.target.value)}
              placeholder="Scope"
            />
            <input
              type="number"
              inputMode="decimal"
              className="input text-base"
              value={phValue}
              onChange={(e) => setPhValue(e.target.value)}
              placeholder="Value ($)"
            />
            <input
              type="number"
              inputMode="numeric"
              className="input text-base"
              value={phYear}
              onChange={(e) => setPhYear(e.target.value)}
              placeholder="Year"
            />
          </div>
        </div>
      )}

      {error && <p className="text-sm text-risk">{error}</p>}

      <button
        type="submit"
        className="btn-primary w-full py-3 text-base"
        disabled={loading}
      >
        {loading ? "Logging…" : "Log call"}
      </button>
    </form>
  );
}
