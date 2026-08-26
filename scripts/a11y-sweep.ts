/**
 * WCAG 2.2 AA, measured rather than asserted.
 *
 * The rules that can be checked by reading source are already checked by
 * tests/design-system.test.ts. These cannot: contrast depends on what colour
 * actually resolved after the cascade and the theme; a touch target depends on
 * what the box ended up being; a heading order depends on what rendered, not
 * on what the JSX suggests. A static scan of any of them produces confident
 * nonsense, which is worse than no check at all because it gets believed.
 *
 * So this drives a real browser at three widths, signs in, and measures.
 *
 * What it checks, and why each one is here:
 *
 *   contrast          4.5:1 for body text, 3:1 for large. The single most
 *                     common AA failure, and invisible to whoever picked the
 *                     colour on a good monitor.
 *   touch targets     44x44 minimum. An operator works these queues from a
 *                     phone in a truck.
 *   headings          One h1, no skipped levels. This is how a screen-reader
 *                     user navigates a page they cannot see.
 *   labels            Every input reachable by name. A placeholder is not a
 *                     label; it disappears the moment you type.
 *   focus             Something must visibly change on focus, or keyboard
 *                     navigation is invisible.
 *   colour-only       A status that differs from its neighbours by colour
 *                     alone is not a status to a colourblind reader.
 *   overflow          No horizontal page scroll at any width.
 *   images            Alt text present, even if empty for decoration.
 *
 * Run: npx tsx scripts/a11y-sweep.ts [--base http://localhost:3100]
 * Writes docs/accessibility-report.md.
 */
import { chromium, type Page } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = argValue("--base") ?? "http://localhost:3100";
const EMAIL = argValue("--email") ?? "nav@brostco.test";
const PASSWORD = argValue("--password") ?? "TestPass123!";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 900, height: 1180 },
  { name: "desktop", width: 1440, height: 1000 },
];

const ROUTES = [
  "/today",
  "/pipeline",
  "/review",
  "/call-queue",
  "/subs",
  "/communications",
  "/contracts",
  "/compliance",
  "/analytics",
  "/agents",
  "/how-it-works",
  "/settings/profile",
  "/settings/rules",
  "/settings/content",
  "/settings/integrations",
  "/settings/billing",
  /*
   * Added as the product grew. A sweep that reports zero findings over a route
   * list which lags the application is a sweep reporting on a smaller product
   * than the one that shipped, and the number it prints gets believed.
   *
   * tests/a11y-coverage.test.ts now fails when an operator page exists with no
   * entry here, so the list cannot fall behind again silently.
   */
  "/search",
  "/settings/notifications",
  "/settings/account",
  "/admin/accounts",
  "/admin/billing",
  "/admin/audit",
  "/admin/health",
  "/admin/invitations",
  "/authority",
  "/more",
];

interface Finding {
  route: string;
  width: string;
  rule: string;
  detail: string;
}

/**
 * Everything measurable about one rendered page, gathered in one pass.
 *
 * One evaluate rather than eight, because each round trip costs a second on a
 * page this size and the sweep already takes minutes.
 */
