import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base='http://127.0.0.1:3100';
const otherOrigin='http://127.0.0.1:3101';
const out='artifacts/ui-audit';
mkdirSync(out,{recursive:true});
const ids=JSON.parse(readFileSync('/tmp/ui-fixtures.json','utf8'));
// A headed Chromium under Xvfb exercises its real PDF viewer. The default
// headless shell does not support PDF navigation/paint.
const browser=await chromium.launch({headless:false});
const evidence={sameOrigin:false,externalBlocked:false,authDenied:false,crossOrgDenied:false,headers:[],blockedRequests:[],failedRequests:[],console:[],frames:[]};
let diagnosticPage;
let externalPage;
function checkpoint() { writeFileSync(`${out}/pdf-embedding-results.json`,JSON.stringify(evidence,null,2)); }
async function isolate(context) {
  context.on('requestfailed',request=>evidence.failedRequests.push({url:request.url(),error:request.failure()?.errorText}));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    // These are bundled Chromium resources, not network destinations. Blocking
    // them disables the real PDF viewer while leaving a misleading blank frame.
    const nativePdfResource=(url.protocol==='chrome-extension:' && url.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai') ||
      (url.protocol==='chrome:' && url.hostname==='resources');
    if(url.origin===base || nativePdfResource) return route.continue();
    evidence.blockedRequests.push(route.request().url()); return route.abort();
  });
}
// Exercise the browser's real session-cookie handling on loopback. The separate
// APIRequestContext does not send this production-mode Secure cookie over HTTP.
async function browserGet(page,url,includeBody=false) {
  assert.equal(new URL(url).origin,base);
  return page.evaluate(async ({url,includeBody})=>{
    const response=await fetch(url,{credentials:'same-origin',redirect:'manual',cache:'no-store'});
    return {status:response.status,headers:Object.fromEntries(response.headers),
      bytes:includeBody ? Array.from(new Uint8Array(await response.arrayBuffer())) : undefined};
  },{url,includeBody});
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
  const page=await login(context,'ui-owner@example.test'); diagnosticPage=page;
  page.on('console',message=>evidence.console.push({type:message.type(),text:message.text()}));
  evidence.nativePdf=await page.evaluate(()=>({enabled:navigator.pdfViewerEnabled,plugins:Array.from(navigator.plugins).map(plugin=>plugin.name)}));
  evidence.browser=browser.version();
  const pdfResponse=page.waitForResponse(r=>r.url().includes('/api/files/') && r.headers()['content-type']==='application/pdf');
  await page.goto(`${base}/opportunity/${ids.sourceAudit}/requirements`,{waitUntil:'networkidle'});
  const response=await pdfResponse;
  const headers=response.headers();
  assert.equal(new URL(response.url()).origin,base);
  evidence.finalUrl=response.url();
  const direct=await browserGet(page,response.url(),true);
  assert.equal(direct.status,200);
  const bytes=Buffer.from(direct.bytes);
  evidence.document={bytes:bytes.length,pages:(await PDFDocument.load(bytes)).getPageCount()};
  writeFileSync(`${out}/pdf-fixture-source.pdf`,bytes);
  assert.equal(evidence.document.pages,50);
  assert.equal(response.status(),200);
  assert.equal(headers['content-security-policy'],"frame-ancestors 'self'");
  assert.equal(headers['x-frame-options'],'DENY','Global restriction remains inherited');
  assert.equal(headers['x-content-type-options'],'nosniff');
  assert.match(headers['cache-control'],/no-store/);
  evidence.headers.push({status:200,type:headers['content-type'],csp:headers['content-security-policy'],xfo:headers['x-frame-options']});
  const frame=page.locator('iframe');
  evidence.requestedSource=await frame.getAttribute('src');
  await frame.scrollIntoViewIfNeeded();
  await painted(frame,'red',`${out}/desktop-pdf-page-44.png`);
  await page.getByRole('button',{name:'Next requirement',exact:true}).click();
  assert.equal(await frame.getAttribute('src'),`/api/documents/${ids.sourceDocs[1]}/open?page=12`);
  await frame.scrollIntoViewIfNeeded();
  await painted(frame,'blue',`${out}/desktop-pdf-page-12.png`);
  evidence.sameOrigin=true;
  checkpoint();
  const html=await browserGet(page,base+'/today');
  assert.equal(html.status,200);
  assert.equal(html.headers['x-frame-options'],'DENY');
  assert.equal(html.headers['content-security-policy'],undefined);

  const anonymous=await browser.newContext(); await isolate(anonymous);
  const visitor=await anonymous.newPage();await visitor.goto(base+'/login');
  const denied=await browserGet(visitor,`${base}/api/documents/${ids.sourceDocs[1]}/open`);
  assert.equal(denied.status,401);
  assert.equal((await browserGet(visitor,response.url())).status,401);
  evidence.authDenied=true; await anonymous.close();
  const tenant=await browser.newContext();await isolate(tenant);
  const tenantPage=await login(tenant,'ui-setup@example.test');
  const foreign=await browserGet(tenantPage,`${base}/api/documents/${ids.sourceDocs[1]}/open`);
  assert.equal(foreign.status,404);
  assert.equal((await browserGet(tenantPage,response.url())).status,404);
  evidence.crossOrgDenied=true;await tenant.close();
  checkpoint();

  // A different port is a different origin but the same cookie site. The
  // synthetic parent is fulfilled locally; no external website is contacted.
  const outside=await context.newPage(); externalPage=outside;
  const errors=[]; evidence.externalConsole=errors;
  outside.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
  // CSP-refused navigations may omit Playwright's ordinary response event.
  // Observe Chromium's actual network receipt without replacing the response.
  const network=await context.newCDPSession(outside);
  await network.send('Network.enable');
  const requests=new Map(); const receipts=[]; evidence.externalReceipts=receipts;
  evidence.externalRequests=[];
  network.on('Network.requestWillBeSent',event=>{
    requests.set(event.requestId,event.request.url);
    evidence.externalRequests.push({requestId:event.requestId,url:event.request.url});
  });
  network.on('Network.responseReceivedExtraInfo',event=>{
    const headers=Object.fromEntries(Object.entries(event.headers).map(([key,value])=>[key.toLowerCase(),value]));
    receipts.push({requestId:event.requestId,status:event.statusCode,type:headers['content-type'],
      csp:headers['content-security-policy'],xfo:headers['x-frame-options']});
  });
  evidence.externalFailures=[];
  network.on('Network.loadingFailed',event=>evidence.externalFailures.push({url:requests.get(event.requestId),error:event.errorText,blockedReason:event.blockedReason}));
  await outside.route(otherOrigin+'/frame-audit',route=>route.fulfill({contentType:'text/html',body:
    `<html><body><iframe title="External frame probe" src="${base}/api/documents/${ids.sourceDocs[1]}/open?page=44" width="900" height="700"></iframe></body></html>`}));
  await outside.goto(otherOrigin+'/frame-audit',{waitUntil:'domcontentloaded',timeout:10000});
  const pdfReceipt=()=>receipts.find(receipt=>receipt.status===200&&receipt.type==='application/pdf'&&requests.get(receipt.requestId)?.startsWith(base+'/api/files/'));
  for(let attempt=0;attempt<100&&(!pdfReceipt()||!errors.some(error=>/frame-ancestors/.test(error)));attempt++) await new Promise(resolve=>setTimeout(resolve,100));
  for(const receipt of receipts) receipt.url=requests.get(receipt.requestId);
  checkpoint();
  assert(pdfReceipt(),'Actual network receipt must prove the owner session received a final 200 PDF');
  assert.equal(pdfReceipt().csp,"frame-ancestors 'self'");
  assert(errors.some(error=>/frame-ancestors/.test(error)),'Other origins must be refused by CSP');
  evidence.externalBlocked=true;
  await outside.screenshot({path:`${out}/desktop-pdf-external-frame-blocked.png`});
  await context.close();
  console.log('PDF embedding: authenticated final 200 headers, real page 44/12 paint, auth/cross-org refusal, unchanged HTML denial, and external-origin frame refusal passed.');
} finally {
  if(diagnosticPage&&!diagnosticPage.isClosed()) {
    evidence.frames=await Promise.all(diagnosticPage.frames().map(async frame=>({url:frame.url(),parent:frame.parentFrame()?.url(),
      dom:await frame.evaluate(()=>({contentType:document.contentType,title:document.title,text:document.body?.innerText?.slice(0,500),
        media:Array.from(document.querySelectorAll('iframe,embed,object')).map(node=>({tag:node.tagName,src:node.getAttribute('src'),type:node.getAttribute('type'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}))})).catch(error=>({error:String(error)}))})));
    await diagnosticPage.screenshot({path:`${out}/desktop-pdf-diagnostic-page.png`}).catch(()=>{});
  }
  if(externalPage&&!externalPage.isClosed()) await externalPage.screenshot({path:`${out}/desktop-pdf-external-diagnostic.png`}).catch(()=>{});
  checkpoint();
  await browser.close();
}
