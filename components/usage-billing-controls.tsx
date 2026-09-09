"use client";
import { ConfirmDialog } from "./confirm-dialog";
import { useEffect, useState } from "react";
type Batch = {
  id: string;
  org_id: string;
  tenant: string;
  amount_cents: string;
  status: string;
  stripe_invoice_id: string;
};
type Data = {
  tenants: { id: string; name: string }[];
  batches: Batch[];
  billingSettings: { org_id: string; automatic: boolean }[];
  syncRuns: {
    id: string;
    provider: string;
    status: string;
    detail: string;
    created_at: string;
  }[];
  adjustments: {
    id: string;
    kind: string;
    org_id: string;
    batch_id: string;
    reason: string;
    settlement_status: string;
    amount_cents: string;
    status: string;
    stripe_credit_note_id: string;
  }[];
};
export function UsageBillingControls() {
  const [data, setData] = useState<Data | null>(null),
    [org, setOrg] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState(""),
    [external, setExternal] = useState(""),
    [selected, setSelected] = useState<Batch | null>(null),
    [amount, setAmount] = useState(""),
    [reason, setReason] = useState(""),
    [kind, setKind] = useState("credit"),
    [attempt, setAttempt] = useState("");
  const [confirmation, setConfirmation] = useState<{
    title: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const load = async () => {
    const r = await fetch("/api/admin/api-usage");
    if (!r.ok) throw new Error("Billing controls could not be loaded.");
    setData(await r.json());
  };
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  async function act(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/admin/api-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setMessage("Completed. " + (result.invoiceId || result.creditNote || ""));
      await load();
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const automatic =
    data?.billingSettings.find((s) => s.org_id === org)?.automatic || false;
  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Reconciliation and billing</h2>
      <p className="text-sm text-muted-foreground">
        Sync provider evidence, collect confirmed usage after each subscription
        period, and track credits or refunds. Unconfirmed costs stay out of
        invoices.
      </p>
      {message && (
        <p role="status" className="rounded border border-border p-3 text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {["Anthropic", "Twilio"].map((p) => (
          <button
            className="btn-secondary"
            disabled={busy}
            key={p}
            onClick={() => act({ action: "sync", provider: p })}
          >
            Sync {p} costs
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Anthropic requires ANTHROPIC_ADMIN_API_KEY and returns account totals,
        which cannot establish individual tenant costs. Twilio can confirm
        prices for recorded message IDs. Both run hourly in the production
        worker.
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Import exact provider receipts
        </summary>
        <p className="my-2 text-xs text-muted-foreground">
          Upload a JSON array with id (ledger entry), provider, requestId, cost
          (USD decimal string), and evidence. All entries must match recorded
          requests. The import is atomic.
        </p>
        <label className="text-sm">
          Receipt JSON
          <textarea
            className="input mt-1 min-h-32 w-full"
            value={receipt}
            onChange={(e) => setReceipt(e.target.value)}
          />
        </label>
        <button
          className="btn-secondary mt-2"
          disabled={busy}
          onClick={() => {
            try {
              void act({ action: "receipts", receipts: JSON.parse(receipt) });
            } catch {
              setMessage("Enter a valid JSON array.");
            }
          }}
        >
          Validate and reconcile receipts
        </button>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Import usage from another service
        </summary>
        <p className="my-2 text-xs text-muted-foreground">
          For services outside the built-in adapters, import a JSON array with
          id (new UUID), orgId, provider, service, feature, requestId,
          occurredAt (ISO timestamp), cost (USD decimal string), source
          (platform or tenant), and evidence. Optional envKey must identify
          prior paid-use acceptance for that same service; otherwise platform
          costs remain held for review.
        </p>
        <label className="text-sm">
          External usage JSON
          <textarea
            className="input mt-1 min-h-32 w-full"
            value={external}
            onChange={(e) => setExternal(e.target.value)}
          />
        </label>
        <button
          className="btn-secondary mt-2"
          disabled={busy}
          onClick={() => {
            try {
              void act({ action: "external", records: JSON.parse(external) });
            } catch {
              setMessage("Enter a valid JSON array.");
            }
          }}
        >
          Validate and import usage
        </button>
      </details>
      <div className="space-y-3 border-t border-border pt-4">
        <label className="block text-sm">
          Tenant
          <select
            className="input mt-1 w-full"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
          >
            <option value="">Choose a tenant</option>
            {data?.tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            disabled={!org || busy}
            onClick={() => act({ action: "syncPeriod", orgId: org })}
          >
            Sync subscription period
          </button>
          <button
            className="btn-secondary"
            disabled={!org || busy}
            onClick={() => {
              if (!automatic) {
                setConfirmation({
                  title:
                    "Enable automatic collection for this tenant? Stripe will collect confirmed, accepted usage after each subscription period.",
                  run: () =>
                    act({ action: "automatic", orgId: org, enabled: true }),
                });
                return;
              }
              void act({ action: "automatic", orgId: org, enabled: false });
            }}
          >
            {automatic
              ? "Turn off automatic collection"
              : "Enable automatic collection"}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Automatic collection is {automatic ? "on" : "off"} for this tenant.
          Runs allow two days for provider reporting. Usage below one cent and
          late-confirmed charges carry forward. Drafts can also be reviewed and
          collected individually below.
        </p>
      </div>
      <div className="space-y-3">
        <h3 className="font-medium">Usage invoices</h3>
        {data?.batches
          .filter((b) => !org || b.org_id === org)
          .map((b) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3"
              key={b.id}
            >
              <div className="text-sm">
                <p>
                  {b.tenant} · ${(Number(b.amount_cents) / 100).toFixed(2)} ·{" "}
                  {b.status}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {b.stripe_invoice_id || "Preparing invoice"}
                </p>
              </div>
              <div className="flex gap-2">
                {b.status === "draft" && (
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => {
                      setConfirmation({
                        title: `Finalize and collect $${(Number(b.amount_cents) / 100).toFixed(2)} for ${b.tenant}?`,
                        run: () =>
                          act({
                            action: "finalize",
                            orgId: b.org_id,
                            batchId: b.id,
                          }),
                      });
                    }}
                  >
                    Finalize and collect
                  </button>
                )}
                {["paid", "open"].includes(b.status) && (
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setSelected(b);
                      setAttempt(crypto.randomUUID());
                      setAmount("");
                      setReason("");
                    }}
                  >
                    Credit or refund
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      {selected && (
        <form
          className="space-y-3 rounded border border-border p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const cents = Math.round(Number(amount) * 100);
            if (!Number.isSafeInteger(cents) || cents < 1) {
              setMessage("Enter a positive dollar amount.");
              return;
            }
            setConfirmation({
              title: `Issue a ${kind} of $${amount} to ${selected.tenant}?`,
              run: async () => {
                const ok = await act({
                  action: "adjust",
                  id: attempt,
                  orgId: selected.org_id,
                  batchId: selected.id,
                  amountCents: cents,
                  kind,
                  reason,
                });
                if (ok) setSelected(null);
              },
            });
          }}
        >
          <h3 className="font-medium">Adjust {selected.tenant}’s invoice</h3>
          <label className="block text-sm">
            Action
            <select
              className="input ml-2"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="credit">Invoice or future balance credit</option>
              <option value="refund" disabled={selected.status !== "paid"}>
                Refund payment
              </option>
            </select>
          </label>
          <label className="block text-sm">
            Amount in USD
            <input
              className="input ml-2"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            Reason
            <input
              className="input mt-1 w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              required
            />
          </label>
          <button className="btn-secondary" disabled={busy}>
            Issue {kind}
          </button>
          <button
            type="button"
            className="btn-secondary ml-2"
            onClick={() => setSelected(null)}
          >
            Cancel
          </button>
          <p className="text-xs text-muted-foreground">
            If a request times out, retry here using the same values. Adjustment
            reference: {attempt}
          </p>
        </form>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Recover an interrupted adjustment from Stripe
        </summary>
        <p className="my-2 text-xs text-muted-foreground">
          If Stripe created the credit note but this app lost the response,
          attach its reference here. This verifies the invoice, amount and
          account without moving money again.
        </p>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act({
              action: "syncAdjustment",
              id: f.get("id"),
              creditNoteId: f.get("creditNoteId"),
            });
          }}
        >
          <label className="block text-sm">
            Adjustment ID
            <input name="id" className="input" required />
          </label>
          <label className="block text-sm">
            Stripe credit note ID
            <input
              name="creditNoteId"
              className="input"
              placeholder="cn_…"
              required
            />
          </label>
          <button className="btn-secondary" disabled={busy}>
            Verify and recover
          </button>
        </form>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Recent reconciliation runs and adjustments
        </summary>
        {data?.syncRuns.map((r) => (
          <p className="my-2 break-words text-xs" key={r.id}>
            {r.provider} · {r.status} · {r.detail}
          </p>
        ))}
        {data?.adjustments.map((a) => (
          <p className="my-2 break-words text-xs" key={a.id}>
            {a.kind} · ${(Number(a.amount_cents) / 100).toFixed(2)} ·{" "}
            {a.settlement_status || a.status} ·{" "}
            {a.stripe_credit_note_id || a.id}
            {a.stripe_credit_note_id ? (
              <button
                className="btn-secondary ml-2"
                disabled={busy}
                onClick={() => act({ action: "syncAdjustment", id: a.id })}
              >
                Check settlement
              </button>
            ) : (
              <button
                className="btn-secondary ml-2"
                disabled={busy}
                onClick={() => {
                  const b = data?.batches.find((b) => b.id === a.batch_id);
                  if (!b) {
                    setMessage(
                      "Open the matching invoice in Stripe to review this older attempt.",
                    );
                    return;
                  }
                  setSelected(b);
                  setAttempt(a.id);
                  setAmount((Number(a.amount_cents) / 100).toFixed(2));
                  setKind(a.kind);
                  setReason(a.reason);
                }}
              >
                Resume saved attempt
              </button>
            )}
          </p>
        ))}
      </details>
      <ConfirmDialog
        open={!!confirmation}
        title={confirmation?.title || "Confirm billing action"}
        confirmLabel="Proceed with billing action"
        busy={busy}
        onCancel={() => setConfirmation(null)}
        onConfirm={async () => {
          await confirmation?.run();
          setConfirmation(null);
        }}
      />
    </section>
  );
}
