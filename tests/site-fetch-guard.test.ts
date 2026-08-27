import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchPage } from "../lib/integrations/email-scrape";

/**
 * The subcontractor website field and the prospect domain are both places a
 * URL enters this system as data. They are fetched by the server, so they are
 * SSRF surfaces, and until now each carried its own idea of what was safe.
 *
 * email-scrape's copy had a hole. Its IPv6 branch read:
 *
 *     if (v6.startsWith("::ffff:")) return isPublicIp(v6.slice(7));
 *
 * which is correct for the spelling a person types and useless for the one the
 * code receives: `new URL("http://[::ffff:169.254.169.254]/").hostname` is
 * `[::ffff:a9fe:a9fe]`. The remainder after "::ffff:" was "a9fe:a9fe", matched
 * no IPv4 rule, fell through, and the function returned true. An operator (or
 * anything that could write that field) could point the server at the cloud
 * metadata endpoint.
 *
 * These tests are against the behaviour, not the internals, so they keep
 * holding whichever implementation is underneath.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mustNotConnect = () =>
  vi.fn(async () => {
    throw new Error("connected to an address that should have been refused");
  });

describe("fetching a subcontractor's website", () => {
  it.each([
    ["http://[::ffff:169.254.169.254]/", "the metadata endpoint, IPv6-mapped"],
    ["http://169.254.169.254/latest/meta-data/", "the metadata endpoint"],
    ["http://127.0.0.1:5432/", "the database"],
    ["http://10.1.2.3/admin", "a private address"],
    ["http://localhost/", "a name that resolves to loopback"],
    ["file:///etc/passwd", "a local file"],
  ])("refuses %s (%s)", async (url) => {
    const spy = mustNotConnect();
    vi.stubGlobal("fetch", spy);
    expect(await safeFetchPage(url)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("still reads a real contractor site, including one on plain http", async () => {
    // The guard has to let the ordinary case through, or Sub Verify simply
    // stops finding contacts and nobody connects that to a security change.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html><a href='mailto:bids@example.com'>bids</a></html>", {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
      )
    );
    const html = await safeFetchPage("http://93.184.216.34/contact");
    expect(html).toContain("bids@example.com");
  });

  it("returns null for a page that is not text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }))
    );
    expect(await safeFetchPage("https://93.184.216.34/brochure.pdf")).toBeNull();
  });
});
