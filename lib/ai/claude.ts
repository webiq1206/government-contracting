/**
 * Claude API client. The Company Profile is injected as system context on every
 * call (architecture principle). Two entry points:
 *   - complete(): free-form text completion
 *   - completeJson(): forces a JSON object back, validated with an optional Zod schema
 *
 * Degrades gracefully: if ANTHROPIC_API_KEY is missing, calls throw a typed
 * error that agents catch and log as "skipped" so the pipeline keeps flowing.
 *
 * A key that EXISTS but no longer works is a different animal and gets its own
 * error, ClaudeUnavailableError. Nothing degrades gracefully there: an account
 * out of credits fails every scoring, analysis and draft call in the system,
 * and the honest thing is to say so loudly rather than to keep flowing past it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../config";
import { getProfileSystemText } from "./companyProfile";
import { noEmDash, deepNoEmDash } from "../sanitize";

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set, Claude-dependent step skipped.");
    this.name = "ClaudeNotConfiguredError";
  }
}

/**
 * Stable marker on the front of every AI-outage message.
 *
 * The message travels through the agent runner into `agent_logs`, and that row
 * is the only durable record of the failure. Matching on a marker we control
 * beats grepping for Anthropic's own wording, which is theirs to reword.
 */
export const AI_UNAVAILABLE_PREFIX = "AI_UNAVAILABLE:";

/**
 * The key is present and Anthropic refused anyway: out of credits, key
 * revoked, rate limited, or Anthropic itself is down.
 *
 * Deliberately NOT a subclass of ClaudeNotConfiguredError. Agents treat that
 * one as "no AI configured, skip this step and carry on", which is right when
 * a customer has not set a key up. Applying it here would have every agent
 * quietly skip its actual work while the dashboard reported a healthy engine,
 * which is the failure this class exists to make impossible.
 */
export class ClaudeUnavailableError extends Error {
  /** Plain English, safe to show an operator. Never contains the key. */
  readonly reason: string;
  readonly status: number | null;
  /** True when waiting is a plausible fix (rate limit, Anthropic outage). */
  readonly retryable: boolean;

