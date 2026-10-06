import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const base='http://127.0.0.1:3100';
const otherOrigin='http://127.0.0.1:3101';
const out='artifacts/ui-audit';
const ids=JSON.parse(readFileSync('/tmp/ui-fixtures.json','utf8'));
// A headed Chromium under Xvfb exercises its real PDF viewer. The default
// headless shell does not support PDF navigation/paint.
const browser=await chromium.launch({headless:false});
const evidence={sameOrigin:false,externalBlocked:false,authDenied:false,crossOrgDenied:false,headers:[]};
async function isolate(context) {
  await context.route('**/*',route=>new URL(route.request().url()).origin===base ? route.continue() : route.abort());
}
async function login(context,email) {
  const page=await context.newPage();
  await page.goto(base+'/login');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('DisposableUiAudit123!');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForURL('**/today',{waitUntil:'domcontentloaded'});
  return page;
}
async function painted(frame,color,path) {
  for(let attempt=0;attempt<60;attempt++) {
    const png=await frame.screenshot();
    const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let pixels=0;
    for(let i=0;i<data.length;i+=info.channels) {
      if(color==='red' ? data[i]>220&&data[i+1]<45&&data[i+2]<45 : data[i]<45&&data[i+1]<45&&data[i+2]>220) pixels++;
    }
    if(pixels>1500) { writeFileSync(path,png);return; }
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  await frame.screenshot({path});
  assert.fail(`The PDF page did not visibly paint its synthetic ${color} marker`);
}
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await isolate(context);
  const page=await login(context,'ui-owner@example.test');
  const pdfResponse=page.waitForResponse(r=>r.url().includes('/api/files/') && r.headers()['content-type']==='application/pdf');
  await page.goto(`${base}/opportunity/${ids.sourceAudit}/requirements`,{waitUntil:'networkidle'});
  const response=await pdfResponse;
  const headers=response.headers();
  assert.equal(response.status(),200);
  assert.equal(headers['content-security-policy'],"frame-ancestors 'self'");
  assert.equal(headers['x-frame-options'],'DENY','Global restriction remains inherited');
  assert.equal(headers['x-content-type-options'],'nosniff');
  assert.match(headers['cache-control'],/no-store/);
  evidence.headers.push({status:200,type:headers['content-type'],csp:headers['content-security-policy'],xfo:headers['x-frame-options']});
  const frame=page.locator('iframe');
  await frame.scrollIntoViewIfNeeded();
  await painted(frame,'red',`${out}/desktop-pdf-page-44.png`);
  await page.getByRole('button',{name:'Next requirement',exact:true}).click();
  assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=12`);
  await frame.scrollIntoViewIfNeeded();
  await painted(frame,'blue',`${out}/desktop-pdf-page-12.png`);
  evidence.sameOrigin=true;
  const html=await context.request.get(base+'/today');
  assert.equal(html.headers()['x-frame-options'],'DENY');
  assert.equal(html.headers()['content-security-policy'],undefined);

  const anonymous=await browser.newContext(); await isolate(anonymous);
  const denied=await anonymous.request.get(`${base}/api/documents/${ids.sourceDocs[1]}/open`,{maxRedirects:0});
  assert.equal(denied.status(),401);
  assert.equal((await anonymous.request.get(response.url(),{maxRedirects:0})).status(),401);
  evidence.authDenied=true; await anonymous.close();
  const tenant=await browser.newContext();await isolate(tenant);
  await login(tenant,'ui-setup@example.test');
  const foreign=await tenant.request.get(`${base}/api/documents/${ids.sourceDocs[1]}/open`,{maxRedirects:0});
  assert.equal(foreign.status(),404);
  assert.equal((await tenant.request.get(response.url(),{maxRedirects:0})).status(),404);
  evidence.crossOrgDenied=true;await tenant.close();

  // A different port is a different origin but the same cookie site. The
  // synthetic parent is fulfilled locally; no external website is contacted.
  const outside=await context.newPage();
  const errors=[]; outside.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  await outside.route(otherOrigin+'/frame-audit',route=>route.fulfill({contentType:'text/html',body:
    `<html><body><iframe title="External frame probe" src="${base}/api/documents/${ids.sourceDocs[1]}/open?page=44" width="900" height="700"></iframe></body></html>`}));
  const externalResponse=outside.waitForResponse(r=>r.url().includes('/api/files/') && r.headers()['content-type']==='application/pdf');
  await outside.goto(otherOrigin+'/frame-audit',{waitUntil:'networkidle'});
  assert.equal((await externalResponse).status(),200,'Owner session was valid; framing policy caused refusal');
  for(let attempt=0;attempt<40&&!errors.some(error=>/frame-ancestors/.test(error));attempt++) await new Promise(resolve=>setTimeout(resolve,100));
  assert(errors.some(error=>/frame-ancestors/.test(error)),'Other origins must be refused by CSP');
  evidence.externalBlocked=true;
  await outside.screenshot({path:`${out}/desktop-pdf-external-frame-blocked.png`});
  await context.close();
  console.log('PDF embedding: authenticated final 200 headers, real page 44/12 paint, auth/cross-org refusal, unchanged HTML denial, and external-origin frame refusal passed.');
} finally {
  writeFileSync(`${out}/pdf-embedding-results.json`,JSON.stringify(evidence,null,2));
  await browser.close();
}
