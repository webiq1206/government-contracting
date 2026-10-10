import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { providerDiagnostics, configurationReference, retryAfterSeconds } from "../lib/api-usage/diagnostics";
import { openAiResponse, describeOpenAiFailure, OpenAiApiError } from "../lib/ai/openai";
import { ProviderDiagnosticDetails } from "../components/provider-diagnostic-details";
import { classifyFailure } from "../lib/domain/automation-health";
import { providerNeedsIntervention } from "../lib/domain/provider-retry";
import { AhrefsProviderError } from "../lib/integrations/ahrefs";
import { HttpError } from "../lib/integrations/http";

const secret = "sk-synthetic-never-a-live-credential";
const privateText = "Private customer mail and procurement plan";
afterEach(() => vi.restoreAllMocks());

describe("bounded provider diagnostics", () => {
  it("retains explicit status/code/type/request ID/delay and discards all free text and arbitrary fields", () => {
    const d = providerDiagnostics({ status: 429, code: "organization_spend_limit_exceeded", type: "insufficient_quota",
      headers: new Headers({ "x-request-id": "req_abcdef123456", "retry-after": "90", authorization: `Bearer ${secret}` }),
      message: privateText, prompt: privateText, email: privateText, key: secret, cause: { token: secret },
    }, [secret]);
    expect(d).toEqual({ version: 1, httpStatus: 429, errorCode: "organization_spend_limit_exceeded", errorType: "insufficient_quota", requestId: "req_abcdef123456", retryAfterSeconds: 90, omittedFields: [] });
    expect(JSON.stringify(d)).not.toMatch(/Private customer|sk-synthetic|Bearer|authorization|prompt|email/);
  });
  it.each([privateText, secret, "customer_mail_content", "victim@example.test", "https://private.example.test/plan", "eyJhbGciOiJub25lIn0.payload.signature"])("drops unrecognized or private values in every diagnostic string slot: %s", value => {
    const d = providerDiagnostics({ status: 403, code: value, type: value, requestId: value, retryAfterSeconds: value }, [secret]);
    expect(d).toMatchObject({ errorCode: null, errorType: null, requestId: null, retryAfterSeconds: null });
    expect(d.omittedFields).toEqual(["errorCode", "errorType", "requestId", "retryAfterSeconds"]);
    expect(JSON.stringify(d)).not.toContain(value);
  });
  it("rejects reflected credentials even when shaped like a valid provider request ID or code", () => {
    const d = providerDiagnostics({ code: "invalid_api_key", requestId: "req_abcdef" }, ["invalid_api_key", "req_abcdef"]);
    expect(d.errorCode).toBeNull(); expect(d.requestId).toBeNull();
  });
  it("re-sanitizes persisted or normalized diagnostics and retains privacy omission labels", () => {
    const d = providerDiagnostics({ diagnostics: { version: 99, httpStatus: 403, errorCode: privateText, message: secret, omittedFields: ["requestId", secret] } });
    expect(d).toMatchObject({ version: 1, httpStatus: 403, errorCode: null, omittedFields: ["errorCode", "requestId"] });
    expect(JSON.stringify(d)).not.toContain(secret);
  });
  it("bounds delay parsing and accepts only seconds or an HTTP date", () => {
    const now = Date.parse("2026-10-10T20:00:00Z");
    expect(retryAfterSeconds("Sat, 10 Oct 2026 20:01:30 GMT", now)).toBe(90);
    expect(retryAfterSeconds("1.5", now)).toBe(2);
    for (const value of [-1, Infinity, "tomorrow", "604801", privateText]) expect(retryAfterSeconds(value, now)).toBeNull();
  });
  it("only preserves nonsecret application configuration references", () => {
    expect(configurationReference({ credentialStore: "platform_settings", settingsOrgId: "00000000-0000-4000-8000-000000000001", credentialSetting: "OPENAI_API_KEY", value: secret, account: privateText }))
      .toEqual({ credentialStore: "platform_settings", settingsOrgId: "00000000-0000-4000-8000-000000000001", credentialSetting: "OPENAI_API_KEY" });
    expect(configurationReference({ credentialStore: secret, settingsOrgId: privateText, credentialSetting: secret }))
      .toEqual({ credentialStore: "unknown", settingsOrgId: null, credentialSetting: null });
  });
});

