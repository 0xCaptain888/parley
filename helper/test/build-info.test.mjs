import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { currentBuild } from '../../scripts/build-info.mjs';

function fixture(t) {
  const root = fs.mkdtempSync('/private/tmp/parley-build-info-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  const build = {
    input: { sources: { 'contracts/Parley.sol': { content: 'current source' } } },
    output: { contracts: { 'contracts/Parley.sol': { Parley: {
      evm: { bytecode: { object: '1234' }, deployedBytecode: { object: '5678' } },
    } } } },
  };
  write('contracts/contracts/Parley.sol', 'current source');
  write('contracts/artifacts/contracts/Parley.sol/Parley.json', { bytecode: '0x1234', deployedBytecode: '0x5678' });
  write('contracts/artifacts/contracts/Parley.sol/Parley.dbg.json', { buildInfo: '../../build-info/current.json' });
  write('contracts/artifacts/build-info/current.json', build);
  return { root, write, build };
}

test('verification export selects the linked current build despite historical builds', t => {
  const { root, write, build } = fixture(t);
  write('contracts/artifacts/build-info/old.json', { output: {} });
  assert.deepEqual(currentBuild(root), build);
});

test('verification export rejects stale source and mismatched bytecode', t => {
  const { root, write, build } = fixture(t);
  write('contracts/contracts/Parley.sol', 'changed source');
  assert.throws(() => currentBuild(root), /Compile before exporting/);
  write('contracts/contracts/Parley.sol', 'current source');
  build.output.contracts['contracts/Parley.sol'].Parley.evm.bytecode.object = 'abcd';
  write('contracts/artifacts/build-info/current.json', build);
  assert.throws(() => currentBuild(root), /does not match/);
});

test('verification export rejects compiler references outside build-info', t => {
  const { root, write } = fixture(t);
  write('contracts/artifacts/contracts/Parley.sol/Parley.dbg.json', { buildInfo: '../../../../outside.json' });
  assert.throws(() => currentBuild(root), /outside build-info/);
});

test('verification export also checks imported dependency source', t => {
  const { root, write, build } = fixture(t);
  build.input.sources['@vendor/Token.sol'] = { content: 'original dependency' };
  write('contracts/node_modules/@vendor/Token.sol', 'changed dependency');
  write('contracts/artifacts/build-info/current.json', build);
  assert.throws(() => currentBuild(root), /Compile before exporting/);
});
