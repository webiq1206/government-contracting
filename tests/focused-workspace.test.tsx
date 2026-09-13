import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { NAVIGATION_SECTIONS, SETTINGS_DESTINATIONS, navigationMatches, workspaceSections } from "@/lib/navigation";
import { focusTasks } from "@/lib/domain/focused-workspace";
import { FocusedToday } from "@/components/focused-today";
import { TodayDetails } from "@/components/today-details";
import type { WorkItem } from "@/lib/domain/work-queue";
const item = (i: number, extra: Partial<WorkItem> = {}): WorkItem => ({key:`call:${i}`,kind:"call",title:`Call company ${i}`,context:"Sample opportunity",href:`/workbench?item=call:${i}`,recordHref:"/call-queue",actionLabel:"Open call",...extra});
describe("focused workspace release", () => {
  it("shows the five primary destinations on every device", () => {
    expect(NAVIGATION_SECTIONS.find(s => s.key === "primary")?.items.map(i => i.label)).toEqual(["Today","Opportunities","Contracts","Subcontractors","Inbox"]);
    const nav = readFileSync("components/nav.tsx", "utf8");
    expect(nav).toContain("data-primary-navigation");
    expect(nav).not.toContain("<NavGroup");
    expect(nav).toContain('href="/more"');
    expect(nav).toContain("setAccountOpen(true)");
    expect(nav).toContain('aria-label="Account controls"');
  });
  it("preserves all former feature destinations with no dead directory links", () => {
    const paths = new Set([...NAVIGATION_SECTIONS.flatMap(s => s.items),...SETTINGS_DESTINATIONS].map(i => i.href));
    for (const path of ["/workbench","/call-queue","/review","/contracts","/compliance","/activity","/analytics","/recap","/agents","/settings/profile","/settings/api-usage","/settings/billing","/settings/integrations","/how-it-works","/feedback","/admin/accounts","/admin/health","/admin/api-usage"]) expect(paths.has(path),path).toBe(true);
    for (const path of paths) expect(["app/(dash)","app/(account)"].some(root=>existsSync(`${root}${path}/page.tsx`)),path).toBe(true);
    expect(workspaceSections(false).some(s=>s.adminOnly)).toBe(false);
    expect(workspaceSections(true).some(s=>s.adminOnly)).toBe(true);
    expect(readFileSync("app/(dash)/more/page.tsx","utf8")).toContain("!ctx.user.impersonatedBy");
  });
  it("selects the correct settings page rather than always highlighting Company", () => {
    expect(navigationMatches("/settings/billing","/settings/profile")).toBe(false);
    expect(navigationMatches("/settings/billing","/settings/billing")).toBe(true);
    expect(readFileSync("components/settings-nav.tsx","utf8")).toContain("links.current.get(destination)?.click()");
  });
  it("shows one next task and no more than three upcoming tasks without losing the full queue", () => {
    const items = Array.from({length:12},(_,i)=>item(i));
    expect(focusTasks(items)).toHaveLength(4);
    expect(items).toHaveLength(12);
    const html = renderToStaticMarkup(<FocusedToday items={items} overdue={2} dueToday={3} completed={1} activity={[]} />);
    expect(html.match(/data-next-task/g)).toHaveLength(1);
    expect(html.match(/data-upcoming-task/g)).toHaveLength(3);
    expect(html).toContain('href="/workbench"');
    expect(html).toContain('href="/activity"');
  });
  it("does not invent tasks or make waiting work actionable", () => {
    expect(focusTasks([item(1,{waitingOn:{party:"Subcontractor"}})])).toEqual([]);
    expect(focusTasks([item(1),item(1)])).toHaveLength(1);
    expect(focusTasks([])).toEqual([]);
  });
  it("leaves old Today controls accessible through filters and saved hash links", () => {
    const closed = renderToStaticMarkup(<TodayDetails><div id="queue">Controls</div></TodayDetails>);
    const opened = renderToStaticMarkup(<TodayDetails defaultOpen><div id="queue">Controls</div></TodayDetails>);
    expect(closed).not.toContain('open=""');
    expect(opened).toContain('open=""');
    expect(closed).toContain('id="queue"');
    expect(readFileSync("components/today-details.tsx","utf8")).toContain('addEventListener("hashchange"');
    expect(readFileSync("app/(dash)/today/page.tsx","utf8")).toContain("<TodayDetails");
  });
  it("does not claim a clear day when task information is missing", () => {
    const html = renderToStaticMarkup(<FocusedToday items={[]} overdue={0} dueToday={0} completed={0} activity={[]} incomplete />);
    expect(html).toContain("Task information is incomplete");
    expect(html).not.toContain("No tasks need you right now");
  });
});
