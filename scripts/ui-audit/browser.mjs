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
try {
 for(const [device,width,height] of [['mobile',390,844],['tablet',820,1180],['desktop',1440,1000]]) {
  const ctx=await browser.newContext({viewport:{width,height},isMobile:device!=='desktop',hasTouch:device!=='desktop'});
  // Provider traffic is never part of this local UI regression.
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await ctx.newPage();
  await page.goto(base+'/login');
  await page.getByLabel('Email',{exact:true}).fill('ui-owner@example.test');
  await page.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/today',{timeout:60000});
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
    const record={route:entry.route,device,role:publicPage?'visitor':'owner',status:'not verified',errors};
    try {
      const response=await p.goto(base+route,{waitUntil:'networkidle',timeout:60000});
      record.http=response?.status();record.finalPath=new URL(p.url()).pathname;
      const name=`${device}-${entry.route.replace(/[^a-z0-9]/gi,'_')||'home'}.png`;
      await p.screenshot({path:join(out,name),fullPage:true});record.screenshot=name;
      record.overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
      record.status=record.http>=500||errors.length||record.overflow?'needs review':'render captured';
      if(!publicPage&&record.finalPath==='/login') record.status='authentication failed';
      if(record.status!=='render captured') failures.push(record);
    } catch(e) {record.status='blocked';record.error=String(e.message);failures.push(record);}
    results.push(record);p.removeListener('pageerror',onError);
    if(publicPage) await target.close();
  }
  // Verify URL navigation and browser back preserve the selected destination.
  await page.goto(base+'/settings/api-usage');
  await page.getByRole('navigation',{name:'Settings sections'}).getByRole('link',{name:'Company',exact:true}).click();
  await page.waitForURL('**/settings/profile');await page.goBack();await page.waitForURL('**/settings/api-usage');
  await ctx.close();
  const viewer=await browser.newContext({viewport:{width,height},isMobile:device!=="desktop",hasTouch:device!=="desktop"});
  await viewer.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  const v=await viewer.newPage();
  await v.goto(base+'/login');
  await v.getByLabel('Email',{exact:true}).fill('ui-viewer@example.test');
  await v.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await v.getByRole('button',{name:'Sign in',exact:true}).click();
  await v.waitForURL('**/today',{timeout:60000});
  await v.goto(base+'/settings/api-usage');
  assert.equal(await v.getByRole('button',{name:'Change budget',exact:true}).count(),0,'Viewer cannot edit budget');
  await v.screenshot({path:join(out,device+'-viewer-api-usage.png'),fullPage:true});
  const denied=await viewer.request.post(base+'/api/automation',{data:{paused:true}});
  assert.equal(denied.status(),403,'Viewer cannot pause automation');
  const admin=await v.goto(base+'/admin/accounts');
  assert.equal(admin.status(),404,'Viewer cannot access platform admin');
  results.push({device,role:'viewer',route:'/settings/api-usage',status:'permission checks passed',screenshot:device+'-viewer-api-usage.png'});
  await viewer.close();
 }
} finally {
 writeFileSync(join(out,'results.json'),JSON.stringify({scope:'Synthetic owner and visitor render checks. Not a production workflow sign-off.',results,failures},null,2));
 await browser.close();
}
console.log(JSON.stringify({captured:results.length,needsReview:failures.length}));
if(failures.length) process.exitCode=1;
