/** Decode every published movie and preserve reproducible media QA evidence. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir='public/demos';
const manifest=JSON.parse(readFileSync(`${dir}/manifest.json`,'utf8'));
const results=[];
for(const [slug,formats] of Object.entries(manifest.assets))for(const [format,asset] of Object.entries(formats)){
  const path=`${dir}/${asset.file}`;
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_format','-show_streams','-of','json',path],{encoding:'utf8'}));
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),asset.sha256);
  const video=info.streams.find(s=>s.codec_type==='video');
  const audio=info.streams.find(s=>s.codec_type==='audio');
  assert.equal(video.codec_name,'h264');assert.equal(video.pix_fmt,'yuv420p');
  assert.equal(video.width,asset.width);assert.equal(video.height,asset.height);
  if(slug==='hero-preview')assert.equal(audio,undefined);else assert.equal(audio?.codec_name,'aac');
  execFileSync('ffmpeg',['-v','error','-threads','2','-i',path,'-f','null','-'],{stdio:'pipe'});
  let loudness;
  if(audio){
    const measure=spawnSync('ffmpeg',['-hide_banner','-i',path,'-vn','-af','loudnorm=print_format=json','-f','null','-'],{encoding:'utf8'});
    assert.equal(measure.status,0);
    const report=JSON.parse(measure.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
    loudness={integratedLUFS:Number(report.input_i),truePeakDBTP:Number(report.input_tp)};
    assert(loudness.integratedLUFS>=-18&&loudness.integratedLUFS<=-14,`Narration level: ${slug}`);
    assert(loudness.truePeakDBTP<=-.5,`Narration peak: ${slug}`);
  }
  results.push({slug,format,file:asset.file,sha256:asset.sha256,decoded:true,durationSeconds:Number(info.format.duration),width:video.width,height:video.height,videoCodec:video.codec_name,audioCodec:audio?.codec_name??null,loudness});
  console.log(`Verified ${slug} ${format}`);
}
writeFileSync('docs/redesign/evidence/recorded-media-validation.json',JSON.stringify({sourceCommit:manifest.sourceCommit,mediaVersion:manifest.version,scope:'Offline full-file decode, format, hash and loudness checks. Browser interaction is covered by the separate responsive audit; real-device playback and listening review are separate.',results},null,2)+'\n');