  constructor(reason: string, status: number | null, retryable: boolean) {
    super(`${AI_UNAVAILABLE_PREFIX} ${reason}`);
    this.name = "ClaudeUnavailableError";
    this.reason = reason;
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * Turn an SDK/network failure into a plain-English cause, or null when it is
 * not an availability problem at all.
 *
 * Null matters: a 400 for a malformed request is OUR bug, and dressing it up
 * as "the AI is unavailable" would send the owner to top up an account that
 * was never the problem. Only failures a human can act on as an account or
 * service issue are named here.
 */
export function describeClaudeFailure(
  err: unknown
): { reason: string; status: number | null; retryable: boolean } | null {
  const e = err as { status?: number; message?: string; error?: { error?: { type?: string; message?: string } } };
  const status = typeof e?.status === "number" ? e.status : null;
  const body = e?.error?.error;
  const text = `${body?.message ?? ""} ${e?.message ?? ""}`;

  if (status === 401 || status === 403) {
    return {
      reason:
        "Anthropic rejected the API key. It was deleted, revoked, or copied incompletely. " +
        "Create a new key at console.anthropic.com and save it under Settings, Integrations.",
      status,
      retryable: false,
    };
  }

  // Out of credits arrives as a 400, not a 402: the request is well-formed,
  // the account simply cannot pay for it. Nothing will run until it is topped
  // up, so this is never retryable.
  if (/credit balance|insufficient|billing|quota|payment/i.test(text)) {
    return {
      reason:
        "The Anthropic account cannot pay for requests (its credit balance is too low). " +
        "Nothing will be scored, analysed, or drafted until credits are added at console.anthropic.com under Billing.",
      status,
      retryable: false,
    };
  }

  if (status === 429) {
    return {
      reason:
        "Anthropic is rate limiting this account, so requests are being refused. " +
        "This usually clears on its own; if it does not, the account's rate limits need raising.",
      status,
      retryable: true,
    };
  }

  if (status != null && status >= 500) {
    return {
      reason: `Anthropic returned a server error (HTTP ${status}). This is on their side and usually clears on its own.`,
      status,
      retryable: true,
    };
  }

  // No status at all: the request never reached Anthropic.
  if (status == null && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network|aborted|timeout/i.test(text)) {
    return {
      reason: "Could not reach Anthropic (network error). If this persists, check the deployment's outbound access.",
      status: null,
      retryable: true,
    };
  }

  return null;
}

/**
 * One Anthropic client per organization.
 *
 * This was a single module-level singleton built from process.env: whichever
 * organization triggered the first AI call created it with THEIR key, and
 * every other tenant then reused that client, and that key, until the process
 * restarted. Worse than reading a shared env var, because the wrong
 * credential was captured in memory indefinitely.
 *
 * Keyed by organization so a client is still reused within a tenant (the SDK
 * holds connections), and never across one.
 */
const _clients = new Map<string, Anthropic>();

/** Test helper: drop cached SDK clients between cases. */
export function clearClaudeClients(): void {
  _clients.clear();
}

async function client(): Promise<Anthropic> {
  const { orgApiKey } = await import("../integration-keys");
  const { tryResolveTenantOrgId } = await import("../tenant");
  const { LEGACY_ORG_ID } = await import("../tenant-context");
  const org = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const apiKey = await orgApiKey("ANTHROPIC_API_KEY", org);
  if (!apiKey) throw new ClaudeNotConfiguredError();
  const existing = _clients.get(org);
  if (existing) return existing;
  const created = new Anthropic({ apiKey });
  _clients.set(org, created);
  return created;
}

/** Whether the CURRENT organization has AI configured. */
export async function claudeEnabled(): Promise<boolean> {
  const { orgHasKey } = await import("../integration-keys");
  return orgHasKey("ANTHROPIC_API_KEY");
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  model: string;
  /**
   * Tokens written to and read from the prompt cache.
   *
   * Reported so an operator can see whether caching is actually engaging.
   * A run showing writes but never reads means the calls are too far apart
   * for the cache window, and the 25% write premium is being paid for
   * nothing; that is worth knowing rather than assuming.
   */
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface CompleteOptions {
  system?: string; // extra system text appended after the Company Profile
  maxTokens?: number;
  temperature?: number;
  /** Override the model for this call (e.g. config.claude.modelSmart). */
  model?: string;
  /** Set false to skip Company Profile injection (rarely needed). */
  injectProfile?: boolean;
  /**
   * PDFs to send with the prompt as native document blocks.
   *
   * This is how a scanned, image-only solicitation gets read at all: there is
   * no extractable text layer, so the bytes themselves have to reach the
   * model. Each entry is base64 with NO newlines (the API rejects wrapped
   * base64). Blocks are placed BEFORE the text block, which is what the API
   * expects for document inputs.
   */
  documents?: { base64: string }[];
}

/**
 * Sonnet 5 / Opus 4.7+ / Fable reject non-default sampling params (temperature,
 * top_p, top_k) with a 400. Haiku 4.5 and Sonnet 4.6 still accept them. Gate on
 * the model string so the tiering (or any operator override) can't send a param
 * the target model rejects.
 */
function modelAcceptsSampling(model: string): boolean {
  return !/(sonnet-5|opus-4-[78]|fable)/.test(model);
}

/**
 * Roughly how many tokens a string is worth.
 *
 * Deliberately crude. It is only ever used to decide whether a block is big
 * enough to be worth caching, and the API silently ignores a cache marker on a
 * prefix below its minimum, so being wrong here costs nothing either way.
 */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Smallest prefix any current model will cache.
 *
 * Haiku 4.5 needs 2048 tokens; Sonnet and Opus need 1024. Using the larger
 * number for every model means a marker is only ever attached where it will
 * definitely be honoured, which matters because a cache WRITE costs 25% more
 * than ordinary input: marking a block that is too small to cache would be a
 * pure loss on the write with no read to recover it.
 */
const MIN_CACHEABLE_TOKENS = 2048;

type SystemBlock = {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
};

/**
 * The system prompt, as blocks, with the stable part marked for caching.
 *
 * The Company Profile is injected into almost every call this system makes and
 * is byte-identical every time: the same few thousand tokens, re-sent and
 * re-billed on every scoring pass, every reply extraction, every compliance
 * check. Agents work in bursts (many subcontractors per opportunity, many
 * opportunities per run), so those calls land well inside the cache window and
 * the profile is read from cache rather than re-processed.
 *
 * Order matters and is the whole trick: caching works on a PREFIX, so the
 * stable profile goes first and carries the marker, and the per-call system
 * text follows it uncached. Putting them the other way round would mean the
 * prefix changed on every call and nothing was ever reused.
 *
 * Output is unaffected. The model sees exactly the same system prompt.
 */
async function buildSystem(opts: CompleteOptions): Promise<SystemBlock[]> {
  const blocks: SystemBlock[] = [];

  if (opts.injectProfile !== false) {
    const profile = await getProfileSystemText();
    if (profile.trim()) {
      const block: SystemBlock = { type: "text", text: profile };
      if (approxTokens(profile) >= MIN_CACHEABLE_TOKENS) {
        block.cache_control = { type: "ephemeral" };
      }
      blocks.push(block);
    }
  }

  if (opts.system) {
    // Separator kept so the assembled prompt reads exactly as it used to.
    blocks.push({ type: "text", text: blocks.length ? `---\n\n${opts.system}` : opts.system });
  }

  return blocks;
}

export async function complete(
  prompt: string,
  opts: CompleteOptions = {}
): Promise<{ text: string; usage: ClaudeUsage; stopReason: string | null }> {
  const system = await buildSystem(opts);
  const model = opts.model ?? config.claude.model;

  // Built as a loose object so we can conditionally include params by model
  // family without fighting the (older) SDK's request types. The model string
  // itself is sent verbatim, so newer model ids work regardless of SDK version.
  // Document blocks go ahead of the prompt text; a plain string is still sent
  // when there are none so every existing call site is byte-for-byte unchanged.
  /*
   * Document blocks go ahead of the prompt text; a plain string is still sent
   * when there are none so every existing call site is byte-for-byte unchanged.
   *
   * The LAST document carries the cache marker, so the whole run of documents
   * becomes one cached prefix. A PDF is by far the largest input this system
   * ever sends, and completeJson re-sends the identical set when a schema
   * validation fails and it retries. That retry used to cost a second full
   * upload; now it reads the documents back from cache.
   */
  const content = opts.documents?.length
    ? [
        ...opts.documents.map((d, i) => ({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: d.base64 },
          ...(i === opts.documents!.length - 1
            ? { cache_control: { type: "ephemeral" } }
            : {}),
        })),
        { type: "text", text: prompt },
      ]
    : prompt;

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 2048,
    system,
    messages: [{ role: "user", content }],
  };
  if (modelAcceptsSampling(model)) {
    body.temperature = opts.temperature ?? 0.2;
  } else if (!/fable/.test(model)) {
    // These models default to adaptive thinking, which would eat into max_tokens
    // and can truncate the (usually JSON) response. Disable it so the full budget
    // goes to the answer. (Fable rejects an explicit "disabled", omit there.)
    body.thinking = { type: "disabled" };
  }

  const anthropic = await client();
  // Every Claude call in the system passes through here, so this is the one
  // place that can name "the AI is refusing us" once, in words an owner can
  // act on, instead of leaving a raw SDK string in thirty agent logs.
  let res: Anthropic.Messages.Message;
  try {
    res = await anthropic.messages.create(
      body as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming
    );
  } catch (err) {
    const cause = describeClaudeFailure(err);
    if (cause) throw new ClaudeUnavailableError(cause.reason, cause.status, cause.retryable);
    throw err;
  }
  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // Single choke point: EVERY Claude call, in every agent, present and
  // future, comes through here. Sanitizing once at the source is the only
  // way to actually guarantee "never any em dashes on the site", rather than
  // relying on each of the dozen call sites to remember to do it (several
  // didn't). Safe to run before JSON parsing downstream: the regex only
  // touches em/en dash characters, never JSON syntax.
  const text = noEmDash(rawText);
  return {
    text,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      model,
      cache_creation_input_tokens: (res.usage as { cache_creation_input_tokens?: number })
        .cache_creation_input_tokens,
      cache_read_input_tokens: (res.usage as { cache_read_input_tokens?: number })
        .cache_read_input_tokens,
    },
    stopReason: (res as { stop_reason?: string | null }).stop_reason ?? null,
  };
}

