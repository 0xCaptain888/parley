import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectDeploymentInputs } from '../../scripts/deployment-inputs.mjs';
import { acceptancePlan } from '../../scripts/acceptance-plan.mjs';
import { acceptanceSession, recordAcceptanceStep } from '../../scripts/acceptance-session.mjs';
import { sourceSnapshot, sha256 } from '../../scripts/evidence.mjs';
import { packageBusiness, runtimeEntries } from '../../operations/business/package.mjs';
import { participationKit } from '../../scripts/participation-kit.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const a = c => `0x${c.repeat(40)}`, snapshot = 'a'.repeat(64);
const config = { chainId: 56, contract: a('2'), deploymentBlock: 100,
  site: 'https://parley-staging.pages.dev', excluded: [], tokens: { USDT: a('4'), USDC: a('5') } };
const intent = () => ({ schemaVersion: 1, chainId: 56, deployer: a('1'), guardian: a('3'),
  site: config.site, defaultPostageBNB: '0', maxPostageBNB: '0.00001',
  minShareBNB: '0.0001', capBNB: '0.001', capUSDT: '1', capUSDC: '1', gasBudgetBNB: '0.001' });
test('deployment intake reports all six unresolved amounts without selecting defaults', () => {
  const input = intent();
  const fields = ['defaultPostageBNB', 'maxPostageBNB', 'capBNB', 'capUSDT', 'capUSDC', 'gasBudgetBNB'];
  for (const field of fields) input[field] = null;
  const before = structuredClone(input), report = inspectDeploymentInputs(input, config);
  assert.deepEqual(report.missing, fields);
  assert.deepEqual(input, before);
  assert.equal(report.status, 'blocked');
  assert.equal(report.inputsApproved, false);
  assert.equal(report.mainnetBroadcast, false);
  assert.equal(report.amountUnits.capUSDT, 'USDT');
  assert.equal(Object.hasOwn(report, 'units'), false);
});
test('actual parameter CLI preserves currency units instead of creating systemd files', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-parameter-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = intent(), file = path.join(dir, 'intent.json');
  for (const name of ['defaultPostageBNB', 'maxPostageBNB', 'capBNB', 'capUSDT', 'capUSDC', 'gasBudgetBNB'])
    input[name] = null;
  fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
  const run = spawnSync(process.execPath, ['scripts/launch-tools.mjs', 'parameters', '--intent', file],
    { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 2, run.stderr);
  const pointer = JSON.parse(run.stdout), reportFile = path.join(root, pointer.report);
  t.after(() => fs.rmSync(path.dirname(reportFile), { recursive: true, force: true }));
  const report = JSON.parse(fs.readFileSync(reportFile));
  assert.equal(report.missing.length, 6);
  assert.deepEqual(fs.readdirSync(path.dirname(reportFile)), ['report.json']);
  assert.equal(report.amountUnits.capUSDC, 'USDC');
  assert.equal(report.productionRelease, false);
});
test('deployment intake distinguishes malformed values, range failures and cross-field inconsistencies', () => {
  const report = inspectDeploymentInputs({ ...intent(), defaultPostageBNB: '0.002',
    maxPostageBNB: '0.001', capBNB: '0.00001', capUSDT: '1e3', capUSDC: '0',
    gasBudgetBNB: 'SECRET_INVALID' }, config);
  assert.deepEqual(report.invalid, ['capUSDT', 'capUSDC', 'gasBudgetBNB']);
  assert.equal(report.consistency.length, 3);
  assert.ok(!JSON.stringify(report).includes('SECRET_INVALID'));
  for (const patch of [{ maxPostageBNB: '19' }, { capBNB: '0.0000000000000000001' },
    { deployer: a('0') }, { site: 'https://example.com/path' }])
    assert.equal(inspectDeploymentInputs({ ...intent(), ...patch }, config).status, 'blocked');
  assert.throws(() => inspectDeploymentInputs({ ...intent(), privateKey: 'not-allowed' }, config));
});
test('complete parameters remain unapproved and do not estimate gas or authorize deployment', () => {
  const report = inspectDeploymentInputs(intent(), config);
  assert.equal(report.status, 'complete-needs-operator-approval');
  assert.deepEqual(report.missing, []);
  assert.equal(report.gasEstimated, false);
  assert.equal(report.productionRelease, false);
});
const ref = { path: 'docs/consent.json', sha256: sha256('genuine-supplied-by-operator') };
function fixture() {
  const plan = acceptancePlan(snapshot, { chainId: config.chainId, contract: config.contract,
    deploymentBlock: config.deploymentBlock, site: config.site });
  plan.participants.A = { handle: 'alice', wallet: a('6'), consentEvidence: ref };
  plan.participants.B = { handle: 'bob', wallet: a('7'), consentEvidence: ref };
  const input = { plan, config, snapshotSha256: snapshot,
    readEvidence: p => { assert.equal(p, ref.path); return Buffer.from('genuine-supplied-by-operator'); },
    now: Date.parse('2026-11-26T04:00:00Z') };
  return input;
}
const firstPatch = () => ({ id: 1, status: 'passed', performedAt: '2026-11-26T03:00:00Z',
  verifiedBy: 'operator', evidence: [ref], transactions: [] });
