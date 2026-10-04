import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), send: vi.fn(), get: vi.fn(), paused: false }));
vi.mock('../lib/config', () => ({ config: {
  gmail: { configured: true, clientId: 'test', clientSecret: 'test', sender: null },
  database: { isIsolatedDev: false }, email: {}, appUrl: 'https://brostco.com',
} }));
vi.mock('../lib/db', () => ({ query: vi.fn(async () => []), queryOne: vi.fn(async () => ({ data: { refresh_token: 'test-only' } })) }));
vi.mock('../lib/integration-settings', () => ({ encryptSecret: (v: string) => v, decryptSecret: (v: string) => v }));
vi.mock('../lib/app-settings', () => ({ isAutomationStopped: async () => mocks.paused, AUTOMATION_PAUSED_ERROR: 'Paused' }));
vi.mock('../lib/integrations/gmail-quota', () => ({ reserveGmailQuota: async () => {} }));
vi.mock('googleapis', () => ({ google: {
  auth: { OAuth2: class { setCredentials() {} } },
  gmail: () => ({ users: { settings: { sendAs: { list: mocks.list } }, messages: { send: mocks.send, get: mocks.get } } }),
} }));
import { query, queryOne } from '../lib/db';
import { gmail, __resetSendAsCache } from '../lib/integrations/gmail';
const params = { orgId: 'org-1', to: 'owner@example.com', from: 'BrostCo <hello@brostco.com>', subject: 'Test', html: '<p>Test</p>' };
beforeEach(() => {
  vi.clearAllMocks(); __resetSendAsCache(); mocks.paused = false;
  mocks.list.mockResolvedValue({ data: { sendAs: [{ sendAsEmail: 'admin@brostco.com', isPrimary: true }, { sendAsEmail: 'hello@brostco.com', verificationStatus: 'accepted' }] } });
  mocks.send.mockResolvedValue({ data: { id: 'gmail-id', threadId: 'thread-id' } });
  mocks.get.mockResolvedValue({ data: { payload: { headers: [{ name: 'Message-ID', value: '<internet-id@example.com>' }] } } });
});

describe('Gmail sender checks at the provider boundary', () => {
  it('sends a verified alias once and preserves provider message IDs', async () => {
    expect(await gmail.send(params)).toEqual({ outcome: 'accepted', messageId: 'gmail-id', threadId: 'thread-id', rfc822MessageId: '<internet-id@example.com>' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const raw = Buffer.from(mocks.send.mock.calls[0][0].requestBody.raw, 'base64url').toString();
    expect(raw).toContain('From: "BrostCo" <hello@brostco.com>');
  });
  it('rechecks a previously cached alias and refuses a removed identity', async () => {
    await gmail.sendAsAddresses('org-1');
    mocks.list.mockResolvedValue({ data: { sendAs: [{ sendAsEmail: 'admin@brostco.com', isPrimary: true }] } });
    expect(await gmail.send(params)).toMatchObject({ disabled: true, error: expect.stringContaining('not verified') });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('refuses an unverified override and a failed alias lookup', async () => {
    expect(await gmail.send({ ...params, from: 'outreach@brostco.com' })).toMatchObject({ disabled: true });
    mocks.list.mockRejectedValue(new Error('Google unavailable'));
    expect(await gmail.send(params)).toMatchObject({ disabled: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('resolves an omitted From to the authenticated primary address', async () => {
    await gmail.send({ ...params, from: undefined });
    const raw = Buffer.from(mocks.send.mock.calls[0][0].requestBody.raw, 'base64url').toString();
    expect(raw).toContain('From: admin@brostco.com');
  });
  it('preserves the automation pause', async () => {
    mocks.paused = true;
    expect(await gmail.send(params)).toMatchObject({ disabled: true, error: 'Paused' });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('commits the attempt only after sender verification and prevents provider IO when that write fails', async () => {
    const stamp = vi.fn(async () => { throw new Error('claim write unavailable'); });
    expect(await gmail.send({ ...params, beforeProviderSend: stamp })).toMatchObject({ outcome: 'not_attempted' });
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();
    stamp.mockClear();
    await gmail.send({ ...params, from: 'unverified@example.test', beforeProviderSend: stamp });
    expect(stamp).not.toHaveBeenCalled();
  });
  it.each([403, 429])('distinguishes a confirmed HTTP %s refusal from an ambiguous timeout', async (status) => {
    mocks.send.mockRejectedValue(Object.assign(new Error('Google refused'), { response: { status } }));
    expect(await gmail.send(params)).toMatchObject({ outcome: 'refused' });
    mocks.send.mockRejectedValue(new Error('socket timed out after upload'));
    expect(await gmail.send(params)).toMatchObject({ outcome: 'unknown' });
  });
  it('keeps acceptance when the optional Message-ID readback fails', async () => {
    mocks.get.mockRejectedValue(new Error('metadata read failed'));
    expect(await gmail.send(params)).toMatchObject({ outcome: 'accepted', messageId: 'gmail-id' });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

});


describe('grant-bound health writes',()=>{
 it('does not revoke a reconnected grant on a late invalid_grant from the old client',async()=>{
  const old='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',fresh='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let generation=old,status='connected';
  vi.mocked(queryOne).mockImplementation(async()=>({data:{refresh_token:'synthetic'},connection_generation:generation}) as never);
  vi.mocked(query).mockImplementation(async(sql:string,p:any[]=[])=>{if(sql.includes('set status =') && p[3]===generation)status=p[1];return [];});
  mocks.send.mockImplementation(async()=>{generation=fresh;throw Error('invalid_grant');});
  await gmail.send(params);
  expect(status).toBe('connected');
  const write=vi.mocked(query).mock.calls.find(([sql])=>sql.includes('set status ='));
  expect(write?.[0]).toContain('connection_generation=$4::uuid');expect(write?.[1]?.[3]).toBe(old);
 });
});
