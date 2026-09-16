/** Current-product source captures. Disposable CI records only; no provider calls. */
import { chromium } from 'playwright';
import pg from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3100';
if (process.env.CI !== 'true' || process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'brostco_audit' || process.env.USE_REPLIT_DEV_DB !== 'true') throw Error('Disposable CI database required');
const ids = JSON.parse(readFileSync('/tmp/ui-fixtures.json', 'utf8'));
const db = new pg.Client({host:'127.0.0.1',port:5432,database:'brostco_audit',user:process.env.PGUSER,password:process.env.PGPASSWORD});
const out = 'artifacts/ui-audit/product-demo';
mkdirSync(out, { recursive: true });
await db.connect();
const browser = await chromium.launch();
try {
  assert.equal((await db.query('select name from organizations where id=$1',[ids.org])).rows[0]?.name, 'Interface Audit Workspace');
  const analysis = {
    project_overview:'Electrical maintenance and planned upgrades at a federal campus.',
    scope_plain_language:'Inspect distribution panels, replace identified components, coordinate planned outages, and document completed testing.',
    location:'Boise, ID',estimated_value:'$125,000',due_date:'October 15, 2026',
    submission_method:'Submit the signed offer as directed in the solicitation.',
    qualifications:{licenses:['Electrical contractor license'],insurance:['Coverage required by the solicitation'],bonding:[]},
    prebid_meeting:{required:false,details:'None recorded'},site_visit:{required:false,details:'Confirm access hours'},
    submission_requirements:['Technical approach','Itemized price schedule','Signed agency forms'],
    evaluation_criteria:['Technical acceptability','Price','Relevant experience'],required_forms:[],key_dates:[],contacts:[],qa_addenda:[],special_requirements:[],
    attention_items:['Confirm site access before final pricing.'],required_trades:['Electrical'],
    pursue_recommendation:'Service and location match. Confirm qualifications and site access before final review.',estimated_margin_pct:25
  };
  await db.query(`update opportunities set title='Federal campus electrical upgrades',agency='Sample Federal Agency',stage='scoring',score=88,tier='review',status='open',human_action_required=true,value_estimated=125000,deadline='2026-10-15',location_state='ID',location_text='Boise, ID',naics_code='238210',solicitation_analysis=$2,past_perf_classification='team_accepted' where id=$1`,[ids.opportunity,JSON.stringify(analysis)]);
  for (const [key,title,stage,score,value] of [
    ['grounds','Federal campus grounds maintenance','sub_research',92,145000],
    ['hvac','HVAC maintenance and inspections','outreach',86,98000],
    ['janitorial','Administrative building janitorial','bid_building',90,175000],
    ['painting','Interior painting and repairs','submitted',84,67000]
  ]) await db.query(`insert into opportunities(org_id,source,source_id,title,agency,stage,status,score,tier,value_estimated,deadline,location_state,location_text,naics_code,human_action_required)
    values($1,'manual',$2,$3,'Sample Federal Agency',$4,'open',$5,'pursue',$6,'2026-10-20','ID','Boise, ID','561210',false)`,[ids.org,'product-film-'+key,title,stage,score,value]);
  for (const [name,trade,city] of [['Sample Mechanical Group','HVAC','Boise'],['Sample Grounds Services','Landscaping','Meridian'],['Sample Facility Care','Janitorial','Nampa']]) await db.query(`insert into subcontractors(org_id,company_name,trade_categories,state,city,phone,email) values($1,$2,array[$3],'ID',$4,'2085550101','estimating@example.test')`,[ids.org,name,trade,city]);
  await db.query(`update subcontractors set email='estimating@example.test',city='Boise',state='ID' where id=$1`,[ids.sub]);
  await db.query(`update communications set subject=case when direction='inbound' then 'Re: Electrical scope and pricing' else 'Electrical scope and pricing' end,
    body=case when direction='inbound' then 'Our price is $82,000 for the electrical scope. Please confirm the site access window before we finalize scheduling.' else 'Please provide a quote for the campus electrical scope, including panel inspection, replacement work, testing, and closeout documents.' end
    where org_id=$1 and gmail_thread_id='clarity-audit-thread'`,[ids.org]);
  const ctx = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce',colorScheme:'light'});
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const p = await ctx.newPage();
  await p.goto(base+'/login');
  await p.getByLabel('Email',{exact:true}).fill('ui-owner@example.test');
  await p.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await p.getByRole('button',{name:'Sign in',exact:true}).click();
  await p.waitForURL('**/today');
  async function capture(name, route, prepare) {
    if (route) await p.goto(base+route,{waitUntil:'networkidle'});
    if (prepare) await prepare();
    await p.evaluate(()=>document.fonts.ready);
    await p.screenshot({path:`${out}/${name}.png`});
  }
  await capture('today','/today');
  await capture('pipeline','/pipeline');
  await capture('review','/review');
  await capture('subs','/subs');
  await capture('communications','/communications?c=clarity-audit-thread',async()=>{
    const earlier=p.getByText('Earlier messages (1)',{exact:true});
    if(await earlier.count()) await earlier.click();
  });
  await capture('opportunity',`/opportunity/${ids.opportunity}`);
  // The screen is a fixture-backed UI state, not a claim that live AI generated it.
  await db.query(`update opportunities set stage='bid_building',human_action_required=true where id=$1`,[ids.opportunity]);
  await db.query(`insert into opportunity_subs(org_id,opportunity_id,subcontractor_id,trade,outreach_state) values($1,$2,$3,'Electrical','responsive') on conflict(opportunity_id,subcontractor_id,trade) do update set outreach_state='responsive'`,[ids.org,ids.opportunity,ids.sub]);
  await db.query(`insert into quotes(org_id,opportunity_id,subcontractor_id,trade,quote_amount,notes) values($1,$2,$3,'Electrical',82000,'Sample written quote. Confirm access and exclusions before approval.')`,[ids.org,ids.opportunity,ids.sub]);
  await db.query(`insert into trade_pricing_rows(org_id,opportunity_id,scope_key,trade,selected_sub_id,base_quote,taxes,freight,mobilization,bonding,manual_adjustment) values($1,$2,'electrical','Electrical',$3,82000,0,0,0,0,0) on conflict do nothing`,[ids.org,ids.opportunity,ids.sub]);
  await capture('prepared',`/opportunity/${ids.opportunity}`);
  const tabs=p.getByRole('tab');
  for(let index=0;index<await tabs.count();index++) {
    await tabs.nth(index).click();
    await p.screenshot({path:`${out}/opportunity-tab-${index}.png`});
  }
  await capture('activity','/activity');
  // Record real navigation and disclosures in the application. These are not
  // provider demonstrations: no message, AI request, payment or bid is sent.
  const auth = await ctx.storageState();
  const recordings = [];
  for (const [format, viewport] of [['desktop', {width:1280,height:900}], ['mobile', {width:390,height:760}]]) {
    async function record(slug, route, steps) {
      const film = await browser.newContext({ storageState:auth, viewport,
        deviceScaleFactor:1, reducedMotion:'reduce', colorScheme:'light',
        recordVideo:{dir:`${out}/raw`,size:viewport} });
      await film.route('**/*', request => new URL(request.request().url()).origin === base ? request.continue() : request.abort());
      const createdAt = Date.now();
      const page = await film.newPage();
      const video = page.video();
      const events = [];
      try {
        await page.goto(base+route,{waitUntil:'networkidle'});
        await page.evaluate(()=>document.fonts.ready);
        const start = (Date.now()-createdAt)/1000;
        await page.waitForTimeout(1800);
        for (const [description, action] of steps) {
          await action(page);
          events.push({description,seconds:(Date.now()-createdAt)/1000-start});
          await page.waitForTimeout(2800);
        }
        await page.waitForTimeout(2500);
        await page.screenshot({path:`${out}/${slug}-${format}-end.png`});
        const duration = (Date.now()-createdAt)/1000-start;
        await film.close();
        await video.saveAs(`${out}/${slug}-${format}.webm`);
        recordings.push({slug,format,viewport,start,duration,events,file:`${slug}-${format}.webm`});
      } finally { await film.close(); }
    }
    await record('hero-preview','/today',[
      ['Open the complete task views',page=>page.getByText('All task views and controls',{exact:true}).click()],
      ['Return to the focused day',page=>page.getByText('All task views and controls',{exact:true}).click()],
    ]);
    await record('pipeline','/pipeline',[
      ['Switch to the list',page=>page.getByRole('link',{name:'List',exact:true}).click()],
      ['Open the sample opportunity',page=>page.getByRole('link',{name:'Federal campus electrical upgrades',exact:true}).first().click()],
    ]);
    await record('review',`/opportunity/${ids.opportunity}`, [
      ['Inspect the requirement context',page=>page.getByRole('tab',{name:'Requirements',exact:true}).click()],
      ['Return to the opportunity overview',page=>page.getByRole('tab',{name:'Overview',exact:true}).click()],
    ]);
    await record('subs',`/subs/${ids.sub}`, [
      ['Inspect connected opportunities',page=>page.getByRole('tab',{name:'Opportunities',exact:true}).click()],
      ['Inspect recorded quotes',page=>page.getByRole('tab',{name:'Quotes',exact:true}).click()],
    ]);
    await record('communications','/communications?c=clarity-audit-thread', [
      ['Inspect earlier messages',page=>page.getByText('Earlier messages (1)',{exact:true}).click()],
      ['Focus the latest conversation',page=>page.getByText('Earlier messages (1)',{exact:true}).click()],
    ]);
    await record('opportunity',`/opportunity/${ids.opportunity}`, [
      ['Inspect the supporting subcontractor quote',page=>page.getByRole('tab',{name:'Subcontractors',exact:true}).click()],
      ['Review the pricing workspace',page=>page.getByRole('tab',{name:'Pricing',exact:true}).click()],
    ]);
    await record('activity','/activity', [
      ['Expand a recorded event',page=>page.locator('details > summary').filter({has:page.locator('h3')}).first().click()],
      ['Inspect available history filters',page=>page.getByText('More filters',{exact:true}).click()],
    ]);
  }
  writeFileSync(`${out}/provenance.json`,JSON.stringify({sourceCommit:process.env.GITHUB_SHA,source:'Current application recorded with disposable sample records',recordedInteractions:true,externalActions:false,recordings},null,2));
} finally {
  await browser.close();
  await db.end();
}
