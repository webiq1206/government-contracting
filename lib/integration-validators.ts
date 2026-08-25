/**
 * Cheap, real connection tests for each integration. Each validator makes a
 * minimal live API call with the candidate credentials and returns a
 * plain-English result. Used by the Integrations page "Test" button, both
 * before saving a new key and to re-check an existing one.
 */

export interface ValidationResult {
  ok: boolean;
  message: string;
}

/**
 * Node's fetch would otherwise announce itself as `User-Agent: node` and ask
 * for nothing in particular. Identifying the caller is ordinary manners toward
 * a public API, and it means anything SAM.gov logs about us is traceable back
 * here.
 */
export const SAM_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "BrostCo/1.0 (+https://brostco.com)",
};

async function timedFetch(url: string, init?: RequestInit, ms = 12_000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

type Values = Record<string, string>;

/**
 * Strip anything that could carry the credential back out to the browser.
 *
 * The SAM key travels in the query string, so a gateway that quotes the
 * offending request in its error body hands us the key inside the very text we
 * were about to show the operator and write to `integration_settings`. An
 * error message is not a place a secret should ever appear.
 */
function redactSecret(text: string, secret: string): string {
  let out = text;
  if (secret) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      out = out.split(form).join("[redacted]");
    }
  }
  // Belt and braces: mask any api_key=... we did not match literally.
  return out.replace(/((?:api[_-]?key|key|token)=)[^&\s"']+/gi, "$1[redacted]");
}

/**
 * Pull the human-readable complaint out of a SAM.gov / api.data.gov error
 * body, which comes back in several shapes depending on which layer answered.
 */
function apiErrorDetail(text: string): string {
  if (!text.trim()) return "";
  try {
    const b = JSON.parse(text) as Record<string, unknown>;
    const nested = b.error as { message?: string; code?: string } | undefined;
    const msg =
      nested?.message ??
      (b.errorMessage as string | undefined) ??
      (b.message as string | undefined) ??
      (typeof b.error === "string" ? b.error : undefined);
    if (msg) return String(msg).slice(0, 200);
  } catch {
    /* not JSON, fall through to the raw text */
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export const VALIDATORS: Record<string, (v: Values) => Promise<ValidationResult>> = {
  sam: async (v) => {
    const key = v.SAM_API_KEY;
    if (!key) return { ok: false, message: "Enter your SAM.gov API key first." };
    const today = new Date();
    const from = new Date(today.getTime() - 7 * 86_400_000);
    const fmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
    const res = await timedFetch(
      `https://api.sam.gov/opportunities/v2/search?api_key=${encodeURIComponent(key)}&limit=1&postedFrom=${fmt(from)}&postedTo=${fmt(today)}`,
      { headers: SAM_HEADERS }
    );
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "SAM.gov rejected this key. Double-check it (keys also expire yearly)." };
    if (res.status === 429)
      return { ok: true, message: "Key looks valid, but you've hit today's SAM.gov rate limit." };
    if (!res.ok) {
      const detail = redactSecret(apiErrorDetail(await res.text().catch(() => "")), key);
      /*
       * SAM.gov does not answer an unrecognized API key with 401 or 403. Its
       * gateway drops the request before the application sees it and returns a
       * bare 404 with an empty body, which is byte for byte what a dead URL
       * looks like. Verified against the live API: a valid key returns 200 on
       * this exact URL, while a well-formed but unknown key returns the empty
       * 404. Reporting that as "SAM.gov returned an error (HTTP 404)" sent an
       * operator looking for an outage while the real answer was that we were
       * sending a key SAM had never heard of.
       */
      if (res.status === 404 && !detail) {
        return {
          ok: false,
          message:
            "SAM.gov did not recognize this key. Copy it again from your SAM.gov account, " +
            "and check it is still active (keys expire yearly).",
        };
      }
      return {
        ok: false,
        message: detail
          ? `SAM.gov returned an error (HTTP ${res.status}): ${detail}`
          : `SAM.gov returned an error (HTTP ${res.status}).`,
      };
    }
    return { ok: true, message: "Connected. SAM.gov accepted the key." };
  },

  claude: async (v) => {
    const key = v.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, message: "Enter your Anthropic API key first." };
    /*
     * Send a real (one-token) message rather than listing models.
     *
     * GET /v1/models answers 200 for any live key, including one on an account
     * with a zero credit balance. Only a message is billed, so only a message
     * can tell "the key is valid" from "the key works". This test reported
     * "Connected. Claude is ready to score and write briefs." throughout a day
     * in which every scoring and drafting job failed for want of credits. One
     * token costs a fraction of a cent and buys an honest answer.
     */
    const res = await timedFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.ok) return { ok: true, message: "Connected. Claude answered a live request." };

    const detail = redactSecret(apiErrorDetail(await res.text().catch(() => "")), key);
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "Anthropic rejected this key. Copy it again from console.anthropic.com." };
    // An account out of credits is a well-formed request that cannot be paid
    // for, so Anthropic answers 400, not 402. Name it, because "HTTP 400"
    // reads like a bug in us and sends the owner to the wrong place.
    if (/credit balance|insufficient|billing|quota|payment/i.test(detail))
      return {
        ok: false,
        message:
          "The key works, but the Anthropic account is out of credits, so every request is refused. " +
          "Add credits at console.anthropic.com under Billing.",
      };
    if (res.status === 429)
      return { ok: false, message: "Anthropic is rate limiting this account right now. Try again shortly." };
    return {
      ok: false,
      message: detail
        ? `Anthropic returned an error (HTTP ${res.status}): ${detail}`
        : `Anthropic returned an error (HTTP ${res.status}).`,
    };
  },

  googleMaps: async (v) => {
    const key = v.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    if (!key) return { ok: false, message: "Enter your Google Maps API key first." };
    const res = await timedFetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent("general contractor in Boise ID")}&key=${encodeURIComponent(key)}`
    );
    const body = (await res.json().catch(() => ({}))) as { status?: string; error_message?: string };
    if (body.status === "OK" || body.status === "ZERO_RESULTS")
      return { ok: true, message: "Connected. Places search is working." };
    return {
      ok: false,
      message: body.error_message
        ? `Google says: ${body.error_message}`
        : `Google returned status ${body.status ?? res.status}. Make sure the Places API is enabled for this key.`,
    };
  },

  hunter: async (v) => {
    const key = v.HUNTER_API_KEY;
    if (!key) return { ok: false, message: "Enter your Hunter.io API key first." };
    const res = await timedFetch(
      `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`
    );
    if (res.status === 401) return { ok: false, message: "Hunter rejected this key." };
    if (!res.ok) return { ok: false, message: `Hunter returned an error (HTTP ${res.status}).` };
    return { ok: true, message: "Connected. Email lookup is working." };
  },

  bls: async (v) => {
    const key = v.BLS_API_KEY;
    const res = await timedFetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: ["CUUR0000SA0"],
        startyear: String(new Date().getFullYear() - 1),
        endyear: String(new Date().getFullYear()),
        ...(key ? { registrationkey: key } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string[] };
    if (body.status === "REQUEST_SUCCEEDED")
      return {
        ok: true,
        message: key
          ? "Connected with your key (higher rate limit)."
          : "Working without a key (low rate limit). Add a free key for more headroom.",
      };
    return { ok: false, message: `BLS returned: ${body.message?.[0] ?? body.status ?? res.status}` };
  },

  twilio: async (v) => {
    const sid = v.TWILIO_ACCOUNT_SID;
    const token = v.TWILIO_AUTH_TOKEN;
    if (!sid || !token)
      return { ok: false, message: "Enter both the Account SID and Auth Token first." };
    const res = await timedFetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
      { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } }
    );
    if (res.status === 401) return { ok: false, message: "Twilio rejected these credentials." };
    if (!res.ok) return { ok: false, message: `Twilio returned an error (HTTP ${res.status}).` };
    return { ok: true, message: "Connected. SMS alerts can send." };
  },

  ahrefs: async (v) => {
    const key = v.AHREFS_API_KEY;
    if (!key) return { ok: false, message: "Enter your Ahrefs API key first." };
    // Cheapest possible check: read the account's own limits/usage (no row units).
    const res = await timedFetch("https://api.ahrefs.com/v3/subscription-info/limits-and-usage", {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "Ahrefs rejected this key. Check that API access is enabled on your plan." };
    if (!res.ok) return { ok: false, message: `Ahrefs returned an error (HTTP ${res.status}).` };
    return { ok: true, message: "Connected. Site Authority tracking is live." };
  },

  usaspending: async () => {
    const res = await timedFetch("https://api.usaspending.gov/api/v2/references/agency/456/");
    return res.ok
      ? { ok: true, message: "Connected. Public API, no key needed." }
      : { ok: false, message: `USASpending returned HTTP ${res.status}. It may be briefly down.` };
  },

  supabaseStorage: async (v) => {
    const url = v.SUPABASE_URL;
    const key = v.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { ok: false, message: "Enter both the project URL and service role key first." };
    const res = await timedFetch(`${url.replace(/\/$/, "")}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
    });
    if (res.status === 401 || res.status === 403)
      return { ok: false, message: "Supabase rejected these credentials." };
    if (!res.ok) return { ok: false, message: `Supabase returned an error (HTTP ${res.status}).` };
    return { ok: true, message: "Connected. Document storage is working." };
  },
};
