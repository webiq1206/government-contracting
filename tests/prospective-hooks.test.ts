/** Exercise the actual entry points, with an active durable fence and no
 * readable credentials. No provider/client or handler may be reached. */
import { beforeEach,expect,it,vi } from 'vitest';
const m=vi.hoisted(()=>({down:false,handler:vi.fn(),query:vi.fn(),client:vi.fn(),callback:vi.fn()}));
vi.mock('../lib/db',()=>({
  query:m.query,queryOne:m.query,
  transaction:async(fn:any)=>{
    if (m.down) throw Error('Synthetic database unavailable');
    return fn({query:async(sql:string)=>{
      if(sql.includes('pg_advisory_xact_lock')) return {rows:[]};
      if(sql.includes('select preview_id from prospective_fence')) return {rows:[{preview_id:'synthetic-hold'}]};
      throw Error('Unexpected persistence after fence refusal: '+sql);
    }});
  },
}));
vi.mock('googleapis',()=>({google:{auth:{OAuth2:m.client},gmail:m.client}}));
import { config } from '../lib/config';
import { gmail } from '../lib/integrations/gmail';
import { systemMail } from '../lib/integrations/system-mail';
import { runAgent } from '../lib/agents/runner';
import { enqueue } from '../lib/queue';
import { withProviderFacts } from '../lib/ai/provider-facts';
beforeEach(()=>{
  vi.clearAllMocks();m.down=false;
  vi.spyOn(config.database,'isIsolatedDev','get').mockReturnValue(false);
  vi.spyOn(config.systemMail,'from','get').mockReturnValue('synthetic-sender@example.test');
  m.query.mockRejectedValue(Error('Credential or business access must not be reached'));
});
it('blocks a deterministic agent and forged opportunity permit before handler/business writes',async()=>{
  await expect(runAgent({name:'synthetic-agent',label:'Fixture',description:'Fixture',worksWithoutClaude:true,handler:m.handler},'manual',
    {opportunityId:'forged',previewId:'synthetic-hold',owner:'forged'})).rejects.toMatchObject({name:'ProspectiveBlockedError'});
  expect(m.handler).not.toHaveBeenCalled();expect(m.query).not.toHaveBeenCalled();
});
it('blocks queue admission before backend construction and intent mutation',async()=>{
  await expect(enqueue('synthetic-agent',{previewId:'synthetic-hold'})).rejects.toMatchObject({name:'ProspectiveBlockedError'});
  expect(m.query).not.toHaveBeenCalled();
});
it('blocks Gmail before OAuth lookup, provider/client construction and the durable send callback',async()=>{
  expect(await gmail.send({to:'recipient@example.test',subject:'Fixture',html:'Synthetic',beforeProviderSend:m.callback})).toMatchObject({disabled:true,outcome:'not_attempted',error:expect.stringContaining('preview')});
  expect(m.query).not.toHaveBeenCalled();expect(m.client).not.toHaveBeenCalled();expect(m.callback).not.toHaveBeenCalled();
});
it('blocks direct platform system mail through the same lowest send guard',async()=>{
  expect(await systemMail.send({to:'recipient@example.test',subject:'Fixture',text:'Synthetic'})).toMatchObject({error:expect.stringContaining('preview')});
  expect(m.query).not.toHaveBeenCalled();expect(m.client).not.toHaveBeenCalled();
});
it.each([false,true])('blocks normal and recovery provider dispatch, recovery=%s',async recovery=>{
  await expect(withProviderFacts({orgId:'fixture',envKey:'OPENAI_API_KEY',value:'synthetic-only',source:'platform',accepted:false},'OpenAI',m.callback,recovery))
    .rejects.toMatchObject({name:'ProspectiveBlockedError'});
  expect(m.callback).not.toHaveBeenCalled();expect(m.query).not.toHaveBeenCalled();
});
it('missing database admission fails closed at the lowest mail boundary',async()=>{
  m.down=true;
  await expect(gmail.send({to:'recipient@example.test',subject:'Fixture',html:'Synthetic',beforeProviderSend:m.callback})).rejects.toThrow('database unavailable');
  expect(m.client).not.toHaveBeenCalled();expect(m.callback).not.toHaveBeenCalled();
});
