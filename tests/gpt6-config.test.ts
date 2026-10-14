import {afterEach,expect,it,vi} from "vitest";
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
it("keeps existing defaults until explicit candidate opt-in and preserves model overrides",async()=>{
  vi.stubEnv("OPENAI_GPT6_CANDIDATES","");vi.stubEnv("OPENAI_MODEL","");vi.stubEnv("OPENAI_MODEL_SMART","");vi.resetModules();
  expect((await import("../lib/config")).config.openai).toMatchObject({gpt6Candidates:false,model:"gpt-4.1",modelSmart:"gpt-4.1"});
  vi.stubEnv("OPENAI_GPT6_CANDIDATES","true");vi.resetModules();
  expect((await import("../lib/config")).config.openai).toMatchObject({gpt6Candidates:true,model:"gpt-6-luna",modelSmart:"gpt-6-sol"});
  vi.stubEnv("OPENAI_MODEL","gpt-4.1");vi.resetModules();
  expect((await import("../lib/config")).config.openai).toMatchObject({model:"gpt-4.1",modelSmart:"gpt-6-sol"});
});