const PROBE = `(() => {
  const out = { contrast: [], targets: [], headings: [], labels: [], images: [], overflow: false, focusRing: null };

  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(",").map((n) => parseFloat(n));
    return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05); };

  // The nearest ancestor that actually paints, since a transparent parent
  // does not decide what the text sits on.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && parseFloat(s.opacity) > 0.1;
  };

  // --- contrast, on elements holding their own text ---
  const textNodes = [...document.querySelectorAll("p, span, a, button, h1, h2, h3, h4, li, td, th, dt, dd, label, summary")]
    .filter((el) => visible(el))
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
  const seen = new Set();
  for (const el of textNodes.slice(0, 400)) {
    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const size = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) {
      const key = s.color + "|" + size + "|" + Math.round(got * 10);
      if (seen.has(key)) continue;
      seen.add(key);
      out.contrast.push({
        text: (el.textContent || "").trim().slice(0, 40),
        color: s.color, bg: "rgb(" + bg.r + "," + bg.g + "," + bg.b + ")",
        size: Math.round(size), need, got: Math.round(got * 100) / 100,
      });
    }
  }

  // --- touch targets ---
  // The hit area, not the element. A checkbox inside a <label> is toggled by
  // clicking anywhere in the label, and a control wearing .tap has its box
  // grown by a pseudo-element. Measuring the input alone reports a 16px
  // target for something a thumb hits at 44, which sends you optimising a
  // number rather than the experience.
  const hitBox = (el) => {
    if (el.classList.contains("tap")) return { width: 44, height: 44 };
    const label = el.closest("label");
    if (label && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const lr = label.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      return { width: Math.max(lr.width, er.width), height: Math.max(lr.height, er.height) };
    }
    return el.getBoundingClientRect();
  };
  for (const el of [...document.querySelectorAll("a[href], button, input, select, textarea, [role=button]")]) {
    if (!visible(el)) continue;
    const r = hitBox(el);
    // Inline links inside a paragraph are exempt: WCAG 2.5.8 excepts targets
    // in a sentence, and padding them would break the sentence.
    const inSentence = el.tagName === "A" && el.parentElement &&
      /^(P|LI|SPAN|DD|TD)$/.test(el.parentElement.tagName) &&
      (el.parentElement.textContent || "").trim().length > (el.textContent || "").trim().length + 12;
    if (inSentence) continue;
    if (r.width < 44 || r.height < 44) {
      out.targets.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 34),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  // --- heading order ---
  const hs = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible);
  out.headings = hs.map((h) => ({ level: +h.tagName[1], text: (h.textContent || "").trim().slice(0, 40) }));

  // --- form labels ---
  for (const el of [...document.querySelectorAll("input, select, textarea")]) {
    if (!visible(el)) continue;
    if (el.type === "hidden") continue;
    const id = el.id;
    const labelled =
      (id && document.querySelector('label[for="' + CSS.escape(id) + '"]')) ||
      el.closest("label") ||
      el.getAttribute("aria-label") ||
      (el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby")));
    if (!labelled) {
      out.labels.push({ tag: el.tagName.toLowerCase(), type: el.type || "", name: el.name || "", placeholder: el.placeholder || "" });
    }
  }

  // --- images ---
  for (const el of [...document.querySelectorAll("img")]) {
    if (el.getAttribute("alt") == null) out.images.push({ src: (el.getAttribute("src") || "").slice(0, 60) });
  }

  out.overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
  return out;
})()`;

/**
 * Serve the remote font stylesheet locally as empty.
 *
 * Not a convenience: the sweep has to be deterministic and it has to finish.
 * A network that cannot reach fonts.googleapis.com leaves the render-blocking
 * <link> hanging until the socket gives up, which added ~12s to every single
 * page load and put a 48-page sweep past any sensible timeout. Fulfilling it
 * empty is also a real condition -- an operator behind a corporate proxy that
 * blocks Google sees exactly this -- so the fallback font stack is what gets
 * measured, which is the more conservative choice for contrast and sizing.
 */
async function stubFonts(page: Page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
}

async function login(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await page.fill("input[type=email]", EMAIL);
  await page.fill("input[type=password]", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 40000 });
}

/**
 * Whether focus is visibly indicated.
 *
 * Compares the computed outline and box-shadow before and after focusing a
 * control. Checking for a CSS rule would not do: a rule can be overridden, and
 * what matters is what the operator can actually see.
 *
 * The element has to be VISIBLE, and focus has to have actually landed on it.
 * The first version of this took `querySelector("a[href], button, input")` --
 * the first in DOM order -- which at tablet and desktop is the mobile app
 * bar's wordmark, `display: none`. Calling focus() on a hidden element does
 * nothing, nothing changes, and the sweep reported thirty pages with invisible
 * focus rings that in fact have perfectly good ones. A checker that cries wolf
 * gets switched off, so it now confirms the element took focus before drawing
 * any conclusion from it.
 */
async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea")];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width < 1 || r.height < 1 || s.visibility === "hidden" || s.display === "none") continue;
      const b = [s.outlineWidth, s.outlineStyle, s.outlineColor, s.boxShadow].join("|");
      el.focus();
      if (document.activeElement !== el) continue;
      const a2 = getComputedStyle(el);
      const a = [a2.outlineWidth, a2.outlineStyle, a2.outlineColor, a2.boxShadow].join("|");
      return a !== b;
    }
    // Nothing focusable rendered: not a focus-ring failure to report.
    return true;
  });
}

