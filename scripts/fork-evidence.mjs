import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sha256, sourceSnapshot } from './evidence.mjs';

export function validateForkBinding(binding, report, snapshot, raw) {
  assert.equal(binding.reportSha256, sha256(raw), 'Fork report integrity mismatch');
  assert.equal(binding.snapshotSha256, snapshot.sha256, 'Fork binding differs from current sources');
  assert.equal(report.snapshotSha256, snapshot.sha256, 'Fork report differs from current sources');
  assert.equal(report.sourceHash, snapshot.files['contracts/contracts/Parley.sol'], 'Fork contract source differs');
  assert.equal(report.status, 'passed', 'Fork attempt did not pass');
  assert.equal(report.sourceChainId, 56, 'Fork source must be BSC');
  assert.equal(report.mainnetBroadcast, false);
  assert.equal(report.walletAccess, false);
  assert.equal(report.tokenBalancesPatched, false);
  assert.equal(report.preflight?.status, 'passed', 'Fork prerequisite evidence is missing');
  assert.equal(report.preflight.forkBlock, report.forkBlock);
  assert.equal(report.preflight.forkBlockHash, report.forkBlockHash);
  assert.equal(report.canonicalEndBlockHash, report.forkBlockHash, 'Fork block is no longer canonical');
  assert.deepEqual(report.preflight.actors, report.actors);
  assert.deepEqual(report.preflight.codeHashes, report.codeHashes);
  assert.equal(report.checks?.length, 22, 'Shared contract scenario is incomplete');
  assert.equal(new Set(report.checks.map(c => c.name)).size, 22, 'Duplicate scenario checks');
  assert.ok(report.checks.every(c => c.status === 'passed'), 'Scenario contains failed checks');
  assert.ok(report.transactions?.length > 40, 'Missing local scenario transactions');
  assert.equal(new Set(report.transactions.map(t => t.hash)).size, report.transactions.length);
  const hash = value => /^0x[0-9a-fA-F]{64}$/.test(value || '');
  assert.ok(hash(report.forkBlockHash) && Number.isSafeInteger(report.forkBlock) && report.forkBlock > 0);
  assert.ok(hash(report.deployment?.runtimeKeccak256) && hash(report.deployment?.transactionHash));
  assert.ok(hash(report.parleyCreationCodeKeccak256));
  assert.ok(report.completedAt && Number.isFinite(Date.parse(report.completedAt)));
  assert.ok(report.transactions.every((tx, i, all) => hash(tx.hash)
    && Number.isSafeInteger(tx.block) && tx.block > report.deployment.block
    && (i === 0 || tx.block > all[i - 1].block)), 'Invalid local transaction sequence');
}

export async function recordForkRun(root, action, takeSnapshot = () => sourceSnapshot(root)) {
  const snapshot = takeSnapshot();
  const startedAt = new Date().toISOString();
  const report = {
    startedAt, snapshotSha256: snapshot.sha256,
    sourceHash: snapshot.files['contracts/contracts/Parley.sol'],
    status: 'running', phase: 'initialization',
    mainnetBroadcast: false, walletAccess: false, tokenBalancesPatched: false,
    productionRelease: false,
  };
  try {
    await action(report);
    assert.deepEqual(takeSnapshot(), snapshot, 'Sources changed during fork execution');
    report.status = 'passed';
    report.completedAt = new Date().toISOString();
    const raw = Buffer.from(JSON.stringify(report));
    validateForkBinding({ reportSha256: sha256(raw), snapshotSha256: snapshot.sha256 },
      report, snapshot, raw);
  } catch {
    report.status = 'failed';
    // RPC exceptions may contain API keys, authenticated URLs or bearer tokens.
    report.failure = 'Fork prerequisites, scenario, canonical block or source binding failed; raw error omitted';
  }
  report.completedAt = new Date().toISOString();
  const file = `docs/reports/fork-${startedAt.replace(/[:.]/g, '-')}-${randomUUID()}.json`;
  fs.mkdirSync(path.join(root, 'docs/reports'), { recursive: true });
  const raw = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path.join(root, file), raw, { flag: 'wx' });
  const pointer = { report: file, reportSha256: sha256(raw),
    snapshotSha256: snapshot.sha256, status: report.status, completedAt: report.completedAt };
  fs.writeFileSync(path.join(root, 'docs/reports/fork-current.json'), JSON.stringify(pointer, null, 2) + '\n');
  return { report, pointer };
}
