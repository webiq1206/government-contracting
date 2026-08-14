/**
 * Claude API client. The Company Profile is injected as system context on every
 * call (architecture principle). Two entry points:
 *   - complete(): free-form text completion
 *   - completeJson(): forces a JSON object back, validated with an optional Zod schema
 *
 * Degrades gracefully: if ANTHROPIC_API_KEY is missing, calls throw a typed
 * error that agents catch and log as "skipped" so the pipeline keeps flowing.
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
}

export interface CompleteOptions {
  system?: string; // extra system text appended after the Company Profile
  maxTokens?: number;
  temperature?: number;
  /** Override the model for this call (e.g. config.claude.modelSmart). */
  model?: string;
  /** Set false to skip Company Profile injection (rarely needed). */
  injectProfile?: boolean;
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

async function buildSystem(opts: CompleteOptions): Promise<string> {
  const parts: string[] = [];
  if (opts.injectProfile !== false) {
    parts.push(await getProfileSystemText());
  }
  if (opts.system) parts.push(opts.system);
  return parts.join("\n\n---\n\n");
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
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 2048,
    system,
    messages: [{ role: "user", content: prompt }],
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
  const res = await anthropic.messages.create(
    body as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming
  );
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
