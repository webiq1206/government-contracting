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
