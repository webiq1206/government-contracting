import { chromium } from 'playwright';
const BASE='http://localhost:3100';
const email=process.argv[2], pw=process.argv[3];
const browser=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await browser.newContext();
const page=await ctx.newPage();
// login
await page.goto(BASE+'/login',{waitUntil:'networkidle'});
await page.fill('input[type="email"]',email); await page.fill('input[type="password"]',pw);
await Promise.all([page.waitForURL(/\/today|\/setup/,{timeout:15000}).catch(()=>{}),page.click('button[type="submit"]')]);
await page.waitForTimeout(1200);
const pages=['/today','/pipeline','/subs','/settings','/settings/integrations','/settings/billing','/agents','/call-queue'];
const out=[];
for(const p of pages){
  const errs=[];
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  let status='?';
  try{ const r=await page.goto(BASE+p,{waitUntil:'domcontentloaded',timeout:20000}); status=r?r.status():'nav'; }catch(e){ status='ERR:'+e.message.slice(0,40); }
  await page.waitForTimeout(700);
  const url=page.url();
  const bounced=/\/login/.test(url)&&p!=='/login';
  // real console errors (ignore favicon/analytics noise + ERR_CONNECTION_RESET from prefetch cancels)
  const realErrs=errs.filter(e=>!/favicon|ERR_CONNECTION_RESET|Failed to load resource/i.test(e));
  out.push({p,status,bounced,errs:realErrs.length});
  console.log(`${status===200&&!bounced&&realErrs.length===0?'PASS':'CHECK'}  ${p}  http=${status} bounced=${bounced} console_errs=${realErrs.length}${realErrs.length?' :: '+realErrs[0].slice(0,80):''}`);
  page.removeAllListeners('console');
}
// mobile viewport render of the dashboard
const m=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
const mp=await m.newPage();
await mp.goto(BASE+'/login',{waitUntil:'networkidle'});
await mp.fill('input[type="email"]',email); await mp.fill('input[type="password"]',pw);
await Promise.all([mp.waitForURL(/\/today|\/setup/,{timeout:15000}).catch(()=>{}),mp.click('button[type="submit"]')]);
await mp.waitForTimeout(1200);
await mp.goto(BASE+'/today',{waitUntil:'domcontentloaded'});
await mp.waitForTimeout(800);
// horizontal overflow check (body must not scroll sideways on mobile)
const overflow=await mp.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
await mp.screenshot({path:'/tmp/e2e/mobile-today.png',fullPage:false});
console.log(`${overflow?'CHECK':'PASS'}  mobile /today: horizontal overflow = ${overflow}`);
console.log('\n==JSON=='+JSON.stringify(out));
await browser.close();
