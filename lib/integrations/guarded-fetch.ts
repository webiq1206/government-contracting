/**
 * Fetching a URL this platform did not choose.
 *
 * Solicitation attachments arrive as `resourceLink` values inside a SAM.gov
 * notice. That is external data: the platform did not write those URLs and
 * cannot vouch for where they point. They were being fetched with a bare
 * `fetch(url)`, which does three dangerous things by default.
 *
 * 1. It resolves and connects to anything. `http://169.254.169.254/...` is the
 *    cloud metadata endpoint; `http://127.0.0.1:5432` is the database. A
 *    server-side fetch of an attacker-chosen URL is the classic SSRF, and the
 *    response comes back into a process holding every credential this platform
 *    has.
 *
 * 2. It follows redirects silently. Validating the URL you were given is worth
 *    nothing if a permitted host answers 302 with a private address, because
 *    the check ran once and the connection happened three hops later.
 *
 * 3. `await res.arrayBuffer()` buffers the whole body before any size check.
 *    The caller had a 25MB cap applied AFTER that line, which is a cap on what
 *    gets parsed rather than on what gets downloaded: a multi-gigabyte
 *    response takes the worker out before the check is reached.
 *
 * So the rule is that nothing outside this module calls fetch on a URL that
 * came from outside.
 *
 * What this does NOT claim: complete DNS-rebinding protection. Hostnames are
 * resolved and the addresses checked before connecting, and every redirect hop
 * is re-checked, but the resolver could in principle answer differently
 * between the check and the connection. Closing that needs a custom dispatcher
 * pinned to the validated address, which breaks SNI and certificate
 * validation; the trade is recorded here rather than papered over.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type GuardedFetchFailure =
  | "blocked_scheme"
  | "blocked_host"
  | "blocked_address"
  | "too_many_redirects"
  | "too_large"
  | "timeout"
  | "unsupported_type"
  | "http_error"
  | "network";

export class GuardedFetchError extends Error {
  readonly kind: GuardedFetchFailure;
  /** True when waiting and trying again could plausibly work. */
  readonly retryable: boolean;
  readonly status: number | null;
  constructor(kind: GuardedFetchFailure, message: string, opts?: { retryable?: boolean; status?: number }) {
    super(message);
    this.name = "GuardedFetchError";
    this.kind = kind;
    this.retryable = opts?.retryable ?? false;
    this.status = opts?.status ?? null;
  }
}

export interface GuardedFetchOptions {
  /** Hard ceiling on bytes read. Enforced while streaming, not afterwards. */
  maxBytes: number;
  /** Whole-operation budget, redirects included. */
  timeoutMs?: number;
  /**
   * Longest gap between bytes while reading the body.
   *
   * The total timeout alone is not enough on its own to be comfortable: a
   * server that accepts the connection and then trickles one byte a minute
   * holds a worker for the entire budget while transferring nothing. This
   * ends it as soon as the transfer stalls.
   */
  idleMs?: number;
  maxRedirects?: number;
  /** When set, a response whose content-type matches none of these is refused. */
  allowedContentTypes?: readonly string[];
  /** http as well as https. Off by default; SAM serves https. */
  allowInsecure?: boolean;
  /** Request headers. A polite user-agent, mostly. */
  headers?: Record<string, string>;
  /**
   * What to do when the body passes `maxBytes`.
   *
   * "refuse" (the default) is right for a file: half a PDF is not a smaller
   * PDF, it is a parse error wearing a document's name. "truncate" is right
   * for scraping a page, where the first 500KB of HTML is genuinely useful and
   * refusing outright would silently lose a contact whose site is heavy.
   *
   * Both stop reading at the limit, which is the part that matters: neither
   * pulls an unknown response into memory and asks questions afterwards.
   */
  onOversize?: "refuse" | "truncate";
}

export interface GuardedFetchResult {
  body: Buffer;
  contentType: string;
  contentDisposition: string | null;
  /** The URL actually fetched, after redirects. */
  finalUrl: string;
  /** Every hop, for an audit line that shows where a fetch really went. */
  hops: string[];
}

/**
 * Address ranges a server-side fetch has no business reaching.
 *
 * Written as explicit checks rather than a CIDR library so each line names
 * what it is keeping out. The metadata endpoint is called out separately even
 * though link-local already covers it, because it is the one an attacker is
 * actually aiming at and a future edit to the link-local rule should have to
 * notice it.
 */
