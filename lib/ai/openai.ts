/**
 * OpenAI Responses API client, the second provider behind lib/ai/claude.ts.
 *
 * Plain fetch rather than the SDK, on purpose: the call is one POST, the
 * request shape is ours to control (no hidden retries, an explicit timeout,
 * nothing stored on the provider's side), and the error shape is the same
 * {status, code, message} the rest of the system already reads. Every call
 * still goes through the metered ledger in lib/ai/claude.ts; nothing here
 * talks to the network on its own behalf.
 *
 * What this module knows about the models it talks to:
 *   - gpt-5.x and o-series are reasoning models. They refuse a temperature
 *     and take a reasoning effort instead. Reasoning tokens are billed as
 *     output and count against max_output_tokens, so a caller's token budget
 *     gets headroom whenever reasoning is actually enabled.
 *   - The original gpt-5 / gpt-5-mini / gpt-5-nano spell "no reasoning" as
 *     "minimal"; every later model spells it "none". Normalised here so one
 *     operator setting works across the family.
 *   - PDFs travel inline as data URLs (input_file). Vision models read the
 *     page images, which is what makes a scanned solicitation legible.
 *   - Prompt caching is automatic on prefixes of 1024+ tokens. The Company
 *     Profile leads the instructions, so it is the cached prefix; a per-org
 *     prompt_cache_key steers repeat calls to the same cache.
 */

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** Default output-token headroom when reasoning is on. Tuned, not measured. */
export const DEFAULT_REASONING_HEADROOM = 4096;

export class OpenAiApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly type: string | null;
  readonly requestId: string | null;
  constructor(message: string, status: number | null, code: string | null, type: string | null, requestId: string | null) {
    super(message);
    this.name = "OpenAiApiError";
    this.status = status;
    this.code = code;
    this.type = type;
    this.requestId = requestId;
  }
}

/**
 * Turn a failure into a plain-English cause an owner can act on, or null when
 * it is not an availability problem (our own malformed request, a parse
 * error). The wording is chosen so lib/domain/automation-health.ts classifies
 * it the same way it classifies the Anthropic equivalents: "insufficient
 * credit" reads as provider_credit, "rejected the API key" as provider_auth.
 */
export function describeOpenAiFailure(
  err: unknown
): { reason: string; status: number | null; retryable: boolean } | null {
  const e = err as { status?: number; code?: string | null; message?: string; name?: string };
  const status = typeof e?.status === "number" ? e.status : null;
  const code = e?.code ?? null;
  const text = `${code ?? ""} ${e?.message ?? ""}`;

  if (status === 401 || status === 403) {
    return {
      reason:
        "OpenAI rejected the API key. It was deleted, revoked, or copied incompletely. " +
        "Create a new key at platform.openai.com under API keys and save it under Settings, Integrations.",
      status,
      retryable: false,
    };
  }

  // An exhausted billing quota arrives as a 429 with code insufficient_quota.
  // It is not a rate limit: waiting fixes nothing, so check it first.
  if (/insufficient_quota|exceeded your current quota|billing|payment/i.test(text)) {
    return {
      reason:
        "The OpenAI account has insufficient credit (its billing quota is used up). " +
        "Nothing will be scored, analysed, or drafted on it until you add credit at platform.openai.com under Billing.",
      status,
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      reason:
        "OpenAI is rate limiting this account, so requests are being refused. " +
        "This usually clears on its own; if it does not, the account's rate limits need raising.",
      status,
      retryable: true,
    };
  }

  if (status != null && status >= 500) {
    return {
      reason: `OpenAI returned a server error (HTTP ${status}). This is on their side and usually clears on its own.`,
      status,
      retryable: true,
    };
  }

  if (status == null && (e?.name === "AbortError" || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|aborted|timeout/i.test(text))) {
    return {
      reason: "Could not reach OpenAI (network error). If this persists, check the deployment's outbound access.",
      status: null,
      retryable: true,
    };
  }

  return null;
}

/** gpt-5.x and the o-series reason; they refuse sampling parameters. */
export function openAiIsReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model.trim());
}

/** The first gpt-5 generation spells "no reasoning" as minimal; later ones as none. */
export function normalizeReasoningEffort(model: string, effort: string | undefined): string | null {
  if (!openAiIsReasoningModel(model)) return null;
  const e = (effort ?? "").trim().toLowerCase();
  if (!e) return null;
  const firstGen = /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/i.test(model.trim());
  if (e === "none" && firstGen) return "minimal";
  if (e === "minimal" && !firstGen) return "none";
  return e;
}

