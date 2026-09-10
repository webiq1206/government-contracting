import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultCompanyProfile } from "../lib/domain/default-profile";
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()}),usePathname:()=>'/settings/profile',useSearchParams:()=>new URLSearchParams()}));
const {ProfileEditor}=await import('../components/profile-editor');
describe('company setup',()=>{
 it('offers a blank legal name and keeps optional sections collapsed',()=>{
  const profile={...defaultCompanyProfile({legalName:'',email:'',ownerName:null}),small_business:false};
  const html=renderToStaticMarkup(<ProfileEditor json={profile}/>);
  expect(html).toContain('Legal name');expect(html).toContain('Save profile');
  expect(html.match(/<details open=""/g)?.length).toBe(1);
  expect(html).toContain('Eligibility');expect(html).toContain('Target work');
  expect(html).not.toContain('type="checkbox" checked=""');
 });
});
