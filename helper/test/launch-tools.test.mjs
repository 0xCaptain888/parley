import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import { currentBuild } from '../../scripts/build-info.mjs';
import { sha256, readContainedEvidence } from '../../scripts/evidence.mjs';
import { deploymentPlan } from '../../scripts/deployment-plan.mjs';
import { acceptancePlan } from '../../scripts/acceptance-plan.mjs';
import { inspectAcceptance } from '../../scripts/acceptance-evidence.mjs';
import { downloadExact, checkSkillInstall, inspectSkillArchive } from '../../scripts/install-check.mjs';
import { residentServicePlan } from '../../scripts/resident-service.mjs';
import { sanitizedWalletSettings, inspectWallet } from '../../scripts/wallet-inspection.mjs';
import { publicFiles } from '../../scripts/site-release.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const a = n => `0x${n.repeat(40)}`, h = n => `0x${n.repeat(64)}`;
const snapshot = 'a'.repeat(64);
const config = () => ({ chainId: 56, registry: a('1'), contract: a('2'), deploymentBlock: 100,
  site: 'https://parley-staging.pages.dev', resident: 'resident', excluded: [a('3')],
  tokens: { USDT: a('4'), USDC: a('5') } });
const intent = () => ({ schemaVersion: 1, chainId: 56, deployer: a('3'), guardian: a('6'),
  site: 'https://parley-staging.pages.dev', defaultPostageBNB: '0.000001', maxPostageBNB: '0.00001',
  minShareBNB: '0.000001', capBNB: '0.001', capUSDT: '1', capUSDC: '2', gasBudgetBNB: '0.001' });

test('deployment plan encodes exact compiler constructor data without choosing a factory or broadcasting', () => {
  const build = currentBuild(root);
  const plan = deploymentPlan({ intent: intent(), config: config(), build, snapshotSha256: snapshot });
  const args = plan.constructorArgs;
  const encoded = encodeAbiParameters(parseAbiParameters('address,address,uint64,uint64,uint128,address[],uint256[]'),
    [args[0], args[1], BigInt(args[2]), BigInt(args[3]), BigInt(args[4]), args[5], args[6].map(BigInt)]);
  assert.equal(plan.creationInput, `0x${build.output.contracts['contracts/Parley.sol'].Parley.evm.bytecode.object}${encoded.slice(2)}`);
  assert.equal(plan.guardian, a('6')); assert.equal(plan.maximumGasSpendWei, '1000000000000000');
  assert.equal(plan.mainnetBroadcast, false); assert.equal(plan.bscscanVerified, false);
  const freePostage = deploymentPlan({ intent: { ...intent(), defaultPostageBNB: '0', maxPostageBNB: '0' },
    config: config(), build, snapshotSha256: snapshot });
  assert.deepEqual(freePostage.constructorArgs.slice(2, 4), ['0', '0']);
});
test('deployment plan fails closed on missing values, zero identities, precision, ABI range and budget inconsistencies', () => {
  for (const patch of [{ guardian: null }, { deployer: a('0') }, { chainId: 97 }, { capUSDT: '1e6' },
    { gasBudgetBNB: '0' }, { minShareBNB: '0.002' }, { defaultPostageBNB: '0.001' },
    { maxPostageBNB: '19' }, { capBNB: '0.0000000000000000001' },
    { site: 'https://parley-staging.pages.dev/path' }])
    assert.throws(() => deploymentPlan({ intent: { ...intent(), ...patch }, config: config(),
      build: currentBuild(root), snapshotSha256: snapshot }));
});

