"use client";
import { useState } from "react";

type Budget = {
  daily_limit: string | null; monthly_limit: string | null; daily_requests: number | null;
  paused: boolean; allow_complex: boolean; day_spend: string; month_spend: string;
  day_requests: number; unknown_costs: number;
};
const field = "w-full rounded border border-border bg-white px-3 py-2 text-sm";
export function ApiSpendingControls({ budget, save, busy, editable = true }: {
  editable?: boolean; budget: Budget; save: (body: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const dollars = (n: string) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD"}).format(Number(n));
  const near = (spent: string, cap: string | null) => cap !== null && Number(spent) >= Number(cap) * .8;
  return <section className="card space-y-3" aria-label="Account spending controls">
    <h2 className="font-semibold">Protect this account’s API budget</h2>
    <p className="text-sm">Set limits for work done through BrostCo, whether you use our API or your own. These controls apply to this account. Platform safeguards still apply.</p>
    <p role="status" className="text-sm font-medium">{budget.paused ? "API work is paused." : "API work is enabled, subject to your limits."}</p>
    <div className="grid gap-3 sm:grid-cols-3 text-sm">
      <p>Today: <strong>{dollars(budget.day_spend)}</strong>{budget.daily_limit !== null ? ` of ${dollars(budget.daily_limit)}` : ", no daily dollar limit"}</p>
      <p>This month: <strong>{dollars(budget.month_spend)}</strong>{budget.monthly_limit !== null ? ` of ${dollars(budget.monthly_limit)}` : ", no monthly dollar limit"}</p>
      <p>Today’s requests: <strong>{budget.day_requests}</strong>{budget.daily_requests !== null ? ` of ${budget.daily_requests}` : ", no request limit"}</p>
    </div>
    {(near(budget.day_spend,budget.daily_limit) || near(budget.month_spend,budget.monthly_limit) || (budget.daily_requests !== null && budget.day_requests >= budget.daily_requests * .8)) &&
      <p role="alert" className="text-sm text-review">You’re near or at a limit. New requests stop when the remaining allowance cannot cover them. Review limits below.</p>}
    <p className="text-xs text-muted-foreground">Amounts include money held for unfinished or unconfirmed requests. They are budget totals, not a final bill. Daily and monthly allowances reset at midnight UTC. Work already sent to a provider can still finish.</p>
    {budget.unknown_costs > 0 && <p className="text-sm text-review">{budget.unknown_costs} requests have no confirmed cost or allowance held. Dollar limits will hold new work until those costs are reviewed. Request-count limits can still protect new usage.</p>}
    <p className="text-sm">AI model selection: <strong>{budget.allow_complex ? "Automatic" : "Routine tasks only"}</strong>. Routine work uses the lower-cost model. Bid analysis, compliance checks and complex reasoning use the stronger model. Routine-only mode pauses complex tasks instead of reducing their accuracy.</p>
    {!editable && <p className="text-sm">Ask an account owner or administrator to change these controls.</p>}
    {editable && <button type="button" disabled={busy} className="btn-secondary" onClick={() => void save({action:"budget",budget:{dailyLimit:budget.daily_limit,monthlyLimit:budget.monthly_limit,dailyRequests:budget.daily_requests,paused:!budget.paused,allowComplex:budget.allow_complex}})}>{budget.paused ? "Resume API work" : "Pause API work"}</button>}
    <button type="button" disabled={!editable} className="btn-secondary" onClick={() => setEditing(!editing)}>{editing ? "Close controls" : "Edit spending limits"}</button>
    {editing && editable && <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault(); const f = new FormData(e.currentTarget);
      await save({ action:"budget", budget: {
        dailyLimit: String(f.get("dailyLimit") ?? "").trim() || null,
        monthlyLimit: String(f.get("monthlyLimit") ?? "").trim() || null,
        dailyRequests: f.get("dailyRequests") === "" ? null : Number(f.get("dailyRequests")),
        paused: f.get("paused") === "on", allowComplex: f.get("allowComplex") === "on",
      }});
    }}>
      <p className="text-sm sm:col-span-2">Leave a limit blank for no cap. Set 0 to block new requests. Dollar limits require a provider price ceiling set by the platform administrator; request limits work without pricing. No changes take effect until you save.</p>
      <label className="text-sm">Daily dollar limit<input name="dailyLimit" inputMode="decimal" defaultValue={budget.daily_limit ?? ""} className={field}/></label>
      <label className="text-sm">Monthly dollar limit<input name="monthlyLimit" inputMode="decimal" defaultValue={budget.monthly_limit ?? ""} className={field}/></label>
      <label className="text-sm">Maximum requests per day<input name="dailyRequests" type="number" min="0" max="1000000" step="1" defaultValue={budget.daily_requests ?? ""} className={field}/></label>
      <div className="space-y-3">
        <label className="flex gap-2 text-sm"><input name="paused" type="checkbox" defaultChecked={budget.paused}/>Pause all API work for this account</label>
        <label className="flex gap-2 text-sm"><input name="allowComplex" type="checkbox" defaultChecked={budget.allow_complex}/>Allow stronger AI for complex tasks</label>
      </div>
      <button className="btn-primary" disabled={busy}>Save spending limits</button>
    </form>}
  </section>;
}
