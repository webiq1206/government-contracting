import {beforeEach,describe,it,expect,vi} from "vitest";
const s=vi.hoisted(()=>({stored:true,quota:0,list:vi.fn(),get:vi.fn(),thread:vi.fn(),profile:vi.fn(),aliases:vi.fn(),credentials:vi.fn()}));
vi.mock("../lib/config",()=>({config:{appUrl:"https://example.invalid",gmail:{configured:true,clientId:"fixture-client",clientSecret:"fixture-secret",refreshToken:"legacy-env-fixture"}}}));
vi.mock("../lib/db",()=>({query:async()=>[],queryOne:async()=>s.stored?{data:{refresh_token:"stored-fixture"},connection_generation:"10000000-0000-4000-8000-000000000001",email:"owner@example.test"}:null}));
vi.mock("../lib/integration-settings",()=>({encryptSecret:(v:string)=>v,decryptSecret:(v:string)=>v}));
vi.mock("../lib/tenant",()=>({tryResolveTenantOrgId:async()=>"00000000-0000-4000-8000-000000000001"}));
vi.mock("../lib/integrations/gmail-quota",()=>({reserveGmailQuota:async(_o:string,n:number,step=n)=>s.quota && step===20?Math.min(n,s.quota):n}));
vi.mock("googleapis",()=>({google:{auth:{OAuth2:class {setCredentials=s.credentials;}},gmail:()=>({users:{getProfile:s.profile,settings:{sendAs:{list:s.aliases}},messages:{list:s.list,get:s.get},threads:{get:s.thread}}})}}));
import {gmail} from "../lib/integrations/gmail";
const org="00000000-0000-4000-8000-000000000001";
function message(id:string){return {id,threadId:"fixture-thread",internalDate:"1792713600000",labelIds:["SENT"],payload:{headers:[{name:"From",value:"Quotes <quotes@example.test>"},{name:"To",value:"supplier@example.test"}],mimeType:"text/plain",body:{data:Buffer.from("Synthetic reply only.").toString("base64url")}}};}
beforeEach(()=>{vi.clearAllMocks();s.stored=true;s.quota=0;s.list.mockResolvedValue({data:{messages:[{id:"a"},{id:"b"}],nextPageToken:"provider-next"}});s.get.mockImplementation(async({id}:{id:string})=>({data:message(id)}));s.profile.mockResolvedValue({data:{emailAddress:"owner@example.test"}});s.thread.mockResolvedValue({data:{messages:[message("a")]}});});
describe("read-only Gmail receipt surfaces",()=>{
 it("does not fall back to the legacy environment grant when the saved grant is absent",async()=>{
  s.stored=false;
  expect(await gmail.mailboxIdentity(org)).toMatchObject({ok:false});
  expect(await gmail.fetchSentMailbox(1,org,"quotes@example.test")).toMatchObject({messages:[],error:expect.any(String)});
  expect(await gmail.readMailboxThread("fixture-thread",org)).toMatchObject({messages:[],error:expect.any(String)});
  expect(s.credentials).not.toHaveBeenCalled();expect(s.profile).not.toHaveBeenCalled();
 });
 it("fetches only one bounded selected-alias Sent page and preserves actual provider labels/dates/body",async()=>{
  const page=await gmail.fetchSentMailbox(123,org,"quotes@example.test");
  expect(s.list).toHaveBeenCalledWith(expect.objectContaining({q:"in:sent -in:trash from:quotes@example.test after:123",maxResults:25}));
  expect(page.messages[0]).toMatchObject({messageId:"a",labels:["SENT"],internalDate:"1792713600000",body:"Synthetic reply only."});
  expect(page.nextPageToken).toBe("provider-next");
 });
 it("resumes a partially read page without losing its unprocessed message or relisting",async()=>{
  s.quota=20;const first=await gmail.fetchSentMailbox(123,org,"quotes@example.test");
  expect(first.messages.map(m=>m.messageId)).toEqual(["a"]);
  const next=await gmail.fetchSentMailbox(123,org,"quotes@example.test",first.nextPageToken);
  expect(next.messages.map(m=>m.messageId)).toEqual(["b"]);expect(next.nextPageToken).toBe("provider-next");expect(s.list).toHaveBeenCalledTimes(1);
 });
 it("preserves partial failure and does not infer that missing mail was read",async()=>{
  s.get.mockResolvedValueOnce({data:message("a")}).mockRejectedValueOnce(Error("denied"));
  const read=await gmail.fetchSentMailbox(123,org,"quotes@example.test");
  expect(read.messages).toHaveLength(1);expect(read.error).toBeTruthy();expect(read.nextPageToken).toBeTruthy();
 });
 it("does not silently truncate an oversized known thread",async()=>{
  s.thread.mockResolvedValue({data:{messages:Array.from({length:501},(_,i)=>message(String(i)))}});
  expect(await gmail.readMailboxThread("fixture-thread",org)).toMatchObject({messages:[],error:expect.stringContaining("bounded")});
 });
 it("rejects an invalid query identity before listing mail",async()=>{
  expect(await gmail.fetchSentMailbox(1,org,"bad@example.test OR from:anyone")).toMatchObject({messages:[],error:expect.any(String)});
  expect(s.list).not.toHaveBeenCalled();
 });
});