/**
 * Force a JSON object response. We instruct the model to return ONLY JSON and
 * defensively extract the first balanced object. If a Zod schema is supplied,
 * we validate and (on failure) retry once with the validation error appended.
 */
export async function completeJson<T = unknown>(
  prompt: string,
  // The `any` input param decouples the schema's INPUT type from its OUTPUT type
  // so T always infers to the parsed output (e.g. defaults applied, not | undefined).
  opts: CompleteOptions & { schema?: z.ZodType<T, z.ZodTypeDef, any>; retries?: number } = {}
): Promise<{ data: T; usage: ClaudeUsage }> {
  const retries = opts.retries ?? 1;
  const jsonInstruction =
    "\n\nRespond with ONLY a single valid JSON object. No markdown, no code fences, no commentary before or after.";
  let lastErr: unknown;
  let extra = "";
  let totalIn = 0;
  let totalOut = 0;
  let maxTokens = opts.maxTokens ?? 2048;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { text, usage, stopReason } = await complete(prompt + jsonInstruction + extra, {
      ...opts,
      maxTokens,
    });
    totalIn += usage.input_tokens;
    totalOut += usage.output_tokens;
    try {
      const obj = extractJson(text);
      const data = opts.schema ? opts.schema.parse(obj) : (obj as T);
      return {
        data,
        usage: { input_tokens: totalIn, output_tokens: totalOut, model: usage.model },
      };
    } catch (err) {
      lastErr = err;
      // If the response was cut off at the token ceiling, the JSON is truncated,
      // retrying at the SAME budget just truncates again. Bump the budget instead
      // (capped) so the retry has room to finish the object.
      if (stopReason === "max_tokens") {
        maxTokens = Math.min(maxTokens * 2, 8192);
        extra = "\n\nYour previous response was cut off before the JSON was complete. Return the COMPLETE, valid JSON object only.";
      } else {
        extra = `\n\nYour previous response could not be parsed/validated (${(err as Error).message}). Return corrected, strictly-valid JSON only.`;
      }
    }
  }
  throw new Error(
    `completeJson failed after ${retries + 1} attempts: ${(lastErr as Error)?.message}`
  );
}

/** Extract the first balanced JSON object or array from a model response. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // Fast path: whole thing is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // Strip code fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  // Scan for the first balanced { } or [ ].
  const start = trimmed.search(/[{[]/);
  if (start === -1) throw new Error("no JSON found in response");
  const open = trimmed[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON in response");
}
