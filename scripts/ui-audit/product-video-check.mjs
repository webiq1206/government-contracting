import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Each homepage chapter has its own original recording and responsive player. */
export async function auditHomepageVideos(page, {device,width,out}) {
  const format=width<=640?'mobile':'desktop';
  const videos=page.locator('video[data-product-video]');
  assert.equal(await videos.count(),8,'All eight product tours are available on the homepage');
  const premature=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>/\/demos\/[^?]+\.mp4/.test(entry.name)).map(entry=>entry.name));
  assert.deepEqual(premature,[],'Product video bytes must not load before Play');
  const quick=page.locator('#quick-preview');
  if(await quick.evaluate(el=>el.open)) await quick.locator('summary').click();
  const explorer=page.locator('#interactive-workflow');
  if(await explorer.evaluate(el=>el.open)) await explorer.locator('summary').click();
  assert.equal(await page.locator('[data-feature-video]:visible').count(),3,'Only one tour per chapter occupies the page');
  let previous;
  for(const [section,slug] of [['platform','pipeline'],['platform','review'],['ai','subs'],['ai','communications'],['bid-review','opportunity'],['bid-review','activity']]) {
    const card=page.locator(`#${section} [data-feature-video="${slug}"]`);
    const chapter=card.locator('..').locator('..');
    await page.locator(`#tour-tab-${slug}`).click();
    await card.waitFor({state:'visible'});
    assert.equal(await chapter.locator('[data-feature-video]:visible').count(),1);
    const video=card.locator('video');
    assert.equal(await video.getAttribute('data-format'),format);
    assert.equal(await video.getAttribute('preload'),'none');
    assert.equal(await video.getAttribute('autoplay'),null);
    assert((await video.locator('source').getAttribute('src')).includes(`/demos/${slug}${format==='mobile'?'-mobile':''}.mp4?`));
    await video.scrollIntoViewIfNeeded();
    await video.evaluate(async el=>{el.textTracks[0].mode='showing';await el.play();});
    await page.waitForFunction(slug=>{
      const el=document.querySelector(`[data-feature-video="${slug}"] video`);
      return el&&el.videoWidth>0&&el.currentTime>.2&&el.textTracks[0].cues?.length>0;
    },slug);
    assert(await video.evaluate(el=>Math.abs(el.duration-20)<.2),'Complete 20-second feature tour');
    if(previous) assert(await previous.evaluate(el=>el.paused),'Only one product tour plays at a time');
    await video.evaluate(el=>{el.currentTime=7;});
    await page.waitForFunction(slug=>!document.querySelector(`[data-feature-video="${slug}"] video`).seeking,slug);
    await chapter.screenshot({path:join(out,`${device}-homepage-feature-${slug}.png`),animations:'disabled'});
    assert.equal(await card.locator('figcaption a').getAttribute('href'),`/demos/${slug}.txt`);
    previous=video;
  }
  // Switching by keyboard preserves focus, stops the hidden tour, and does not autoplay.
  const lastTab=page.locator('#tour-tab-activity');
  await lastTab.focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#tour-tab-opportunity').getAttribute('aria-selected'),'true');
  assert(await page.locator('#tour-tab-opportunity').evaluate(el=>el===document.activeElement));
  assert(await page.locator('#tour-activity video').evaluate(el=>el.paused));
  assert(await page.locator('#tour-opportunity video').evaluate(el=>el.paused));
  await page.keyboard.press('ArrowRight');
  assert.equal(await lastTab.getAttribute('aria-selected'),'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tour-tab-opportunity').getAttribute('aria-selected'),'true');
  for(const slug of ['pipeline','subs']) await page.locator(`#tour-tab-${slug}`).click();
  for(const size of (device==='mobile'?[{width:320,height:640},{width:844,height:390}]:[])) {
    await page.setViewportSize(size);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'Narrow and landscape chapters fit');
    const tab=page.locator('#tour-tab-review');
    await tab.click();
    assert(await page.locator('#tour-review').isVisible());
    const box=await tab.boundingBox();
    assert(box.width>=44&&box.height>=44,'Tour selectors have touch-sized targets');
    await page.locator('[data-chapter="discover"]').screenshot({path:join(out,`${device}-homepage-refined-${size.width}.png`),animations:'disabled'});
  }
  await page.setViewportSize({width,height:device==='mobile'?844:device==='tablet'?1180:1000});
  await page.locator('#tour-tab-pipeline').click();
  await quick.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert(await quick.evaluate(el=>el.open),'Preview opens with the keyboard');
  const preview=quick.locator('video');
  await preview.scrollIntoViewIfNeeded();
  await preview.evaluate(async el=>{await el.play();});
  await page.waitForFunction(()=>document.querySelector('#quick-preview video').currentTime>.2);
  assert.equal(await preview.getAttribute('data-format'),format);
  assert(await preview.evaluate(el=>Math.abs(el.duration-16)<.2));
  await quick.screenshot({path:join(out,`${device}-homepage-feature-quick-preview.png`)});
  await quick.locator('summary').click();
  await page.waitForFunction(()=>document.querySelector('#quick-preview video').paused);
  await explorer.locator('summary').focus();
  await page.keyboard.press('Enter');
  assert(await explorer.locator('.bco-workflow-demo').isVisible(),'Interactive workflow remains accessible');
  await explorer.locator('summary').click();
  assert(await page.locator('.bco-price-card > .bco-price').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=40),'Price has clear visual prominence');
  for(const heading of await page.locator('.bco-footer h2').all()) {
    assert(await heading.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)<=16),'Footer labels retain their compact hierarchy');
  }
  for(const selector of ['#workflow','#proof','#pricing','.bco-final-cta','.bco-footer']) {
    await page.locator(selector).screenshot({path:join(out,`${device}-homepage-refined-${selector.replace(/[.#]/g,'')}.png`),animations:'disabled'});
  }
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('video[data-product-video]')).every(video=>video.paused));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
}

