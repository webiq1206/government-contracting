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
  await page.goto(base+'/admin/accounts',{waitUntil:'networkidle'});
  const quickLook=page.getByRole('link',{name:'Quick look',exact:true}).first();
  const quickHref=await quickLook.getAttribute('href');
  const quickEvents=[];
  const onNavigation=frame=>{if(frame===page.mainFrame())quickEvents.push({navigation:frame.url()});};
  const onRequest=request=>{if(request.url().includes('/admin/accounts'))quickEvents.push({request:request.url(),method:request.method()});};
  page.on('framenavigated',onNavigation);page.on('request',onRequest);
  await quickLook.click();
  const accountDrawer=page.getByRole(device==='desktop'?'complementary':'dialog',{name:'Record details',exact:true});
  try { await accountDrawer.waitFor(); }
  finally {
    page.removeListener('framenavigated',onNavigation);page.removeListener('request',onRequest);
    writeFileSync(join(out,device+'-quick-look-navigation.json'),JSON.stringify({href:quickHref,final:page.url(),events:quickEvents},null,2));
  }
  await page.screenshot({path:join(out,device+'-account-quick-look.png')});
  await page.keyboard.press('Escape');
  await accountDrawer.waitFor({state:'hidden'});
  results.push({device,role:'owner',route:'/admin/accounts',status:'quick look and Escape checked',screenshot:device+'-account-quick-look.png'});
  // Verify URL navigation and browser back preserve the selected destination.
  await page.goto(base+'/settings/api-usage');
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Company',exact:true}).click();
  await page.waitForURL('**/settings/profile');await page.goBack();await page.waitForURL('**/settings/api-usage');
  await page.goto(base+'/settings/profile',{waitUntil:'networkidle'});
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
  await v.getByRole('alert').waitFor();
  assert(!(await v.getByRole('alert').innerText()).includes('SQLSTATE'),'Signup must hide technical diagnostics');
  assert(await v.getByRole('button',{name:/Start.*7-day free trial/}).isEnabled(),'Failed signup remains retryable');
  results.push({device,role:'visitor',route:'/signup',status:'service failure recovery checked; account creation not attempted'});
  await viewer.close();
  checkpoint();
  } catch(error) {
    failures.push({device,status:'workflow blocked',error:String(error.message)});checkpoint();
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
 failures.push({status:'workflow blocked',error:String(error.message)});
 for(const [index,context] of browser.contexts().entries()) {
  for(const [tab,page] of context.pages().entries()) {
   await page.screenshot({path:join(out,`failure-${index}-${tab}.png`)}).catch(()=>{});
   writeFileSync(join(out,`failure-${index}-${tab}.json`),JSON.stringify({url:page.url(),text:await page.locator('body').innerText().catch(()=>'' )}));
  }
 }
 process.exitCode=1;
} finally {
 writeFileSync(join(out,'diagnostics.json'),JSON.stringify(diagnostics,null,2));
 writeFileSync(join(out,'results.json'),JSON.stringify({scope:'Synthetic owner and visitor render checks. Not a production workflow sign-off.',results,failures},null,2));
 await browser.close();
}
console.log(JSON.stringify({captured:results.length,needsReview:failures.length}));
if(failures.length) process.exitCode=1;
