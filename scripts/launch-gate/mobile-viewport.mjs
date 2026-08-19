import { chromium } from 'playwright';
const BASE='http://localhost:3100';
const [email,pw]=process.argv.slice(2);
const b=await chromium.launch({headless:true,executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
const p=await ctx.newPage();
await p.goto(BASE+'/login',{waitUntil:'domcontentloaded',timeout:15000});
await p.fill('input[type="email"]',email); await p.fill('input[type="password"]',pw);
await Promise.all([p.waitForURL(/\/today|\/setup/,{timeout:15000}).catch(()=>{}),p.click('button[type="submit"]')]);
await p.waitForTimeout(1500);
for(const path of ['/today','/pipeline','/subs']){
  await p.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:15000});
  await p.waitForTimeout(700);
  const of=await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
  await p.screenshot({path:'/tmp/e2e/mobile'+path.replace(/\//g,'_')+'.png'});
  console.log(`${of?'OVERFLOW':'ok'}  mobile ${path}: h-overflow=${of}`);
}
// marketing page mobile too
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
const mof=await p.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+2);
await p.screenshot({path:'/tmp/e2e/mobile_marketing.png'});
console.log(`${mof?'OVERFLOW':'ok'}  mobile /(marketing): h-overflow=${mof}`);
await b.close();
