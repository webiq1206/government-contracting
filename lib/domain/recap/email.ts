/**
 * The recap, as an email.
 *
 * Rendering only. Every decision about what goes in it was made in
 * sections.ts, which is what lets the dashboard page show the identical recap
 * without either surface re-deriving anything.
 *
 * The plain-text alternative is written out properly rather than stripped from
 * the HTML. A recap read on a watch, in a terminal client, or by a screen
 * reader falling back to text/plain has to keep the ordering and the links,
 * and a tag-stripped table gives up both.
 *
 * Pure.
 */
import {
  BRAND,
  absoluteUrl,
  emailButton,
  emailCallout,
  emailEmpty,
  emailHeading,
  emailRow,
  emailShell,
  emailStats,
  emailText,
} from "../email-shell";
import { ageNote, recapPreheader, recapSubject } from "./sections";
import type { Recap, RecapItem, RecapSection } from "./types";

export interface RenderRecapOptions {
  /** Root of the app, e.g. https://app.example.com. Links are absolute from it. */
  appUrl: string;
  /** Who it is addressed to, for the greeting. */
  recipientName?: string | null;
  /** The account's name, for the header and subject. */
  orgName?: string | null;
  /**
   * The scheduled send was missed and this went out later. Said in the mail,
   * not just recorded, because a recap that arrives at two in the afternoon
   * without explaining itself reads as a system that cannot be trusted with
   * the time of day.
   */
  late?: boolean;
  /** Where the reader turns this off or changes it. */
  preferencesPath?: string;
  /** A test send, marked as one so nobody acts on a rehearsal. */
  test?: boolean;
  brandName?: string;
}

export interface RenderedRecap {
  subject: string;
  html: string;
  text: string;
}

/** Word for the tone, so nothing depends on colour alone. */
function tagFor(item: RecapItem, sectionEmphasis: RecapSection["emphasis"]): string | undefined {
  if (item.reason) return item.reason;
  if (sectionEmphasis === "urgent") return item.severity === "critical" ? "Urgent" : "Needs attention";
  if (sectionEmphasis === "problem") return item.severity === "critical" ? "Broken" : "Degraded";
  return undefined;
}

function renderSection(section: RecapSection, appUrl: string): string {
  const parts: string[] = [emailHeading(section.title, section.blurb)];

  if (section.totals.length > 0) {
    parts.push(
      emailStats(
        section.totals.map((t) => ({
          label: t.label,
          value: t.value,
          href: absoluteUrl(appUrl, t.href),
          note: t.note,
        }))
      )
    );
  }

  if (section.items.length > 0) {
    for (const item of section.items) {
      parts.push(
        emailRow({
          title: item.title,
          detail: item.detail,
          href: absoluteUrl(appUrl, item.href),
          tag: tagFor(item, section.emphasis),
          tone:
            section.emphasis === "normal" && item.severity !== "critical"
              ? item.severity === "warning"
                ? "warning"
                : "normal"
              : (item.severity ?? "normal"),
          meta: item.when,
          note: ageNote(item.ageDays) ?? undefined,
        })
      );
    }
  } else if (section.totals.length === 0) {
    parts.push(emailEmpty(section.empty));
  }

  return parts.join("\n");
}

