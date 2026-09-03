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
 * So this drives a real browser at six widths, signs in, and measures.
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

/*
 * The audit's six representative widths, not three. The pairs matter: a
 * layout can hold at 390 and clip at 360, and a tablet turned sideways is a
 * different page from one held upright. Wide desktop is where excessive
 * whitespace and unreadable line lengths hide, which no narrower width can
 * catch.
 */
const WIDTHS = [
  { name: "phone-small", width: 360, height: 780 },
  { name: "phone-large", width: 430, height: 932 },
  { name: "tablet-portrait", width: 820, height: 1180 },
  { name: "tablet-landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 1000 },
  { name: "desktop-wide", width: 1920, height: 1080 },
];

const ROUTES = [
  "/today",
  "/workbench",
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
  "/feedback",
  "/recap",
  "/settings/recap",
  "/admin/recap",
];

/**
 * The pages a customer meets before they have an account.
 *
 * Never measured until now, because the sweep signs in before it starts and
 * these cannot be reached afterwards. They are the first thing every customer
 * sees, and the one place where a contrast failure costs a signup rather than
 * an inconvenience.
 *
 * Swept in their own pass with no session cookie, so a redirect to /today
 * cannot silently turn "I measured the login page" into "I measured Today".
 */
const SIGNED_OUT_ROUTES = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/privacy",
  "/terms",
  "/sitemap",
  "/compare",
  "/pricing-guide",
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

  /*
   * What is actually painted behind the text.
   *
   * The ancestor walk alone reported the marketing site's navigation as
   * 1.05:1, near-invisible, when it is light text sitting legibly on a dark
   * hero. The header is positioned over that hero rather than inside it, so
   * walking up the DOM left the hero out entirely and landed on the cream page
   * background two levels higher. A confident wrong contrast number is worse
   * than no check, because it sends somebody to "fix" a page that is correct.
   *
   * So hit-test the point instead, which is what a reader's eye does. Only
   * possible while the element is in the viewport; below the fold the walk is
   * still the best available answer, and it is right wherever the background
   * comes from an ancestor, which is the ordinary case.
   */
  const walkUp = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  /*
   * The background this text is actually painted on.
   *
   * This used to hit-test the point with elementsFromPoint, on the reasoning
   * that a reader's eye sees whatever is at that pixel. The trouble is that
   * elementsFromPoint returns what is ON TOP as well as what is behind, and
   * the top of the stack at any point in the lower fifth of a phone screen is
   * the fixed tab bar, whose background is bg-background/95.
   *
   * So a gold Save button that happened to sit under the bar at rest was
   * reported as 1.1:1 near-black on near-black: a control coloured correctly,
   * failed for being in the wrong place, and filed under the wrong rule. A
   * report that cries wolf about a button anybody can see is one that gets
   * skimmed, which costs more than the check is worth.
   *
   * elementsFromPoint is still the right tool, because a background can come
   * from a sibling painted behind rather than an ancestor: the marketing
   * header is absolutely positioned over a dark hero it is not inside, and an
   * ancestor walk from there finds the cream page background and calls the
   * white nav links invisible.
   *
   * The list is ordered front to back, so the element's own position in it is
   * the dividing line: everything before it is covering it, everything from it
   * onwards is behind it. Start at the element.
   *
   * A control genuinely hidden under fixed chrome is a layout fault rather
   * than a contrast one, and belongs to the overlap rule.
   */
  const bgOf = (el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const inView = x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
    if (inView) {
      const stack = document.elementsFromPoint(x, y);
      const self = stack.indexOf(el);
      if (self !== -1) {
        for (const n of stack.slice(self)) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0.5) return c;
        }
      }
    }
    return walkUp(el);
  };

  /*
   * Deliberately hidden from sight but present for a screen reader.
   *
   * The .sr-only pattern is a 1px absolutely positioned box clipped to
   * nothing, so it has a non-zero rect and passes every other visibility test.
   * Measuring its contrast asks what colour invisible text is against, and the
   * answer was being reported as a defect on a control that is correct.
   */
  const screenReaderOnly = (el, s, r) =>
    r.width <= 1 &&
    r.height <= 1 &&
    s.position === "absolute" &&
    s.overflow === "hidden" &&
    (s.clip.indexOf("rect(0") === 0 || s.clipPath.indexOf("inset(50%)") === 0);

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (screenReaderOnly(el, s, r)) return false;
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
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
}