function addressIsBlocked(ip: string): string | null {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    if (p[0] === 127) return "loopback";
    if (p[0] === 10) return "private";
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return "private";
    if (p[0] === 192 && p[1] === 168) return "private";
    if (p[0] === 169 && p[1] === 254) {
      return ip === "169.254.169.254" ? "cloud metadata endpoint" : "link-local";
    }
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return "carrier-grade NAT";
    if (p[0] === 0) return "unspecified";
    if (p[0] >= 224) return "multicast or reserved";
    return null;
  }
  if (v === 6) {
    const groups = ipv6Groups(ip);
    if (!groups) return "unparseable address";
    const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
    const leadingZeros = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
    if (leadingZeros && g5 === 0 && g6 === 0) {
      return g7 === 1 ? "loopback" : g7 === 0 ? "unspecified" : blockedV4(g6, g7);
    }
    /*
     * An IPv4 address wearing an IPv6 coat, in all three forms that reach a
     * private range: ::ffff:a.b.c.d (mapped), ::a.b.c.d (the deprecated
     * compatible form), and 64:ff9b::a.b.c.d (the well-known NAT64 prefix).
     *
     * This used to be a regex against the dotted-quad spelling, which never
     * matched anything: WHATWG URL parsing rewrites `[::ffff:127.0.0.1]` to
     * `[::ffff:7f00:1]` before this function ever sees it, so every mapped
     * loopback and mapped private address walked straight through the guard.
     * Working on the numbers instead of the spelling is why the check now
     * holds regardless of how the address was written down.
     */
    if (leadingZeros && g5 === 0xffff) return blockedV4(g6, g7);
    if (leadingZeros && g5 === 0) return blockedV4(g6, g7);
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return blockedV4(g6, g7);
    }
    if ((g0 & 0xffc0) === 0xfe80) return "link-local";
    if ((g0 & 0xfe00) === 0xfc00) return "unique local";
    if ((g0 & 0xff00) === 0xff00) return "multicast or reserved";
    return null;
  }
  return "unparseable address";
}

/** The last two groups of a v6 address read back as the v4 address they carry. */
function blockedV4(g6: number, g7: number): string | null {
  const v4 = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
  return addressIsBlocked(v4);
}

/**
 * Expand an IPv6 address to its eight 16-bit groups, handling `::` compression
 * and a trailing dotted quad. Returns null if it does not parse, which the
 * caller treats as a refusal rather than as permission.
 */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  let tail: number[] = [];
  if (dotted) {
    const o = dotted.slice(1, 5).map(Number);
    if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tail = [(o[0] << 8) | o[1], (o[2] << 8) | o[3]];
    text = text.slice(0, dotted.index);
    if (text.endsWith(":") && !text.endsWith("::")) text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 1) return known === 8 ? [...head, ...tail] : null;
  if (known > 7) return null;
  return [...head, ...new Array(8 - known).fill(0), ...rest, ...tail];
}

/**
 * Resolve and check every address a hostname answers with, not just the first.
 *
 * `URL.hostname` keeps the brackets on an IPv6 literal ("[::1]"), which `isIP`
 * does not recognise. Left alone, `http://[::1]/` fell through to the
 * unparseable branch: still refused, but for the wrong reason, and a public
 * IPv6 literal was refused with it.
 */
async function assertHostIsPublic(rawHostname: string): Promise<void> {
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  const literal = isIP(hostname);
  if (literal) {
    const why = addressIsBlocked(hostname);
    if (why) {
      throw new GuardedFetchError("blocked_address", `Refused: the address is ${why}.`);
    }
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    throw new GuardedFetchError("blocked_host", "Refused: the host name could not be resolved.", {
      retryable: true,
    });
  }
  if (addrs.length === 0) {
    throw new GuardedFetchError("blocked_host", "Refused: the host name resolved to nothing.");
  }
  /*
   * Every address, not the first. A name that answers with one public address
   * and one loopback address is a rebinding attempt wearing a disguise, and
   * checking only the first would let it through half the time.
   */
  for (const a of addrs) {
    const why = addressIsBlocked(a.address);
    if (why) {
      throw new GuardedFetchError("blocked_address", `Refused: the host resolves to ${why}.`);
    }
  }
}

function assertScheme(u: URL, allowInsecure: boolean): void {
  const ok = u.protocol === "https:" || (allowInsecure && u.protocol === "http:");
  if (!ok) {
    throw new GuardedFetchError(
      "blocked_scheme",
      `Refused: ${u.protocol.replace(":", "")} is not a protocol this fetches.`
    );
  }
}

/**
 * Read a body with a hard ceiling, refusing as soon as it is passed.
 *
 * The point is the "as soon as". Checking length after buffering is a check on
 * what gets parsed, not on what gets downloaded, and the machine is already
 * out of memory by the time it runs.
 */