export interface OpenAiRequest {
  apiKey: string;
  model: string;
  /** Joined system text; null sends none. */
  instructions: string | null;
  prompt: string;
  /** Base64 PDFs, no newlines. */
  documents?: { base64: string }[];
  maxTokens: number;
  /** Ask for a JSON object. The prompt must mention JSON, which completeJson's does. */
  json?: boolean;
  /** Reasoning effort for reasoning models; ignored for others. */
  effort?: string;
  /** Extra output tokens allowed when reasoning is on. */
  reasoningHeadroom?: number;
  /** Only sent to models that accept sampling. */
  temperature?: number;
  timeoutMs?: number;
  /** Steers prompt caching; typically per organization. */
  cacheKey?: string;
}

/** The request body, kept pure so the shape can be pinned by tests. */
export function buildOpenAiBody(req: OpenAiRequest): Record<string, unknown> {
  const effort = normalizeReasoningEffort(req.model, req.effort);
  const reasoningOn = effort != null && effort !== "none" && effort !== "minimal";
  const content: Record<string, unknown>[] = [
    ...(req.documents ?? []).map((d, i) => ({
      type: "input_file",
      filename: `document-${i + 1}.pdf`,
      file_data: `data:application/pdf;base64,${d.base64}`,
    })),
    { type: "input_text", text: req.prompt },
  ];
  const body: Record<string, unknown> = {
    model: req.model,
    input: [{ role: "user", content }],
    max_output_tokens: req.maxTokens + (reasoningOn ? (req.reasoningHeadroom ?? DEFAULT_REASONING_HEADROOM) : 0),
    // Never retain prompts or outputs on the provider's side. Solicitation
    // documents and subcontractor replies are the customer's, not training data.
    store: false,
  };
  if (req.instructions) body.instructions = req.instructions;
  if (effort) body.reasoning = { effort };
  if (!openAiIsReasoningModel(req.model) && req.temperature != null) body.temperature = req.temperature;
  if (req.json) body.text = { format: { type: "json_object" } };
  if (req.cacheKey) body.prompt_cache_key = req.cacheKey;
  return body;
}

export interface OpenAiUsage {
  /** Input tokens NOT served from cache. Kept apart so a rate per bucket adds up. */
  input_tokens: number;
  cached_input_tokens: number;
  /** All output, reasoning included, which is how OpenAI bills it. */
  output_tokens: number;
  reasoning_tokens: number;
}

export interface OpenAiResult {
  id: string;
  text: string;
  usage: OpenAiUsage;
  /** "max_tokens" when the output was cut off, "end_turn" when complete. */
  stopReason: string;
}

type ResponsesBody = {
  id?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string | null } | null;
};

/** Read the assistant text out of a Responses payload. Pure. */
export function parseOpenAiResponse(body: ResponsesBody): OpenAiResult {
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
      else if (c?.type === "refusal" && typeof c.refusal === "string") parts.push(c.refusal);
    }
  }
  const input = body.usage?.input_tokens ?? 0;
  const cached = body.usage?.input_tokens_details?.cached_tokens ?? 0;
  const stopReason =
    body.status === "incomplete"
      ? body.incomplete_details?.reason === "max_output_tokens"
        ? "max_tokens"
        : (body.incomplete_details?.reason ?? "incomplete")
      : "end_turn";
  return {
    id: body.id ?? "",
    text: parts.join(""),
    usage: {
      input_tokens: Math.max(0, input - cached),
      cached_input_tokens: cached,
      output_tokens: body.usage?.output_tokens ?? 0,
      reasoning_tokens: body.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
    stopReason,
  };
}

/** One request, no retries, an explicit timeout. */
export async function openAiResponse(
  req: OpenAiRequest,
  fetchImpl: typeof fetch = fetch
): Promise<OpenAiResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), req.timeoutMs ?? 600_000);
  try {
    const res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildOpenAiBody(req)),
      signal: ctl.signal,
    });
    const requestId = res.headers.get("x-request-id");
    const text = await res.text();
    let body: ResponsesBody | null = null;
    try {
      body = text ? (JSON.parse(text) as ResponsesBody) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = body?.error;
      throw new OpenAiApiError(
        `${res.status} ${err?.message ?? (text ? text.slice(0, 300) : res.statusText)}`,
        res.status,
        err?.code ?? null,
        err?.type ?? null,
        requestId
      );
    }
    if (!body) throw new OpenAiApiError("OpenAI returned an empty response body.", null, null, null, requestId);
    if (body.status === "failed") {
      throw new OpenAiApiError(
        `OpenAI marked the response failed: ${body.error?.message ?? "no detail"}`,
        null,
        body.error?.code ?? null,
        body.error?.type ?? null,
        requestId
      );
    }
    return parseOpenAiResponse(body);
  } finally {
    clearTimeout(timer);
  }
}
