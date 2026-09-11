import {describe,it,expect} from 'vitest';
import {parseHTML} from 'linkedom';
import {revealEditorialTarget} from '../lib/editorial-nav';
describe('links into optional workflow detail',()=>{
 it('opens every containing disclosure while leaving unrelated sections closed',()=>{
  const {document}=parseHTML('<main><details id="readiness"><summary>Readiness</summary><details id="attention"><summary>Blockers</summary><button id="resolve">Resolve</button></details></details><details id="other"><summary>Other</summary></details></main>');
  revealEditorialTarget(document.getElementById('resolve') as unknown as HTMLElement);
  expect(document.getElementById('readiness')!.hasAttribute('open')).toBe(true);
  expect(document.getElementById('attention')!.hasAttribute('open')).toBe(true);
  expect(document.getElementById('other')!.hasAttribute('open')).toBe(false);
 });
 it('can target the disclosure itself and safely ignore an absent target',()=>{
  const {document}=parseHTML('<details id="attention"><summary>Blockers</summary></details>');
  revealEditorialTarget(document.getElementById('attention') as unknown as HTMLElement);
  expect(document.getElementById('attention')!.hasAttribute('open')).toBe(true);
  expect(()=>revealEditorialTarget(null)).not.toThrow();
 });
});