const now = Date.parse('2026-11-24T08:00:00Z');
const ref = { path: 'docs/evidence.json', sha256: sha256('evidence') };
function acceptanceFixture(count = 2) {
  const c = config(), plan = acceptancePlan(snapshot, {
    chainId: c.chainId, contract: c.contract, deploymentBlock: c.deploymentBlock, site: c.site,
  });
  plan.participants = { A: { handle: 'alice', wallet: a('7'), consentEvidence: ref },
    B: { handle: 'bob', wallet: a('8'), consentEvidence: ref }, guardian: { wallet: a('6') } };
  const tx = (n, from = a('7')) => ({ hash: `0x${n.toString(16).padStart(64, '0')}`, chainId: 56,
    from, to: c.contract, valueWei: '0', kind: 'business', receiptStatus: 'success', block: 101,
    blockHash: h('9'), requestId: `preview-${n}`, previewedAt: '2026-11-24T07:00:00Z',
    previewExpiresAt: '2026-11-24T07:05:00Z', consentedAt: '2026-11-24T07:01:00Z',
    confirmedAt: '2026-11-24T07:02:00Z', previewEvidence: ref, consentEvidence: ref,
    receiptEvidence: ref, assetDeltaEvidence: ref });
  for (const s of plan.steps.slice(0, count)) {
    Object.assign(s, { status: 'passed', performedAt: '2026-11-24T07:03:00Z', verifiedBy: 'operator', evidence: [ref] });
    if (['transaction', 'transactions', 'mixed'].includes(s.kind))
      s.transactions = [tx(s.id, s.actor.startsWith('B') ? a('8') : a('7'))];
    if (s.kind === 'rejection') Object.assign(s, { noCallsProduced: true, policyBeforeSha256: snapshot,
      policyAfterSha256: snapshot, expectedError: s.id === 5 ? 'ALREADY_CLAIMED' : 'OVER_POLICY_TX' });
  }
  const inspect = () => inspectAcceptance({ plan, config: c, snapshotSha256: snapshot, now,
    readEvidence: p => { assert.equal(p, ref.path); return Buffer.from('evidence'); } });
  return { plan, c, inspect, tx };
}
test('acceptance pending records remain pending and supplied records never imply independently verified real users', () => {
  const f = acceptanceFixture(0);
  assert.equal(f.inspect().completedSteps, 0);
  const full = acceptanceFixture(20).inspect();
  assert.equal(full.completedSteps, 20);
  assert.equal(full.status, 'evidence-complete-needs-independent-review');
  assert.equal(full.chainReceiptsIndependentlyVerified, false);
  assert.equal(full.participantIndependenceVerified, false); assert.equal(full.productionRelease, false);
});
test('acceptance rejects changed steps, stale source, same participant, missing consent and wrong deployment', () => {
  for (const mutate of [
    f => f.plan.snapshotSha256 = 'b'.repeat(64), f => f.plan.steps[1].command = 'execute-anything',
    f => f.plan.steps[0].status = 'pending', f => f.plan.participants.B.wallet = a('7'),
    f => f.plan.participants.A.consentEvidence = { ...ref, sha256: 'b'.repeat(64) },
    f => f.plan.deployment.contract = a('9'), f => f.plan.steps[1].evidence = [],
    f => f.plan.steps[1].performedAt = '2099-01-01T00:00:00Z',
  ]) { const f = acceptanceFixture(); mutate(f); assert.throws(f.inspect); }
});
test('acceptance validates exact targets, participant senders, separate receipts and consent chronology', () => {
  for (const mutate of [
    tx => tx.chainId = 97, tx => tx.to = a('1'), tx => tx.from = a('8'),
    tx => tx.receiptStatus = 'reverted', tx => tx.block = 99, tx => tx.valueWei = '-1',
    tx => tx.consentedAt = '2026-11-24T07:06:00Z', tx => tx.previewedAt = '2026-11-24T07:02:00Z',
    tx => delete tx.consentEvidence, tx => delete tx.previewEvidence, tx => delete tx.assetDeltaEvidence,
  ]) { const f = acceptanceFixture(); mutate(f.plan.steps[1].transactions[0]); assert.throws(f.inspect); }
  const f = acceptanceFixture(3);
  f.plan.steps[2].transactions[0].hash = f.plan.steps[1].transactions[0].hash;
  assert.throws(f.inspect, /reused/);
});
test('acceptance rejects fake rejection and token approval to an unexpected spender', () => {
  const f = acceptanceFixture(5);
  f.plan.steps[4].policyAfterSha256 = 'b'.repeat(64); assert.throws(f.inspect, /policy/);
  const g = acceptanceFixture(2), tx = g.plan.steps[1].transactions[0];
  Object.assign(tx, { kind: 'approval', to: g.c.tokens.USDT, spender: a('9'), amountRaw: '1' });
  assert.throws(g.inspect, /spender/);
});
test('acceptance evidence path containment rejects directory traversal and symlink escapes', () => {
  assert.throws(() => readContainedEvidence(root, '../outside'));
  const f = acceptanceFixture(); f.plan.steps[0].evidence[0] = { ...ref, path: '../outside' };
  assert.throws(f.inspect);
});

