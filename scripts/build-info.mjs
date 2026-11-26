import fs from 'node:fs';
import path from 'node:path';

export function currentBuild(root) {
  const artifacts = path.join(root, 'contracts/artifacts');
  const artifactFile = path.join(artifacts, 'contracts/Parley.sol/Parley.json');
  const artifact = JSON.parse(fs.readFileSync(artifactFile, 'utf8'));
  const debug = JSON.parse(fs.readFileSync(artifactFile.replace(/\.json$/, '.dbg.json'), 'utf8'));
  if (typeof debug.buildInfo !== 'string') throw new Error('Missing current compiler build reference.');
  const file = path.resolve(path.dirname(artifactFile), debug.buildInfo);
  if (path.dirname(file) !== path.join(artifacts, 'build-info'))
    throw new Error('Compiler build reference is outside build-info.');
  const build = JSON.parse(fs.readFileSync(file, 'utf8'));
  const compiled = build.output?.contracts?.['contracts/Parley.sol']?.Parley;
  if (!compiled || `0x${compiled.evm?.bytecode?.object}` !== artifact.bytecode
    || `0x${compiled.evm?.deployedBytecode?.object}` !== artifact.deployedBytecode)
    throw new Error('Current artifact does not match its compiler build.');
  if (!build.input?.sources?.['contracts/Parley.sol'])
    throw new Error('Missing Parley source in compiler build.');
  for (const [name, source] of Object.entries(build.input.sources)) {
    const file = path.join(root, 'contracts', name.startsWith('@') ? 'node_modules' : '', name);
    if (source.content !== fs.readFileSync(file, 'utf8'))
      throw new Error(`Current source differs from compiler build: ${name}. Compile before exporting.`);
  }
  return build;
}
