import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  owner: vi.fn(), auth: vi.fn(), token: vi.fn(), signedUrl: vi.fn(), download: vi.fn(), mime: vi.fn(),
}));
vi.mock("@/lib/org-guard", () => ({ requireOrgContext: mocks.auth }));
vi.mock("@/lib/domain/file-ownership", () => ({ orgIdForStorageKey: mocks.owner }));
vi.mock("@/lib/integrations/storage", () => ({ verifyFileToken: mocks.token,
  storage: {signedUrl: mocks.signedUrl, download: mocks.download, getMime: mocks.mime} }));
import { GET } from "@/app/api/files/[...path]/route";
const call = (key = "orgs/owner/source.pdf", token = false) => GET(new Request(`https://brostco.test/api/files/${key}${token ? '?exp=123&sig=synthetic' : ''}`), {params: Promise.resolve({path: key.split('/')})});
beforeEach(() => {
  vi.resetAllMocks(); mocks.owner.mockResolvedValue("owner"); mocks.auth.mockResolvedValue({orgId: "owner"});
  mocks.token.mockReturnValue(false); mocks.signedUrl.mockResolvedValue(null);
  mocks.download.mockResolvedValue(Buffer.from('%PDF-1.4\nSynthetic test bytes')); mocks.mime.mockResolvedValue('application/pdf');
});
describe("authenticated inline PDF framing", () => {
  it("allows only same-origin embedding after the signed-in owner check", async () => {
    const res = await call();
    expect(res.status).toBe(200); expect(mocks.auth).toHaveBeenCalledOnce();
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('inline;');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it.each([['source.html','text/html','<html>stored file</html>'],['source.txt','text/plain','saved text'],['source.pdf','application/pdf','<html>mislabelled file</html>']])('does not relax framing for %s without PDF bytes', async (name,mime,bytes) => {
    mocks.mime.mockResolvedValue(mime); mocks.download.mockResolvedValue(Buffer.from(bytes));
    expect((await call(`orgs/owner/${name}`)).headers.has('content-security-policy')).toBe(false);
  });
  it("keeps bearer-only file access under the global framing denial", async () => {
    mocks.token.mockReturnValue(true); const res = await call(undefined,true);
    expect(res.status).toBe(200); expect(mocks.auth).not.toHaveBeenCalled();
    expect(res.headers.has('content-security-policy')).toBe(false);
  });
  it("preserves authentication refusal before reading bytes", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({error:'Unauthorized'},{status:401}));
    expect((await call()).status).toBe(401); expect(mocks.download).not.toHaveBeenCalled();
  });
  it("does not expose another organization's document", async () => {
    mocks.auth.mockResolvedValue({orgId:'other'}); const res=await call();
    expect(res.status).toBe(404); expect(mocks.download).not.toHaveBeenCalled();
    expect(res.headers.has('content-security-policy')).toBe(false);
  });
  it("does not claim control over the headers of an external storage redirect", async () => {
    mocks.signedUrl.mockResolvedValue('https://storage.example.test/controlled-synthetic.pdf');
    const res=await call(); expect(res.status).toBe(307);
    expect(res.headers.has('content-security-policy')).toBe(false);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
