"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { offerPreview } from "@/lib/domain/invitation-offer";
import type { Concession } from "@/lib/billing/concessions";

type Kind = "none" | "percent" | "free_months" | "free_account";

const KIND_LABEL: Record<Kind, string> = {
  none: "Pay the normal price",
  percent: "A percentage off",
  free_months: "A run of free months",
  free_account: "Free account, nothing to pay",
};

/**
 * Issue an invitation on chosen terms.
 *
 * The terms are one choice rather than four independent fields on purpose:
 * they are mutually exclusive, and a form that lets somebody set a percentage
 * AND a number of free months invites a question the billing system has no
 * answer to.
 */
export function InvitationForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<"standard" | "founding">("standard");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [kind, setKind] = useState<Kind>("none");
  const [percent, setPercent] = useState(20);
  const [months, setMonths] = useState(3);
  const [percentMonths, setPercentMonths] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          plan,
          interval,
          kind,
          percent,
          months: kind === "percent" ? Number(percentMonths) || undefined : months,
          note,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setResult({ ok: false, text: data.error ?? "That did not work." });
        return;
      }
      setResult({ ok: true, text: data.message ?? "Invitation sent." });
      setEmail("");
      setNote("");
      router.refresh();
    } catch {
      setResult({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  /*
   * What this offer costs, worked out from the same catalog checkout uses.
   *
   * The form collected a plan, a period and a discount and showed none of the
   * money, so choosing twenty-five per cent off a founding annual plan meant
   * doing the arithmetic in your head on a form whose output is a binding
   * offer. Computed here rather than fetched, so it moves with the fields
   * rather than a request behind them.
   */
  const preview = useMemo(() => {
    const concession: Concession =
      kind === "percent"
        ? { kind: "percent", percent, months: Number(percentMonths) || null }
        : kind === "free_months"
          ? { kind: "free_months", months }
          : kind === "free_account"
            ? { kind: "free_account" }
            : { kind: "none" };
    return offerPreview({ plan, interval, concession });
  }, [plan, interval, kind, percent, months, percentMonths]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <form onSubmit={submit} className="space-y-4 panel-inset p-4">
      <div>
        <h2 className="font-semibold">Invite somebody</h2>
        <p className="pt-1 text-sm text-muted-foreground">
          They get an email explaining the offer and a link that sets up their
          account on these terms. Nothing is charged when they accept.
        </p>
      </div>

      {result && (
        <p
          className={`rounded-md border px-4 py-3 text-sm ${
            result.ok
              ? "border-pursue/40 bg-pursue/5 text-pursue"
              : "border-risk/40 bg-risk/5 text-risk"
          }`}
        >
          {result.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block sm:col-span-3">
          <span className="label">Email address</span>
          <input
            type="email"
            required
            className="input mt-1 w-full"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">Plan</span>
          <select
            className="input mt-1 w-full"
            value={plan}
            onChange={(e) => setPlan(e.target.value as "standard" | "founding")}
          >
            <option value="standard">Standard</option>
            <option value="founding">Founding</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Billed</span>
          <select
            className="input mt-1 w-full"
            value={interval}
            onChange={(e) => setInterval(e.target.value as "month" | "year")}
          >
            <option value="month">Monthly</option>
            <option value="year">Annually</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Terms</span>
          <select
            className="input mt-1 w-full"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {kind === "percent" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Percentage off</span>
            <input
              type="number"
              min={1}
              max={100}
              className="input mt-1 w-full"
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="label">For how many months</span>
            <input
              type="number"
              min={1}
              max={36}
              className="input mt-1 w-full"
              placeholder="Leave blank to run forever"
              value={percentMonths}
              onChange={(e) => setPercentMonths(e.target.value)}
            />
          </label>
        </div>
      )}

      {kind === "free_months" && (
        <label className="block sm:max-w-[12rem]">
          <span className="label">Free months</span>
          <input
            type="number"
            min={1}
            max={36}
            className="input mt-1 w-full"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          />
        </label>
      )}

      <label className="block">
        <span className="label">A line for them, and for our records</span>
        <input
          className="input mt-1 w-full"
          placeholder="Optional. Appears in the invitation email."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
        {busy ? "Sending…" : "Send invitation"}
      </button>
    </form>

    {/*
      * The offer, as the recipient will experience it.
      *
      * Beside the form on a wide screen and under it on a narrow one, which is
      * the guided sequence ending in a complete preview that the audit asks
      * for on mobile: on a phone this is simply the last thing before the
      * button.
      */}
    <aside className="panel-inset h-fit p-4" aria-label="Offer preview">
      <h2 className="font-semibold">What they are being offered</h2>
      <p className="pt-1 text-sm leading-relaxed text-muted-foreground">{preview.summary}</p>
      <dl className="mt-3 space-y-2.5 border-t border-border/60 pt-3 text-sm">
        {preview.lines.map((l) => (
          <div key={l.label}>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{l.label}</dt>
            <dd className="font-medium text-foreground">{l.value}</dd>
            {l.note && (
              <dd className="pt-0.5 text-xs leading-relaxed text-muted-foreground">{l.note}</dd>
            )}
          </div>
        ))}
        {note.trim() && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Your message
            </dt>
            <dd className="text-sm leading-relaxed text-foreground">{note.trim()}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
        Every figure here is the one checkout will charge, read from the same price list.
        Nothing is taken when they accept; the first charge happens when they subscribe.
      </p>
    </aside>
    </div>
  );
}

