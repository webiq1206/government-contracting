import { randomUUID } from 'crypto';
// DATABASE_URL comes from the environment: never point this at production.
process.env.AUTH_SECRET=process.env.AUTH_SECRET||'x'.repeat(64);
const { bidBuilder } = await import('./lib/agents/bid-builder.ts');
const { runWithOrg } = await import('./lib/tenant-context.ts');
const { query } = await import('./lib/db.ts');
const [OPP, A] = process.argv.slice(2);
if (!OPP || !A) {
  console.error('usage: tsx bid-race.mts <opportunityId> <orgId>   (DATABASE_URL must point at a disposable database)');
  process.exit(1);
}
// Fire two builds truly concurrently
const run=()=>runWithOrg(A,()=>bidBuilder.handler({runId:randomUUID(),trigger:'manual',payload:{opportunityId:OPP}}));
const results = await Promise.allSettled([run(),run()]);
console.log('run outcomes:', results.map(r=>r.status).join(', '));
const rows = await query("select count(*)::int n from bids where opportunity_id=$1",[OPP]);
console.log('BID_ROWS_AFTER_CONCURRENT_BUILD:', rows[0].n);
