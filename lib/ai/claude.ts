/**
 * The AI choke point. The Company Profile is injected as system context on
 * every call (architecture principle). Two entry points:
 *   - complete(): free-form text completion
 *   - completeJson(): forces a JSON object back, validated with an optional Zod schema
 *
 * Two providers sit behind it, Anthropic and OpenAI, chosen per call by
 * lib/ai/routing.ts: routine work goes to whichever provider the operator
 * prefers for volume (OpenAI by default, being cheaper), the bid-critical
 * path to whichever they prefer for accuracy (Claude by default), and an
 * organization holding one key uses it for everything. When the chosen
 * provider refuses a request for an account or service reason, the call is
 * made once more on the other provider, and both attempts show in the ledger.
 *
 * Degrades gracefully: if no provider key is set, calls throw a typed error
 * that agents catch and log as "skipped" so the pipeline keeps flowing.
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
import {
  chooseRoute,
  type AiProvider,
  type AiRoute,
  type AiEnvKey,
  type RoutingConfig,
} from "./routing";
import { openAiResponse, describeOpenAiFailure } from "./openai";

export type { AiProvider, AiRoute } from "./routing";

/**
 * No provider key at all for this organization. The name is historical: it
 * is caught in a dozen agents as "no AI configured, skip this step", and that
 * meaning is unchanged now that either key satisfies it.
 */
export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("No AI provider key is set (ANTHROPIC_API_KEY or OPENAI_API_KEY), AI-dependent step skipped.");
    this.name = "ClaudeNotConfiguredError";
  }
}
export { ClaudeNotConfiguredError as AiNotConfiguredError };

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
export class AiUnavailableError extends Error {
  readonly provider: AiProvider;
  /** Plain English, safe to show an operator. Never contains the key. */
  readonly reason: string;
  readonly status: number | null;
  /** True when waiting is a plausible fix (rate limit, provider outage). */
  readonly retryable: boolean;

  constructor(provider: AiProvider, reason: string, status: number | null, retryable: boolean) {
    super(`${AI_UNAVAILABLE_PREFIX} ${reason}`);
    this.name = "AiUnavailableError";
    this.provider = provider;
    this.reason = reason;
    this.status = status;
    this.retryable = retryable;
  }
}

export class ClaudeUnavailableError extends AiUnavailableError {
  constructor(reason: string, status: number | null, retryable: boolean) {
    super("Anthropic", reason, status, retryable);
    this.name = "ClaudeUnavailableError";
  }
}

export class OpenAiUnavailableError extends AiUnavailableError {
  constructor(reason: string, status: number | null, retryable: boolean) {
    super("OpenAI", reason, status, retryable);
    this.name = "OpenAiUnavailableError";
  }
}

function unavailable(provider: AiProvider, reason: string, status: number | null, retryable: boolean): AiUnavailableError {
  return provider === "Anthropic"
    ? new ClaudeUnavailableError(reason, status, retryable)
    : new OpenAiUnavailableError(reason, status, retryable);
}

/**
 * Describe any failure that came out of complete(), whichever provider raised
 * it. An error the choke point already classified carries its own reason;
 * anything rawer is tried against both providers' vocabularies.
 */
