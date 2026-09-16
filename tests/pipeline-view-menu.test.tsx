import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PipelineViewMenu } from '@/components/pipeline-view-menu';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
let root:Root;let container:HTMLElement;
beforeEach(()=>{
  const {window}=parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('window',window);vi.stubGlobal('document',window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  container=window.document.querySelector('main')! as unknown as HTMLElement;root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());vi.unstubAllGlobals();});
it('closes the phone view menu after selecting a destination',async()=>{
  await act(async()=>root.render(<PipelineViewMenu view="lanes"/>));
  const details=container.querySelector('details')!;details.open=true;
  expect(container.querySelector('a[aria-current="page"]')?.textContent).toBe('Simple');
  await act(async()=>container.querySelector('a[href="/pipeline?view=list"]')!.dispatchEvent(new window.Event('click',{bubbles:true})));
  expect(details.open).toBe(false);
});
it('dismisses on Escape and outside pointer input',async()=>{
  await act(async()=>root.render(<PipelineViewMenu view="list"/>));
  const details=container.querySelector('details')!;details.open=true;
  const focus=vi.fn();container.querySelector('summary')!.focus=focus;
  await act(async()=>{const event=new window.Event('keydown',{bubbles:true,cancelable:true});Object.defineProperty(event,'key',{value:'Escape'});details.dispatchEvent(event);});
  expect(details.open).toBe(false);expect(focus).toHaveBeenCalledOnce();
  details.open=true;document.body.dispatchEvent(new window.Event('pointerdown',{bubbles:true}));
  expect(details.open).toBe(false);
});