test('download bounds refuse redirects, truncation, incorrect digest and oversized streamed bodies', async () => {
  const bytes = Buffer.from('abc'), entry = { bytes: 3, sha256: sha256(bytes) };
  assert.deepEqual(await downloadExact('https://example.com/file', entry, async () => new Response(bytes)), bytes);
  for (const response of [new Response(bytes, { status: 302 }), new Response('ab'),
    new Response('abd'), new Response('abcd'), new Response(bytes, { headers: { 'content-length': '9' } })])
    await assert.rejects(downloadExact('https://example.com/file', entry, async (_url, opts) => {
      assert.equal(opts.redirect, 'error'); return response;
    }));
});
function installFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-install-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = Object.fromEntries(publicFiles.map(name => [name, Buffer.from(`fixture ${name}`)]));
  files['skill/parley.mjs'] = Buffer.from('console.log(JSON.stringify({ok:true,command:"help",chainId:56,configured:false}));');
  for (const name of ['SKILL.md', 'parley.mjs']) fs.writeFileSync(path.join(dir, name), files[`skill/${name}`]);
  execFileSync('zip', ['-X', '-q', path.join(dir, 'parley.zip'), 'SKILL.md', 'parley.mjs'], { cwd: dir });
  files['skill/parley.zip'] = fs.readFileSync(path.join(dir, 'parley.zip'));
  files['skill/SHA256SUMS'] = Buffer.from(['SKILL.md', 'parley.mjs', 'parley.zip']
    .map(n => `${sha256(files[`skill/${n}`])}  ${n}`).join('\n') + '\n');
  const c = { ...config(), contract: null, deploymentBlock: null, resident: null, excluded: [],
    multicall: a('9'), rpcs: ['https://bsc-rpc.publicnode.com'] };
  const manifest = { schemaVersion: 1, mode: 'staging', config: c, sourceSnapshotSha256: snapshot,
    files: Object.fromEntries(Object.entries(files).map(([name, b]) => [name,
      { bytes: b.length, sha256: sha256(b), mutable: false }])) };
  return { manifest, files };
}
test('public install uses trusted manifest, exact zip entries and a fresh HOME, without wallet execution', async t => {
  const { manifest, files } = installFixture(t);
  const report = await checkSkillInstall({ origin: 'https://parley-staging.pages.dev', manifest,
    readTrusted: relative => files[relative],
    fetcher: async url => new Response(files[new URL(url).pathname.slice(1)]) });
  assert.equal(report.status, 'passed'); assert.equal(report.freshHomeSmoke, true);
  assert.equal(report.cleanMachineSkillInstall, false); assert.equal(report.walletAccess, false);
  await assert.rejects(checkSkillInstall({ origin: 'http://example.com', manifest, readTrusted: () => Buffer.alloc(0) }));
  await assert.rejects(checkSkillInstall({ origin: 'https://example.com', manifest, readTrusted: () => Buffer.from('wrong') }),
    /trusted Skill/);
});
test('archive members cannot inject files, and standalone contents must match archive bytes', t => {
  const { files } = installFixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parley-archive-test-'));
  try {
    const zip = files['skill/parley.zip'];
    assert.throws(() => inspectSkillArchive(zip, { 'SKILL.md': Buffer.from('wrong') }, dir), /differ/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

function residentFixture() {
  const build = config(), from = a('3'), stateDir = path.join(root, 'resident/state', `56-${build.contract.slice(2, 10)}`, from);
  return { config: { from, home: '/private/tmp/parley-private-home', mode: 'manual', rpc: null,
    logRpc: 'https://bsc-rpc.publicnode.com', dailyBNB: '0.002', perTxBNB: '0.001', perTxUSD: '1',
    giftEach: '0.000001', publicPacket: { total: '0.00002', shares: 2 }, welcome: 'Hello',
    pricesUpdatedAt: Math.floor(now / 1000) - 60, pricesUSD: { BNB: '1', USDT: '1', USDC: '1' } },
  build, binding: { chainId: 56, contract: build.contract, from }, root, node: process.execPath,
  configPath: '/private/tmp/config.local.json', buildPath: '/private/tmp/build.json', stateDir,
  logs: '/private/tmp/private-logs', now: Math.floor(now / 1000) };
}
test('resident launch jobs use explicit argv, restricted umask, one-shot queueing, health and local stats only', () => {
  const p = residentServicePlan(residentFixture());
  assert.equal(Object.keys(p.jobs).length, 3);
  assert.match(p.jobs['dev.parley.resident'], /ops-job.mjs/);
  assert.match(p.jobs['dev.parley.resident'], /<string>resident<\/string>/);
  assert.match(p.jobs['dev.parley.resident'], /<key>RunAtLoad<\/key><false\/>/);
  assert.match(p.jobs['dev.parley.resident'], /<key>Umask<\/key><integer>63/);
  assert.ok(!/--approve|--preview|execute|\/bin\/sh/.test(Object.values(p.jobs).join('')));
  assert.equal(p.automaticSigning, false); assert.equal(p.serviceInstalled, false);
  assert.equal(p.logRotationPrepared, true);
});
test('resident preparation rejects wrong state, stale prices, excess budget, automatic mode and missing exclusions', () => {
  for (const mutate of [
    f => f.config.mode = 'auto', f => f.build.excluded = [], f => f.config.pricesUpdatedAt -= 86400,
    f => f.config.pricesUpdatedAt += 1000, f => f.config.perTxBNB = '1',
    f => f.config.publicPacket.shares = 3, f => f.binding.contract = a('9'),
    f => f.stateDir = '/private/tmp/other', f => f.config.home = null,
    f => f.config.logRpc = 'https://user:password@example.com',
  ]) { const f = residentFixture(); mutate(f); assert.throws(() => residentServicePlan(f)); }
});
test('resident plist XML escapes filesystem paths without shell interpretation', () => {
  const f = residentFixture(); f.configPath = '/private/tmp/a & b/config.json';
  assert.match(residentServicePlan(f).jobs['dev.parley.resident'], /a &amp; b/);
});

const walletSettings = () => ({ success: true, data: { sessionExpireTime: '2026-11-25T01:42:15Z',
  dailyLimit: 50000, quotaLeft: 50000, developerModeQuotaUsed: 0, abnormalTxnHandling: 'AutoReject',
  sessionToken: 'MUST_NOT_APPEAR', clientId: 'MUST_NOT_APPEAR',
  devMode: { enabled: true, expiresAt: '2026-11-29T14:37:40Z', dailyLimit: 1000, balanceExceeded: false } } });
test('wallet inspection only retains explicitly allowed settings and handles ISO and numeric expiration', () => {
  let s = sanitizedWalletSettings(walletSettings(), now);
  assert.equal(s.externalSigningReady, true);
  assert.ok(!JSON.stringify(s).includes('MUST_NOT_APPEAR'));
  const raw = walletSettings(); raw.data.devMode.expiresAt = Date.parse('2026-11-29T14:37:40Z') / 1000;
  assert.deepEqual(sanitizedWalletSettings(raw, now), s);
  raw.data.devMode.enabled = false; s = sanitizedWalletSettings(raw, now);
  assert.equal(s.externalSigningReady, false); assert.equal(s.devMode.expiresAt, null);
  raw.data.sessionExpireTime = 'not-a-date'; assert.throws(() => sanitizedWalletSettings(raw, now));
});
test('wallet preflight stops when disconnected or an update needs human review, never signs in itself', async () => {
  for (const update of [false, true]) {
    const calls = [];
    const p = await inspectWallet(async args => {
      calls.push(args.join(' '));
      if (args[0] === 'skill-check') return { data: { needUpdateSkill: update } };
      if (args[0] === 'cli-check') return { success: true, data: { needUpdateCli: false } };
      return { success: true, data: { status: 'UNCONNECTED' } };
    }, now);
    assert.equal(p.status, update ? 'skill-update-needs-user-confirmation' : 'not-connected');
    assert.equal(calls.length, update ? 1 : 3);
  }
});
test('connected wallet check reads status then settings then BSC address and lock, with no signing API', async () => {
  const calls = [];
  const p = await inspectWallet(async args => {
    calls.push(args.join(' '));
    if (args[0] === 'skill-check') return { data: { needUpdateSkill: false } };
    if (args[0] === 'cli-check') return { success: true, data: { needUpdateCli: false } };
    if (args[1] === 'status') return { success: true, data: { status: 'CONNECTED' } };
    if (args[1] === 'settings') return walletSettings();
    if (args[1] === 'address') return { success: true, data: { addresses: [{ binanceChainId: 56, address: a('7') }] } };
    return { success: true, data: { status: 'UNLOCKED' } };
  }, now);
  assert.equal(p.from, a('7')); assert.equal(p.transactionLock, 'UNLOCKED');
  assert.deepEqual(calls.slice(2), ['wallet status', 'wallet settings', 'wallet address', 'wallet tx-lock --binanceChainId 56']);
  assert.ok(!JSON.stringify(p).includes('MUST_NOT_APPEAR'));
});
