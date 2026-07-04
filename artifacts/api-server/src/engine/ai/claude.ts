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

export class ClaudeNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set — Claude-dependent step skipped.");
    this.name = "ClaudeNotConfiguredError";
  }
}

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!config.claude.enabled) throw new ClaudeNotConfiguredError();
  if (!_client) _client = new Anthropic({ apiKey: config.claude.apiKey });
  return _client;
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
  /** Set false to skip Company Profile injection (rarely needed). */
  injectProfile?: boolean;
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
): Promise<{ text: string; usage: ClaudeUsage }> {
  const system = await buildSystem(opts);
  const res = await client().messages.create({
    model: config.claude.model,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.2,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    usage: {
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      model: config.claude.model,
    },
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

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { text, usage } = await complete(prompt + jsonInstruction + extra, opts);
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
      extra = `\n\nYour previous response could not be parsed/validated (${(err as Error).message}). Return corrected, strictly-valid JSON only.`;
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
