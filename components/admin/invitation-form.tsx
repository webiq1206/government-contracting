"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
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
  );
}
