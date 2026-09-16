import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const directory=join(process.cwd(),'public/demos');
const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8'));
const slugs=['hero-preview','platform-walkthrough','pipeline','review','subs','communications','opportunity','activity'];
const seconds=(stamp:string)=>stamp.split(':').reduce((total,value)=>total*60+Number(value),0);
describe('final recorded demo assets',()=>{
  it('publishes current recorded interactions with honest sample provenance',()=>{
    expect(manifest.recordedInteractions).toBe(true);
    expect(manifest.sampleData).toBe(true);
    expect(manifest.externalActions).toBe(false);
    expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(manifest.assets).sort()).toEqual(slugs.toSorted());
  });
  for(const slug of slugs)it(`${slug} has both encodings, matching hashes, posters and timed captions`,()=>{
    for(const format of ['desktop','mobile']){
      const asset=manifest.assets[slug][format];
      const bytes=readFileSync(join(directory,asset.file));
      expect(bytes.toString('ascii',4,8)).toBe('ftyp');
      expect(bytes.indexOf(Buffer.from('moov'))).toBeGreaterThan(0);
      expect(bytes.indexOf(Buffer.from('moov'))).toBeLessThan(bytes.indexOf(Buffer.from('mdat')));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(asset.codec).toBe('h264');
      expect(asset.width).toBe(format==='mobile'?720:1600);
      expect(asset.height).toBe(format==='mobile'?1600:1000);
      const [min,max]=slug==='hero-preview'?[10,20]:slug==='platform-walkthrough'?[90,150]:[20,45];
      expect(asset.durationSeconds).toBeGreaterThanOrEqual(min);
      expect(asset.durationSeconds).toBeLessThanOrEqual(max);
      expect(existsSync(join(directory,`${slug}-${format}.jpg`))).toBe(true);
      const vtt=readFileSync(join(directory,`${slug}.vtt`),'utf8');
      const transcript=readFileSync(join(directory,`${slug}.txt`),'utf8');
      expect(vtt.startsWith('WEBVTT')).toBe(true);
      expect(transcript).toContain('No external sends');
      const cues=[...vtt.matchAll(/(\d\d:\d\d:\d\d\.\d{3}) --> (\d\d:\d\d:\d\d\.\d{3})/g)];
      expect(cues.length).toBeGreaterThan(0);
      let end=0;
      for(const cue of cues){const start=seconds(cue[1]);expect(start).toBeGreaterThanOrEqual(end-.002);end=seconds(cue[2]);expect(end).toBeGreaterThan(start);}
      expect(end).toBeLessThanOrEqual(asset.durationSeconds+.1);
    }
  });
});
