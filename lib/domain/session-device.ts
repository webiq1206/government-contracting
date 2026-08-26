/**
 * Naming the device behind a session, from its user agent and nothing else.
 *
 * The point is recognition, not fingerprinting: somebody looking at this list
 * is asking "is that my laptop, or is that somebody else". "Chrome on macOS"
 * answers it. A version string, a build number and a rendering engine do not,
 * and printing the raw user agent asks a contractor to parse a string that was
 * never written for a person to read.
 *
 * An unparsable or absent agent is "Not recorded", never a guess. Sessions
 * that predate the column have none, and a browser we do not recognise is
 * genuinely unknown rather than "Other".
 */

export interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  userAgent: string | null;
  /** Set when a platform administrator opened this session as the customer. */
  impersonatorEmail: string | null;
}

export interface SessionView {
  id: string;
  device: string;
  /** True for the session doing the looking, which must never offer to end itself by accident. */
  current: boolean;
  lastSeen: string;
  signedIn: string;
  expires: string;
  /** Support sessions are worth calling out: they are somebody else, signed in as you. */
  support: string | null;
}

const BROWSERS: [RegExp, string][] = [
  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims
  // to be Safari. Most specific first.
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\//, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\//, "Chrome"],
  [/\bChromium\//, "Chromium"],
  // No leading word boundary: "HeadlessChrome/" and a handful of embedded
  // browsers prefix the token, and they are still Chrome. Everything that
  // merely claims to be Chrome (Edge, Opera, Chromium) is matched above this.
  [/Chrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, "iPhone"],
  [/\biPad\b/, "iPad"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows NT\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

/** "Chrome on macOS", "Safari on iPhone", or "Not recorded". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Not recorded";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null;
  const platform = PLATFORMS.find(([re]) => re.test(ua))?.[1] ?? null;
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return "Not recorded";
}

/**
 * A user agent is a header, which means it is whatever the client sent.
 *
 * Stored and rendered as text, so what matters is that it cannot be enormous
 * and cannot carry control characters into a log line or a table cell.
 */
export function sanitizeUserAgent(raw: string | null | undefined): string | null {
  const ua = (raw ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!ua) return null;
  return ua.slice(0, 400);
}

function relative(iso: string | null, now: Date): string {
  if (!iso) return "Not recorded";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Not recorded";
  const mins = Math.round((now.getTime() - then) / 60_000);
  if (mins <= 1) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function until(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "at an unrecorded time";
  const mins = Math.round((then - now.getTime()) / 60_000);
  if (mins <= 0) return "already expired";
  if (mins < 60) return `in ${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

export function sessionView(row: SessionRow, currentId: string | null, now: Date): SessionView {
  return {
    id: row.id,
    device: describeDevice(row.userAgent),
    current: currentId != null && row.id === currentId,
    // A session created before the column existed has no last-seen, and
    // falling back to its creation time would claim activity that was never
    // recorded. The two facts are shown separately instead.
    lastSeen: relative(row.lastSeenAt, now),
    signedIn: relative(row.createdAt, now),
    expires: until(row.expiresAt, now),
    support: row.impersonatorEmail
      ? `Opened by ${row.impersonatorEmail} to support this account`
      : null,
  };
}

/**
 * The current session first, then the rest in the order the query gave them.
 *
 * A person scanning for something they do not recognise should meet their own
 * session first and know to skip it, rather than find it somewhere in the
 * middle and wonder whether they had already checked it.
 */
export function sortSessions(views: SessionView[]): SessionView[] {
  return [...views].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return 0;
  });
}

/** What the list says above itself, including when the only session is the reader's. */
export function sessionSummary(views: SessionView[]): string {
  const others = views.filter((v) => !v.current).length;
  if (views.length === 0) {
    return "No sessions are recorded, which should not happen while you are signed in.";
  }
  if (others === 0) {
    return "This is the only device signed in to your account.";
  }
  return `${others} other device${others === 1 ? " is" : "s are"} signed in to your account.`;
}
