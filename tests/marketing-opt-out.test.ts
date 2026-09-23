import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOptOutToken, readOptOutToken } from '../lib/domain/marketing-opt-out';
const suppress = vi.hoisted(() => vi.fn());
vi.mock('../lib/domain/email-suppression', () => ({ suppressEmail: suppress }));
import { GET, POST } from '../app/api/email/unsubscribe/[token]/route';
import { middleware } from '../middleware';
import { NextRequest } from 'next/server';

const recipient = { orgId: '11111111-2222-4333-8444-555555555555', email: 'recipient@example.com' };
beforeEach(() => { vi.stubEnv('AUTH_SECRET', 'test-only-marketing-key-12345678901234567890123456789'); suppress.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
const context = (token: string) => ({ params: Promise.resolve({ token }) });
const post = (body = 'List-Unsubscribe=One-Click') => new Request('https://brostco.com/api/email/unsubscribe/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });

describe('authenticated marketing opt-out', () => {
  it('round trips an opaque token and rejects tampering or another key', () => {
    const token = createOptOutToken(recipient);
    expect(readOptOutToken(token)).toEqual(recipient);
    expect(Buffer.from(token, 'base64url').toString()).not.toContain(recipient.email);
    expect(readOptOutToken((token[0] === 'x' ? 'y' : 'x') + token.slice(1))).toBeNull();
    vi.stubEnv('AUTH_SECRET', 'different-test-key');
    expect(readOptOutToken(token)).toBeNull();
  });
  it('preserves delivered links across configured key rotation', () => {
    const token = createOptOutToken(recipient);
    vi.stubEnv('AUTH_SECRET_PREVIOUS', process.env.AUTH_SECRET!);
    vi.stubEnv('AUTH_SECRET', 'rotated-test-key');
    expect(readOptOutToken(token)).toEqual(recipient);
  });
  it('refuses the public default signing secret', () => {
    vi.stubEnv('AUTH_SECRET', ''); vi.stubEnv('SESSION_SECRET', '');
    expect(() => createOptOutToken(recipient)).toThrow('AUTH_SECRET');
  });
  it('does not unsubscribe on GET and works without a signed-in session', async () => {
    const token = createOptOutToken(recipient);
    const url = `https://brostco.com/api/email/unsubscribe/${token}`;
    expect(middleware(new NextRequest(url)).headers.get('x-middleware-next')).toBe('1');
    const response = await GET(new Request(url), context(token));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('method="post"');
    expect(suppress).not.toHaveBeenCalled();
  });
  it('accepts a provider one-click POST for only the token recipient and tenant', async () => {
    const response = await POST(post(), context(createOptOutToken(recipient)));
    expect(response.status).toBe(200);
    expect(suppress).toHaveBeenCalledWith({ ...recipient, source: 'unsubscribe', reason: expect.any(String) });
  });
  it('rejects malformed requests and never claims success on a persistence error', async () => {
    expect((await POST(post(), context('invalid'))).status).toBe(400);
    expect((await POST(post('email=someone-else@example.com'), context(createOptOutToken(recipient)))).status).toBe(400);
    expect(suppress).not.toHaveBeenCalled();
    suppress.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(post(), context(createOptOutToken(recipient)))).status).toBe(503);
  });
});