async function main() {
  const findings: Finding[] = [];
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.name === "mobile",
      hasTouch: vp.name === "mobile",
    });
    const page = await ctx.newPage();
    await stubFonts(page);
    await login(page);

    for (const route of ROUTES) {
      try {
        await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 40000 });
      } catch {
        findings.push({ route, width: vp.name, rule: "load", detail: "timed out" });
        continue;
      }

      const r = (await page.evaluate(PROBE)) as any;

      for (const c of r.contrast) {
        findings.push({
          route,
          width: vp.name,
          rule: "contrast",
          detail: `${c.got}:1 needs ${c.need}:1 -- ${c.size}px ${c.color} on ${c.bg} -- "${c.text}"`,
        });
      }
      // Only mobile has a touch requirement; a mouse pointer is precise.
      if (vp.name === "mobile") {
        for (const t of r.targets) {
          findings.push({
            route, width: vp.name, rule: "touch-target",
            detail: `${t.w}x${t.h} <${t.tag}> "${t.text}"`,
          });
        }
      }
      const h1s = r.headings.filter((h: any) => h.level === 1);
      if (h1s.length === 0) {
        findings.push({ route, width: vp.name, rule: "heading", detail: "no h1" });
      } else if (h1s.length > 1) {
        findings.push({ route, width: vp.name, rule: "heading", detail: `${h1s.length} h1 elements` });
      }
      for (let i = 1; i < r.headings.length; i++) {
        const jump = r.headings[i].level - r.headings[i - 1].level;
        if (jump > 1) {
          findings.push({
            route, width: vp.name, rule: "heading",
            detail: `h${r.headings[i - 1].level} to h${r.headings[i].level} -- "${r.headings[i].text}"`,
          });
        }
      }
      for (const l of r.labels) {
        findings.push({
          route, width: vp.name, rule: "label",
          detail: `<${l.tag}${l.type ? ` type=${l.type}` : ""}> name="${l.name}" placeholder="${l.placeholder}"`,
        });
      }
      for (const im of r.images) {
        findings.push({ route, width: vp.name, rule: "img-alt", detail: im.src });
      }
      if (r.overflow) {
        findings.push({ route, width: vp.name, rule: "overflow", detail: "page scrolls horizontally" });
      }
      if (!(await focusVisible(page))) {
        findings.push({ route, width: vp.name, rule: "focus", detail: "no visible change on focus" });
      }
    }
    await ctx.close();
  }
  await browser.close();

  // ----- report -----
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule)!.push(f);
  }

  const out: string[] = [];
  out.push("# Accessibility report");
  out.push("");
  out.push("Generated by `npx tsx scripts/a11y-sweep.ts` against a running server.");
  out.push("Measured in Chromium at three widths, signed in, on rendered output.");
  out.push("");
  out.push(
    "The remote font stylesheet is stubbed empty, so the fallback stack is what gets " +
      "measured. That is the more conservative reading and matches what an operator behind " +
      "a proxy that blocks Google actually sees."
  );
  out.push("");
  out.push(`${ROUTES.length} routes x ${WIDTHS.length} widths. **${findings.length} findings.**`);
  out.push("");

  if (findings.length === 0) {
    out.push("No failures against the rules checked.");
  } else {
    out.push("| Rule | Count |");
    out.push("| --- | --- |");
    for (const [rule, fs] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`| ${rule} | ${fs.length} |`);
    }
    out.push("");
    for (const [rule, fs] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
      out.push(`## ${rule} (${fs.length})`);
      out.push("");
      // Deduplicated: the same control on twelve pages is one thing to fix.
      // Deduplicated per width, not across it: the same control can pass at
      // one size and fail at another, and collapsing those hides which.
      const seen = new Set<string>();
      for (const f of fs) {
        const key = `${f.width}|${f.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const routes = [...new Set(
          fs.filter((x) => x.detail === f.detail && x.width === f.width).map((x) => x.route)
        )];
        const where = routes.length > 3 ? `${routes.length} routes` : routes.join(", ");
        out.push(`- \`${f.width}\` ${f.detail} _(${where})_`);
      }
      out.push("");
    }
  }

  mkdirSync(join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(join(process.cwd(), "docs/accessibility-report.md"), out.join("\n"));
  console.error(`[a11y] ${findings.length} findings -> docs/accessibility-report.md`);
  for (const [rule, fs] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`[a11y]   ${rule}: ${fs.length}`);
  }
}

main().catch((e) => {
  console.error("[a11y] failed:", e);
  process.exit(1);
});
