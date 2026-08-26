import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardedFetchError, guardedFetch } from "../lib/integrations/guarded-fetch";
import { evaluateSolicitationCompleteness } from "../lib/domain/solicitation-completeness";

/**
 * Solicitation attachments are fetched from URLs copied out of a SAM.gov
 * notice. Nobody at Brost Co wrote those URLs, so every one of them is an
 * instruction from a stranger telling a server that holds every credential
 * this platform has to go and make a request.
 *
 * These tests are the reason the bare `fetch(att.url)` is gone. Each one
 * describes a request that used to succeed.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that fails the test if it is ever called. */
function fetchMustNotHappen() {
  return vi.fn(async () => {
    throw new Error("a connection was made to an address that should have been refused");
  });
}

async function refusal(url: string, opts?: Parameters<typeof guardedFetch>[1]) {
  try {
    await guardedFetch(url, { maxBytes: 1_000_000, ...opts });
  } catch (err) {
    if (err instanceof GuardedFetchError) return err;
    throw err;
  }
  throw new Error(`${url} was not refused`);
}

describe("addresses a server-side fetch may not reach", () => {
  it("refuses the cloud metadata endpoint, and says which one it is", async () => {
    const fetchSpy = fetchMustNotHappen();
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal("http://169.254.169.254/latest/meta-data/", {
      maxBytes: 1_000,
      allowInsecure: true,
    });
    expect(err.kind).toBe("blocked_address");
    // Not merely "link-local". The operator reading an Automation Log line
    // should be able to tell an accident from an attempt.
    expect(err.message).toContain("cloud metadata endpoint");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["http://127.0.0.1:5432/", "loopback"],
    ["http://127.1.2.3/", "loopback"],
    ["http://10.0.0.5/x", "private"],
    ["http://172.16.4.4/x", "private"],
    ["http://192.168.1.1/x", "private"],
    ["http://169.254.10.10/x", "link-local"],
    ["http://100.64.0.1/x", "carrier-grade NAT"],
    ["http://0.0.0.0/x", "unspecified"],
    ["http://[::1]/x", "loopback"],
    ["http://[fe80::1]/x", "link-local"],
    ["http://[fd00::1]/x", "unique local"],
    // Written as a dotted quad, but URL parsing rewrites these to
    // [::ffff:7f00:1] and [::ffff:a01:203] before the guard sees them, which
    // is exactly how the first version of this check was bypassed.
    ["http://[::ffff:127.0.0.1]/x", "loopback"],
    ["http://[::ffff:10.1.2.3]/x", "private"],
    ["http://[::ffff:7f00:1]/x", "loopback"],
    ["http://[0:0:0:0:0:ffff:c0a8:1]/x", "private"],
    ["http://[::127.0.0.1]/x", "loopback"],
    ["http://[64:ff9b::169.254.169.254]/x", "cloud metadata endpoint"],
    ["http://[ff02::1]/x", "multicast"],
    // Decimal and hex spellings of 127.0.0.1. URL parsing normalizes these,
    // so the guard sees the dotted form; the test is here to keep it true.
    ["http://2130706433/x", "loopback"],
    ["http://0x7f000001/x", "loopback"],
  ])("refuses %s (%s)", async (url, why) => {
    const fetchSpy = fetchMustNotHappen();
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal(url, { allowInsecure: true });
    expect(err.kind).toBe("blocked_address");
    expect(err.message).toContain(why);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a host name that resolves to loopback, not just a literal address", async () => {
    // The literal checks above are worth nothing on their own: an attacker
    // controls the DNS record, so the URL never has to contain "127.0.0.1".
    const fetchSpy = fetchMustNotHappen();
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal("http://localhost:5432/", { allowInsecure: true });
    expect(err.kind).toBe("blocked_address");
    expect(err.message).toContain("resolves to");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows a public address through to the request", async () => {
    // The guard has to let real attachments through, or it is just an outage.
    const fetchSpy = vi.fn(async () => new Response("hello", { headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const out = await guardedFetch("https://93.184.216.34/file.txt", { maxBytes: 1_000 });
    expect(out.body.toString()).toBe("hello");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

describe("protocols", () => {
  it.each(["file:///etc/passwd", "gopher://x/", "ftp://x/y"])("refuses %s", async (url) => {
    const err = await refusal(url);
    expect(err.kind).toBe("blocked_scheme");
  });

  it("refuses plain http unless the caller asked for it", async () => {
    const err = await refusal("http://93.184.216.34/file.txt");
    expect(err.kind).toBe("blocked_scheme");
    expect(err.message).toContain("http");
  });

  it("refuses something that is not a URL at all", async () => {
    const err = await refusal("not a url");
    expect(err.kind).toBe("blocked_scheme");
  });
});

describe("redirects", () => {
  it("re-checks the destination of every hop", async () => {
    // Validating the URL you were handed proves nothing if a permitted host
    // answers 302 with a private address. This is the whole reason for
    // redirect: "manual".
    const fetchSpy = vi.fn(async (_u: URL, _init: RequestInit) =>
      new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal("https://93.184.216.34/attachment.pdf");
    expect(err.kind).toBe("blocked_address");
    expect(err.message).toContain("cloud metadata endpoint");
    // One connection: the first hop. The second was refused before connecting.
    expect(fetchSpy).toHaveBeenCalledOnce();
    /*
     * And the hop loop above only ever gets a say if the runtime hands the
     * redirect back instead of following it itself. A stubbed fetch ignores
     * `redirect` and returns the 302 either way, so without this line the
     * whole per-hop check passes just as happily with `redirect: "follow"`,
     * which is the bare fetch this replaced. Asserting the request we make is
     * the only part of that this layer can prove.
     */
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("resolves a relative redirect against the hop it came from", async () => {
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (u: URL) => {
      seen.push(u.toString());
      if (seen.length === 1) {
        return new Response(null, { status: 301, headers: { location: "/moved/here.pdf" } });
      }
      return new Response("ok", { headers: { "content-type": "application/pdf" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const out = await guardedFetch("https://93.184.216.34/a/b.pdf", { maxBytes: 1_000 });
    expect(seen[1]).toBe("https://93.184.216.34/moved/here.pdf");
    expect(out.finalUrl).toBe("https://93.184.216.34/moved/here.pdf");
    expect(out.hops).toHaveLength(2);
  });

  it("stops after the redirect limit rather than looping forever", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://93.184.216.34/again" } })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal("https://93.184.216.34/start", { maxRedirects: 3 });
    expect(err.kind).toBe("too_many_redirects");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("refuses a redirect that downgrades to plain http", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "http://93.184.216.34/x" } })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const err = await refusal("https://93.184.216.34/attachment.pdf");
    expect(err.kind).toBe("blocked_scheme");
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("refuses a redirect with no destination instead of reading the error page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
    const err = await refusal("https://93.184.216.34/start");
    expect(err.kind).toBe("http_error");
    expect(err.status).toBe(302);
  });
});

describe("size limit", () => {
  it("refuses on a declared length before draining the body", async () => {
    /*
     * The assertion is that the body was not drained, not that it was never
     * touched at all: a ReadableStream fills its own queue on construction, so
     * one or two `pull` calls happen before anything here reads it and proving
     * "not a single byte" is not something this layer can honestly claim. What
     * it can prove is which branch refused (the declared-length one, named in
     * the message) and that nothing went on to pull the 99MB behind it.
     */
    let pulls = 0;
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { headers: { "content-length": "99000000" } }))
    );
    const err = await refusal("https://93.184.216.34/huge.pdf", { maxBytes: 1_000_000 });
    expect(err.kind).toBe("too_large");
    expect(err.message).toContain("declared");
    expect(pulls).toBeLessThanOrEqual(2);
  });

  it("refuses a lying server WHILE downloading, not after", async () => {
    /*
     * The defect this replaces: `Buffer.from(await res.arrayBuffer())` ran
     * first and the 25MB check ran on the line after it. That is a limit on
     * what gets parsed, not on what gets downloaded, so a server that sends
     * gigabytes (declaring nothing, or declaring a lie) took the worker out
     * before the check was ever reached.
     *
     * So the assertion that matters here is not that it throws. It is that it
     * stopped pulling: a handful of chunks, not the whole thing.
     */
    const chunk = new Uint8Array(64 * 1024);
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 5_000) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream)));
    const err = await refusal("https://93.184.216.34/liar.pdf", { maxBytes: 256 * 1024 });
    expect(err.kind).toBe("too_large");
    expect(err.message).toContain("while downloading");
    expect(cancelled).toBe(true);
    // 256KB cap, 64KB chunks: five pulls at the very most, nowhere near 5,000.
    expect(pulls).toBeLessThanOrEqual(6);
  });

  it("returns a body that fits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("small", { headers: { "content-type": "text/plain; charset=utf-8" } }))
    );
    const out = await guardedFetch("https://93.184.216.34/small.txt", { maxBytes: 1_000 });
    expect(out.body.toString()).toBe("small");
    expect(out.contentType).toBe("text/plain; charset=utf-8");
  });
});

describe("what the caller is told", () => {
  it("marks a 503 retryable and a 404 not", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect((await refusal("https://93.184.216.34/x")).retryable).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    const gone = await refusal("https://93.184.216.34/x");
    expect(gone.retryable).toBe(false);
    expect(gone.status).toBe(404);
  });

  it("refuses a content type the caller did not ask for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } }))
    );
    const err = await refusal("https://93.184.216.34/x", {
      allowedContentTypes: ["application/pdf"],
    });
    expect(err.kind).toBe("unsupported_type");
  });

  it("reports a timeout as a timeout, and as worth retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: URL, init: RequestInit) => {
        await new Promise((resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
        throw new Error("unreachable");
      })
    );
    const err = await refusal("https://93.184.216.34/slow.pdf", { timeoutMs: 20 });
    expect(err.kind).toBe("timeout");
    expect(err.retryable).toBe(true);
  });
});