export function describeAiFailure(
  err: unknown
): { reason: string; status: number | null; retryable: boolean; provider: AiProvider | null } | null {
  if (err instanceof AiUnavailableError) {
    return { reason: err.reason, status: err.status, retryable: err.retryable, provider: err.provider };
  }
  const claude = describeClaudeFailure(err);
  if (claude) return { ...claude, provider: null };
  const openai = describeOpenAiFailure(err);
  return openai ? { ...openai, provider: null } : null;
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
  if (/specified (?:api )?usage limits|regain access on/i.test(text)) {
    return {
      reason:
        "The Anthropic account has reached its specified API usage limits. " +
        "Check Billing and Usage at console.anthropic.com. Requests using this provider must wait for its allowance to reset or an approved account change. " +
        (text.match(/regain access on\s+[^\"\n}]+/i)?.[0] ?? ""),
      status,
      retryable: false,
    };
  }

  if (/credit balance|insufficient|billing|quota|payment/i.test(text)) {
    return {
      reason: "The Anthropic credit balance is too low or billing allowance has been exhausted. Check Billing and Usage at console.anthropic.com before retrying. A new API key alone will not restore the account allowance.",
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

/** Stamp the Integrations card with the org that actually made the call. */
function recordProviderUse(envKey: AiEnvKey, outcome: { ok: boolean; error?: string }): void {
  void Promise.all([import("../tenant"), import("../integration-settings")])
    .then(async ([{ resolveTenantOrgId }, settings]) => {
      const orgId = await resolveTenantOrgId();
      await settings.recordIntegrationUse(envKey, { ...outcome, orgId });
    })
    .catch(() => undefined);
}

function routingConfig(): RoutingConfig {
  return {
    anthropic: { model: config.claude.model, modelSmart: config.claude.modelSmart },
    openai: { model: config.openai.model, modelSmart: config.openai.modelSmart },
    routineProvider: config.ai.routineProvider,
    complexProvider: config.ai.complexProvider,
    fallback: config.ai.fallback,
  };
}

/** Which providers the CURRENT (or named) organization holds a key for. */
export async function aiProviderAvailability(orgId?: string): Promise<Record<AiProvider, boolean>> {
  const { orgHasKey } = await import("../integration-keys");
  const [Anthropic, OpenAI] = await Promise.all([
    orgHasKey("ANTHROPIC_API_KEY", orgId),
    orgHasKey("OPENAI_API_KEY", orgId),
  ]);
  return { Anthropic, OpenAI };
}

/**
 * Whether the CURRENT organization has AI configured: either provider will
 * do, since either serves every tier on its own.
 */
export async function claudeEnabled(): Promise<boolean> {
  const a = await aiProviderAvailability();
  return a.Anthropic || a.OpenAI;
}
export const aiEnabled = claudeEnabled;

/**
 * The route a call with these options would take right now, for preflight
 * checks that want to reserve against the model that will actually run.
 */
export async function planRoute(
  opts: Pick<CompleteOptions, "complexity" | "model" | "fallback">,
  orgId?: string
): Promise<{ primary: AiRoute; fallback: AiRoute | null } | null> {
  const available = await aiProviderAvailability(orgId);
  return chooseRoute({ complexity: opts.complexity, model: opts.model, fallback: opts.fallback, available, cfg: routingConfig() });
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
  /** Which provider answered. Absent on usage assembled before routing existed. */
  provider?: AiProvider;
  /** OpenAI reasoning tokens, already included in output_tokens. */
  reasoning_tokens?: number;
  /** Set when the primary provider refused and this answer came from the other. */
  fallback_from?: AiProvider;
}

export interface CompleteOptions {
  /** Interactive checks can use a short budget without shortening agent work. */
  timeoutMs?: number;
  maxRetries?: number;
  feature?: string;
  system?: string; // extra system text appended after the Company Profile
  maxTokens?: number;
  temperature?: number;
  /** Override the model for this call (e.g. config.claude.modelSmart). */
  model?: string;
  /** Explicit task difficulty; complex tasks are never silently downgraded. */
  complexity?: "routine" | "complex";
  /** Set false to skip Company Profile injection (rarely needed). */
  injectProfile?: boolean;
  /**
   * The caller wants a JSON object. Providers with a native JSON mode
   * (OpenAI) get it switched on; the prompt must still ask for JSON.
   */
  json?: boolean;
  /** Set false to refuse the cross-provider fallback for this call. */
  fallback?: boolean;
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

export interface Completion {
  text: string;
  usage: ClaudeUsage;
  stopReason: string | null;
}

export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<Completion> {
  const system = await buildSystem(opts);
  const plan = await planRoute(opts);
  if (!plan) throw new ClaudeNotConfiguredError();

  let primaryFailure: AiUnavailableError;
  try {
    return await runRoute(plan.primary, system, prompt, opts);
  } catch (err) {
    // A local spending hold never reached a provider; it is not the
    // provider's fault and the other provider would be held just the same.
    if (err instanceof Error && err.name === "ApiUsageBlockedError") throw err;
    // Anything but a provider refusing us is our own bug (or a parse
    // problem downstream). Switching providers would not fix a bad request.
    if (!(err instanceof AiUnavailableError)) throw err;
    primaryFailure = err;
  }

  if (!plan.fallback) throw primaryFailure;

  console.warn(
    `[ai] ${plan.primary.provider} (${plan.primary.model}) refused: ${primaryFailure.reason.slice(0, 160)} ` +
      `Retrying once on ${plan.fallback.provider} (${plan.fallback.model}).`
  );
  try {
    const res = await runRoute(plan.fallback, system, prompt, opts);
    return { ...res, usage: { ...res.usage, fallback_from: plan.primary.provider } };
  } catch (err) {
    if (err instanceof Error && err.name === "ApiUsageBlockedError") throw err;
    const second = err instanceof AiUnavailableError ? err.reason : (err as Error).message;
    // Named after the primary so the incident classifies as the primary's
    // problem (credit, key, rate limit), with the fallback's story attached.
    throw unavailable(
      plan.primary.provider,
      `${primaryFailure.reason} The ${plan.fallback.provider} fallback also failed: ${second}`,
      primaryFailure.status,
      primaryFailure.retryable
    );
  }
}

/**
 * One metered attempt on one provider. Every failure that means "the
 * provider refused us" leaves here as an AiUnavailableError, in words an
 * owner can act on, instead of a raw SDK string in thirty agent logs.
 */
async function runRoute(route: AiRoute, system: SystemBlock[], prompt: string, opts: CompleteOptions): Promise<Completion> {
  const { orgApiKey } = await import("../integration-keys");
  const { requestIdentity, metered } = await import("../api-usage/ledger");
  // Both spelled out: a source scan pins the literal Anthropic lookup so the
  // per-organization key can never be replaced by a process-wide one again.
  const apiKey = route.provider === "Anthropic"
    ? await orgApiKey("ANTHROPIC_API_KEY")
    : await orgApiKey("OPENAI_API_KEY");
  if (!apiKey) throw new ClaudeNotConfiguredError();
  const identity = await requestIdentity(route.envKey, apiKey);
  const feature = opts.feature ?? "AI assistance";

  try {
    const out = route.provider === "Anthropic"
      ? await runAnthropic(apiKey, identity, route, system, prompt, opts, metered, feature)
      : await runOpenAi(apiKey, identity, route, system, prompt, opts, metered, feature);
    /*
     * Every AI call passes through here, so it is the one place that can
     * record whether the provider is actually working for this account. The
     * Integrations page claimed to show that and showed the last Test press
     * instead, which on the day Anthropic refused for want of credit left the
     * card reading as verified that morning.
     *
     * Imported lazily: integration-settings reaches the database, and this
     * module is imported by code paths that must not pull a connection in
     * just by being loaded.
     */
    void recordProviderUse(route.envKey, { ok: true });
    return out;
  } catch (err) {
    // A local spending hold never reached the provider and must not mark its key as broken.
    if (err instanceof Error && err.name === "ApiUsageBlockedError") throw err;
    const cause = route.provider === "Anthropic" ? describeClaudeFailure(err) : describeOpenAiFailure(err);
    void recordProviderUse(route.envKey, { ok: false, error: cause?.reason ?? (err as Error).message });
    if (cause) throw unavailable(route.provider, cause.reason, cause.status, cause.retryable);
    throw err;
  }
}

type Metered = typeof import("../api-usage/ledger").metered;
type Identity = import("../api-usage/ledger").RequestIdentity;

async function runAnthropic(
  apiKey: string,
  identity: Identity,
  route: AiRoute,
  system: SystemBlock[],
  prompt: string,
  opts: CompleteOptions,
  metered: Metered,
  feature: string
): Promise<Completion> {
  const model = route.model;
  // No retained credentials and no hidden SDK retries. Every execution is metered.
  const anthropic = new Anthropic({ apiKey, maxRetries: 0 });

  // Built as a loose object so we can conditionally include params by model
  // family without fighting the (older) SDK's request types. The model string
  // itself is sent verbatim, so newer model ids work regardless of SDK version.
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

  const res: Anthropic.Messages.Message = await metered(identity, "Anthropic", model, feature,
    () => anthropic.messages.create(
      body as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      { ...(opts.timeoutMs != null ? { timeout: opts.timeoutMs } : {}),
        maxRetries: 0 }
    ),
    value => ({ requestId: value.id, units: { ...value.usage, requests: 1 } }), { complex: route.complex });

  const rawText = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // Single choke point: EVERY AI call, in every agent, present and future,
  // comes through here (the OpenAI leg does the same). Sanitizing once at
  // the source is the only way to actually guarantee "never any em dashes on
  // the site", rather than relying on each of the dozen call sites to
  // remember to do it (several didn't). Safe to run before JSON parsing
  // downstream: the regex only touches em/en dash characters, never JSON syntax.
  const text = noEmDash(rawText);
  return {
    text,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      model,
      provider: "Anthropic",
      cache_creation_input_tokens: (res.usage as { cache_creation_input_tokens?: number })
        .cache_creation_input_tokens,
      cache_read_input_tokens: (res.usage as { cache_read_input_tokens?: number })
        .cache_read_input_tokens,
    },
    stopReason: (res as { stop_reason?: string | null }).stop_reason ?? null,
  };
}

async function runOpenAi(
  apiKey: string,
  identity: Identity,
  route: AiRoute,
  system: SystemBlock[],
  prompt: string,
  opts: CompleteOptions,
  metered: Metered,
  feature: string
): Promise<Completion> {
  const model = route.model;
  // The same system prompt Claude sees, as one instructions string. The
  // stable profile still leads, which is the prefix OpenAI's automatic
  // prompt cache matches on.
  const instructions = system.map((b) => b.text).join("\n\n") || null;
  const res = await metered(identity, "OpenAI", model, feature,
    () => openAiResponse({
      apiKey,
      model,
      instructions,
      prompt,
      documents: opts.documents,
      maxTokens: opts.maxTokens ?? 2048,
      json: opts.json,
      effort: route.complex ? config.openai.reasoningComplex : config.openai.reasoningRoutine,
      reasoningHeadroom: config.openai.reasoningHeadroom,
      temperature: opts.temperature ?? 0.2,
      timeoutMs: opts.timeoutMs,
      cacheKey: `brostco:${identity.orgId}`,
    }),
    value => ({ requestId: value.id, units: { ...value.usage, requests: 1 } }), { complex: route.complex });

  return {
    text: noEmDash(res.text),
    usage: {
      // Same convention as Anthropic: input_tokens excludes cache reads.
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      model,
      provider: "OpenAI",
      cache_read_input_tokens: res.usage.cached_input_tokens,
      reasoning_tokens: res.usage.reasoning_tokens,
    },
    stopReason: res.stopReason,
  };
}

/**
 * Force a JSON object response. We instruct the model to return ONLY JSON and
 * defensively extract the first balanced object. If a Zod schema is supplied,
 * we validate and (on failure) retry once with the validation error appended.
 */
/**
 * Ceiling for a truncated JSON retry.
 *
 * The analyst used to start at 8192 and retry at the same number, which
 * produced the same cut-off object twice and then "An analysis came back
 * unreadable". The first attempt now starts at this budget; a still-truncated
 * retry can double once more, up to twice this.
 */
export const JSON_RETRY_TOKEN_CAP = 16384;
export const JSON_RETRY_TOKEN_HARD_CAP = 32768;

export async function completeJson<T = unknown>(
  prompt: string,
  // The `any` input param decouples the schema's INPUT type from its OUTPUT type
  // so T always infers to the parsed output (e.g. defaults applied, not | undefined).
  opts: CompleteOptions & { schema?: z.ZodType<T, z.ZodTypeDef, any>; retries?: number } = {}
): Promise<{ data: T; usage: ClaudeUsage }> {
  const retries = Math.max(0, Math.min(1, Math.floor(opts.retries ?? 1)));
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
      json: true,
    });
    totalIn += usage.input_tokens;
    totalOut += usage.output_tokens;
    try {
      const obj = extractJson(text);
      const data = opts.schema ? opts.schema.parse(obj) : (obj as T);
      return {
        data,
        usage: {
          input_tokens: totalIn,
          output_tokens: totalOut,
          model: usage.model,
          provider: usage.provider,
          fallback_from: usage.fallback_from,
        },
      };
    } catch (err) {
      lastErr = err;
      // If the response was cut off at the token ceiling, the JSON is truncated,
      // retrying at the SAME budget just truncates again. Bump the budget instead
      // (capped) so the retry has room to finish the object.
      if (stopReason === "max_tokens") {
        maxTokens = Math.min(maxTokens * 2, JSON_RETRY_TOKEN_HARD_CAP);
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
  // Cut off mid-object. Closing what was already written keeps the fields
  // that arrived, which is a usable analysis. Throwing here is how one
  // truncated compliance matrix erased the scope, trades and deadline.
  return closeTruncatedJson(trimmed.slice(start));
}

/**
 * Finish a truncated object or array so JSON.parse can read it.
 *
 * The last property may be dropped or set to null. That is the point: a
 * solicitation analysis that names the trades and misses the last form is
 * a brief somebody can work. "unbalanced JSON in response" is not.
 */
export function closeTruncatedJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error("unbalanced JSON in response");
  let s = text.slice(start);
  const stack: Array<"{" | "["> = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("{");
    else if (ch === "[") stack.push("[");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  if (inStr) s += '"';
  s = s.replace(/,\s*$/, "");
  if (/:\s*$/.test(s)) s += "null";
  while (stack.length > 0) {
    s += stack.pop() === "{" ? "}" : "]";
  }
  try {
    return JSON.parse(s);
  } catch {
    throw new Error("unbalanced JSON in response");
  }
}
