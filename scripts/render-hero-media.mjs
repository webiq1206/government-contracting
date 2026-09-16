import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const source = process.argv[2];
if (!source) throw new Error('Provide the original AI-Government-Procurement-Hero-30s.mp4');
const directory = resolve('public/marketing');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const approvedSourceHash = '42c4ef63c94c42bad5b8e274f82660b33237d16081dc7d314eb4e2001e3c5e16';
if (hash(source) !== approvedSourceHash) throw new Error('Use only the approved BrostCo hero film');
const probe = file => JSON.parse(execFileSync('ffprobe', ['-v','error','-show_format','-show_streams','-of','json',file], {encoding:'utf8'}));
const original = probe(source);
if (Math.abs(Number(original.format.duration)-30) > .1) throw new Error('Expected the complete 30-second original');
const encode = args => execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',source,...args], {stdio:'inherit'});
const codec = ['-an','-c:v','libx264','-preset','slow','-pix_fmt','yuv420p','-movflags','+faststart'];
encode([...codec,'-crf','25',`${directory}/hero-background.mp4`]);
const filters = ['[0:v]split=6'+Array.from({length:6},(_,i)=>`[in${i}]`).join('')];
const focalPoints = [.5,.28,.5,.5,.4,.73];
for (const [i,focus] of focalPoints.entries()) {
  filters.push(`[in${i}]trim=start=${i*5}:end=${(i+1)*5},setpts=PTS-STARTPTS,crop=404:720:${Math.floor(876*focus/2)*2}:0,scale=480:854:flags=lanczos[v${i}]`);
}
filters.push(Array.from({length:6},(_,i)=>`[v${i}]`).join('')+'concat=n=6:v=1:a=0[out]');
encode(['-filter_complex',filters.join(';'),'-map','[out]',...codec,'-crf','26',`${directory}/hero-background-mobile.mp4`]);
encode(['-frames:v','1','-q:v','2',`${directory}/hero-poster-full.jpg`]);
const assets = {};
for (const [format,file] of Object.entries({desktop:'hero-background.mp4',mobile:'hero-background-mobile.mp4'})) {
  const path = `${directory}/${file}`;
  const metadata = probe(path);
  const video = metadata.streams.find(stream=>stream.codec_type==='video');
  execFileSync('ffmpeg',['-v','error','-xerror','-i',path,'-f','null','-'],{stdio:'inherit'});
  assets[format] = {file,sha256:hash(path),bytes:Number(metadata.format.size),durationSeconds:Number(metadata.format.duration),width:video.width,height:video.height,codec:video.codec_name,audio:metadata.streams.some(stream=>stream.codec_type==='audio')};
}
const manifest = {
  project:'BrostCo',
  source:{file:basename(source),sha256:hash(source),durationSeconds:30,description:'Previously generated illustrative montage, recovered from the saved September 13 film. No new generation credits used.'},
  chapters:['AI computing','Government','Infrastructure','Logistics','Manufacturing','Aerospace'],
  mobileFocalPoints:focalPoints,
  assets,
  poster:{file:'hero-poster-full.jpg',sha256:hash(`${directory}/hero-poster-full.jpg`)},
};
writeFileSync(`${directory}/hero-manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
