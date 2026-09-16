import assert from 'node:assert/strict';
import { join } from 'node:path';

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
