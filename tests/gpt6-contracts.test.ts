import { describe, expect, it, vi } from "vitest";
import { buildOpenAiBody, normalizeReasoningEffort, openAiResponse, parseOpenAiResponse } from "../lib/ai/openai";
import { GPT6_MODELS, GPT6_RATES, gpt6ReservationCovered, gpt6TokenEnvelope } from "../lib/ai/model-contracts";

const request = { apiKey: "synthetic-test-key", model: GPT6_MODELS.complex, instructions: "Return source-grounded JSON.", prompt: "[p.2] Deadline November 19.", maxTokens: 16384 };
describe("bounded GPT-6 candidate transport", () => {
  it.each(Object.values(GPT6_MODELS))("pins %s to none, the original output cap, standard service and no cache writes", model => {
    const body = buildOpenAiBody({ ...request, model, reasoningHeadroom: 4096, temperature: 0.2, responseSchema: {type:"object",properties:{},additionalProperties:false} });
    expect(body).toMatchObject({reasoning:{effort:"none"},max_output_tokens:16384,store:false,service_tier:"default",truncation:"disabled",prompt_cache_options:{mode:"explicit"}});
    expect(body).not.toHaveProperty("temperature");
    expect(body.text).toMatchObject({format:{type:"json_schema",strict:true}});
    expect(JSON.stringify(body)).not.toContain("prompt_cache_breakpoint");
  });
  it("does not silently activate a legacy complex effort or a different GPT-6 model", () => {
    expect(() => buildOpenAiBody({...request,effort:"medium"})).toThrow("reviewed bounded");
    expect(() => normalizeReasoningEffort("gpt-6.1-sol","none")).toThrow("reviewed bounded");
    expect(() => normalizeReasoningEffort("gpt-6-astra","low")).toThrow("reviewed bounded");
  });
  it("holds PDFs and oversized inputs intact before any network call", async () => {
    const transport = vi.fn();
    await expect(openAiResponse({...request,documents:[{base64:"synthetic-pdf"}]},transport)).rejects.toThrow("verified token-cost bound");
    await expect(openAiResponse({...request,prompt:"x".repeat(272000)},transport)).rejects.toThrow("No evidence was shortened");
    expect(transport).not.toHaveBeenCalled();
    expect(() => buildOpenAiBody({...request,maxTokens:128001})).toThrow("output limit");
  });
  it("includes Unicode, instructions and schema in its conservative text bound", () => {
    const input = {...request,prompt:"€",instructions:"abc",responseSchema:{type:"object"}};
    expect(gpt6TokenEnvelope(input)?.input_tokens).toBe(3+3+JSON.stringify(input.responseSchema).length+4096);
  });
  it.each(Object.values(GPT6_MODELS))("requires complete verified %s pricing without raising custom ceilings", model => {
    expect(gpt6ReservationCovered(model,GPT6_RATES[model],"3")).toBe(true);
    expect(gpt6ReservationCovered(model,undefined,"3")).toBe(false);
    expect(gpt6ReservationCovered(model,{...GPT6_RATES[model],output_tokens:"0"},"3")).toBe(false);
    expect(gpt6ReservationCovered(model,{...GPT6_RATES[model],input_tokens:"999"},"3")).toBe(false);
    expect(gpt6ReservationCovered(model,GPT6_RATES[model],"0.001")).toBe(false);
  });
});

describe("honest response accounting", () => {
  const completed = {status:"completed",service_tier:"default",output:[{type:"message",content:[{type:"output_text",text:"Finished"}]}]};
  it.each([undefined,{}, {input_tokens:100}, {input_tokens:100,output_tokens:-1},
    {input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:101}},
    {input_tokens:100,output_tokens:10,input_tokens_details:{cache_write_tokens:100}}])("retains completion but omits unverified units %j", usage => {
    const response = parseOpenAiResponse({...completed,usage},GPT6_MODELS.complex);
    expect(response).toMatchObject({text:"Finished",stopReason:"end_turn",usage:{}});
  });
  it("accepts explicit zero usage and holds unexpected tier/reasoning/long context", () => {
    expect(parseOpenAiResponse({...completed,usage:{input_tokens:0,output_tokens:0}},GPT6_MODELS.complex).usage.input_tokens).toBe(0);
    expect(parseOpenAiResponse({...completed,service_tier:"fast",usage:{input_tokens:10,output_tokens:10}},GPT6_MODELS.complex).usage).toEqual({});
    expect(parseOpenAiResponse({...completed,usage:{input_tokens:272001,output_tokens:10}},GPT6_MODELS.complex).usage).toEqual({});
    expect(parseOpenAiResponse({...completed,usage:{input_tokens:10,output_tokens:10,output_tokens_details:{reasoning_tokens:1}}},GPT6_MODELS.complex).usage).toEqual({});
  });
});