describe("a refused attachment on the opportunity", () => {
  it("counts as a document that was not collected, and blocks sourcing", async () => {
    // A refusal must not read as a success anywhere downstream. The brief is
    // missing a document either way, and only a person can supply it.
    const result = evaluateSolicitationCompleteness({
      solicitationNumber: "W912-25-R-0001",
      agency: "USACE",
      deadline: "2026-09-30",
      locationState: "TX",
      naicsCode: "236220",
      setAsideType: "Unrestricted",
      description: "Renovation of building 4.",
      storedDocumentCount: 1,
      attachmentOutcomes: [
        { name: "Wage Determination.pdf", status: "fetched" },
        { name: "Attachment 2", status: "refused", detail: "Refused: the address is loopback." },
      ],
      analysis: null,
    });
    const partial = result.missing.find((m) => m.key === "attachments_partial");
    expect(partial).toBeDefined();
    expect(partial?.critical).toBe(true);
    expect(partial?.resolution).toContain("Attachment 2");
    expect(result.riskFlags).toContain("missing_attachments");
  });
});

describe("truncating instead of refusing", () => {
  it("returns exactly the cap and stops pulling", async () => {
    // Scraping a contractor's homepage for a contact address: the first 500KB
    // of HTML is genuinely useful, and refusing a heavy page outright loses
    // the contact for no safety gain. The bound is the same either way.
    const chunk = new Uint8Array(1024).fill(65);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls > 10_000) {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { headers: { "content-type": "text/html" } }))
    );
    const out = await guardedFetch("https://93.184.216.34/heavy.html", {
      maxBytes: 4 * 1024,
      onOversize: "truncate",
    });
    expect(out.body.byteLength).toBe(4 * 1024);
    expect(pulls).toBeLessThanOrEqual(6);
  });

  it("ignores a declared length it is willing to truncate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("a".repeat(100), {
            headers: { "content-type": "text/html", "content-length": "99000000" },
          })
      )
    );
    const out = await guardedFetch("https://93.184.216.34/lies.html", {
      maxBytes: 50,
      onOversize: "truncate",
    });
    expect(out.body.byteLength).toBe(50);
  });

  it("sends the user-agent it was given", async () => {
    const spy = vi.fn(async (_u: URL, _init: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", spy);
    await guardedFetch("https://93.184.216.34/x", {
      maxBytes: 100,
      headers: { "user-agent": "BROSTCO-SubVerify/1.0" },
    });
    expect(spy.mock.calls[0][1]).toMatchObject({
      headers: { "user-agent": "BROSTCO-SubVerify/1.0" },
    });
  });
});
