"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";

type Outcome = "won" | "lost" | "no_award";

/** One complete, evidence-seeking outcome form used wherever an award is recorded. */
export function OutcomeForm({
  opportunityId,
  canManage,
  bidAmount,
  solicitationNumber,
}: {
  opportunityId: string;
  canManage: boolean;
  bidAmount: number | null;
  solicitationNumber: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) {
    return (
      <p className="text-sm text-muted-foreground">
        A bid manager or account administrator must record the agency outcome because a win
        creates the contract record.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!outcome || busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const body =
      outcome === "won"
        ? {
            outcome,
            award_amount: form.get("award_amount"),
            contract_number: form.get("contract_number"),
            start_date: form.get("start_date"),
            end_date: form.get("end_date"),
          }
        : {
            outcome,
            loss_reason: form.get("loss_reason"),
          };
    try {
      const response = await fetch(`/api/opportunities/${opportunityId}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        warnings?: string[];
      };
      if (!response.ok) {
        setError(data.error ?? "The outcome could not be recorded. Refresh and try again.");
        return;
      }
      const label = outcome === "won" ? "Win" : outcome === "lost" ? "Loss" : "No award";
      const warning = data.warnings?.filter(Boolean).join(" ");
      push({
        message: warning
          ? `${label} recorded. Attention is still needed: ${warning}`
          : `${label} recorded. ${outcome === "won" ? "The contract is ready for startup." : "Learning and analytics will update."}`,
      });
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The network request failed. Check your connection and try again."
      );
    } finally {
      setBusy(false);
    }
  }

  if (!outcome) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-success min-h-11" onClick={() => setOutcome("won")}>
          Record win
        </button>
        <button type="button" className="btn-danger min-h-11" onClick={() => setOutcome("lost")}>
          Record loss
        </button>
        <button type="button" className="btn-ghost min-h-11" onClick={() => setOutcome("no_award")}>
          Record no award
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {outcome === "won"
              ? "Record the awarded contract"
              : outcome === "lost"
                ? "Record the loss"
                : "Record no award"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {outcome === "won"
              ? "These facts create the contract and its startup schedule."
              : "The reason feeds future scoring and keeps this result explainable."}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost min-h-11 text-xs"
          disabled={busy}
          onClick={() => {
            setOutcome(null);
            setError(null);
          }}
        >
          Cancel
        </button>
      </div>

      {outcome === "won" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Award amount" htmlFor="outcome-award-amount">
            <input
              id="outcome-award-amount"
              name="award_amount"
              type="number"
              min="0.01"
              max="100000000"
              step="0.01"
              required
              defaultValue={bidAmount && bidAmount > 0 ? String(bidAmount) : ""}
              className="input min-h-11 w-full"
            />
          </Field>
          <Field label="Contract or award number" htmlFor="outcome-contract-number">
            <input
              id="outcome-contract-number"
              name="contract_number"
              type="text"
              maxLength={200}
              required
              defaultValue={solicitationNumber ?? ""}
              className="input min-h-11 w-full"
            />
          </Field>
          <Field label="Contract start date" htmlFor="outcome-start-date">
            <input
              id="outcome-start-date"
              name="start_date"
              type="date"
              required
              className="input min-h-11 w-full"
            />
          </Field>
          <Field label="Contract end date" htmlFor="outcome-end-date">
            <input
              id="outcome-end-date"
              name="end_date"
              type="date"
              required
              className="input min-h-11 w-full"
            />
          </Field>
        </div>
      ) : (
        <Field
          label={outcome === "lost" ? "Why was the bid lost?" : "Why was no award made?"}
          htmlFor="outcome-loss-reason"
        >
          <textarea
            id="outcome-loss-reason"
            name="loss_reason"
            required
            minLength={10}
            maxLength={2000}
            rows={4}
            className="input w-full resize-y py-2"
            placeholder={
              outcome === "lost"
                ? "For example: Agency selected a lower-priced compliant offer."
                : "For example: Agency canceled the procurement before award."
            }
          />
        </Field>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-risk/30 bg-risk/5 px-3 py-2 text-sm text-risk">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className={`${outcome === "won" ? "btn-success" : "btn-danger"} min-h-11`}
      >
        {busy
          ? "Recording..."
          : outcome === "won"
            ? "Create contract and record win"
            : outcome === "lost"
              ? "Record loss"
              : "Record no award"}
      </button>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-foreground">
      {label}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
