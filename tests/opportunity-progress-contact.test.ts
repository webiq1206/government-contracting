import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { guideStandards } from './helpers/guide-evidence';
const state = vi.hoisted(() => ({ db: null as PGlite | null }));
vi.mock('@/lib/tenant', () => ({ resolveTenantOrgId: async () => 'ours' }));
vi.mock('@/lib/opportunity-sub-scope', () => ({ unavailableSubcontractorLinks: async () => 0 }));
vi.mock('@/lib/db', () => ({
  // Execute the actual detail roster SQL. Unrelated panels are outside this fixture.
  query: async (sql: string, params: unknown[]) => sql.includes('select os.id, os.opportunity_id')
    ? (await state.db!.query(sql, params)).rows : [],
  queryOne: async (sql: string, params: unknown[]) => sql.includes('select * from opportunities')
    ? (await state.db!.query(sql, params)).rows[0] ?? null : null,
}));
import { opportunityDetail } from '@/lib/data';
import { verifiedGuideProgress } from '@/lib/domain/guide-progress';
import { summarizeTradeCoverage } from '@/lib/domain/trade-coverage';

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`
    create table opportunities(id text, org_id text);
    create table subcontractors(id text, org_id text, company_name text, phone text, email text,
      email_verified boolean, google_rating float, archived_at timestamptz, blacklisted boolean,
      sam_excluded boolean, license_status text, review_count integer, reliability_score float,
      contact_status text, last_contacted timestamptz);
    create table opportunity_subs(id text, org_id text, opportunity_id text, subcontractor_id text,
      trade text, candidate_rank int, outreach_state text, responded_at timestamptz, verified boolean,
      verification_json jsonb, role text, removed_at timestamptz, removed_reason text);
    create table communications(id text, org_id text, opportunity_id text, subcontractor_id text,
      channel text, direction text, provider text, delivery_state text, meta jsonb,
      created_at timestamptz default now(), gmail_thread_id text);
    create table call_cards(org_id text, opportunity_id text, subcontractor_id text,
      card_json jsonb, response_json jsonb, status text, called_at timestamptz);
    create table quotes(org_id text, opportunity_id text, subcontractor_id text);
    insert into opportunities values ('bid','ours'),('foreign-bid','theirs');
    insert into subcontractors(id,org_id,company_name,email,email_verified,google_rating,blacklisted,
      sam_excluded,license_status,review_count) values
      ('firm','ours','Synthetic firm','test@example.invalid',true,4.7,false,false,'active',25);
    insert into opportunity_subs(id,org_id,opportunity_id,subcontractor_id,trade,verified,verification_json) values
      ('roof','ours','bid','firm','Roofing',true,'{"sam_confirmed":true,"sam_excluded":false,"unresolved_failures":[],"notes":[]}'),
      ('electric','ours','bid','firm','Electrical',true,'{"sam_confirmed":true,"sam_excluded":false,"unresolved_failures":[],"notes":[]}'),
      ('foreign-pair','theirs','bid','firm','Plumbing',true,'{}');
  `);
}, 60000);
beforeEach(async () => { await state.db!.exec('delete from communications; delete from call_cards;'); });
afterAll(async () => { await state.db?.close(); });
async function email(trade: string | null, org = 'ours', delivery = 'sent', provider: string | null = 'gmail', opportunity = 'bid') {
  await state.db!.query(`insert into communications(id,org_id,opportunity_id,subcontractor_id,channel,direction,provider,delivery_state,meta)
    values('mail',$1,$2,'firm','email','outbound',$3,$4,$5)`, [org, opportunity, provider, delivery, JSON.stringify({ trade })]);
}
async function call(outcome: string, trade: string | null = 'Roofing', org = 'ours', status = 'called') {
  await state.db!.query(`insert into call_cards values($1,'bid','firm',$2,$3,$4,now())`,
    [org, JSON.stringify({ trade }), JSON.stringify({ outcome }), status]);
  await state.db!.query(`insert into communications(id,org_id,opportunity_id,subcontractor_id,channel,direction)
    values('call',$1,'bid','firm','call','inbound')`, [org]);
}
async function progress() {
  const detail = (await opportunityDetail('bid'))!;
  const subs = detail.subs;
  return { subs, ...verifiedGuideProgress({ standards: guideStandards, subs,
    sourceEvidence: { analysisInputHash: 'synthetic', completeness: { ok: true, missing: [] } },
    coverage: summarizeTradeCoverage({ requiredTrades: ['Roofing', 'Electrical'], subs, quotes: [] }),
  }) };
}
describe('detail loader contact evidence stays within tenant, bid, firm and trade', () => {
  it('does not duplicate one trade receipt across a multi-trade firm', async () => {
    await email('Roofing');
    const first = await progress();
    expect(first.subs).toHaveLength(2);
    expect(first.subs.find(s => s.trade === 'Roofing')).toMatchObject({ emails_sent: 1, has_trade_contact: true });
    expect(first.subs.find(s => s.trade === 'Electrical')).toMatchObject({ emails_sent: 1, has_trade_contact: false });
    expect(first.subsFound).toBe(true); expect(first.subsContacted).toBe(false);
    await email('Electrical');
    expect((await progress()).subsContacted).toBe(true);
  });
  it('rejects foreign, unknown-trade, other-bid, bounced, deferred and unsent evidence', async () => {
    await email('Roofing', 'theirs'); await email(null); await email('');
    await email('Electrical', 'ours', 'sent', 'gmail', 'foreign-bid');
    await email('Roofing', 'ours', 'bounced'); await email('Electrical', 'ours', 'deferred');
    await email('Electrical', 'ours', 'sent', null);
    expect((await progress()).subs.every(s => s.has_trade_contact === false)).toBe(true);
    expect(await opportunityDetail('foreign-bid')).toBeNull();
  });
  it.each(['no_answer', 'wrong_number', 'logged', 'unknown'])('keeps %s as call history without successful contact', async outcome => {
    await call(outcome);
    const result = await progress();
    expect(result.callsRecorded).toBe(true); expect(result.subsContacted).toBe(false);
    expect(result.subs.every(s => !s.has_trade_contact)).toBe(true);
  });
  it('does not reuse a past outcome when Call Prep changes the mutable card trade', async () => {
    await call('interested');
    expect((await progress()).subs.every(s => !s.has_trade_contact)).toBe(true);
    // The real Call Prep upsert overwrites card_json but keeps this past outcome.
    await state.db!.exec(`update call_cards set card_json='{"trade":"Electrical"}'`);
    const result = await progress();
    expect(result.callsRecorded).toBe(true);
    expect(result.subs.every(s => !s.has_trade_contact)).toBe(true);
    expect(result.subsContacted).toBe(false);
    // Known-trade email receipts remain usable, independently of call cards.
    await email('Roofing'); await email('Electrical');
    expect((await progress()).subsContacted).toBe(true);
  });
});
