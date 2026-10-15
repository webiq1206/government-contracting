import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { FOLLOW_UP_ELIGIBLE_SQL, OWNED_CALL_CARD_SQL } from '@/lib/sub-action-eligibility';
import { lockOwnedCallCard } from '@/lib/call-card-access';

describe('action eligibility against legacy ownership and contact records',()=>{
  let db:PGlite;
  beforeAll(async()=>{
    db=new PGlite();
    // Synthetic pre-constraint schema permits historical null/cross-tenant links.
    await db.exec(`
      create table opportunities(id text, org_id text, status text, pursuit_state text, stage text, snoozed_until timestamptz);
      create table subcontractors(id text, org_id text);
      create table opportunity_subs(opportunity_id text, subcontractor_id text, removed_at timestamptz, outreach_state text);
      create table communications(org_id text, opportunity_id text, subcontractor_id text, channel text, direction text, provider text, delivery_state text);
      create table quotes(org_id text, opportunity_id text, subcontractor_id text, quote_amount numeric);
      create table call_cards(id text,org_id text, opportunity_id text, subcontractor_id text, status text);
      insert into opportunities values ('mine','a','open','active','call_queue',null),('theirs','b','open','active','call_queue',null);
      insert into subcontractors values ('valid','a'),('called','a'),('draft','a'),('historical','a'),('foreign-receipt','a'),
        ('unowned',null),('foreign','b'),('removed','a'),('declined','a'),('quoted','a'),('queued','a');
      insert into opportunity_subs select 'mine',id,case when id='removed' then now() else null end,
        case when id='declined' then 'declined' else 'unresponsive' end from subcontractors;
      insert into communications select 'a','mine',id,'email','outbound','fixture',
        case when id='draft' then 'draft' else 'sent' end from subcontractors where id not in ('historical','called','foreign-receipt');
      insert into communications values ('a','mine','called','call','outbound',null,null),
        ('b','mine','foreign-receipt','email','outbound','fixture','sent');
      insert into quotes values ('a','mine','quoted',100),('b','mine','valid',100);
      insert into call_cards values ('queued','a','mine','queued','pending');
    `);
  },60000);
  afterAll(async()=>{await db?.close();});
  const from=`from opportunity_subs os join opportunities o on o.id=os.opportunity_id
    join subcontractors s on s.id=os.subcontractor_id where o.org_id=$1 and ${FOLLOW_UP_ELIGIBLE_SQL}`;
  it('keeps only owned active pairings with real scoped contact evidence and matches the count',async()=>{
    const rows=(await db.query<{id:string}>(`select s.id ${from} order by s.id`,['a'])).rows;
    expect(rows.map(r=>r.id)).toEqual(['called','valid']);
    expect((await db.query(`select count(*)::int as n ${from}`,['a'])).rows).toEqual([{n:rows.length}]);
    expect((await db.query(`select s.id ${from}`,['b'])).rows).toEqual([]);
  });
  it('does not offer unowned or foreign call cards; preserves a valid owned card without a legacy pairing',async()=>{
    await db.exec(`insert into subcontractors values ('standalone','a');
      insert into call_cards values ('good','a','mine','standalone','pending'),('bad-owner','b','mine','valid','pending'),
        ('no-owner','a','mine','unowned','pending'),('cross','a','mine','foreign','pending'),
        ('removed','a','mine','removed','pending'),('declined','a','mine','declined','pending');`);
    const rows=await db.query<{id:string}>(`select cc.id from call_cards cc
      join opportunities o on o.id=cc.opportunity_id join subcontractors s on s.id=cc.subcontractor_id
      where o.org_id=$1 and ${OWNED_CALL_CARD_SQL} order by cc.id`,['a']);
    expect(rows.rows.map(r=>r.id)).toEqual(['good','queued']);
  });
  it('leaves historical records and their unknown ownership intact',async()=>{
    expect((await db.query("select org_id from subcontractors where id='unowned'")).rows).toEqual([{org_id:null}]);
    expect((await db.query('select count(*)::int as n from opportunity_subs')).rows).toEqual([{n:11}]);
  });
  it('rechecks ownership inside the save transaction and cannot lock an unavailable related record',async()=>{
    const client={query:(sql:string,values:unknown[])=>db.query(sql,values)} as unknown as Parameters<typeof lockOwnedCallCard>[0];
    expect(await lockOwnedCallCard(client,'queued','a')).toMatchObject({subcontractor_id:'queued'});
    for(const id of ['bad-owner','no-owner','cross','removed','declined','missing']) {
      expect(await lockOwnedCallCard(client,id,'a')).toBeNull();
    }
    expect(await lockOwnedCallCard(client,'queued','b')).toBeNull();
    await db.exec("update subcontractors set org_id=null where id='queued'");
    expect(await lockOwnedCallCard(client,'queued','a')).toBeNull();
  });
});
