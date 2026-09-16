import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const directory = 'public/marketing/';
const manifest = JSON.parse(readFileSync(directory+'hero-manifest.json','utf8'));
describe('complete homepage film',()=>{
  it('ships both complete encodings with fast-start metadata and matching hashes',()=>{
    for (const format of ['desktop','mobile']) {
      const asset = manifest.assets[format];
      const bytes = readFileSync(directory+asset.file);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(bytes.toString('ascii',4,8)).toBe('ftyp');
      expect(bytes.indexOf(Buffer.from('moov'))).toBeGreaterThan(0);
      expect(bytes.indexOf(Buffer.from('moov'))).toBeLessThan(bytes.indexOf(Buffer.from('mdat')));
      expect(asset.durationSeconds).toBeCloseTo(30,1);
      expect(asset.audio).toBe(false);
      expect(asset.bytes).toBeLessThan(format==='mobile'?3_000_000:5_000_000);
    }
    expect(manifest.assets.mobile.width).toBeLessThan(manifest.assets.mobile.height);
    expect(manifest.assets.desktop.width).toBeGreaterThan(manifest.assets.desktop.height);
    expect(createHash('sha256').update(readFileSync(directory+manifest.poster.file)).digest('hex')).toBe(manifest.poster.sha256);
  });
});
