// Diagnostic logging in the disposable audit build only. Never run on a
// deployment or against customer data. No React behavior is changed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
if (process.env.CI !== 'true' || process.env.PGDATABASE !== 'brostco_audit' || process.env.PGHOST !== '127.0.0.1') {
  throw new Error('React diagnostics are limited to the disposable CI audit');
}
const paths = [
  'node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js',
  'node_modules/next/dist/compiled/react-dom-experimental/cjs/react-dom-client.production.js',
  'node_modules/react-dom/cjs/react-dom-client.production.js',
];
const needle = 'function throwOnHydrationMismatch(fiber) {';
const logging = `
  try {
    var auditParents = [], auditParent = fiber;
    for (var auditIndex = 0; auditParent && auditIndex < 12; auditIndex++, auditParent = auditParent.return) {
      auditParents.push({tag: auditParent.tag, type: typeof auditParent.type === 'string' ? auditParent.type : auditParent.type && (auditParent.type.displayName || auditParent.type.name), className: auditParent.pendingProps && auditParent.pendingProps.className});
    }
    var auditChildren = [], auditChild = fiber.child;
    for (var auditChildIndex = 0; auditChild && auditChildIndex < 12; auditChildIndex++, auditChild = auditChild.sibling) {
      auditChildren.push({tag: auditChild.tag, type: typeof auditChild.type === 'string' ? auditChild.type : auditChild.type && auditChild.type.name, flags: auditChild.flags, dehydrated: auditChild.memoizedState && auditChild.memoizedState.dehydrated && auditChild.memoizedState.dehydrated.nodeValue});
    }
    console.error('[ui-audit hydration]', JSON.stringify({
      children: auditChildren, phase: new Error().stack, props: {keys: Object.keys(fiber.pendingProps || {}), childrenType: typeof (fiber.pendingProps && fiber.pendingProps.children), childCount: Array.isArray(fiber.pendingProps && fiber.pendingProps.children) ? fiber.pendingProps.children.length : null},
      path: window.location.pathname, expected: auditParents,
      actual: nextHydratableInstance && String(nextHydratableInstance.outerHTML || nextHydratableInstance.nodeValue).slice(0, 3500),
      parent: nextHydratableInstance && nextHydratableInstance.parentElement && nextHydratableInstance.parentElement.outerHTML.slice(0, 3500)
    }));
  } catch (auditError) { console.error('[ui-audit hydration diagnostic unavailable]'); }
`;
let patched = 0;
for (const path of paths) {
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  if (!source.includes(needle)) throw new Error('React diagnostic insertion point changed: '+path);
  writeFileSync(path, source.replace(needle, needle + logging));
  patched++;
}
if (!patched) throw new Error('No React client source found for diagnostics');
console.log('Added hydration diagnostic logging to '+patched+' audit-only React builds');
