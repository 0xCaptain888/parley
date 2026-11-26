import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../../scripts/evidence.mjs';
import { recordForkRun, validateForkBinding } from '../../scripts/fork-evidence.mjs';

const hash = n => `0x${n.toString(16).padStart(64, '0')}`;
const snapshot = { sha256: 'current', files: { 'contracts/contracts/Parley.sol': 'source' } };
function passed() {
  const preflight = { status: 'passed', forkBlock: 123, forkBlockHash: hash(1),
    actors: ['alice', 'bob'], codeHashes: { registry: hash(2) } };
  return {
    status: 'passed', snapshotSha256: 'current', sourceHash: 'source', sourceChainId: 56,
    mainnetBroadcast: false, walletAccess: false, tokenBalancesPatched: false,
    preflight, forkBlock: 123, forkBlockHash: hash(1), canonicalEndBlockHash: hash(1),
    actors: preflight.actors, codeHashes: preflight.codeHashes,
    checks: Array.from({ length: 22 }, (_, i) => ({ name: `check ${i}`, status: 'passed' })),
    transactions: Array.from({ length: 47 }, (_, i) => ({ hash: hash(i + 10), block: 125 + i })),
    deployment: { runtimeKeccak256: hash(3), transactionHash: hash(4), block: 124 },
    parleyCreationCodeKeccak256: hash(5), completedAt: '2026-11-23T02:00:00Z',
  };
}
function validate(report, overrides = {}, bytes) {
  const raw = Buffer.from(JSON.stringify(report));
  return validateForkBinding({ reportSha256: sha256(raw), snapshotSha256: 'current', ...overrides },
    report, snapshot, bytes || raw);
}
test('fork binding accepts a complete source-bound local run', () => {
  assert.doesNotThrow(() => validate(passed()));
});
test('fork binding rejects stale source and report tampering', () => {
  assert.throws(() => validate(passed(), { snapshotSha256: 'old' }), /current sources/);
  assert.throws(() => validate({ ...passed(), snapshotSha256: 'old' }), /current sources/);
  assert.throws(() => validate({ ...passed(), sourceHash: 'old' }), /contract source/);
  assert.throws(() => validate(passed(), {}, Buffer.from('tampered')), /integrity/);
});
test('fork binding rejects failed, patched-token, wallet and mainnet attempts', () => {
  for (const change of [{ status: 'failed' }, { tokenBalancesPatched: true },
    { walletAccess: true }, { mainnetBroadcast: true }, { sourceChainId: 97 }])
    assert.throws(() => validate({ ...passed(), ...change }));
});
test('fork binding rejects missing prerequisites, changed blocks and substituted actors/code', () => {
  for (const change of [{ preflight: undefined }, { canonicalEndBlockHash: hash(9) },
    { forkBlock: 999 }, { actors: ['other', 'bob'] }, { codeHashes: {} }])
    assert.throws(() => validate({ ...passed(), ...change }));
});
test('fork binding rejects partial checks and invalid transaction evidence', () => {
  const report = passed();
  for (const change of [{ checks: report.checks.slice(1) },
    { checks: report.checks.map(() => report.checks[0]) },
    { checks: report.checks.map((c, i) => i ? c : { ...c, status: 'failed' }) },
    { transactions: [] }, { transactions: report.transactions.map(() => report.transactions[0]) },
    { transactions: report.transactions.toReversed() }, { deployment: undefined }])
    assert.throws(() => validate({ ...report, ...change }));
});
function temporary(t) {
  const root = fs.mkdtempSync('/private/tmp/parley-fork-evidence-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('a failed attempt replaces the current pointer but preserves prior success without leaking RPC errors', async t => {
  const root = temporary(t);
  const good = await recordForkRun(root, async report => Object.assign(report, passed()), () => snapshot);
  assert.equal(good.report.status, 'passed');
  const oldBytes = fs.readFileSync(path.join(root, good.pointer.report));
  const failed = await recordForkRun(root, async () => {
    throw new Error('https://user:secret@example.invalid/api-token Authorization: Bearer wallet-session');
  }, () => snapshot);
  assert.equal(failed.report.status, 'failed');
  const pointer = JSON.parse(fs.readFileSync(path.join(root, 'docs/reports/fork-current.json')));
  assert.equal(pointer.status, 'failed');
  assert.notEqual(pointer.report, good.pointer.report);
  assert.deepEqual(fs.readFileSync(path.join(root, good.pointer.report)), oldBytes);
  const raw = fs.readFileSync(path.join(root, pointer.report));
  assert.equal(sha256(raw), pointer.reportSha256);
  assert.doesNotMatch(raw.toString(), /secret|api-token|Bearer|wallet-session/);
});
test('source drift during fork execution is recorded as failure', async t => {
  let reads = 0;
  const result = await recordForkRun(temporary(t), async r => Object.assign(r, passed()),
    () => ++reads === 1 ? snapshot : { ...snapshot, sha256: 'changed' });
  assert.equal(result.report.status, 'failed');
});
test('an action returning without the complete scenario cannot record success', async t => {
  const result = await recordForkRun(temporary(t), async () => {}, () => snapshot);
  assert.equal(result.report.status, 'failed');
});
