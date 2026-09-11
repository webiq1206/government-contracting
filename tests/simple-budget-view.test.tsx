import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect,it,vi } from "vitest";
import { ApiSpendingControls } from "../components/api-spending-controls";
const budget={daily_limit:"25",monthly_limit:"250",daily_requests:100,paused:false,allow_complex:true,day_spend:"0",month_spend:"0",day_requests:0,unknown_costs:0};
it("shows protection with no setup form until the user chooses to change it",()=>{
  const html=renderToStaticMarkup(<ApiSpendingControls budget={budget} busy={false} save={vi.fn()}/>);
  expect(html).toContain("Spending protection is on");
  expect(html).toContain("Change budget");
  expect(html).not.toContain('<input');
  expect(html).not.toContain('<select');
});
it("does not present unknown costs as zero or budget state as healthy",()=>{
  const html=renderToStaticMarkup(<ApiSpendingControls budget={{...budget,unknown_costs:3}} busy={false} save={vi.fn()}/>);
  expect(html).toContain("Not fully known");expect(html).toContain("Some costs need review");expect(html).not.toContain("Spending protection is on");
});
it("a read-only member cannot see budget-change or resume controls",()=>{
  const html=renderToStaticMarkup(<ApiSpendingControls budget={{...budget,paused:true}} busy={false} editable={false} save={vi.fn()}/>);
  expect(html).not.toContain('<button');expect(html).toContain("owner or administrator");
});
it("names the exhausted daily request cap instead of suggesting a larger monthly budget",()=>{
  const html=renderToStaticMarkup(<ApiSpendingControls budget={{...budget,monthly_limit:"1000",month_spend:"46.44",day_requests:100}} busy={false} save={vi.fn()}/>);
  expect(html).toContain("Daily request limit reached");
  expect(html).toContain("Review daily limits");
  expect(html).toContain("Raising the monthly budget will not clear this daily limit");
  expect(html).not.toContain("Monthly budget reached");
});
