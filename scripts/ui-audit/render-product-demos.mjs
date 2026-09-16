/** Edit original fixture recordings into branded, captioned desktop/phone tours.
 * Usage: node scripts/ui-audit/render-product-demos.mjs SOURCE_DIR [AUDIO_DIR]
 * Requires ffmpeg, ffprobe and the sharp dependency supplied by Next.js.
 * SOURCE_DIR must be an unmodified capture-product-demo CI artifact.
 * Audio directory: intro.mp3, outro.mp3 and one MP3 per scene slug.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = resolve(process.argv[2] || 'artifacts/ui-audit/product-demo');
const audio = resolve(process.argv[3] || 'scripts/demo-assets/narration');
const preview=process.env.DEMO_PREVIEW_FORMAT;
if(preview&&!['desktop','mobile'].includes(preview))throw Error('Unknown preview format');
const formats=preview?[preview]:['desktop','mobile'];
const out = join(root, preview?'artifacts/redesign/demo-preview':'public/demos');
const work = join(root, 'artifacts/redesign/edited-film');
mkdirSync(work,{recursive:true}); mkdirSync(out,{recursive:true});
const provenance = JSON.parse(readFileSync(join(source,'provenance.json'),'utf8'));
if (!provenance.recordedInteractions || provenance.externalActions !== false) throw Error('Verified fixture recordings required');
const script = JSON.parse(readFileSync(join(root,'scripts/ui-audit/product-demo-scenes.json'),'utf8'));
const fps=24;
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const soundFilter='loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000';
async function fitHeading(lines,maximum,size){
  while(size>=28){
    const widths=await Promise.all(lines.map(text=>sharp({text:{text:esc(text),font:`DejaVu Sans Bold ${size}`,dpi:72,rgba:true}}).metadata().then(m=>m.width)));
    if(widths.every(width=>width<=maximum))return size;
    size--;
  }
  throw Error(`Heading does not fit: ${lines.join(' ')}`);
}
function ff(args){execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});}
function probe(path){return JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path],{encoding:'utf8'}));}
function stamp(seconds){const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
function captions(slug,entries){
  // Sentence-level cues remain short and exactly match the spoken script.
  const cues=[];
  for(const {start,end,text,audioSlug} of entries){
    const sentences=text.match(/[^.!?]+[.!?]+/g)||[text];
    const detection=audioSlug?spawnSync('ffmpeg',['-hide_banner','-i',join(audio,`${audioSlug}.mp3`),'-af','silencedetect=noise=-32dB:d=0.16','-f','null','-'],{encoding:'utf8'}).stderr:'';
    const pauses=[...detection.matchAll(/silence_end: ([\d.]+)/g)].map(m=>Number(m[1]));
    const total=sentences.reduce((n,s)=>n+s.length,0);let at=start;
    let consumed=0;
    for(const sentence of sentences){consumed+=sentence.length;const target=start+(end-start)*consumed/total;
      const near=pauses.filter(p=>start+p>at+.7&&Math.abs(start+p-target)<.75).sort((a,b)=>Math.abs(start+a-target)-Math.abs(start+b-target))[0];
      const next=consumed===total?end:near==null?target:start+near;
      const words=sentence.trim().split(/\s+/);const lines=[''];
      for(const word of words){if((lines.at(-1)+' '+word).trim().length>48)lines.push(word);else lines[lines.length-1]+=(lines.at(-1)?' ':'')+word;}
      cues.push(`${stamp(at)} --> ${stamp(next)}\n${lines.join('\n')}\n`);at=next;}
  }
  writeFileSync(join(out,`${slug}.vtt`),'WEBVTT\n\n'+cues.join('\n'));
  writeFileSync(join(out,`${slug}.txt`),'BROSTCO | RECORDED PRODUCT TOUR\nReal navigation in a disposable sample workspace. Staged AI analysis, quotes and message history. No external sends.\n\n'+entries.map(e=>`${stamp(e.start)}\n${e.text}\n`).join('\n'));
}
const dimensions=format=>format==='mobile'?{w:720,h:1600,x:30,y:212,vw:660,vh:1280}:{w:1600,h:1000,x:460,y:144,vw:1080,vh:760};
async function frame(scene,format){
  const {w,h,x,y,vw,vh}=dimensions(format);const mobile=format==='mobile';
  const title=scene.title.split('\n');
  const titleX=mobile?32:62;const titleY=mobile?111:251;
  const titleSize=await fitHeading(title,mobile?w-titleX-32:x-titleX-24,mobile?42:44);
  const points=mobile?'':scene.points.map((p,i)=>`<circle cx="69" cy="${432+i*65}" r="4" fill="#92d3c4"/><text x="87" y="${439+i*65}" font-size="18" fill="#cadcdb">${esc(p)}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0b171f"/><stop offset="1" stop-color="#12373b"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <path d="M0 ${h-65}H${w}" stroke="#355559"/>
    <g font-family="DejaVu Sans, sans-serif"><text x="${mobile?32:62}" y="${mobile?40:62}" fill="#f4f6f6" font-size="${mobile?22:30}" letter-spacing="3">BROSTCO</text>
    <text x="${w-(mobile?32:62)}" y="${mobile?40:57}" text-anchor="end" fill="#a3c5c2" font-size="${mobile?14:16}">SAMPLE WORKSPACE · RECORDED</text>
    <text x="${titleX}" y="${mobile?76:179}" fill="#97dacb" font-size="${mobile?14:16}" letter-spacing="2">${esc(scene.chapter)}</text>
    ${title.map((s,i)=>`<text x="${titleX}" y="${titleY+i*(titleSize+12)}" fill="#ffffff" font-size="${titleSize}" font-weight="bold">${esc(s)}</text>`).join('')}
    ${points}
    <rect x="${x-2}" y="${y-2}" width="${vw+4}" height="${vh+4}" rx="12" fill="#6d9694"/>
    <text x="${mobile?32:62}" y="${h-24}" fill="#bdcecf" font-size="${mobile?14:17}">Real interface. Sample records. No external sends.</text></g></svg>`;
  const path=join(work,`${scene.slug}-${format}-frame.png`);await sharp(Buffer.from(svg)).png().toFile(path);return path;
}
const rendered={}; const narrationDurations={};
for (const scene of script.scenes) {
  const sound=join(audio,`${scene.slug}.mp3`);
  if(!existsSync(sound)) throw Error(`Missing narration: ${scene.slug}`);
  const audioDuration=Number(probe(sound).format.duration);narrationDurations[scene.slug]=audioDuration;
  if(audioDuration>22) throw Error(`Narration exceeds readable scene duration: ${scene.slug} ${audioDuration}`);
  const sceneDuration=Math.max(20,Math.ceil(audioDuration+1));
  rendered[scene.slug]={duration:sceneDuration,formats:{}};
  for (const format of formats) {
    const rec=provenance.recordings.find(x=>x.slug===scene.slug&&x.format===format);
    if(!rec||rec.events.length<2) throw Error(`Incomplete recorded scene ${scene.slug} ${format}`);
    const recording=join(source,rec.file);const meta=probe(recording);
    if(Number(meta.format.duration)<rec.start+rec.duration-.75)throw Error(`Truncated recording ${rec.file}`);
    const {w,h,x,y,vw,vh}=dimensions(format);const bg=await frame(scene,format);
    const dest=join(work,`${scene.slug}-${format}-body.mp4`);
    // Retain the complete phone viewport: important controls must not be cropped.
    const crop='';
    const filters=`[1:v]${crop}scale=${vw}:${vh}:force_original_aspect_ratio=decrease,pad=${vw}:${vh}:(ow-iw)/2:(oh-ih)/2:color=0xf4f6f6,setsar=1,tpad=stop_mode=clone:stop_duration=${sceneDuration},trim=duration=${sceneDuration},setpts=PTS-STARTPTS[ui];[0:v][ui]overlay=${x}:${y}:shortest=1,drawbox=x=0:y=${h-5}:w='iw':h=5:color=0x183c40:t=fill,fade=t=in:d=0.3,fade=t=out:st=${sceneDuration-.3}:d=0.3,format=yuv420p[v];[2:a]${soundFilter},adelay=450|450,apad,atrim=duration=${sceneDuration}[a]`;
    ff(['-loop','1','-framerate',String(fps),'-i',bg,'-ss',String(rec.start),'-i',recording,'-i',sound,'-filter_complex',filters,'-map','[v]','-map','[a]','-t',String(sceneDuration),'-r',String(fps),'-c:v','libx264','-threads','2','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',dest]);
    rendered[scene.slug].formats[format]={path:dest,source:rec.file,sourceSha256:hash(recording),captureStartSeconds:rec.start,events:rec.events};
    const published=join(out,`${scene.slug}${format==='mobile'?'-mobile':''}.mp4`);
    copyFileSync(dest,published);
    ff(['-ss','1','-i',dest,'-frames:v','1','-q:v','2',join(out,`${scene.slug}-${format}.jpg`)]);
    console.log(`Edited ${scene.slug} ${format}`);
  }
  captions(scene.slug,[{start:.45,end:.45+audioDuration,text:scene.narration,audioSlug:scene.slug}]);
}
const bookends={};
for(const slug of ['intro','outro']){
  const sound=join(audio,`${slug}.mp3`);const duration=Number(probe(sound).format.duration);
  bookends[slug]={duration:Math.ceil(duration+1.2),audioDuration:duration,formats:{}};
  for(const format of formats){
    const {w,h}=dimensions(format);const phone=format==='mobile';
    const left=phone?48:140;
    const title=slug==='intro'?['From opportunity','to informed action.']:['Your rules.','Your final review.'];
    const size=await fitHeading(title,w-left*2,phone?60:88);
    const subtitle=slug==='intro'?['Government contracting, connected.','A recorded tour with sample data.']:['Explore the connected workspace.','Start your free trial at brostco.com'];
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#0b171f"/><stop offset="1" stop-color="#12373b"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${w}" cy="${h*.36}" r="${w*.4}" stroke="#285153" stroke-width="2" fill="none"/><circle cx="${w}" cy="${h*.36}" r="${w*.25}" stroke="#285153" stroke-width="2" fill="none"/><g font-family="DejaVu Sans, sans-serif"><text x="${left}" y="${phone?140:145}" fill="#a3d9ce" font-size="26" letter-spacing="6">BROSTCO</text>${title.map((s,i)=>`<text x="${left}" y="${(phone?410:420)+i*(size+25)}" fill="#ffffff" font-size="${size}" font-weight="bold">${esc(s)}</text>`).join('')}${subtitle.map((s,i)=>`<text x="${left}" y="${(phone?685:690)+i*44}" fill="#bed2d1" font-size="${phone?24:28}">${esc(s)}</text>`).join('')}<rect x="${left}" y="${h-170}" width="72" height="5" fill="#9adaca"/><text x="${left}" y="${h-100}" fill="#93b1b1" font-size="${phone?17:21}">Real interface. Sample records. No external sends.</text></g></svg>`;
    const bg=join(work,`${slug}-${format}.png`);await sharp(Buffer.from(svg)).png().toFile(bg);
    const path=join(work,`${slug}-${format}.mp4`);const length=bookends[slug].duration;
    ff(['-loop','1','-framerate',String(fps),'-i',bg,'-i',sound,'-vf',`fade=t=in:d=0.35,fade=t=out:st=${length-.4}:d=0.4,format=yuv420p`,'-af',`${soundFilter},adelay=450|450,apad,atrim=duration=${length}`,'-t',String(length),'-r',String(fps),'-c:v','libx264','-threads','2','-preset','fast','-crf','23','-c:a','aac','-b:a','128k','-movflags','+faststart',path]);
    bookends[slug].formats[format]=path;
  }
}
// Six connected chapters, with intentional cut-to-black transitions. Each
// chapter retains actual interaction timing. No speed-up or invented cursor.
let timeline=bookends.intro.duration;const entries=[{start:.45,end:.45+bookends.intro.audioDuration,text:script.intro,audioSlug:'intro'}];
for(const scene of script.scenes){entries.push({start:timeline+.45,end:timeline+.45+narrationDurations[scene.slug],text:scene.narration,audioSlug:scene.slug});timeline+=rendered[scene.slug].duration;}
entries.push({start:timeline+.45,end:timeline+.45+bookends.outro.audioDuration,text:script.outro,audioSlug:'outro'});timeline+=bookends.outro.duration;
for(const format of formats){
  const paths=[bookends.intro.formats[format],...script.scenes.map(s=>rendered[s.slug].formats[format].path),bookends.outro.formats[format]];
  const list=join(work,`main-${format}.ffconcat`);writeFileSync(list,paths.map(p=>`file '${p}'`).join('\n'));
  const dest=join(out,`platform-walkthrough${format==='mobile'?'-mobile':''}.mp4`);
  ff(['-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',dest]);
  ff(['-ss',String(bookends.intro.duration+1),'-i',dest,'-frames:v','1','-q:v','2',join(out,`platform-walkthrough-${format}.jpg`)]);
  // Compact, silent introduction shows actual list and opportunity navigation.
  const preview=rendered.pipeline.formats[format].path;
  ff(['-i',preview,'-t','16','-an','-c:v','copy','-movflags','+faststart',join(out,`hero-preview${format==='mobile'?'-mobile':''}.mp4`)]);
  ff(['-ss','1','-i',preview,'-frames:v','1','-q:v','2',join(out,`hero-preview-${format}.jpg`)]);
}
captions('platform-walkthrough',entries);
captions('hero-preview',[{start:0,end:16,text:'BrostCo opportunity workflow. Real navigation with sample data. Switch to a focused list and inspect the connected opportunity. No external actions.'}]);
const assets={};
for(const slug of ['platform-walkthrough','hero-preview',...script.scenes.map(s=>s.slug)]){
  assets[slug]={};
  for(const format of formats){
    const file=`${slug}${format==='mobile'?'-mobile':''}.mp4`;const info=probe(join(out,file));const stream=info.streams.find(s=>s.codec_type==='video');
    assets[slug][format]={file,durationSeconds:Number(info.format.duration),width:stream.width,height:stream.height,codec:stream.codec_name,sha256:hash(join(out,file))};
  }
}
writeFileSync(join(out,'manifest.json'),JSON.stringify({version:'2026-09-16-recorded',type:'edited_recorded_workflows',sampleData:true,recordedInteractions:true,externalActions:false,narration:'Synthetic narration; script in scripts/ui-audit/product-demo-scenes.json',sourceCommit:provenance.sourceCommit,sourceRecordings:rendered,assets},(_,value)=>typeof value==='string'&&value.startsWith(work)?value.replace(work,'editing-intermediates'):value,2)+'\n');
console.log(`Completed ${Object.keys(assets).length} demos in ${formats.length} formats; main duration ${timeline}s`);