export function renderRecapEmail(recap: Recap, opts: RenderRecapOptions): RenderedRecap {
  const orgName = opts.orgName ?? recap.orgName ?? null;
  const subject = `${opts.test ? "[Test] " : ""}${recapSubject(recap, orgName)}`;
  const preferences = absoluteUrl(opts.appUrl, opts.preferencesPath ?? "/settings/account");
  const recapPage = absoluteUrl(opts.appUrl, `/recap?date=${recap.localDate}`) ?? opts.appUrl;

  const body: string[] = [];

  if (opts.test) {
    body.push(
      emailCallout(
        "Test send.",
        "Somebody asked for this from the recap settings page to check the mail arrives. It uses real data, but nobody else received it.",
        "normal"
      )
    );
  }

  if (opts.late) {
    body.push(
      emailCallout(
        "Sent late.",
        "This should have arrived first thing. It covers the same day it always would; only the delivery slipped.",
        "warning"
      )
    );
  }

  const greeting = opts.recipientName ? `Good morning, ${opts.recipientName}.` : "Good morning.";

  if (recap.quiet) {
    /*
     * The short variant.
     *
     * Sent rather than skipped, because an absent email is ambiguous: it means
     * either "nothing happened" or "the recap is broken", and the reader
     * cannot tell which. Three lines and a link says the first one plainly.
     * An account that would rather have the silence can turn that on.
     */
    body.push(emailText(`${greeting} Nothing needed you yesterday.`));
    body.push(
      emailText(
        `No urgent items, no system problems, and no activity worth reporting for ${recap.dayLabel}. ` +
          `The full page is there if you want to check for yourself.`
      )
    );
    body.push(emailButton("Open the recap", recapPage));
  } else {
    body.push(emailText(`${greeting} Here is ${recap.dayLabel} for ${orgName ?? "your account"}.`));
    if (recap.urgentCount > 0) {
      body.push(
        emailCallout(
          `${recap.urgentCount} ${recap.urgentCount === 1 ? "item needs" : "items need"} attention.`,
          "They are listed first, oldest at the top of each group.",
          "critical"
        )
      );
    }
    for (const section of recap.sections) {
      body.push(renderSection(section, opts.appUrl));
    }
    body.push(emailButton("Open the recap in the app", recapPage));
  }

  const footer: string[] = [
    `This covers ${escapeText(recap.dayLabel)} in ${escapeText(recap.timezone)}, your own time zone.`,
    preferences
      ? `<a href="${preferences}" style="color:${BRAND.accent}">Change your time zone or turn this off</a>.`
      : "",
    "Every figure here comes from records in the app. Nothing is estimated.",
  ].filter(Boolean);

  return {
    subject,
    html: emailShell({
      title: recap.quiet ? "A quiet day" : "Daily recap",
      eyebrow: `${orgName ?? "Daily recap"} · ${recap.dayLabel}`,
      preheader: recapPreheader(recap),
      body: body.join("\n"),
      footer,
      brandName: opts.brandName,
    }),
    text: renderRecapText(recap, opts),
  };
}

function escapeText(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rule(char = "-", width = 60): string {
  return char.repeat(width);
}

export function renderRecapText(recap: Recap, opts: RenderRecapOptions): string {
  const orgName = opts.orgName ?? recap.orgName ?? "your account";
  const lines: string[] = [];

  if (opts.test) lines.push("[TEST SEND] Real data, sent only to you.", "");
  if (opts.late) lines.push("[SENT LATE] The delivery slipped; the day covered is unchanged.", "");

  lines.push(`Daily recap for ${orgName}`, recap.dayLabel, rule("="));

  if (recap.quiet) {
    lines.push(
      "",
      "Nothing needed you yesterday: no urgent items, no system problems, no activity worth reporting.",
      "",
      absoluteUrl(opts.appUrl, `/recap?date=${recap.localDate}`) ?? opts.appUrl
    );
    return lines.join("\n");
  }

  if (recap.urgentCount > 0) {
    lines.push("", `${recap.urgentCount} item(s) need attention. They are listed first.`);
  }

  for (const section of recap.sections) {
    lines.push("", section.title.toUpperCase(), rule());
    if (section.totals.length > 0) {
      for (const t of section.totals) {
        lines.push(`  ${t.value}  ${t.label}${t.note ? ` (${t.note})` : ""}`);
      }
    }
    if (section.items.length === 0 && section.totals.length === 0) {
      lines.push(`  ${section.empty}`);
      continue;
    }
    for (const item of section.items) {
      const tag = tagFor(item, section.emphasis);
      lines.push(`  * ${tag ? `[${tag}] ` : ""}${item.title}`);
      if (item.detail) lines.push(`      ${item.detail}`);
      if (item.when) lines.push(`      ${item.when}`);
      const age = ageNote(item.ageDays);
      if (age) lines.push(`      ${age}`);
      const href = absoluteUrl(opts.appUrl, item.href);
      if (href) lines.push(`      ${href}`);
    }
  }

  lines.push(
    "",
    rule("="),
    `This covers ${recap.dayLabel} in ${recap.timezone}, your own time zone.`,
    `Full recap: ${absoluteUrl(opts.appUrl, `/recap?date=${recap.localDate}`) ?? opts.appUrl}`,
    `Change your time zone or turn this off: ${
      absoluteUrl(opts.appUrl, opts.preferencesPath ?? "/settings/account") ?? opts.appUrl
    }`,
    "Every figure here comes from records in the app. Nothing is estimated."
  );

  return lines.join("\n");
}
