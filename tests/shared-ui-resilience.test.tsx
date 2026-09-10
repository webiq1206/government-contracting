import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  usePathname: () => "/today",
  useSearchParams: () => new URLSearchParams(),
}));

const { CallPanel } = await import("../components/call-panel");
const { ConfirmDialog } = await import("../components/confirm-dialog");
const { SentConfirmationFlow } = await import("../components/sent-confirmation-flow");

describe("shared mobile overlays", () => {
  it("keeps fixed actions clear of the mobile tab bar", () => {
    const files = [
      "components/confirm-dialog.tsx",
      "components/row-actions.tsx",
      "components/detail-drawer.tsx",
      "components/context-drawer.tsx",
      "components/sent-confirmation-flow.tsx",
      "components/call-workspace.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes("dialog.showModal()") ||
          source.includes("mobile-tab-clearance") ||
          source.includes("drawer-footer") ||
          source.includes("bottom-[calc(4rem+env(safe-area-inset-bottom))]")
      ).toBe(true);
    }
  });

  it("labels confirmation dialogs and traps keyboard focus", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog
        open
        title="Remove this item"
        confirmLabel="Remove"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("aria-labelledby");
    expect(readFileSync("components/confirm-dialog.tsx", "utf8")).toContain(
      "document.activeElement"
    );
    expect(html).toContain("max-h-[calc(100dvh-2rem)]");
    expect(html).toContain("overflow-y-auto");
  });

  it("keeps the blocking trial dialog keyboard-contained", () => {
    const frame = readFileSync("components/blocking-dialog.tsx", "utf8");
    const trial = readFileSync("components/trial-expired-modal.tsx", "utf8");
    expect(frame).toContain('role="dialog"');
    expect(frame).toContain('aria-modal="true"');
    expect(frame).toContain('event.key !== "Tab"');
    expect(frame).toContain("first?.focus()");
    expect(trial).toContain("<BlockingDialog");
    expect(trial).toContain('labelledBy="trial-expired-title"');
  });

  it("keeps the guided sent flow labelled and above mobile navigation", () => {
    const html = renderToStaticMarkup(
      <SentConfirmationFlow opportunityId="opp-1" proofOptions={[]} onClose={() => {}} />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("aria-labelledby");
    expect(html).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
  });
});

describe("shared failure and loading states", () => {
  it("announces call loading and provides a bounded retry path", () => {
    const html = renderToStaticMarkup(<CallPanel cardId="card-1" closeHref="/call-queue" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');

    const source = readFileSync("components/call-panel.tsx", "utf8");
    expect(source).toContain("AbortController");
    expect(source).toContain("12_000");
    expect(source).toContain("Try again");
    expect(source).toContain('role="alert"');

    const launcher = readFileSync("components/call-workspace-launcher.tsx", "utf8");
    expect(launcher).toContain("AbortController");
    expect(launcher).toContain("12_000");
    expect(launcher).toContain("Try again");
  });

  it("distinguishes a search failure from no matching records", () => {
    const source = readFileSync("components/command-palette.tsx", "utf8");
    expect(source).toContain("Search did not load");
    expect(source).toContain("searchError && !searching");
    expect(source).toContain("!searchError && flat.length === 0");
    expect(source).toContain("controller.abort()");
  });
});

describe("rendered accessibility sweep coverage", () => {
  it("recognizes every phone and tablet label as a touch viewport", () => {
    const source = readFileSync("scripts/a11y-sweep.ts", "utf8");
    expect(source).toContain('width.startsWith("phone-")');
    expect(source).toContain('width.startsWith("tablet-")');
    expect(source).toContain("touchViewport");
    expect(source).not.toContain('width === "mobile"');
    expect(source).toContain('rule: "covered-control"');
    expect(source).toContain("textarea, summary, [role=button]");
  });

  it("restores 44 pixel controls on coarse pointers after desktop breakpoints", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const coarse = css.slice(css.lastIndexOf("@media (pointer: coarse)"));
    expect(coarse).toContain('[class~="min-h-11"]');
    expect(coarse).toContain("summary,");
    expect(coarse).toContain("min-height: 2.75rem !important");
    expect(coarse).toContain('[class~="min-w-11"]');
  });

  it("uses visible form and secondary-control borders in both themes", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("border-foreground/50 bg-background");
    expect(css).toContain("border-white/35 bg-shell");
    expect(css).toContain("border-foreground/50 bg-surface");

    const rootStart = css.indexOf(":root");
    const darkStart = css.indexOf("\n.dark {", rootStart);
    const root = css.slice(rootStart, darkStart);
    const dark = css.slice(darkStart, css.indexOf("\nhtml,", darkStart));
    const token = (scope: string, name: string) => {
      const value = scope.match(new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`));
      expect(value).not.toBeNull();
      return value!.slice(1, 4).map(Number);
    };
    const blend = (front: number[], back: number[], alpha: number) =>
      front.map((value, index) => value * alpha + back[index]! * (1 - alpha));
    const luminance = (color: number[]) => {
      const linear = color.map((value) => {
        const channel = value / 255;
        return channel <= 0.03928
          ? channel / 12.92
          : Math.pow((channel + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    };
    const contrast = (one: number[], two: number[]) => {
      const values = [luminance(one), luminance(two)].sort((a, b) => b - a);
      return (values[0]! + 0.05) / (values[1]! + 0.05);
    };
    const lightBackground = token(root, "background");
    const darkBackground = token(dark, "shell");
    expect(
      contrast(blend(token(root, "foreground"), lightBackground, 0.5), lightBackground)
    ).toBeGreaterThanOrEqual(3);
    expect(contrast(blend([255, 255, 255], darkBackground, 0.35), darkBackground)).toBeGreaterThanOrEqual(
      3
    );
  });

  it("keeps compact help surfaces inside the visual viewport", () => {
    for (const file of ["components/help-popover.tsx", "components/info-tip.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("fixed inset-x-4");
      expect(source).toContain(
        "max-h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom))]"
      );
      expect(source).toContain("overflow-y-auto");
    }
  });

  it("keeps dense card controls usable by touch through tablet widths", () => {
    const contact = readFileSync("components/contact-quick-edit.tsx", "utf8");
    expect(contact).toContain("tap inline-flex h-8 w-8");
    expect(contact).toContain("<ConfirmDialog");
    expect(contact).toContain("busy={saving}");

    const menu = readFileSync("components/pipeline-card-menu.tsx", "utf8");
    expect(menu).toContain("tap flex h-8 w-8");
    expect(menu).toContain("bottom-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(menu).toContain("block min-h-11 w-full");
  });

  it("lets integration credentials and actions wrap on narrow cards", () => {
    const source = readFileSync("components/integration-manager.tsx", "utf8");
    expect(source).toContain("flex min-w-0 flex-wrap items-center justify-end");
    expect(source).toContain("num break-all");
    expect(source).toContain("flex flex-col items-stretch gap-2");
  });

  it("keeps secondary workflow links large enough for touch", () => {
    const reply = readFileSync("components/reply-review-list.tsx", "utf8");
    expect(reply).not.toContain("min-h-7");
    expect(reply).not.toContain("min-h-9 text-xs text-accent");

    const sent = readFileSync("components/sent-confirmation-flow.tsx", "utf8");
    expect(sent).toContain(
      'className="inline-flex min-h-11 items-center text-sm underline underline-offset-2"'
    );
  });
});
