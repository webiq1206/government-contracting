import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Versioned scope of source inputs, not a claim about the entire Git tree,
// installed dependencies, environment values, or external services.
export const SOURCE_INPUT_SCOPE = 'brostco-source-inputs-v1';
export const SOURCE_INPUT_ROOTS = [
  'app', 'components', 'lib', 'worker', 'scripts', 'public', 'db',
  'middleware.ts', 'next.config.mjs', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tailwind.config.ts', 'postcss.config.mjs',
];

export function sourceInputEvidence(root = process.cwd()) {
  const entries = [];
  function visit(relative) {
    const path = resolve(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Source input symlinks are not supported');
    if (stat.isDirectory()) {
      // Workspace package managers install nested dependency trees under lib/
      // and scripts/. Installed dependency bytes are outside this source scope,
      // including their package-manager symlinks; never follow or remove them.
      for (const name of readdirSync(path).sort()) {
        if (name !== 'node_modules') visit(`${relative}/${name}`);
      }
    } else if (stat.isFile()) {
      entries.push([relative, createHash('sha256').update(readFileSync(path)).digest('hex')]);
    } else throw new Error('Unsupported source input type');
  }
  for (const name of SOURCE_INPUT_ROOTS) visit(name);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return {
    sourceInputScope: SOURCE_INPUT_SCOPE,
    sourceInputSha256: createHash('sha256').update(JSON.stringify([SOURCE_INPUT_SCOPE, entries])).digest('hex'),
    sourceInputFiles: entries.length,
  };
}

export function assertUnchangedSourceInputs(before, root = process.cwd()) {
  const after = sourceInputEvidence(root);
  if (before.sourceInputSha256 !== after.sourceInputSha256 || before.sourceInputFiles !== after.sourceInputFiles) {
    throw new Error('Source inputs changed during compilation; runtime publication refused');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(sourceInputEvidence(), null, 2));
}