describe("normal OpenAI request failure with an injected response", () => {
  it("filters reflected credentials on a malformed successful response too", async () => {
    const key = "req_abcdef";
    const fakeFetch = vi.fn(async()=>new Response("invalid json",{status:200,headers:{"x-request-id":key}}));
    const error = await openAiResponse({apiKey:key,model:"gpt-4.1",prompt:"synthetic",instructions:null,maxTokens:1},fakeFetch as typeof fetch).catch(e=>e);
    expect(error.diagnostics).toMatchObject({httpStatus:200,requestId:null,omittedFields:["requestId"]});
    expect(JSON.stringify(error)).not.toContain(key);
  });
  it("makes one synthetic request and preserves diagnostics without leaking the provider's echoed prompt/key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: "project_spend_limit_exceeded", type: "insufficient_quota", message: `${privateText} ${secret}` }, prompt: privateText }),
      { status: 429, headers: { "x-request-id": "req_123456abcdef", "retry-after": "120", "set-cookie": secret } }));
    const error = await openAiResponse({ apiKey: secret, model: "gpt-4.1", instructions: privateText, prompt: privateText, maxTokens: 1 }, fetchImpl as typeof fetch).catch(e => e);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(error.diagnostics).toMatchObject({ httpStatus: 429, errorCode: "project_spend_limit_exceeded", errorType: "insufficient_quota", requestId: "req_123456abcdef", retryAfterSeconds: 120 });
    expect(String(error) + JSON.stringify(error)).not.toContain(secret);
    expect(String(error) + JSON.stringify(error)).not.toContain(privateText);
    const hold = describeOpenAiFailure(error)!;
    expect(hold).toMatchObject({ retryable: false });
    expect(hold.reason).toContain("project spend limit");
    expect(classifyFailure(hold.reason)).toBe("provider_credit");
  });
  it.each([
    ["credit_balance_exhausted", "insufficient_quota", false, "exhausted credit balance"],
    ["organization_spend_limit_exceeded", "insufficient_quota", false, "organization spend limit"],
    ["organization_usage_limit_exceeded", "insufficient_quota", false, "assigned organization usage limit"],
    ["insufficient_quota", null, false, "billing quota or account allowance"],
    ["rate_limit_exceeded", null, true, "rate limiting"],
    ["slow_down", "rate_limit_error", true, "rate limiting"],
  ])("classifies the specific saved code %s without treating all 429s as rate limits", (code, type, retryable, reason) => {
    const d = describeOpenAiFailure(new OpenAiApiError("ignored private body", 429, code, type, null))!;
    expect(d.retryable).toBe(retryable); expect(d.reason).toContain(reason);
    expect(classifyFailure(d.reason)).toBe(retryable ? "provider_rate_limit" : "provider_credit");
  });
  it.each([401, 403, 429])("keeps bare %s refusals unresolved and held for review", status => {
    const d = describeOpenAiFailure(new OpenAiApiError(privateText, status, null, null, null))!;
    expect(d.retryable).toBe(false);
    expect(classifyFailure(d.reason)).toBe("provider_refusal");
    expect(providerNeedsIntervention(`AI_UNAVAILABLE: ${d.reason}`)).toBe(true);
  });
});

it("preserves bounded Retry-After evidence across the Ahrefs wrapper without claiming scheduled recovery",()=>{
  const diagnostics = providerDiagnostics({status:429,code:"rate_limit_exceeded",headers:{"retry-after":"600","x-request-id":"req_abcdef"}});
  const error = new AhrefsProviderError("Synthetic provider failure",{cause:new HttpError(429,"Synthetic refusal",undefined,diagnostics)});
  expect(error.diagnostics).toEqual(diagnostics);
  expect(error.retryable).toBe(true);
});

it("renders only allowlisted fields, labels missing historic evidence and does not invent a provider account", () => {
  const historical = renderToStaticMarkup(<ProviderDiagnosticDetails diagnostics={null} configuration={null} />);
  expect(historical).toContain("historical cause cannot be reconstructed");
  const html = renderToStaticMarkup(<ProviderDiagnosticDetails diagnostics={{ httpStatus: 403, errorCode: secret, errorType: privateText, extra: privateText }} configuration={{ value: secret }} />);
  expect(html).not.toContain(secret); expect(html).not.toContain(privateText);
  expect(html).toContain("Omitted by privacy filter");
  expect(html).toContain("not a verified provider billing account");
});