test('session reports prerequisites and the actual next step without executing it', () => {
  const report = acceptanceSession(fixture());
  assert.equal(report.status, 'blocked');
  assert.equal(report.nextStep.id, 1);
  assert.equal(report.nextStep.individualTransactionConsentRequired, false);
  assert.ok(report.blockers.includes('INDEPENDENT_REVIEW_REQUIRED'));
  assert.equal(report.completedSteps, 0);
  assert.equal(report.automaticExecution, false);
});
test('recorder preserves the source record and records one evidence-backed step without certifying authenticity', () => {
  const input = fixture(), before = structuredClone(input.plan);
  const { plan, inspection } = recordAcceptanceStep({ ...input, patch: firstPatch() });
  assert.deepEqual(input.plan, before);
  assert.equal(plan.steps[0].status, 'passed');
  assert.equal(plan.steps[1].status, 'pending');
  assert.equal(inspection.completedSteps, 1);
  assert.equal(inspection.chainReceiptsIndependentlyVerified, false);
  assert.equal(inspection.participantIndependenceVerified, false);
  assert.equal(inspection.productionRelease, false);
  assert.equal(acceptanceSession({ ...input, plan }).nextStep.id, 2);
});
test('recorder refuses skipped steps, forged structure, evidence changes, stale source and incomplete transactions', () => {
  for (const patch of [{ ...firstPatch(), id: 2 }, { ...firstPatch(), action: 'changed' },
    { ...firstPatch(), evidence: [] }, { ...firstPatch(), verifiedBy: '' },
    { ...firstPatch(), status: 'pending' }, { ...firstPatch(), performedAt: '2099-01-01T00:00:00Z' }])
    assert.throws(() => recordAcceptanceStep({ ...fixture(), patch }));
  const input = fixture();
  assert.throws(() => recordAcceptanceStep({ ...input, snapshotSha256: 'b'.repeat(64), patch: firstPatch() }));
  assert.throws(() => recordAcceptanceStep({ ...input, readEvidence: () => Buffer.from('altered'), patch: firstPatch() }));
  const { plan } = recordAcceptanceStep({ ...input, patch: firstPatch() });
  assert.throws(() => recordAcceptanceStep({ ...input, plan, patch: { ...firstPatch(), id: 2 } }), /receipts/);
  assert.throws(() => recordAcceptanceStep({ ...input, plan, patch: firstPatch() }), /next/);
  assert.throws(() => recordAcceptanceStep({ ...fixture(), patch: { ...firstPatch(),
    transactions: [{ hash: 'unexpected' }] } }), /Read-only/);
});
test('participation kit creates all twenty empty patches and never invents consent, interviews or growth', () => {
  const participants = { A: { handle: 'btc123456.ai', wallet: a('6') },
    B: { handle: 'captain888.ai', wallet: a('7') } };
  const kit = participationKit({ intent: intent(), participants, config, snapshotSha256: snapshot });
  assert.equal(Object.keys(kit.files).filter(name => name.startsWith('steps/')).length, 20);
  assert.equal(kit.files['acceptance.json'].steps.filter(s => s.status === 'passed').length, 0);
  assert.equal(kit.files['acceptance.json'].participants.A.handle, 'btc123456');
  assert.equal(kit.files['acceptance.json'].participants.B.consentEvidence, null);
  assert.equal(kit.files['participant-B-consent.json'].consentedToTest, null);
  assert.equal(kit.files['submission.json'].consentedForPublication, false);
  assert.equal(kit.files['growth-template.json'].actualParticipants, null);
  assert.equal(kit.files['interview-template.json'].notes.every(note => note.answer === null), true);
  for (const name of Object.keys(kit.files).filter(name => name.startsWith('steps/')))
    assert.equal(kit.files[name].status, null);
  assert.equal(kit.publicUpload, false);
  assert.throws(() => participationKit({ intent: intent(), config, snapshotSha256: snapshot,
    participants: { ...participants, B: participants.A } }), /Different/);
  assert.throws(() => participationKit({ intent: intent(), config, snapshotSha256: snapshot,
    participants: { ...participants, B: { ...participants.B, token: 'NOT_ALLOWED' } } }));
});
test('source snapshots now bind cloud installers, timers and wallet guards', () => {
  const files = sourceSnapshot(root).files;
  for (const name of ['operations/agent/unlock-keyring.sh', 'operations/agent/wallet-secure.mjs',
    'operations/linux/parley-telegram.timer', 'operations/business/install-business.sh'])
    assert.equal(files[name], sha256(fs.readFileSync(path.join(root, name))));
});
test('business package has self-contained syntax-valid jobs, no private state, and fails closed before networking', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-business-package-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const output = path.join(parent, 'output'), report = await packageBusiness(output);
  assert.equal(report.installed, false);
  const directory = path.join(output, 'business');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  assert.equal(manifest.sourceSnapshotSha256, sourceSnapshot(root).sha256);
  for (const [file, hash] of Object.entries(manifest.files))
    assert.equal(sha256(fs.readFileSync(path.join(directory, file))), hash);
  for (const entry of runtimeEntries) {
    const result = spawnSync(process.execPath, ['--check', path.join(directory, entry)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const run = entry => spawnSync(process.execPath, [path.join(directory, entry)], {
    encoding: 'utf8', timeout: 5000, env: { HOME: parent, PATH: path.dirname(process.execPath) },
  });
  assert.equal(JSON.parse(run('scripts/ops-job.mjs').stderr).code, 'OPS_JOB_FAILED');
  const stats = run('scripts/stats-runner.mjs');
  assert.equal(stats.status, 2);
  assert.equal(stats.stdout, '');
  assert.equal(JSON.parse(stats.stderr).code, 'STATS_COLLECTION_FAILED');
  assert.equal(JSON.parse(run('scripts/resident-ops.mjs').stdout).code, 'RESIDENT_INSPECTION_FAILED');
  assert.ok(!fs.existsSync(path.join(directory, 'web')));
  await assert.rejects(packageBusiness(output), /Exclusive/);
});
test('runtime installer is explicit, first-install-only and never starts services or invokes a wallet', () => {
  const file = path.join(root, 'operations/business/install-business.sh');
  const source = fs.readFileSync(file, 'utf8');
  assert.equal(spawnSync('bash', ['-n', file]).status, 0);
  assert.match(source, /--approve-business-runtime-only/);
  assert.match(source, /test ! -e \/opt\/parley-business/);
  assert.ok(!/\bsystemctl\b|\bbaw\b|\bnpm\b|\bcurl\b|\/bin\/sh/.test(source));
});
