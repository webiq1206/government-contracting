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
    expect(await gmail.send(params)).toEqual({ messageId: 'gmail-id', threadId: 'thread-id', rfc822MessageId: '<internet-id@example.com>' });
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
});
