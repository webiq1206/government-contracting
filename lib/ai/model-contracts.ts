/** Candidate transport contracts; quality approval and rollout are separate.
 * Official model/pricing references and release gates: docs/gpt6-migration.md. */
import { decimalUnits } from "../api-usage/money";

export const GPT6_MODELS = { routine: "gpt-6-luna", complex: "gpt-6-sol" } as const;
export type Gpt6Model = typeof GPT6_MODELS[keyof typeof GPT6_MODELS];
export function isBoundedGpt6(model: string): model is Gpt6Model {
  return model === GPT6_MODELS.routine || model === GPT6_MODELS.complex;
}

export const GPT6_RATES = {
  "gpt-6-luna": { input_tokens: "0.10", output_tokens: "0.50", cached_input_tokens: "0.01", cache_write_input_tokens: "0.125" },
  "gpt-6-sol": { input_tokens: "2", output_tokens: "10", cached_input_tokens: "0.20", cache_write_input_tokens: "2.50" },
} as const;

export interface TokenEnvelope { input_tokens: number; output_tokens: number }
/** Called under the existing ledger admission lock. Custom prices are kept;
 * incomplete/underpriced rows cannot admit candidate calls on request counts.
 * Cover the entire allowed text/output envelope plus the ledger's 10% buffer.
 */
export function gpt6ReservationCovered(model: Gpt6Model, rates: Record<string, unknown> | undefined, reservation: string | null): boolean {
  try {
    if (!rates || !reservation) return false;
    for (const [key, minimum] of Object.entries(GPT6_RATES[model]))
      if (decimalUnits(String(rates[key])) < decimalUnits(minimum)) return false;
    if (Object.keys(rates).some(key => !Object.hasOwn(GPT6_RATES[model], key))) return false;
    const input = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens"].map(key => decimalUnits(String(rates[key])));
    const maxInput = input.reduce((a,b) => a > b ? a : b);
    const numerator = (272000n * maxInput + 128000n * decimalUnits(String(rates.output_tokens))) * 11n;
    const ceiling = (numerator + 9999999n) / 10000000n;
    return decimalUnits(reservation) >= ceiling;
  } catch { return false; }
}
export interface BoundedOpenAiInput {
  model: string; instructions: string | null; prompt: string; maxTokens: number;
  responseSchema?: Record<string, unknown>; documents?: { base64: string }[];
}

/** UTF-8 bytes conservatively bound byte-tokenized text, plus framing/schema.
 * No PDF token estimate is inferred from its compressed bytes or page count.
 * Refuse unsupported input intact: never silently shorten evidence or output.
 */
export function gpt6TokenEnvelope(input: BoundedOpenAiInput): TokenEnvelope | undefined {
  if (!isBoundedGpt6(input.model)) return undefined;
  if (input.documents?.length) throw new Error("GPT-6 PDF input requires a verified token-cost bound before dispatch. No document was sent or shortened.");
  if (!Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 128000)
    throw new Error("GPT-6 output limit is outside the reviewed request contract.");
  const inputTokens = Buffer.byteLength(input.prompt, "utf8") + Buffer.byteLength(input.instructions ?? "", "utf8") +
    Buffer.byteLength(JSON.stringify(input.responseSchema ?? {}), "utf8") + 4096;
  if (inputTokens > 272000) throw new Error("GPT-6 input exceeds the reviewed standard-context price bound. No evidence was shortened.");
  return { input_tokens: inputTokens, output_tokens: input.maxTokens };
}
