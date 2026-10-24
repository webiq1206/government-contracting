"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FitReview } from "@/lib/domain/subcontractor-fit";

const kinds = [
  ["business_website","Business website"], ["supplier_reply","Supplier's reply"],
  ["confirmed_call","Confirmed call"], ["document","Document"],
] as const;

/** Recording source review does not research a firm, reopen a request or send mail. */
export function SubcontractorFitReview({opportunityId,pairingId,contextKey,canReview,block,verification}: {
  opportunityId:string;pairingId:string;contextKey:string|null;canReview:boolean;block:string|null;
  verification?:Record<string,unknown>|null;
}) {
  const router=useRouter();
  const [busy,setBusy]=useState(false),[note,setNote]=useState("");
  const raw=verification?.outreach_fit as (FitReview & {checkedAt?:string})|undefined;
  async function save(form:HTMLFormElement) {
    const data=new FormData(form);
    const proof=(key:string)=>({kind:data.get(`${key}-kind`),reference:data.get(`${key}-reference`),statement:data.get(`${key}-statement`)});
    setBusy(true);setNote("");
    try {
      const res=await fetch(`/api/opportunities/${opportunityId}/subs/${pairingId}`,{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"review_fit",
          fitContextKey:contextKey,fitReview:{serviceArea:proof("area"),capability:proof("trade"),affirmed:data.get("affirmed")==="on"}})});
      const body=await res.json();setNote(body.message ?? body.error ?? "Could not save the review.");
      if(res.ok)router.refresh();
    }catch{setNote("The result could not be confirmed. Refresh to check saved evidence before retrying.");}
    finally{setBusy(false);}
  }
  return <details className="mt-2 rounded border border-border/60 p-3 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium">Service area and trade fit</summary>
    <p className="my-2">{block ?? "Source review matches this request. Other contact, reply and spending checks still apply."}</p>
    {raw && <div className="space-y-2 break-words">
      <p>Saved coverage evidence: {raw.serviceArea?.statement} ({raw.serviceArea?.reference})</p>
      <p>Saved capability evidence: {raw.capability?.statement} ({raw.capability?.reference})</p>
      <p>Review time: {raw.checkedAt ?? "Not recorded"}</p>
    </div>}
    {canReview && contextKey && <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
      <p>Check the firm&apos;s own sources for this project&apos;s location and trade scope. An office address, distance, search category or verified email alone is insufficient. Do not record an unknown answer as confirmed.</p>
      {([['area','Service coverage','serviceArea'],['trade','Trade capability','capability']] as const).map(([key,label,saved])=><fieldset className="space-y-2" key={key}>
        <legend className="font-medium">{label}</legend>
        <label className="block">Source type<select className="input block w-full" name={`${key}-kind`} defaultValue={raw?.[saved]?.kind ?? "business_website"}>
          {kinds.map(([value,title])=><option value={value} key={value}>{title}</option>)}
        </select></label>
        <label className="block">Source URL or specific message, call or document reference<input className="input block w-full" name={`${key}-reference`} minLength={8} maxLength={1000} required defaultValue={raw?.[saved]?.reference ?? ""}/></label>
        <label className="block">What confirms this firm can cover this project&apos;s {key==='area'?'location':'trade scope'}<textarea className="input block w-full" name={`${key}-statement`} minLength={20} maxLength={2000} required defaultValue={raw?.[saved]?.statement ?? ""}/></label>
      </fieldset>)}
      <label className="flex min-h-11 items-start gap-2"><input type="checkbox" name="affirmed" required className="mt-1"/>I reviewed these sources and confirmed both coverage and capability for the scope shown on this bid.</label>
      <button className="btn btn-secondary min-h-11" disabled={busy}>{busy?'Saving…':'Save fit evidence'}</button>
      <p>No message or paid research is queued by saving this review. A closed request stays closed.</p>
    </form>}
    {note && <p role="status" className="mt-2">{note}</p>}
  </details>;
}
