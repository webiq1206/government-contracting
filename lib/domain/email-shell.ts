/**
 * The branded HTML shell every platform email is poured into.
 *
 * Until now system mail was a bare div with a font stack on it, which is fine
 * for a password reset and not fine for something somebody reads every
 * morning. This is the layout: header, content, footer, and the handful of
 * primitives (section heading, item row, statistic, callout, button) that the
 * recap and anything after it can compose without each one inventing its own
 * table markup.
 *
 * Written for mail clients, not for browsers. That means:
 *   - tables for layout, because Outlook on Windows still renders through Word
 *   - every style inline, because Gmail strips <style> from forwarded mail and
 *     several clients strip it outright
 *   - no flexbox, no grid, no external assets, no web fonts
 *   - a fluid single column with a max width, which is the only responsive
 *     technique that behaves everywhere without media queries
 *
 * Accessibility is not decoration here: status is always carried by a word as
 * well as a colour, layout tables are marked presentational, and the contrast
 * of every pairing below is taken from the light theme, which already meets
 * AA on the page.
 *
 * Pure.
 */

/** The light theme's palette, as literal hex. Email cannot read CSS variables. */
export const BRAND = {
  paper: "#f1ece3",
  surface: "#ffffff",
  surfaceMuted: "#f9f6f0",
  ink: "#171713",
  inkSoft: "#54514a",
  border: "#ded6c8",
  borderStrong: "#c8bda9",
  gold: "#c3a06b",
  goldDeep: "#a68250",
  goldText: "#7d6644",
  accent: "#7e5e33",
  risk: "#a2453c",
  riskSoft: "#fbeceb",
  review: "#855c2c",
  reviewSoft: "#fbf1e4",
  pursue: "#4a5943",
  pursueSoft: "#eef1ea",
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export function escapeHtml(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * An absolute URL for a path, because a relative href in an email goes
 * nowhere. A path that is already absolute is left alone.
 */
export function absoluteUrl(base: string, path: string | null | undefined): string | null {
  if (!path) return null;
  const p = path.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const root = (base || "").replace(/\/+$/, "");
  return `${root}${p.startsWith("/") ? "" : "/"}${p}`;
}

export interface EmailShellOptions {
  /** The <title>, and the heading in the coloured header band. */
  title: string;
  /** The line under the heading, and the inbox preview text. */
  preheader?: string;
  /** Small line above the heading: a date, an account name. */
  eyebrow?: string;
  /** Already-rendered HTML for the body. */
  body: string;
  /** Footer lines, rendered small and muted. HTML allowed. */
  footer?: string[];
  brandName?: string;
}

/**
 * The wrapper.
 *
 * The hidden preheader span is the text a mail client shows beside the subject
 * in the list view. Left out, clients grab the first words of the header
 * markup, which is how "View this email" ends up as the summary of everything
 * we send.
 */
export function emailShell(opts: EmailShellOptions): string {
  const brand = opts.brandName ?? "BROST CO";
  const footer = (opts.footer ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 6px;font-family:${FONT};font-size:12px;line-height:1.5;color:${BRAND.inkSoft}">${line}</p>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.paper};-webkit-text-size-adjust:100%">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(
    opts.preheader ?? ""
  )}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.paper};padding:16px 0">
  <tr>
    <td align="center" style="padding:0 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:4px">
        <tr>
          <td style="background:${BRAND.ink};padding:20px 24px;border-radius:4px 4px 0 0">
            ${
              opts.eyebrow
                ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.gold}">${escapeHtml(
                    opts.eyebrow
                  )}</p>`
                : ""
            }
            <h1 style="margin:0;font-family:${FONT};font-size:20px;line-height:1.3;font-weight:700;color:#ffffff">${escapeHtml(
              opts.title
            )}</h1>
            ${
              opts.preheader
                ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:#e6dfd2">${escapeHtml(
                    opts.preheader
                  )}</p>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 8px">${opts.body}</td>
        </tr>
        <tr>
          <td style="padding:16px 24px 24px;border-top:1px solid ${BRAND.border}">
            ${footer}
            <p style="margin:10px 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:${BRAND.inkSoft}">${escapeHtml(
              brand
            )}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A section heading with a rule under it, and an optional one-line blurb. */
export function emailHeading(title: string, blurb?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 10px">
  <tr><td style="border-bottom:2px solid ${BRAND.goldDeep};padding-bottom:6px">
    <h2 style="margin:0;font-family:${FONT};font-size:16px;line-height:1.3;font-weight:700;color:${BRAND.ink}">${escapeHtml(
      title
    )}</h2>
    ${
      blurb
        ? `<p style="margin:4px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${BRAND.inkSoft}">${escapeHtml(
            blurb
          )}</p>`
        : ""
    }
  </td></tr>
</table>`;
}

export interface EmailRowOptions {
  title: string;
  detail?: string;
  /** Absolute URL. A row without one renders as plain text, never a dead link. */
  href?: string | null;
  /** The short word carrying the state. Always present when there is a tint. */
  tag?: string;
  tone?: "critical" | "warning" | "normal";
  /** Right-hand timing text: "due in 6 hours". */
  meta?: string;
  /** The age line, when the item has been here before. */
  note?: string;
}

/**
 * One item.
 *
 * The tone shows up three ways at once, on purpose: a coloured left rule, a
 * tinted background, and a word. Any one of the three can be lost, to a
 * monochrome client, to a colour vision difference, to a plain-text
 * conversion, and the row still says which items are the bad ones.
 */