/** Public native-media checks. No account, provider or third-party request. */
export async function auditProductVideos(page, {device,width,out}) {
  const videos=page.locator('video[data-product-video]');
  assert.equal(await videos.count(),7,'Main tour plus six focused workflows');
  const main=videos.first();
  assert.equal(await main.getAttribute('data-format'),width<=640?'mobile':'desktop');
  assert.equal(await main.getAttribute('preload'),'none');
  assert.equal(await main.getAttribute('autoplay'),null);
  const slowPattern='**/demos/platform-walkthrough*.mp4*';
  await page.route(slowPattern,async route=>{
    await new Promise(resolve=>setTimeout(resolve,300));
    await route.fallback();
  });
  await main.scrollIntoViewIfNeeded();
  await main.evaluate(async video=>{await video.play();});
  await page.waitForFunction(()=>document.querySelector('video[data-product-video]').currentTime>.3);
  await page.unrouteAll({behavior:'wait'});
  assert.equal(await main.evaluate(video=>video.error?.message??null),null);
  assert(await main.evaluate(video=>video.videoWidth>0&&video.videoHeight>0),'A real decoded frame is available');
  await main.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('video[data-product-video]').paused);
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>!document.querySelector('video[data-product-video]').paused);
  await main.evaluate(video=>{video.textTracks[0].mode='showing';video.currentTime=10;});
  await page.waitForFunction(()=>document.querySelector('video[data-product-video]').textTracks[0].cues?.length>0);
  await page.screenshot({path:join(out,`${device}-recorded-tour-playing.png`)});
  const next=videos.nth(1);
  await next.scrollIntoViewIfNeeded();
  await next.evaluate(async video=>{await video.play();});
  assert(await main.evaluate(video=>video.paused),'Prior tour pauses');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('video[data-product-video]')).every(v=>v.paused));

  const card=page.locator('article').filter({has:page.locator('source[src*="/demos/pipeline"]')});
  const pipeline=card.locator('video');
  const pattern='**/demos/pipeline*.mp4*';
  await page.route(pattern,route=>route.abort('failed'));
  try {
    await pipeline.scrollIntoViewIfNeeded();
    await pipeline.evaluate(video=>{video.load();void video.play().catch(()=>{});});
    await card.getByRole('alert').waitFor();
    assert.equal(await card.getByRole('alert').getByRole('link',{name:'Read transcript',exact:true}).getAttribute('href'),'/demos/pipeline.txt');
    await page.screenshot({path:join(out,`${device}-recorded-tour-fallback.png`)});
  } finally {await page.unroute(pattern);}
  await card.getByRole('button',{name:'Try video again',exact:true}).click();
  await pipeline.evaluate(async video=>{await video.play();});
  await page.waitForFunction(()=>document.querySelector('source[src*="/demos/pipeline"]').parentElement.currentTime>.2);
  assert.equal(await card.getByRole('alert').count(),0);
  await pipeline.evaluate(video=>video.pause());
}
