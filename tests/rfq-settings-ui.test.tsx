import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";
import { act } from "react";
import type { Root } from "react-dom/client";
import { DEFAULT_RULES } from "@/lib/domain/intake";
import { AutomationRulesForm } from "@/components/automation-rules-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

let root: Root;
let container: HTMLElement;
const requests: { body: Record<string, unknown> }[] = [];

beforeEach(async () => {
  requests.length = 0;
  const { window } = parseHTML("<html><body><main></main></body></html>");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hash: "",
      href: "http://localhost/settings/rules",
      pathname: "/settings/rules",
      origin: "http://localhost",
      search: "",
    },
  });
  Object.defineProperty(window, "history", {
    configurable: true,
    value: { replaceState: () => undefined, pushState: () => undefined },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ body });
    const preview = { past_due_open: 0, below_lead_time: 0, past_retention: 0, queued_calls: 0 };
    if (body.preview_only) {
      return new Response(JSON.stringify({ preview, impacts: [], confirm: false }), { status: 200 });
    }
    return new Response(JSON.stringify({
      ok: true,
      rules: { ...DEFAULT_RULES, ...body },
      preview,
    }), { status: 200 });
  }));
  const { createRoot } = await import("react-dom/client");
  container = document.querySelector("main")!;
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

function input(name: string): HTMLInputElement {
  const node = container.querySelector(`input[name="${name}"]`);
  if (!(node instanceof HTMLInputElement)) throw new Error(`missing ${name}`);
  return node;
}

function reactProps(node: HTMLElement): { onChange?: (event: { target: HTMLInputElement }) => void } {
  const key = Object.keys(node).find((name) => name.startsWith("__reactProps"));
  if (!key) throw new Error("missing react props");
  return (node as unknown as Record<string, { onChange?: (event: { target: HTMLInputElement }) => void }>)[key];
}

async function typeNumber(name: string, value: string) {
  const node = input(name);
  await act(async () => {
    reactProps(node).onChange?.({ target: Object.assign(node, { value }) });
  });
}

async function setChecked(name: string, checked: boolean) {
  const node = input(name);
  await act(async () => {
    reactProps(node).onChange?.({ target: Object.assign(node, { checked }) });
  });
}

describe("organization quote-request settings", () => {
  it("shows editable caps at 25 and 5, and pauses outbound requests when the switch is saved", async () => {
    await act(async () => root.render(<AutomationRulesForm initial={DEFAULT_RULES} />));

    expect(container.textContent).toContain("Outbound quote requests are on");
    expect(container.textContent).toContain("Default is 100.");
    expect(container.textContent).toContain("The defaults are 100 a day");
    expect(input("rfq_daily_cap").value).toBe("100");
    expect(input("rfq_daily_cap").disabled).toBe(false);
    expect(input("rfq_subs_per_trade").value).toBe("5");
    expect(input("rfq_subs_per_trade").disabled).toBe(false);
    expect(input("rfq_outbound_paused").checked).toBe(false);
    expect(container.textContent).toContain("Pause outbound quote requests");

    await typeNumber("rfq_daily_cap", "10");
    await typeNumber("rfq_subs_per_trade", "2");
    expect(input("rfq_daily_cap").value).toBe("10");
    expect(input("rfq_subs_per_trade").value).toBe("2");
    await setChecked("rfq_outbound_paused", true);
    expect(container.textContent).toContain("Outbound quote requests are paused");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save rules");
    expect(save?.disabled).toBe(false);
    await act(async () => {
      save!.dispatchEvent(new window.Event("click", { bubbles: true }));
    });

    const saved = requests.find((request) => request.body.preview_only !== true);
    expect(saved?.body.rfq_daily_cap).toBe(10);
    expect(saved?.body.rfq_subs_per_trade).toBe(2);
    expect(saved?.body.rfq_outbound_enabled).toBe(false);

    const route = await import("node:fs").then((fs) => fs.readFileSync("app/api/automation/rules/route.ts", "utf8"));
    const pause = await import("node:fs").then((fs) => fs.readFileSync("lib/rfq-pause.ts", "utf8"));
    expect(route).toContain("before.rfq_outbound_enabled && !saved.rfq_outbound_enabled");
    expect(route).toContain("pauseOutboundRfqs(orgId)");
    expect(pause).toContain("human_action_required = true");
    expect(pause).toContain("o.org_id = $1");
    expect(pause).toContain("'pending'");
    expect(pause).not.toContain("'sent'");
  });
});
