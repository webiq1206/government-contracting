"use client";
import { useState } from "react";
import Link from "next/link";
type Budget = {
  daily_limit: string | null; monthly_limit: string | null; daily_requests: number | null;
  paused: boolean; allow_complex: boolean; day_spend: string; month_spend: string;
  day_requests: number; unknown_costs: number; held_requests?: number;
};
const field = "w-full rounded border border-border bg-surface text-foreground px-3 py-2 text-sm";
export function ApiSpendingControls({ budget: b, save, busy, editable = true }: {
  editable?: boolean; budget: Budget; save: (body: Record<string, unknown>) => Promise<void>; busy: boolean;
}) {
  const [editing,setEditing] = useState(false);
  const money=(n:string|null)=>n===null?"No limit":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n));
  const atDaily = b.daily_limit !== null && Number(b.day_spend)>=Number(b.daily_limit);
  const atMonthly = b.monthly_limit !== null && Number(b.month_spend)>=Number(b.monthly_limit);
  const atRequests = b.daily_requests !== null && b.day_requests>=b.daily_requests;
  const hold=b.paused||atDaily||atMonthly||atRequests||b.unknown_costs>0;
  const current={dailyLimit:b.daily_limit,monthlyLimit:b.monthly_limit,dailyRequests:b.daily_requests,paused:b.paused,allowComplex:b.allow_complex};
  return <section className="card space-y-3" aria-label="Account spending controls">
    <h2 className="font-semibold">Your spending protection</h2>
    <p role="status" className="font-medium">{b.paused?"API work is paused":atMonthly?"Monthly budget reached":atDaily?"Daily dollar limit reached":atRequests?"Daily request limit reached":b.unknown_costs>0?"Some costs need review":"Spending protection is on"}</p>
    <div className="grid gap-3 sm:grid-cols-3 text-sm">
      <p>Monthly budget<br/><strong>{money(b.monthly_limit)}</strong></p>
      <p>Used or held this month<br/><strong>{b.unknown_costs>0?"Not fully known":money(b.month_spend)}</strong></p>
      <p>Paid requests today<br/><strong>{b.day_requests}{b.daily_requests!==null?` of ${b.daily_requests}`:""}</strong></p>
    </div>
    <p className="text-sm">We choose the AI model automatically and stop new paid requests before their allowance runs out. More powerful AI is reserved for complex work.</p>
    {hold && <p role="alert" className="text-sm text-review">{b.paused?"New paid work is waiting. Resume it when you’re ready.":b.unknown_costs>0?"Unresolved costs can hold new work. The platform administrator must review these charges before a dollar budget can cover more requests.":atMonthly?"Your monthly budget is reached. Paid work waits until the first day of next month or an approved budget change.":atRequests&&!atDaily?`Today’s ${b.daily_requests}-request limit is reached. It resets at midnight UTC. Raising the monthly budget will not clear this daily limit. Review the daily request limit below if you want more work to run today.`:"Your daily dollar limit is reached. It resets at midnight UTC. Review the daily dollar limit below before allowing more spending."}</p>}
    {!b.allow_complex && <p className="text-sm text-review">Complex tasks are paused by your saved preference. Enable them in advanced controls to continue bid analysis.</p>}
    {(b.held_requests??0)>0 && <p className="text-xs text-muted-foreground">Includes allowances held for {b.held_requests} unfinished or unconfirmed requests. These are not final charges.</p>}
    <div className="flex flex-wrap gap-3">
      {editable && <button type="button" className="btn-secondary" disabled={busy} onClick={()=>setEditing(!editing)}>{editing?"Close controls":atRequests||atDaily?"Review daily limits":"Change budget"}</button>}
      {editable && <button type="button" className="text-sm underline" disabled={busy} onClick={()=>void save({action:"budget",budget:{...current,paused:!b.paused}})}>{b.paused?"Resume API work":"Pause API work"}</button>}
      {b.unknown_costs>0 && <Link href="/automation" className="text-sm underline">Review automation status</Link>}
    </div>
    {!editable && <p className="text-sm">An account owner or administrator can change this budget.</p>}
    {editing && editable && <form className="space-y-3 border-t pt-3" onSubmit={e=>{
      e.preventDefault();const f=new FormData(e.currentTarget);
      const amount=(key:string)=>String(f.get(key)??"").trim()||null;
      void save({action:"budget",budget:{monthlyLimit:amount("monthlyLimit"),dailyLimit:amount("dailyLimit"),dailyRequests:amount("dailyRequests")===null?null:Number(f.get("dailyRequests")),allowComplex:f.get("allowComplex")==="on",paused:b.paused}});
    }}>
      <label className="block max-w-sm text-sm">Monthly budget in dollars<input name="monthlyLimit" inputMode="decimal" className={field} defaultValue={b.monthly_limit??""}/></label>
      <p className="text-xs text-muted-foreground">Applies to paid work through BrostCo, using our API or yours. Amounts include conservative allowances for pending requests. Provider bills remain final.</p>
      <details open={atRequests||atDaily||undefined} className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Advanced controls</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Daily dollar limit<input name="dailyLimit" inputMode="decimal" defaultValue={b.daily_limit??""} className={field}/></label>
          <label className="text-sm">Daily request limit<input name="dailyRequests" type="number" min="0" max="1000000" defaultValue={b.daily_requests??""} className={field}/></label>
          <label className="flex gap-2 text-sm"><input name="allowComplex" type="checkbox" defaultChecked={b.allow_complex}/>Allow complex AI work</label>
        </div>
        <p className="mt-2 text-xs">Blank removes an account limit; zero stops new requests. Platform safeguards still apply.</p>
        <button type="button" className="mt-3 text-sm underline" disabled={busy} onClick={()=>void save({action:"budget",budget:{dailyLimit:"25",monthlyLimit:"250",dailyRequests:100,allowComplex:true,paused:b.paused}})}>Restore recommended limits</button>
      </details>
      <button className="btn-primary" disabled={busy}>Save budget</button>
    </form>}
  </section>;
}
