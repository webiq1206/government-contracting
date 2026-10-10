import { afterEach, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import { renderToString } from "react-dom/server";
import type { Root } from "react-dom/client";
import { ActivityTimeline } from "@/components/activity-timeline";

let root:Root|undefined;
afterEach(async()=>{if(root) await act(async()=>root!.unmount());root=undefined;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("hydrates recorded activity across a minute boundary without changing its initial text",async()=>{
  const events=[{id:"synthetic-email",kind:"email" as const,at:"2026-10-10T16:00:00.000Z",title:"Stored synthetic email",detail:null,actor:null}];
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-10T16:00:59.999Z"));
  const html=renderToString(<ActivityTimeline events={events}/>);
  // Browser HTML parsing folds attribute names; linkedom preserves this case.
  const {window}=parseHTML(`<html><body><main>${html.replaceAll("dateTime=","datetime=")}</main></body></html>`);
  const getAttribute=window.HTMLElement.prototype.getAttribute;
  vi.spyOn(window.HTMLElement.prototype,"getAttribute").mockImplementation(function(this:HTMLElement,name:string){return getAttribute.call(this,name.toLowerCase());});
  const hasAttribute=window.HTMLElement.prototype.hasAttribute;
  vi.spyOn(window.HTMLElement.prototype,"hasAttribute").mockImplementation(function(this:HTMLElement,name:string){return hasAttribute.call(this,name.toLowerCase());});
  vi.stubGlobal("window",window);vi.stubGlobal("document",window.document);vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.setSystemTime(new Date("2026-10-10T16:01:00.001Z"));
  const errors:string[]=[];
  const warnings=vi.spyOn(console,"error").mockImplementation(()=>{});
  const {hydrateRoot}=await import("react-dom/client");
  await act(async()=>{root=hydrateRoot(document.querySelector("main")!,<ActivityTimeline events={events}/>,{onRecoverableError:error=>errors.push(String(error))});});
  expect(errors).toEqual([]);
  expect(warnings).not.toHaveBeenCalled();
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(events[0].at);
  expect(document.querySelector("time")?.textContent).toContain("UTC");
});
