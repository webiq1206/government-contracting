import { chromium } from "playwright";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const base="http://127.0.0.1:3100";
const out="artifacts/ui-audit";
mkdirSync(out,{recursive:true});
const ids=JSON.parse(readFileSync('/tmp/ui-fixtures.json','utf8'));
function walk(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):e.name==='page.tsx'?[join(dir,e.name)]:[]);}
const routes=walk('app').map(file=>({file,route:'/'+file.split('/').slice(1,-1).filter(s=>!s.startsWith('(')).join('/')})).filter(x=>!x.route.startsWith('/theme-qa'));
function resolve(route) {
  return route.replace('/opportunity/[id]',`/opportunity/${ids.opportunity}`).replace('/subs/[id]',`/subs/${ids.sub}`).replace('/contracts/[id]',`/contracts/${ids.contract}`).replace('/admin/accounts/[id]',`/admin/accounts/${ids.org}`).replace('[token]','invalid-audit-token');
}
const browser=await chromium.launch();
const results=[];
const failures=[];
const diagnostics=[];
function checkpoint() {
 writeFileSync(join(out,'results.json'),JSON.stringify({scope:'Synthetic browser regression; live integrations and production performance are not verified.',results,failures},null,2));
 writeFileSync(join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
}
try {
 for(const [device,width,height] of [['mobile',390,844],['tablet',820,1180],['desktop',1440,1000]]) {
  try {
  const ctx=await browser.newContext({viewport:{width,height},isMobile:device!=='desktop',hasTouch:device!=='desktop'});
  // Provider traffic is never part of this local UI regression.
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await ctx.newPage();
  page.on('pageerror',e=>diagnostics.push({device,error:e.message}));
  page.on('console',m=>{if(m.type()==='error')diagnostics.push({device,error:m.text()});});
  await page.goto(base+'/login');
  await page.getByLabel('Email',{exact:true}).fill('ui-owner@example.test');
  await page.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/today',{timeout:60000,waitUntil:'domcontentloaded'});
  if(device!=='desktop') {
    const trigger=page.getByRole('button',{name:'Open menu',exact:true});
    await trigger.click();
    const menu=page.getByRole('navigation',{name:'Main',exact:true});
    await menu.getByRole('button',{name:'Settings',exact:true}).click();
    await menu.getByRole('link',{name:'API Usage',exact:true}).first().waitFor();
    assert(await page.locator('main').evaluate(n=>n.inert),'Menu must isolate background');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('main')?.inert);
    assert(await trigger.evaluate(n=>n===document.activeElement),'Menu must restore focus');
  }
  for(const entry of routes) {
    const route=resolve(entry.route);
    const publicPage=!entry.file.includes('(dash)')&&!entry.file.includes('(account)');
    const target=publicPage?await ctx.browser().newContext({viewport:{width,height},isMobile:device!=='desktop',hasTouch:device!=='desktop'}):ctx;
    if(publicPage) await target.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
    const p=publicPage?await target.newPage():page;
    const errors=[]; const onError=e=>errors.push(e.message);p.on('pageerror',onError);
    const onConsole=m=>{if(m.type()==='error'&&/hydrati|cannot be a descendant|cannot contain|did not match/i.test(m.text())) errors.push(m.text());};
    p.on('console',onConsole);
    const record={route:entry.route,device,role:publicPage?'visitor':'owner',status:'not verified',errors};
    try {
      const response=await p.goto(base+route,{waitUntil:'networkidle',timeout:60000});
      record.http=response?.status();record.finalPath=new URL(p.url()).pathname;
      record.navigation=await p.evaluate(()=>{
        const nav=performance.getEntriesByType('navigation')[0];
        return nav?{responseMs:Math.round(nav.responseStart-nav.startTime),domMs:Math.round(nav.domContentLoadedEventEnd-nav.startTime),transferBytes:nav.transferSize}:null;
      });
      record.headings=await p.locator('h1').allTextContents();
      if(entry.route==='/opportunity/[id]') {
        const heading=await p.locator('h1').boundingBox();
        assert(heading&&heading.y>=0&&heading.y+heading.height<height,'Opportunity title must remain visible on arrival');
      }
      if(entry.route.endsWith('/api-usage')) await p.getByRole('region',{name:'Account spending controls'}).waitFor();
      const name=`${device}-${entry.route.replace(/[^a-z0-9]/gi,'_')||'home'}.png`;
      await p.screenshot({path:join(out,name),fullPage:true});record.screenshot=name;
      record.controls=await p.evaluate(()=>Array.from(document.querySelectorAll('input,select,textarea,button')).filter(n=>n.getClientRects().length&&!n.closest('[inert]')).map(n=>({tag:n.tagName,name:n.getAttribute('aria-label')||(n.labels?Array.from(n.labels).map(l=>l.textContent).join(' '):'')||n.textContent||n.getAttribute('title')||'',width:Math.round(n.getBoundingClientRect().width),height:Math.round(n.getBoundingClientRect().height)})));
      const scrolled=await p.evaluate(()=>{
        const candidates=Array.from(document.querySelectorAll('main,main *')).filter(n=>n.scrollHeight>n.clientHeight+30&&n.clientHeight>100&&/auto|scroll/.test(getComputedStyle(n).overflowY));
        const area=candidates.sort((a,b)=>b.clientHeight-a.clientHeight)[0];
        if(!area)return false;area.scrollTop=area.scrollHeight;return true;
      });
      if(scrolled) {record.bottomScreenshot=name.replace('.png','-bottom.png');await p.screenshot({path:join(out,record.bottomScreenshot)});}
      record.overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
      record.tabs=[];
      const tablists=p.getByRole('tablist');
      for(let group=0;group<await tablists.count();group++) {
        const list=tablists.nth(group);
        const labels=await list.getByRole('tab').allTextContents();
        for(let tab=0;tab<labels.length;tab++) {
          const control=list.getByRole('tab').nth(tab);
          await control.click();
          await p.waitForLoadState('networkidle');
          assert.equal(await control.getAttribute('aria-selected'),'true','Selected tab must identify itself');
          const screenshot=name.replace('.png',`-tabs-${group}-${tab}.png`);
          await p.screenshot({path:join(out,screenshot)});
          record.tabs.push({group,label:labels[tab],screenshot,status:'tab opened'});
        }
      }
      record.status=record.http>=500||errors.length||record.overflow?'needs review':'render captured';
      if(!publicPage&&record.finalPath==='/login') record.status='authentication failed';
      if(record.status!=='render captured') failures.push(record);
    } catch(e) {record.status='blocked';record.error=String(e.message);failures.push(record);}
    results.push(record);checkpoint();console.log(JSON.stringify({device,route:entry.route,status:record.status}));p.removeListener('pageerror',onError);p.removeListener('console',onConsole);
    if(publicPage) await target.close();
  }
  try {
  await page.goto(base+'/admin/accounts',{waitUntil:'networkidle'});
  const quickLook=page.getByRole('link',{name:'Quick look',exact:true}).first();
  const quickHref=await quickLook.getAttribute('href');
  const quickEvents=[];
  const quickBodies=[];
  const quickStart=Date.now();
  const onNavigation=frame=>{if(frame===page.mainFrame())quickEvents.push({elapsedMs:Date.now()-quickStart,navigation:frame.url()});};
  const onRequest=request=>{if(request.url().includes('/admin/accounts'))quickEvents.push({elapsedMs:Date.now()-quickStart,request:request.url(),method:request.method()});};
  const onResponse=response=>{
    if(!response.url().includes('/admin/accounts'))return;
    const entry={elapsedMs:Date.now()-quickStart,response:response.url(),status:response.status(),type:response.headers()['content-type']};
    quickEvents.push(entry);
    if(entry.type?.includes('text/x-component'))quickBodies.push(response.text().then(body=>{
      const file=device+'-quick-flight-'+quickBodies.length+'.txt';
      writeFileSync(join(out,file),body);entry.bodyFile=file;
    }).catch(error=>{entry.bodyError=String(error.message);}));
  };
  const onFailed=request=>{if(request.url().includes('/admin/accounts'))quickEvents.push({elapsedMs:Date.now()-quickStart,failed:request.url(),reason:request.failure()});};
  const onFinished=request=>{if(request.url().includes('/admin/accounts'))quickEvents.push({elapsedMs:Date.now()-quickStart,finished:request.url()});};
  page.on('framenavigated',onNavigation);page.on('request',onRequest);
  page.on('response',onResponse);page.on('requestfailed',onFailed);page.on('requestfinished',onFinished);
  const accountDrawer=page.getByRole(device==='desktop'?'complementary':'dialog',{name:'Record details',exact:true});
  try {
    await quickLook.click();
    await accountDrawer.waitFor();
    await page.screenshot({path:join(out,device+'-account-quick-look.png')});
    await page.keyboard.press('Escape');
    await accountDrawer.waitFor({state:'hidden'});
    await page.goBack(); await accountDrawer.waitFor();
    await page.goForward(); await accountDrawer.waitFor({state:'hidden'});
    assert.equal(quickEvents.filter(entry=>entry.request).length,0,'Read-only account peeks should reuse loaded rows without a server request');
  } finally {
    page.removeListener('framenavigated',onNavigation);page.removeListener('request',onRequest);
    page.removeListener('response',onResponse);page.removeListener('requestfailed',onFailed);page.removeListener('requestfinished',onFinished);
    await Promise.race([Promise.allSettled(quickBodies), new Promise(resolve=>setTimeout(resolve,5000))]);
    writeFileSync(join(out,device+'-quick-look-navigation.json'),JSON.stringify({href:quickHref,final:page.url(),events:quickEvents},null,2));
  }
  results.push({device,role:'owner',route:'/admin/accounts',status:'quick look, Escape, Back/Forward and zero additional account requests checked',screenshot:device+'-account-quick-look.png'});
  } catch(error) {
    failures.push({device,route:'/admin/accounts',status:'quick look blocked',error:String(error.stack ?? error.message)});
    checkpoint();
  }
  // A shared quick-look URL must also hydrate directly, without depending
  // on a previously opened table or changing streamed siblings' attributes.
  try {
    await page.goto(base+'/admin/accounts?peek='+ids.org,{waitUntil:'networkidle'});
    const directDrawer=page.getByRole(device==='desktop'?'complementary':'dialog',{name:'Record details',exact:true});
    await directDrawer.waitFor();
    assert.equal(await directDrawer.evaluate(n=>n.matches(':modal')),device!=='desktop','Only smaller-screen drawers should isolate the background');
    const box=await directDrawer.boundingBox();
    assert(box&&box.x>=0&&box.y>=0&&box.x+box.width<=width+2&&box.y+box.height<=height+2,'Drawer must fit the viewport');
    await page.screenshot({path:join(out,device+'-direct-quick-look.png')});
    await page.keyboard.press('Escape');
    await directDrawer.waitFor({state:'hidden'});
    results.push({device,role:'owner',route:'/admin/accounts?peek',status:'direct quick-look URL, responsive isolation and Escape checked'});
  } catch(error) {
    failures.push({device,route:'/admin/accounts?peek',status:'direct quick look blocked',error:String(error.stack ?? error.message)});checkpoint();
  }
  // Fault injection remains inside the disposable browser: no key is saved
  // and no provider test is sent outside this app.
  try {
    await page.goto(base+'/settings/integrations',{waitUntil:'networkidle'});
    const card=page.locator('#sam');
    const field=card.locator('input').first();
    await field.fill('audit-placeholder-not-a-real-key');
    let saves=0, tests=0;
    await page.route('**/api/integrations',async route=>{
      if(route.request().method()!=='POST')return route.continue();
      saves++;
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SQLSTATE secret-value-do-not-display'})});
    });
    await page.route('**/api/integrations/test',async route=>{
      tests++;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:false,message:'401 API key sk-ant-do-not-display'})});
    });
    await card.getByRole('button',{name:'Save',exact:true}).evaluate(button=>{button.click();button.click();});
    await card.getByRole('alert').waitFor();
    assert.equal(saves,1,'Repeated save must send only one request');
    assert.equal(tests,0,'Saving must not start a provider test');
    assert.equal(await field.inputValue(),'audit-placeholder-not-a-real-key','Failed save preserves entries');
    assert(!/SQLSTATE|secret-value/.test(await card.innerText()),'Raw diagnostics must stay hidden');
    await card.getByRole('button',{name:'Test connection',exact:true}).click();
    await card.getByText('The service rejected the connection details.',{exact:false}).waitFor();
    assert.equal(tests,1);
    assert(!(await card.innerText()).includes('sk-ant-do-not-display'));
    await card.getByRole('button',{name:'Refresh status',exact:true}).waitFor();
    await page.screenshot({path:join(out,device+'-integration-recovery.png')});
    await page.unroute('**/api/integrations');await page.unroute('**/api/integrations/test');
    results.push({device,route:'/settings/integrations',status:'save failure, duplicate clicks, draft preservation and rejected connection recovery checked without provider traffic'});
  } catch(error) {
    failures.push({device,route:'/settings/integrations',status:'integration workflow blocked',error:String(error.stack??error.message)});checkpoint();
  }
  // Filtering the automation feed never starts an automation.
  await page.goto(base+'/agents',{waitUntil:'networkidle'});
  assert.equal(await page.getByRole('button',{name:'Run now',exact:true}).count(),0,'Manual runs should be collapsed by default');
  const automationFilter=page.getByLabel('Filter by automation',{exact:true});
  assert.equal(await automationFilter.inputValue(),'','All automations should be the default');
  await automationFilter.selectOption('scoring-engine');
  await page.getByLabel('Filter the log by severity').selectOption('error');
  await page.getByLabel('Search Automation Health').fill('audit check');
  await automationFilter.locator('..').getByRole('button',{name:'Filter',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('agent')==='scoring-engine'&&url.searchParams.get('level')==='error'&&url.searchParams.get('q')==='audit check');
  await page.getByRole('link',{name:'Clear',exact:true}).click();
  await page.waitForURL(url=>url.pathname==='/agents'&&!url.search);
  assert.equal(await page.getByLabel('Filter by automation',{exact:true}).inputValue(),'');
  await page.getByText('Automation schedules and manual controls',{exact:true}).click();
  let manualRequests=0;
  const noManualRun=request=>{if(/\/api\/agents\/[^/]+\/run$/.test(request.url()))manualRequests++;};
  page.on('request',noManualRun);
  await page.getByRole('button',{name:'Run now',exact:true}).first().click();
  const runConfirmation=page.getByRole('dialog',{name:/^Run .+ now\?$/});
  await runConfirmation.getByText('This starts an additional run and may use paid API credits.',{exact:false}).waitFor();
  await runConfirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(manualRequests,0,'Cancel must not enqueue or spend API credits');
  page.removeListener('request',noManualRun);
  await page.getByText('Automation schedules and manual controls',{exact:true}).click();
  await page.getByLabel('Filter by automation',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:join(out,device+'-automation-filters.png')});
  results.push({device,role:'owner',route:'/agents',status:'automation filters, safe manual-run defaults and confirmation cancellation checked; no automation executed'});
  // Verify URL navigation and browser back preserve the selected destination.
  await page.goto(base+'/settings/api-usage');
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Company',exact:true}).click();
  await page.waitForURL('**/settings/profile');await page.goBack();await page.waitForURL('**/settings/api-usage');
  await page.goto(base+'/settings/profile',{waitUntil:'networkidle'});
  assert.equal(await page.getByRole('navigation',{name:'Breadcrumb',exact:true}).getByRole('link',{name:'Settings',exact:true}).getAttribute('href'),'/settings');
  await page.getByLabel('Legal name',{exact:true}).fill('Audit Company '+device);
  if(device!=='desktop') await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('link',{name:/^Today/}).click();
  const warning=page.getByRole('dialog',{name:'Leave without saving?',exact:true});
  await warning.waitFor();
  await page.screenshot({path:join(out,device+'-unsaved-dialog.png')});
  await warning.getByRole('button',{name:'Stay here',exact:true}).click();
  if(device!=='desktop') await page.keyboard.press('Escape');
  // A failed save must leave the form editable, with the entered data intact.
  await page.route('**/api/profile',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'internal audit failure'})}):r.continue());
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByText('Your company profile could not be saved.',{exact:false}).waitFor();
  assert.equal(await page.getByLabel('Legal name',{exact:true}).inputValue(),'Audit Company '+device);
  await page.unroute('**/api/profile');
  const saved=page.waitForResponse(r=>r.url()===base+'/api/profile'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  assert.equal((await saved).status(),200,'Owner can complete profile setup');
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await page.getByLabel('Legal name',{exact:true}).inputValue(),'Audit Company '+device);
  results.push({device,role:'owner',route:'/settings/profile',status:'setup save and unsaved navigation checked',screenshot:device+'-unsaved-dialog.png'});
  await page.goto(base+'/settings/api-usage',{waitUntil:'networkidle'});
  const spending=page.getByRole('region',{name:'Account spending controls'});
  await spending.getByRole('button',{name:'Change budget',exact:true}).click();
  await spending.getByLabel('Monthly budget in dollars').fill('125');
  const budgetSaved=page.waitForResponse(r=>r.url()===base+'/api/api-usage'&&r.request().method()==='POST');
  await spending.getByRole('button',{name:'Save budget',exact:true}).click();
  assert.equal((await budgetSaved).status(),200,'Owner can save spending limits');
  await spending.getByText('$125.00',{exact:true}).waitFor();
  for(const [button,status] of [['Pause API work','API work is paused'],['Resume API work','Spending protection is on']]) {
    await spending.getByRole('button',{name:button,exact:true}).click();
    await spending.getByRole('status').filter({hasText:status}).waitFor();
  }
  await page.route('**/api/api-usage?**',r=>r.fulfill({status:503,contentType:'text/plain',body:'upstream unavailable'}));
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('alert').filter({hasText:'Your latest usage could not be loaded'}).waitFor();
  await page.unroute('**/api/api-usage?**');
  await page.getByRole('button',{name:'Refresh usage',exact:true}).click();
  await page.getByRole('region',{name:'Account spending controls'}).waitFor();
  results.push({device,role:'owner',route:'/settings/api-usage',status:'budget save, pause/resume and outage recovery checked'});
  await ctx.close();
  const viewer=await browser.newContext({viewport:{width,height},isMobile:device!=="desktop",hasTouch:device!=="desktop"});
  await viewer.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const v=await viewer.newPage();
  await v.goto(base+'/login');
  await v.getByLabel('Email',{exact:true}).fill('ui-viewer@example.test');
  await v.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await v.getByRole('button',{name:'Sign in',exact:true}).click();
  await v.waitForURL('**/today',{timeout:60000,waitUntil:'domcontentloaded'});
  await v.goto(base+'/settings/api-usage',{waitUntil:'networkidle'});
  assert.equal(new URL(v.url()).pathname,'/settings/api-usage','Viewer session must be valid');
  await v.getByRole('region',{name:'Account spending controls'}).waitFor();
  assert.equal(await v.getByRole('button',{name:'Change budget',exact:true}).count(),0,'Viewer cannot edit budget');
  await v.screenshot({path:join(out,device+'-viewer-api-usage.png'),fullPage:true});
  const denied=await v.evaluate(async()=>{ const r=await fetch('/api/automation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused:true})});return {status:r.status,url:r.url,body:await r.text()}; });
  writeFileSync(join(out,device+'-permission.json'),JSON.stringify(denied));
  assert.equal(denied.status,403,'Viewer cannot pause automation');
  await v.goto(base+'/agents',{waitUntil:'networkidle'});
  await v.getByText('Automation schedules and manual controls',{exact:true}).click();
  assert.equal(await v.getByRole('button',{name:'Run now',exact:true}).count(),0,'Viewer must not be offered manual execution');
  const deniedRun=await viewer.request.post(base+'/api/agents/scoring-engine/run',{data:{}});
  assert.equal(deniedRun.status(),403,'Viewer must not enqueue a job');
  assert.equal(await v.getByRole('button',{name:/^(Pause|Resume) everything$/}).count(),0,'Viewer cannot operate automation controls');
  // Next can send HTTP 200 before a streamed notFound() finishes. The
  // rendered denial and absence of privileged content are the page contract.
  await v.goto(base+'/admin/accounts',{waitUntil:'networkidle'});
  await v.getByRole('heading',{name:'That page or record is unavailable',exact:true}).waitFor();
  assert.equal(await v.getByRole('heading',{name:'All accounts',exact:true}).count(),0,'Viewer cannot see platform account data');
  assert.equal(await v.getByRole('link',{name:'Quick look',exact:true}).count(),0,'Viewer cannot inspect platform accounts');
  results.push({device,role:'viewer',route:'/settings/api-usage',status:'permission checks passed',screenshot:device+'-viewer-api-usage.png'});
  await v.goto(base+'/more',{waitUntil:'networkidle'});
  await v.getByRole('button',{name:'Sign out',exact:true}).last().click();
  await v.waitForURL('**/login',{waitUntil:'domcontentloaded'});
  await v.goto(base+'/today',{waitUntil:'domcontentloaded'});
  assert.equal(new URL(v.url()).pathname,'/login','Signing out removes authenticated access');
  results.push({device,role:'viewer',route:'/more',status:'sign-out checked'});
  await v.goto(base+'/signup',{waitUntil:'networkidle'});
  await v.route('**/api/auth/signup',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SQLSTATE private diagnostic'})}));
  await v.getByLabel('Your name',{exact:true}).fill('Audit Applicant');
  await v.getByLabel('Company name',{exact:true}).fill('Audit Applicant Company');
  await v.getByLabel('Work email',{exact:true}).fill('ui-new@example.test');
  await v.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await v.getByRole('button',{name:/Start.*7-day free trial/}).click();
  await v.locator('form').getByRole('alert').waitFor();
  assert(!(await v.locator('form').getByRole('alert').innerText()).includes('SQLSTATE'),'Signup must hide technical diagnostics');
  assert(await v.getByRole('button',{name:/Start.*7-day free trial/}).isEnabled(),'Failed signup remains retryable');
  results.push({device,role:'visitor',route:'/signup',status:'service failure recovery checked; account creation not attempted'});
  await v.goto(base+'/forgot-password',{waitUntil:'networkidle'});
  let resetRequests=0;
  await v.route('**/api/auth/forgot-password',r=>{resetRequests++;return r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SQLSTATE private diagnostic'})});});
  await v.getByLabel('Email',{exact:true}).fill('ui-owner@example.test');
  await v.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await v.getByRole('alert').filter({hasText:'We could not confirm whether a reset link was sent'}).waitFor();
  assert.equal(resetRequests,1,'Repeated password-help submissions must send one request');
  assert.equal(await v.getByLabel('Email',{exact:true}).inputValue(),'ui-owner@example.test');
  assert(await v.getByRole('button',{name:'Try again',exact:true}).isEnabled());
  await v.unroute('**/api/auth/forgot-password');
  await v.route('**/api/auth/forgot-password',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,delivered:false})}));
  await v.getByRole('button',{name:'Try again',exact:true}).click();
  await v.getByRole('alert').filter({hasText:'A reset link was not sent'}).waitFor();
  await v.unroute('**/api/auth/forgot-password');
  await v.goto(base+'/reset-password?token=invalid-audit-token',{waitUntil:'networkidle'});
  await v.route('**/api/auth/reset-password',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SQLSTATE private diagnostic'})}));
  await v.getByLabel('New password',{exact:true}).fill('DisposableUiAudit456!');
  await v.getByLabel('Confirm password',{exact:true}).fill('DisposableUiAudit456!');
  await v.getByRole('button',{name:'Update password',exact:true}).click();
  await v.getByRole('alert').filter({hasText:'We could not confirm your password change'}).waitFor();
  assert(!(await v.locator('form').getByRole('alert').innerText()).includes('SQLSTATE'));
  await v.getByRole('link',{name:'Request a new reset link',exact:true}).waitFor();
  assert(await v.getByRole('button',{name:'Update password',exact:true}).isEnabled());
  await v.unroute('**/api/auth/reset-password');
  results.push({device,role:'visitor',route:'/forgot-password and /reset-password',status:'duplicate submission, unavailable delivery and password failure recovery checked; no email or password change performed'});
  // Public footer links must land on an existing section, including from a
  // different page. No signup or other write is performed here.
  await v.unroute('**/api/auth/signup');
  await v.goto(base+'/privacy',{waitUntil:'networkidle'});
  await v.getByRole('navigation',{name:'Product',exact:true}).getByRole('link',{name:'How it works',exact:true}).click();
  await v.waitForURL('**/#workflow');
  await v.locator('#workflow').waitFor();
  results.push({device,role:'visitor',route:'/privacy',status:'footer navigation to workflow checked'});
  await viewer.close();
  checkpoint();
  } catch(error) {
    failures.push({device,status:'workflow blocked',error:String(error.stack ?? error.message)});checkpoint();
    for(const [index,context] of browser.contexts().entries()) {
      for(const [tab,page] of context.pages().entries()) {
        await page.screenshot({path:join(out,`${device}-failure-${index}-${tab}.png`)}).catch(()=>{});
        writeFileSync(join(out,`${device}-failure-${index}-${tab}.json`),JSON.stringify({url:page.url(),text:await page.locator('body').innerText().catch(()=>'' )}));
      }
      await context.close();
    }
  }
 }
 } catch(error) {
 failures.push({status:'workflow blocked',error:String(error.stack ?? error.message)});
 for(const [index,context] of browser.contexts().entries()) {
  for(const [tab,page] of context.pages().entries()) {
   await page.screenshot({path:join(out,`failure-${index}-${tab}.png`)}).catch(()=>{});
   writeFileSync(join(out,`failure-${index}-${tab}.json`),JSON.stringify({url:page.url(),text:await page.locator('body').innerText().catch(()=>'' )}));
  }
 }
 process.exitCode=1;
} finally {
 const hydrationDiagnostics=diagnostics.filter(x=>/hydrati|Minified React error #41[89]|cannot be a descendant|did not match/i.test(x.error));
 if(hydrationDiagnostics.length) failures.push({status:'shell hydration errors',count:hydrationDiagnostics.length});
 writeFileSync(join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
 writeFileSync(join(out,'results.json'),JSON.stringify({scope:'Synthetic owner and visitor render checks. Not a production workflow sign-off.',results,failures},null,2));
 await browser.close();
}
console.log(JSON.stringify({captured:results.length,needsReview:failures.length}));
if(failures.length) process.exitCode=1;
