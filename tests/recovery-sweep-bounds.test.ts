import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("applies recovery limits to actual selection SQL without borrowing another tenant's failures", async () => {
  const source = readFileSync("lib/agents/maintenance.ts", "utf8");
  const sql = source.match(/`(select id, title from opportunities[\s\S]*?limit 200)`/)?.[1];
  expect(sql).toBeTruthy();
  const db = new PGlite();
  try {
    await db.exec(`create table opportunities(id text,org_id text,title text,status text,stage text,score integer,is_sources_sought boolean,created_at timestamptz);
      create table job_runs(org_id text,opportunity_id text,agent text,status text,started_at timestamptz);
      insert into opportunities select id,'a',id,'open','scoring',null,false,now()-interval '2 days'
        from unnest(array['eligible','recent','capped','success','other-tenant','research']) id;
      update opportunities set is_sources_sought=true where id='research';
      insert into job_runs values('a','recent','scoring-engine','error',now()-interval '30 minutes'),
        ('a','success','scoring-engine','ok',now()-interval '2 days'),
        ('b','other-tenant','scoring-engine','ok',now());
      insert into job_runs select 'a','capped','scoring-engine','error',now()-interval '2 hours' from generate_series(1,3);`);
    const result = await db.query<{ id: string }>(sql!, ["a"]);
    // An old ok run can mean held work, not a produced score. Missing output
    // remains recoverable after backoff; current output is the success proof.
    expect(result.rows.map(row => row.id).sort()).toEqual(["eligible", "other-tenant", "success"]);
    await db.exec("update opportunities set score=70 where id='success'");
    expect((await db.query<{ id: string }>(sql!, ["a"])).rows.map(row=>row.id).sort()).toEqual(["eligible", "other-tenant"]);
    const analysisSql = source.match(/`(select id from opportunities[\s\S]*?solicitation_analysis is null[\s\S]*?limit 200)`/)?.[1];
    expect(analysisSql).toBeTruthy();
    await db.exec(`alter table opportunities add column solicitation_analysis jsonb;
      alter table opportunities add column risk_flags text[];
      update opportunities set score=70;
      update job_runs set agent='solicitation-analyst';`);
    const analysis = await db.query<{ id: string }>(analysisSql!, ["a"]);
    expect(analysis.rows.map(row => row.id).sort()).toEqual(["eligible", "other-tenant", "success"]);
    await db.exec("update opportunities set solicitation_analysis='{}'::jsonb where id='success'");
    expect((await db.query<{ id: string }>(analysisSql!, ["a"])).rows.map(row=>row.id).sort()).toEqual(["eligible", "other-tenant"]);
  } finally { await db.close(); }
}, 30_000);