/**
 * One read, abandoned if nothing arrives within the idle budget.
 *
 * The pending read is left to the reader's own cancellation, which the caller
 * does on the way out: resolving the race is what matters, not tidying the
 * promise nobody is waiting on any more.
 */
async function readWithin<T>(read: Promise<T>, idleMs: number): Promise<T> {
  if (!idleMs || idleMs <= 0) return read;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new GuardedFetchError("timeout", `Refused: the transfer stalled for ${idleMs}ms.`, {
                retryable: true,
              })
            ),
          idleMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  res: Response,
  maxBytes: number,
  onOversize: "refuse" | "truncate",
  idleMs: number
): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes && onOversize === "refuse") {
    throw new GuardedFetchError(
      "too_large",
      `Refused: the server declared ${Math.round(declared / 1e6)}MB, over the ${Math.round(maxBytes / 1e6)}MB limit.`
    );
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await readWithin(reader.read(), idleMs);
      if (done) break;
      /*
       * `value` is decoded bytes: fetch has already undone any content
       * encoding by this point, so a response that claims 1KB gzipped and
       * expands to 10GB is stopped here at the limit like anything else. The
       * cap is on what this process holds, which is the number that matters.
       */
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling. A declared length can lie, so this is the check that counts.
        if (onOversize === "truncate") {
          chunks.push(Buffer.from(value));
          return Buffer.concat(chunks).subarray(0, maxBytes);
        }
        throw new GuardedFetchError(
          "too_large",
          `Refused: the response passed the ${Math.round(maxBytes / 1e6)}MB limit while downloading.`
        );
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    // Whether this ended at the limit, on a stall, or normally, nothing is
    // left holding the connection open.
    await reader.cancel().catch(() => {});
  }
}

/**
 * A URL safe to write to a log, a prompt, or an error message.
 *
 * SAM resource links carry `api_key` in the query string, and other sources
 * carry signed tokens there. An audit line naming where a fetch went must not
 * be the place a credential is written down, and the path answers the question
 * the audit line is asking.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const query = u.search ? " (query redacted)" : "";
    return `${u.protocol}//${u.host}${u.pathname}${query}`;
  } catch {
    return "(unparseable url)";
  }
}

export async function guardedFetch(
  rawUrl: string,
  opts: GuardedFetchOptions
): Promise<GuardedFetchResult> {
  const {
    maxBytes,
    timeoutMs = 30_000,
    maxRedirects = 5,
    allowedContentTypes,
    allowInsecure = false,
    idleMs = 20_000,
    headers,
    onOversize = "refuse",
  } = opts;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new GuardedFetchError("blocked_scheme", "Refused: not a valid URL.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const hops: string[] = [];

  try {
    for (let hop = 0; ; hop++) {
      if (hop > maxRedirects) {
        throw new GuardedFetchError(
          "too_many_redirects",
          `Refused: more than ${maxRedirects} redirects.`
        );
      }
      assertScheme(url, allowInsecure);
      await assertHostIsPublic(url.hostname);
      hops.push(redactUrl(url.toString()));

      let res: Response;
      try {
        res = await fetch(url, {
          method: "GET",
          headers,
          // Manual, so every hop goes back through the checks above. Following
          // automatically means the validation ran once and the connection
          // happened somewhere else.
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new GuardedFetchError("timeout", `Refused: no response within ${timeoutMs}ms.`, {
            retryable: true,
          });
        }
        throw new GuardedFetchError("network", `Could not reach it: ${(err as Error).message}.`, {
          retryable: true,
        });
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new GuardedFetchError("http_error", `Redirect with no destination (HTTP ${res.status}).`, {
            status: res.status,
          });
        }
        // Relative redirects are legal and common; resolve against the hop we
        // are on rather than the original, which is what a browser does.
        url = new URL(location, url);
        continue;
      }

      if (!res.ok) {
        throw new GuardedFetchError("http_error", `HTTP ${res.status}.`, {
          status: res.status,
          // 5xx and 429 may pass. A 404 will not, and retrying it three times
          // with backoff only delays telling somebody the file is gone.
          retryable: res.status >= 500 || res.status === 429,
        });
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (allowedContentTypes && allowedContentTypes.length > 0) {
        const bare = contentType.split(";")[0].trim();
        if (!allowedContentTypes.includes(bare)) {
          throw new GuardedFetchError(
            "unsupported_type",
            `Refused: the server sent ${bare || "no content type"}.`
          );
        }
      }

      return {
        body: await readCapped(res, maxBytes, onOversize, idleMs),
        contentType,
        contentDisposition: res.headers.get("content-disposition"),
        finalUrl: url.toString(),
        hops,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