export function emailRow(o: EmailRowOptions): string {
  const tone = o.tone ?? "normal";
  const palette =
    tone === "critical"
      ? { rule: BRAND.risk, bg: BRAND.riskSoft, text: BRAND.risk }
      : tone === "warning"
        ? { rule: BRAND.review, bg: BRAND.reviewSoft, text: BRAND.review }
        : { rule: BRAND.border, bg: BRAND.surfaceMuted, text: BRAND.inkSoft };

  const titleHtml = o.href
    ? `<a href="${escapeHtml(o.href)}" style="color:${BRAND.accent};text-decoration:underline;font-weight:600">${escapeHtml(
        o.title
      )}</a>`
    : `<span style="font-weight:600;color:${BRAND.ink}">${escapeHtml(o.title)}</span>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;background:${palette.bg};border-left:4px solid ${palette.rule};border-radius:3px">
  <tr>
    <td style="padding:10px 12px;font-family:${FONT};font-size:14px;line-height:1.5;color:${BRAND.ink}">
      ${
        o.tag
          ? `<span style="display:inline-block;margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${palette.text}">${escapeHtml(
              o.tag
            )}</span><br />`
          : ""
      }
      ${titleHtml}
      ${
        o.detail
          ? `<div style="margin-top:2px;font-size:13px;color:${BRAND.inkSoft}">${escapeHtml(
              o.detail
            )}</div>`
          : ""
      }
      ${
        o.meta
          ? `<div style="margin-top:2px;font-size:13px;color:${BRAND.ink}">${escapeHtml(
              o.meta
            )}</div>`
          : ""
      }
      ${
        o.note
          ? `<div style="margin-top:4px;font-size:12px;font-style:italic;color:${BRAND.inkSoft}">${escapeHtml(
              o.note
            )}</div>`
          : ""
      }
    </td>
  </tr>
</table>`;
}

/** The line a section shows when it has nothing in it. Never a blank space. */
export function emailEmpty(text: string): string {
  return `<p style="margin:0 0 8px;font-family:${FONT};font-size:14px;line-height:1.5;color:${BRAND.inkSoft}">${escapeHtml(
    text
  )}</p>`;
}

export interface EmailStat {
  label: string;
  value: number | string;
  href?: string | null;
  note?: string;
}

/**
 * The totals block, as a two-column table.
 *
 * Two columns rather than a responsive grid: a table with fixed 50% cells is
 * the one arrangement that stays readable from a 320px phone to a desktop
 * client without a media query, and media queries are exactly what the strict
 * clients drop.
 */
export function emailStats(stats: EmailStat[]): string {
  if (stats.length === 0) return "";
  const cells = stats.map((s) => {
    const value = `<span style="font-size:20px;font-weight:700;color:${BRAND.ink}">${escapeHtml(
      String(s.value)
    )}</span>`;
    const label = s.href
      ? `<a href="${escapeHtml(s.href)}" style="color:${BRAND.accent};text-decoration:underline">${escapeHtml(
          s.label
        )}</a>`
      : escapeHtml(s.label);
    return `<td width="50%" valign="top" style="padding:8px 10px;font-family:${FONT};font-size:13px;line-height:1.4;color:${BRAND.inkSoft};border:1px solid ${BRAND.border};background:${BRAND.surfaceMuted}">
      ${value}<br />${label}
      ${s.note ? `<div style="margin-top:2px;font-size:12px;color:${BRAND.review}">${escapeHtml(s.note)}</div>` : ""}
    </td>`;
  });

  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 2) {
    const pair = cells.slice(i, i + 2);
    if (pair.length === 1) {
      pair.push(
        `<td width="50%" style="border:1px solid ${BRAND.border};background:${BRAND.surfaceMuted}">&nbsp;</td>`
      );
    }
    rows.push(`<tr>${pair.join("")}</tr>`);
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:collapse">${rows.join(
    ""
  )}</table>`;
}

/** A bulletproof-enough button. Padding on the anchor, so no VML is needed. */
export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 4px">
  <tr><td style="background:${BRAND.ink};border-radius:3px">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 20px;font-family:${FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${escapeHtml(
      label
    )}</a>
  </td></tr>
</table>`;
}

/** A banner for something the reader must not miss, tone carried by its label. */
export function emailCallout(label: string, text: string, tone: "critical" | "warning" | "normal" = "warning"): string {
  const palette =
    tone === "critical"
      ? { rule: BRAND.risk, bg: BRAND.riskSoft, text: BRAND.risk }
      : tone === "warning"
        ? { rule: BRAND.review, bg: BRAND.reviewSoft, text: BRAND.review }
        : { rule: BRAND.border, bg: BRAND.surfaceMuted, text: BRAND.inkSoft };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;background:${palette.bg};border:1px solid ${palette.rule};border-radius:3px">
  <tr><td style="padding:10px 12px;font-family:${FONT};font-size:13px;line-height:1.5;color:${BRAND.ink}">
    <strong style="color:${palette.text}">${escapeHtml(label)}</strong> ${escapeHtml(text)}
  </td></tr>
</table>`;
}

/** Ordinary paragraph copy inside the shell. */
export function emailText(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.ink}">${escapeHtml(
    text
  )}</p>`;
}