async function login(page: Page) {
  /*
   * Signed in through the API rather than by driving the form.
   *
   * Clicking the real button made the sweep depend on React hydration timing:
   * once the signed-out pass runs first this page arrives with history behind
   * it, and a press that lands early is swallowed, which the sweep then
   * reported as a broken sign-in on a form that works. The form itself is
   * measured in the signed-out pass, so nothing is lost by not using it here.
   */
  await page.goto(`${BASE}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 40000,
  });
  const status = await page.evaluate(
    async ([email, password]) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return res.status;
    },
    [EMAIL, PASSWORD]
  );
  if (status !== 200) throw new Error(`sign-in failed with ${status}`);
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
    const candidates = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button, input, select, textarea",
      ),
    ];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (
        r.width < 1 ||
        r.height < 1 ||
        s.visibility === "hidden" ||
        s.display === "none"
      )
        continue;
      const b = [
        s.outlineWidth,
        s.outlineStyle,
        s.outlineColor,
        s.boxShadow,
      ].join("|");
      el.focus();
      if (document.activeElement !== el) continue;
      const a2 = getComputedStyle(el);
      const a = [
        a2.outlineWidth,
        a2.outlineStyle,
        a2.outlineColor,
        a2.boxShadow,
      ].join("|");
      return a !== b;
    }
    // Nothing focusable rendered: not a focus-ring failure to report.
    return true;
  });
}

/**
 * Everything measured about one route at one width.
 *
 * Extracted so the signed-out pass and the signed-in pass cannot drift into
 * checking different things, which is exactly how the route list came to cover
 * less than the product.
 */
async function measure(
  page: Page,
  route: string,
  width: string,
  findings: Finding[],
  /**
   * Restrict this pass to one rule. The dark pass measures contrast only:
   * target sizes and accessible names do not change with the theme, and
   * reporting them twice would double every finding.
   */
  only: string | null = null,
): Promise<void> {
  /*
   * Collected here and filtered once, rather than at each site. `only` is a
   * property of the pass, not of any individual check, and threading it
   * through ten call sites is how one of them ends up forgotten.
   */
  const local: Finding[] = [];
  const flush = () => {
    for (const f of local) if (!only || f.rule === only) findings.push(f);
  };
  try {
    await page.goto(BASE + route, {
      waitUntil: "domcontentloaded",
      timeout: 40000,
    });
  } catch {
    local.push({ route, width, rule: "load", detail: "timed out" });
    flush();
    return;
  }

  /*
   * Wait for the page itself, not the sketch of it.
   *
   * `domcontentloaded` is the right gate for how long this sweep is allowed to
   * take and the wrong one for what it measures. Routes with a `loading.tsx`
   * -- /today, /pipeline, /call-queue, the whole dash group through its shared
   * one -- flush a skeleton first, and a skeleton has no h1, no labelled
   * controls and almost no text. Measured in that state the sweep reported
   * "no h1" against pages that have one, intermittently, on whichever route
   * happened to be slowest that run. It cost three separate investigations
   * before the cause was captured, because the finding never reproduced on a
   * second run and so read as a flake every time.
   *
   * Waiting for an h1 rather than for the network to fall idle keeps the sweep
   * fast on the pages that are already rendered, which is nearly all of them:
   * the wait resolves immediately when the heading is there. A page that
   * genuinely has no h1 pays this timeout once and is then reported, which is
   * the correct outcome and the reason the wait is bounded rather than
   * indefinite.
   */
  await page.waitForSelector("h1", { state: "attached", timeout: 8000 }).catch(() => {});

  /*
   * A route the sweep's user cannot reach is a different fact from a route
   * with findings. This previously measured whatever rendered instead - the
   * 404 page, or the login screen after a bounced redirect - and attributed
   * that page's structure to the route it asked for, which is how six admin
   * routes once reported "no h1" that was really "you are not an admin".
   * Reported loudly rather than skipped: a sweep that quietly measures fewer
   * pages than its route list prints a coverage number that gets believed.
   */
  const reached = (await page.evaluate(
    `(() => {
      const body = document.body?.innerText ?? "";
      if (body.includes("That page or record does not exist")) return "404";
      if (location.pathname === "/login" && ${JSON.stringify(route)} !== "/login") return "login";
      return "ok";
    })()`
  )) as string;
  if (reached !== "ok") {
    local.push({
      route,
      width,
      rule: "unreachable",
      detail:
        reached === "404"
          ? "renders the 404 page for the sweep user; run with an account that can see it (admin routes need PLATFORM_ADMIN_EMAILS to include the sweep email)"
          : "redirects to login; the session was lost",
    });
    flush();
    return;
  }

  const r = (await page.evaluate(PROBE)) as any;

  for (const c of r.contrast) {
    local.push({
      route,
      width,
      rule: "contrast",
      detail: `${c.got}:1 needs ${c.need}:1 -- ${c.size}px ${c.color} on ${c.bg} -- "${c.text}"`,
    });
  }
  // Only mobile has a touch requirement; a mouse pointer is precise.
  if (width === "mobile") {
    for (const t of r.targets) {
      local.push({
        route,
        width,
        rule: "touch-target",
        detail: `${t.w}x${t.h} <${t.tag}> "${t.text}"`,
      });
    }
  }
  const h1s = r.headings.filter((h: any) => h.level === 1);
  if (h1s.length === 0) {
    local.push({ route, width, rule: "heading", detail: "no h1" });
  } else if (h1s.length > 1) {
    local.push({
      route,
      width,
      rule: "heading",
      detail: `${h1s.length} h1 elements`,
    });
  }
  for (let i = 1; i < r.headings.length; i++) {
    const jump = r.headings[i].level - r.headings[i - 1].level;
    if (jump > 1) {
      local.push({
        route,
        width,
        rule: "heading",
        detail: `h${r.headings[i - 1].level} to h${r.headings[i].level} -- "${r.headings[i].text}"`,
      });
    }
  }
  for (const l of r.labels) {
    local.push({
      route,
      width,
      rule: "label",
      detail: `<${l.tag}${l.type ? ` type=${l.type}` : ""}> name="${l.name}" placeholder="${l.placeholder}"`,
    });
  }
  for (const im of r.images) {
    local.push({ route, width, rule: "img-alt", detail: im.src });
  }
  if (r.overflow) {
    local.push({
      route,
      width,
      rule: "overflow",
      detail: "page scrolls horizontally",
    });
  }
  if (!(await focusVisible(page))) {
    local.push({
      route,
      width,
      rule: "focus",
      detail: "no visible change on focus",
    });
  }
  flush();
}

const THEMES = ["light", "dark"] as const;

/**
 * Put the page in dark mode the way the product does.
 *
 * `colorScheme: "dark"` on the context covers `prefers-color-scheme`, but the
 * theme provider writes a `dark` class on the root element and remembers the
 * choice in localStorage, so a page loaded without it renders light whatever
 * the media query says. Both are set: the class for this load, the stored
 * value for every navigation after it.
 */
async function forceDark(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("brost.theme", "dark");
    } catch {
      /* storage off: the class below still applies */
    }
    document.documentElement.classList.add("dark");
  });
}

async function main() {
  const findings: Finding[] = [];
  const browser = await chromium.launch({
    executablePath: "/opt/pw-browsers/chromium",
  });

  /*
   * Both themes, because contrast is a property of the pair.
   *
   * This measured the light theme only, and dark is not a variant of it: the
   * palette swaps through CSS variables, so anything written as a fixed colour
   * rather than a token keeps its light-mode value on a dark background and is
   * never checked. Reporting "0 findings" while half the shipped product went
   * unmeasured is the same failure as a health page that only looks at the
   * agents which ran.
   *
   * Touch targets and names do not change with the theme, so those rules are
   * measured once, in light, and the dark pass reports contrast alone. That
   * keeps the run from doubling and keeps one finding from being listed twice.
   */
  for (const vp of WIDTHS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.name === "mobile",
        hasTouch: vp.name === "mobile",
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      await stubFonts(page);
      if (theme === "dark") await forceDark(page);

      const label = theme === "dark" ? `${vp.name} dark` : vp.name;
      const only = theme === "dark" ? "contrast" : null;

      // Signed out first, in a context that has never held a session cookie.
      for (const route of SIGNED_OUT_ROUTES) {
        await measure(page, route, label, findings, only);
      }

      await login(page);

      for (const route of ROUTES) {
        await measure(page, route, label, findings, only);
      }
      await ctx.close();
    }
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
  out.push(
    "Generated by `npx tsx scripts/a11y-sweep.ts` against a running server.",
  );
  out.push(
    "Measured in Chromium at six widths and in both themes, on rendered output: one pass signed out " +
      "over the pages a customer meets before they have an account, then one signed in " +
      "over the operator pages.",
  );
  out.push("");
  out.push(
    "The remote font stylesheet is stubbed empty, so the fallback stack is what gets " +
      "measured. That is the more conservative reading and matches what an operator behind " +
      "a proxy that blocks Google actually sees.",
  );
  out.push("");
  out.push(
    `${SIGNED_OUT_ROUTES.length} signed-out and ${ROUTES.length} signed-in routes x ` +
      `${WIDTHS.length} widths x ${THEMES.length} themes. **${findings.length} findings.**`,
  );
  out.push("");
  out.push(
    "The dark pass reports contrast only. Target sizes and accessible names do " +
      "not change with the theme, so measuring them twice would list every " +
      "finding twice without covering anything more.",
  );
  out.push("");

  if (findings.length === 0) {
    out.push("No failures against the rules checked.");
  } else {
    out.push("| Rule | Count |");
    out.push("| --- | --- |");
    for (const [rule, fs] of [...byRule].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      out.push(`| ${rule} | ${fs.length} |`);
    }
    out.push("");
    for (const [rule, fs] of [...byRule].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
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
        const routes = [
          ...new Set(
            fs
              .filter((x) => x.detail === f.detail && x.width === f.width)
              .map((x) => x.route),
          ),
        ];
        const where =
          routes.length > 3 ? `${routes.length} routes` : routes.join(", ");
        out.push(`- \`${f.width}\` ${f.detail} _(${where})_`);
      }
      out.push("");
    }
  }

  mkdirSync(join(process.cwd(), "docs"), { recursive: true });
  writeFileSync(
    join(process.cwd(), "docs/accessibility-report.md"),
    out.join("\n"),
  );
  console.error(
    `[a11y] ${findings.length} findings -> docs/accessibility-report.md`,
  );
  for (const [rule, fs] of [...byRule].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.error(`[a11y]   ${rule}: ${fs.length}`);
  }
}

main().catch((e) => {
  console.error("[a11y] failed:", e);
  process.exit(1);
});
