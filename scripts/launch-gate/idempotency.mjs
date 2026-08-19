import fs from 'fs';
const BASE='http://localhost:3100';
const ids=fs.readFileSync('/tmp/e2e/ids.env','utf8').trim().split('\n').reduce((a,l)=>{const[k,v]=l.split('=');a[k]=v;return a},{});
const email=process.argv[2], pw=process.argv[3];
const lr=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:pw}),redirect:'manual'});
const cookie=(lr.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
const H={cookie,'content-type':'application/json'};
const out=[];
const rec=(n,ok,d)=>{out.push({n,ok,d});console.log(`${ok?'PASS':'FAIL'}  ${n}  — ${d}`);};

// 1. Rapid double-fire of notes write (double-click): both should 200, one row/value, no error
const p=(body)=>fetch(BASE+'/api/opportunities/'+ids.OPP+'/notes',{method:'POST',headers:H,body:JSON.stringify(body)});
const [a,b]=await Promise.all([p({notes:'concurrent A'}),p({notes:'concurrent A'})]);
rec('Double-click notes write: both handled, no 500', a.status<500&&b.status<500, `statuses ${a.status}/${b.status}`);

// 2. Concurrent bid-builder enqueues (idempotent agent): both accepted, one job semantics
const runq=()=>fetch(BASE+'/api/agents/bid-builder/run',{method:'POST',headers:H,body:JSON.stringify({opportunityId:ids.OPP})});
const [j1,j2]=await Promise.all([runq(),runq()]);
rec('Concurrent agent runs accepted without error', j1.status<500&&j2.status<500, `statuses ${j1.status}/${j2.status}`);

// 3. Rapid repeated requirement-confirm toggles (state churn): no 500s, deterministic end state
const conf=(v)=>fetch(BASE+'/api/opportunities/'+ids.OPP+'/requirements',{method:'POST',headers:H,body:JSON.stringify({requirement_id:'reps',confirmed:v})});
const res=await Promise.all([conf(true),conf(true),conf(false),conf(true)]);
rec('Rapid requirement toggles: no server error', res.every(r=>r.status<500), 'statuses '+res.map(r=>r.status).join('/'));

console.log('\n==JSON=='+JSON.stringify(out));
