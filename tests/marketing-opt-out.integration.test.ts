import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const suite = process.env.DATABASE_URL ? describe : describe.skip;

suite('marketing opt-out persistence and tenant isolation', () => {
  let query: typeof import('../lib/db').query;
  let queryOne: typeof import('../lib/db').queryOne;
  let createOptOutToken: typeof import('../lib/domain/marketing-opt-out').createOptOutToken;
  let POST: typeof import('../app/api/email/unsubscribe/[token]/route').POST;
  let isSuppressed: typeof import('../lib/domain/email-suppression').isSuppressed;
  const orgs: string[] = [];
  const email = `optout-${randomUUID()}@example.test`;
  beforeAll(async () => {
    vi.stubEnv('AUTH_SECRET', 'disposable-opt-out-integration-secret-12345678901234567890');
    ({ query, queryOne } = await import('../lib/db'));
    ({ createOptOutToken } = await import('../lib/domain/marketing-opt-out'));
    ({ POST } = await import('../app/api/email/unsubscribe/[token]/route'));
    ({ isSuppressed } = await import('../lib/domain/email-suppression'));
    for (let i = 0; i < 2; i++) {
      const org = await queryOne<{ id: string }>("insert into organizations(name,subscription_status) values($1,'active') returning id", [`optout-${randomUUID()}`]);
      orgs.push(org!.id);
    }
  });
  afterAll(async () => {
    for (const org of orgs) await query('delete from organizations where id=$1', [org]);
    vi.unstubAllEnvs();
  });
  it('stores repeated provider POSTs once and affects only the named sender', async () => {
    const token = createOptOutToken({ orgId: orgs[0], email });
    for (let i = 0; i < 2; i++) {
      const req = new Request('https://brostco.com/api/email/unsubscribe/test', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
      expect((await POST(req, { params: Promise.resolve({ token }) })).status).toBe(200);
    }
    expect(await isSuppressed(orgs[0], email.toUpperCase())).toBe(true);
    expect(await isSuppressed(orgs[1], email)).toBe(false);
    const rows = await query<{ source: string }>('select source from email_suppressions where org_id=$1 and email=$2', [orgs[0], email]);
    expect(rows).toEqual([{ source: 'unsubscribe' }]);
  });
});
