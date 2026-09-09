// Read-only diagnostics for the disposable browser build, never a deployment.
import { readFileSync, writeFileSync } from 'node:fs';
if (process.env.CI !== 'true' || process.env.PGDATABASE !== 'brostco_audit' || process.env.PGHOST !== '127.0.0.1') throw new Error('Navigation diagnostics require the disposable audit');
for (const prefix of ['node_modules/next/dist/client', 'node_modules/next/dist/esm/client']) {
  const patches = [
    ['components/router-reducer/reducers/navigate-reducer.js', [
      ['function navigateReducer(state, action) {', `function navigateReducer(state, action) { console.error('[ui-audit navigation]', JSON.stringify({phase:'start', from:state.canonicalUrl, to:action.url.href}));`],
      ['return data.then((param)=>{', `return data.then((param)=>{ console.error('[ui-audit navigation]', JSON.stringify({phase:'flight ready', to:href, from:state.canonicalUrl, count:Array.isArray(param.flightData)?param.flightData.length:null}));`],
      ['mutable.canonicalUrl = updatedCanonicalUrl;', `mutable.canonicalUrl = updatedCanonicalUrl; console.error('[ui-audit navigation]', JSON.stringify({phase:'state ready', to:updatedCanonicalUrl}));`],
      ['}, ()=>state);', `}, (error)=>{ console.error('[ui-audit navigation]', JSON.stringify({phase:'rejected', to:href, error:String(error)})); return state; });`],
    ]],
    ['components/app-router-instance.js', [
      ['function dispatchAction(actionQueue, payload, setState) {', `function dispatchAction(actionQueue, payload, setState) { console.error('[ui-audit navigation]', JSON.stringify({phase:'dispatch', type:payload.type, to:payload.url?.href, pending:actionQueue.pending?.payload?.type}));`],
      ['function handleResult(nextState) {', `function handleResult(nextState) { console.error('[ui-audit navigation]', JSON.stringify({phase:'resolve', type:payload.type, to:nextState.canonicalUrl, discarded:action.discarded}));`],
    ]],
  ];
  for (const [name, replacements] of patches) {
    const path=prefix+'/'+name;let source=readFileSync(path,'utf8');
    for(const [needle, replacement] of replacements) {
      if(!source.includes(needle))throw new Error('Navigation insertion point changed: '+path+' '+needle);
      source=source.replaceAll(needle,replacement);
    }
    writeFileSync(path,source);
  }
}
