import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, zeroAddress, keccak256 } from 'viem';
import { abi, tokenAbi } from '../src/chain.mjs';
import { sha256 } from '../../scripts/evidence.mjs';
import { acceptancePlan } from '../../scripts/acceptance-plan.mjs';
import { inspectAcceptanceChain } from '../../scripts/acceptance-chain.mjs';
import { inspectDeploymentReadiness } from '../../scripts/deployment-readiness.mjs';
import { publicIP, validateOperations, alertPayload, monitorHealth, writeOperationalLog, safePath, postAlert } from '../../scripts/operational-monitor.mjs';
import { inspectPublication, writePublication } from '../../scripts/publication-plan.mjs';
import { publicFiles } from '../../scripts/site-release.mjs';
import { submissionPlan } from '../../scripts/submission-plan.mjs';
import { walletVersions, sanitizedWalletSettings } from '../../scripts/wallet-inspection.mjs';
import { aggregate } from '../../web/stats/aggregate.mjs';
import { residentServicePlan } from '../../scripts/resident-service.mjs';
import { inspectOperationsSoak } from '../../scripts/operations-soak.mjs';
import { walletEnvironment } from '../../scripts/wallet-runtime.mjs';

const a = n => `0x${n.repeat(40)}`, h = n => `0x${n.repeat(64)}`;
const now = Date.parse('2026-11-24T08:00:00Z'), seconds = now / 1000, snapshot = 'a'.repeat(64);
const config = () => ({ chainId: 56, registry: a('1'), contract: a('2'), deploymentBlock: 100,
  site: 'https://parley-staging.pages.dev', resident: 'resident', excluded: [a('3')],
  multicall: a('9'), rpcs: ['https://bsc-rpc.publicnode.com'], tokens: { USDT: a('4'), USDC: a('5') } });
const temporary = t => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'parley-operations-test-')));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const operations = () => ({ schemaVersion: 1, logs: { maxBytes: 1024, keep: 2 },
  alerts: { enabled: true, webhook: 'https://alerts.example.com/hook/PRIVATE', cooldownSeconds: 300 } });
const health = (status = 'critical') => ({ status, checkedAt: seconds, privateMail: 'SECRET',
  checks: status === 'healthy' ? [] : [{ code: 'TICK_FRESH', status }] });

test('updated wallet versions and balance cap are enforced without enabling signing', () => {
  assert.deepEqual(walletVersions, { skill: '1.15.0', cli: '1.12.0' });
  const raw = { success: true, data: { sessionExpireTime: '2026-11-25T00:00:00Z', dailyLimit: 50000, quotaLeft: 50000,
    devMode: { enabled: true, expiresAt: '2026-11-29T00:00:00Z', balanceExceeded: true, dailyLimit: 1000 } } };
  assert.equal(sanitizedWalletSettings(raw, now).externalSigningReady, false);
  delete raw.data.devMode.balanceExceeded;
  assert.throws(() => sanitizedWalletSettings(raw, now), /balance-cap/);
});
test('wallet subprocess uses the explicitly selected Node runtime without changing the global environment', () => {
  const env = { PATH: '/usr/bin', OTHER: 'retained' };
  const result = walletEnvironment(process.execPath, env);
  assert.equal(result.PATH.split(path.delimiter)[0], path.dirname(fs.realpathSync(process.execPath)));
  assert.equal(result.OTHER, 'retained'); assert.deepEqual(env, { PATH: '/usr/bin', OTHER: 'retained' });
  assert.throws(() => walletEnvironment('node', env), /absolute/);
  assert.throws(() => walletEnvironment('/bin/sh', env), /Node runtime/);
});

test('alert configuration refuses extra fields, bad retention and non-HTTPS destinations', () => {
  assert.equal(validateOperations(operations()).alerts.enabled, true);
  for (const change of [
    c => c.token = 'secret', c => c.logs.keep = 0, c => c.logs.maxBytes = 1,
    c => c.alerts.webhook = 'http://example.com', c => c.alerts.webhook = 'https://user:pass@example.com',
    c => c.alerts.cooldownSeconds = 1, c => c.alerts.enabled = false,
  ]) { const c = operations(); change(c); assert.throws(() => validateOperations(c)); }
});
test('webhook DNS refuses loopback, private, reserved and mixed answers before opening a connection', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1',
    '192.168.0.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', '::ffff:127.0.0.1',
    'fd00::1', '2001:db8::1', '2001:0db8::1', '2001::1', '2002:7f00:1::1', '3fff::1'])
    assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP('1.1.1.1'), true);
  assert.equal(publicIP('2606:4700:4700::1111'), true);
  await assert.rejects(postAlert(operations().alerts.webhook, {}, async () =>
    [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]), /Private/);
});
test('alerts send only allowlisted health codes and deployment, never raw messages or webhook URLs', () => {
  const p = alertPayload(health(), config());
  assert.ok(!JSON.stringify(p).includes('SECRET'));
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
  assert.throws(() => alertPayload({ ...health(), status: 'healthy' }, config()), /mismatch/);
  assert.throws(() => alertPayload({ ...health(), checks: [{ code: 'mail text', status: 'critical' }] }, config()));
});
test('alerts deduplicate, remind after cooldown, send recovery, and never claim failed delivery succeeded', async t => {
  const stateDir = temporary(t), calls = [];
  const invoke = (report, time = seconds, deliver = async (_url, body) => calls.push(body)) =>
    monitorHealth({ report, deployment: config(), operations: operations(), stateDir, now: time, deliver });
  assert.equal((await invoke(health())).status, 'alert-delivered');
  assert.equal((await invoke(health())).status, 'cooldown');
  const later = { ...health(), checkedAt: seconds + 301 };
  assert.equal((await invoke(later, seconds + 301)).status, 'alert-delivered');
  assert.equal((await invoke({ ...health('healthy'), checkedAt: seconds + 302 }, seconds + 302)).status, 'recovery-delivered');
  assert.equal((await invoke({ ...health('healthy'), checkedAt: seconds + 604 }, seconds + 604)).status, 'healthy-no-alert');
  const before = fs.readFileSync(path.join(stateDir, 'alert-state.json'));
  await assert.rejects(invoke({ ...health('warning'), checkedAt: seconds + 303 }, seconds + 303,
    async () => { throw new Error('network'); }));
  assert.deepEqual(fs.readFileSync(path.join(stateDir, 'alert-state.json')), before);
  assert.equal(calls.length, 3);
});
test('disabled, stale, cross-deployment and concurrent monitor runs do not deliver', async t => {
  const stateDir = temporary(t);
  const invoke = options => monitorHealth({ report: health(), deployment: config(), operations: operations(),
    stateDir, now: seconds, deliver: async () => assert.fail('Must not deliver'), ...options });
  const disabled = operations(); disabled.alerts = { ...disabled.alerts, enabled: false, webhook: null };
  assert.equal((await invoke({ operations: disabled })).delivered, false);
  await assert.rejects(invoke({ now: seconds + 301 }), /Stale/);
  fs.writeFileSync(path.join(stateDir, '.lock'), '', { mode: 0o600 });
  await assert.rejects(invoke({}), /状态目录/);
  fs.unlinkSync(path.join(stateDir, '.lock'));
  fs.writeFileSync(path.join(stateDir, 'alert-state.json'), JSON.stringify({ contract: a('9') }), { mode: 0o600 });
  await assert.rejects(invoke({}), /deployment mismatch/);
});
test('runner-owned logs rotate with bounded retention and reject symlink/private-permission violations', t => {
  const directory = temporary(t);
  for (let i = 0; i < 9; i++) writeOperationalLog(directory, 'health', { i, content: 'x'.repeat(600) }, operations().logs);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['health.jsonl', 'health.jsonl.1', 'health.jsonl.2']);
  for (const name of fs.readdirSync(directory)) {
    const stat = fs.statSync(path.join(directory, name));
    assert.ok(stat.size <= 1024); assert.equal(stat.mode & 0o077, 0);
  }
  assert.throws(() => writeOperationalLog(directory, 'unknown', {}, operations().logs));
  const link = path.join(directory, 'resident.jsonl'); fs.symlinkSync(path.join(directory, 'health.jsonl'), link);
  assert.throws(() => writeOperationalLog(directory, 'resident', {}, operations().logs), /Symlink/);
  fs.chmodSync(directory, 0o755); assert.throws(() => safePath(directory, { directory: true, privateMode: true }), /permissions/);
});
test('actual one-shot health runner emits sanitized rotating logs without changing state or accessing a wallet', t => {
  const dir = temporary(t), stateDir = path.join(dir, 'state'), logs = path.join(dir, 'logs');
  fs.mkdirSync(stateDir, { mode: 0o700 }); fs.mkdirSync(logs, { mode: 0o700 });
  const c = { from: a('3'), mode: 'manual', dailyBNB: '0.001', perTxBNB: '0.0001',
    pricesUpdatedAt: seconds, pricesUSD: { BNB: '1', USDT: '1', USDC: '1' }, privateMail: 'MUST_NOT_APPEAR' };
  const build = config(), state = { queue: [], gifted: [], welcomed: [], privateMail: 'MUST_NOT_APPEAR',
    lastTickAt: seconds, lastInboxAt: seconds, publicDate: '2026-11-24' };
  const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj), { mode: 0o600 });
  write(path.join(dir, 'config.json'), c); write(path.join(dir, 'build.json'), build);
  write(path.join(stateDir, 'state.json'), state);
  write(path.join(stateDir, 'deployment.json'), { chainId: 56, contract: build.contract, from: c.from });
  const source = fs.readFileSync(path.join(stateDir, 'state.json'));
  const r = spawnSync(process.execPath, ['scripts/ops-job.mjs', 'health', '--config', path.join(dir, 'config.json'),
    '--build', path.join(dir, 'build.json'), '--state-dir', stateDir, '--logs', logs],
  { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 2, r.stderr);
  const record = JSON.parse(r.stdout);
  assert.equal(record.alert.status, 'alerts-disabled');
  const log = fs.readFileSync(path.join(logs, 'health.jsonl'), 'utf8');
  assert.ok(!log.includes('MUST_NOT_APPEAR'));
  assert.deepEqual(fs.readFileSync(path.join(stateDir, 'state.json')), source);
});
test('service plan binds explicit operations configuration and never contains alert secrets or signing flags', () => {
  const build = config(), root = '/private/tmp/project', from = a('3'), binding = { chainId: 56, contract: build.contract, from };
  const c = { from, mode: 'manual', home: '/private/tmp/home', operationsPath: '/private/tmp/ops.json',
    logRpc: 'https://bsc-rpc.publicnode.com', dailyBNB: '0.01', perTxBNB: '0.001', perTxUSD: '1',
    giftEach: '0.000001', publicPacket: { total: '0.00002', shares: 2 }, welcome: 'hello',
    pricesUpdatedAt: seconds, pricesUSD: { BNB: '1', USDT: '1', USDC: '1' } };
  const input = { config: c, build, binding, root, node: process.execPath, configPath: '/private/tmp/config.json',
    buildPath: '/private/tmp/build.json', stateDir: `${root}/resident/state/56-22222222/${from}`,
    logs: '/private/tmp/logs', operations: operations(), now: seconds };
  const r = residentServicePlan(input);
  assert.equal(r.alertDeliveryConfigured, true); assert.equal(r.serviceInstalled, false);
  assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  assert.ok(!JSON.stringify(r.jobs).includes('--approve'));
  input.operations = null; assert.throws(() => residentServicePlan(input));
});

function chainFixture(count = 2) {
  const c = config(), plan = acceptancePlan(snapshot, {
    chainId: c.chainId, contract: c.contract, deploymentBlock: c.deploymentBlock, site: c.site });
  const files = new Map(), txs = new Map(), receipts = new Map();
  const ref = (name, value) => {
    const raw = Buffer.from(JSON.stringify(value)); files.set(name, raw); return { path: name, sha256: sha256(raw) };
  };
  const consent = ref('consent.json', { synthetic: true });
  plan.participants = { A: { handle: 'alice', wallet: a('7'), consentEvidence: consent },
    B: { handle: 'bob', wallet: a('8'), consentEvidence: consent }, guardian: { wallet: a('6') } };
  const methods = { 2: ['openMailbox'], 3: ['createPacket'], 4: ['claimPacket'], 6: ['sendMessage'],
    8: ['blockHandle', 'unblockHandle'], 9: ['sendMessage'], 10: ['sendMessage'], 11: ['requestPayment'],
    12: ['approve', 'payRequest'] };
  const dummy = parameter => {
    if (parameter.type === 'tuple') return Object.fromEntries(parameter.components.map(p => [p.name, dummy(p)]));
    if (parameter.type.endsWith('[]')) return [];
    if (parameter.type === 'address') return c.tokens.USDT;
    if (parameter.type === 'string') return 'alice';
    if (parameter.type === 'bool') return false;
    if (parameter.type === 'bytes') return '0x00';
    if (parameter.type === 'bytes32') return h('1');
    return 1n;
  };
  let index = 0;
  for (const s of plan.steps.slice(0, count)) {
    Object.assign(s, { status: 'passed', performedAt: '2026-11-24T07:03:00Z', verifiedBy: 'synthetic-test',
      evidence: [consent], transactions: [] });
    if (s.kind === 'rejection') Object.assign(s, { noCallsProduced: true, policyBeforeSha256: snapshot,
      policyAfterSha256: snapshot, expectedError: s.id === 5 ? 'ALREADY_CLAIMED' : 'OVER_POLICY_TX' });
    for (const method of methods[s.id] || []) {
      const approval = method === 'approve', target = approval ? c.tokens.USDT : c.contract;
      const functionAbi = approval ? tokenAbi : abi, fn = functionAbi.find(f => f.type === 'function' && f.name === method);
      const args = approval ? [c.contract, 1n] : fn.inputs.map(dummy);
      const data = encodeFunctionData({ abi: functionAbi, functionName: method, args });
      const from = s.actor.startsWith('B') ? a('8') : a('7'), hash = `0x${(++index).toString(16).padStart(64, '0')}`;
      const preview = { schemaVersion: 1, requestId: `synthetic-${index}`, chainId: 56, from, to: target,
        data, valueWei: '0', previewedAt: '2026-11-24T07:00:00Z', expiresAt: '2026-11-24T07:05:00Z' };
      const eventName = approval ? 'Approval' : 'MailboxOpened';
      const eventArgs = approval ? { owner: from, spender: c.contract } : { owner: from };
      const logData = encodeAbiParameters(approval ? [{ type: 'uint256' }] : [{ type: 'bytes32' }], approval ? [1n] : [h('1')]);
      const log = { address: target, topics: encodeEventTopics({ abi: functionAbi, eventName, args: eventArgs }),
        data: logData, blockNumber: 101n, blockHash: h('9'), transactionHash: hash, logIndex: index };
      const assets = { schemaVersion: 1, expectedEvents: [{ address: target, eventName,
        args: approval ? { owner: from, spender: c.contract, value: '1' } : { owner: from } }] };
      s.transactions.push({ hash, chainId: 56, from, to: target, valueWei: '0', kind: approval ? 'approval' : 'business',
        ...(approval ? { spender: c.contract, amountRaw: '1' } : {}), receiptStatus: 'success', block: 101, blockHash: h('9'),
        requestId: preview.requestId, previewedAt: preview.previewedAt, previewExpiresAt: preview.expiresAt,
        consentedAt: '2026-11-24T07:01:00Z', confirmedAt: '2026-11-24T07:02:00Z',
        previewEvidence: ref(`preview-${index}.json`, preview), consentEvidence: consent, receiptEvidence: consent,
        assetDeltaEvidence: ref(`assets-${index}.json`, assets) });
      txs.set(hash, { hash, chainId: 56, from, to: target, input: data, value: 0n, blockNumber: 101n,
        blockHash: h('9'), transactionIndex: index });
      receipts.set(hash, { transactionHash: hash, from, to: target, status: 'success', blockNumber: 101n,
        blockHash: h('9'), transactionIndex: index, gasUsed: 20000n, effectiveGasPrice: 100n, logs: [log] });
    }
  }
  const client = { getChainId: async () => 56, getBlockNumber: async () => 200n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: h('9'), timestamp: BigInt(Date.parse('2026-11-24T07:01:30Z') / 1000) }),
    readContract: async ({ functionName, args }) => functionName === 'allowance' ? 0n
      : functionName === 'GUARDIAN' ? a('6') : args[0] === 'alice' ? a('7') : a('8'),
    getTransaction: async ({ hash }) => txs.get(hash), getTransactionReceipt: async ({ hash }) => receipts.get(hash) };
  return { plan, c, files, txs, receipts, client,
    inspect: () => inspectAcceptanceChain({ plan, config: c, snapshotSha256: snapshot,
      readEvidence: p => files.get(p), client, now }) };
}
test('chain checker observes mined calldata, token approval, event fields and gas without promoting human evidence', async () => {
  const f = chainFixture(12), r = await f.inspect();
  assert.equal(r.status, 'partial-chain-observed');
  assert.equal(r.observedTransactions.length, 11);
  assert.ok(r.observedTransactions.some(t => t.functionName === 'approve'));
  assert.equal(r.observedTransactions[0].gasPaidWei, '2000000');
  assert.equal(r.participantIndependenceVerified, false); assert.equal(r.productionRelease, false);
});
test('chain checker refuses wrong chain, sender, target, calldata, receipt hash/status and block', async () => {
  for (const mutate of [
    f => f.client.getChainId = async () => 97,
    f => [...f.txs.values()][0].from = a('9'), f => [...f.receipts.values()][0].from = a('9'),
    f => [...f.txs.values()][0].to = a('9'), f => [...f.txs.values()][0].input = '0x12345678',
    f => [...f.txs.values()][0].chainId = 97, f => [...f.receipts.values()][0].transactionHash = h('8'),
    f => [...f.receipts.values()][0].status = 'reverted', f => [...f.receipts.values()][0].blockHash = h('8'),
    f => [...f.txs.values()][0].transactionIndex = 99,
    f => f.client.getBlockNumber = async () => 110n,
    f => f.client.readContract = async () => a('9'),
  ]) { const f = chainFixture(); mutate(f); await assert.rejects(f.inspect()); }
});
test('chain checker rejects forged event deltas, stale preview bytes, bad approval amount and reversed chain order', async () => {
  for (const mutate of [
    f => [...f.receipts.values()][0].logs = [],
    f => f.files.set('preview-1.json', Buffer.from('{}')),
    f => [...f.receipts.values()][0].logs[0].blockHash = h('8'),
    f => f.plan.steps[11].transactions[0].amountRaw = '2',
    f => { const original = f.client.readContract;
      f.client.readContract = async input => input.functionName === 'allowance' ? 1n : original(input); },
    f => { const ts = [...f.txs.values()]; ts[1].transactionIndex = 0;
      [...f.receipts.values()][1].transactionIndex = 0; },
    f => f.client.getBlock = async ({ blockNumber }) => ({ number: blockNumber, hash: h('9'), timestamp: 1n }),
  ]) { const f = chainFixture(12); mutate(f); await assert.rejects(f.inspect()); }
});
test('chain checker rechecks canonical block hashes and refuses reorgs', async () => {
  const f = chainFixture(); let reads = 0;
  const original = f.client.getBlock;
  f.client.getBlock = async input => ({ ...await original(input), hash: ++reads > 2 ? h('8') : h('9') });
  await assert.rejects(f.inspect(), /changed/);
});
test('empty acceptance never contacts RPC or invents a receipt', async () => {
  const f = chainFixture(0); f.client.getChainId = async () => assert.fail('No RPC needed');
  assert.equal((await f.inspect()).status, 'pending-no-chain-evidence');
});

function deploymentFixture() {
  const input = '0x1234', plan = { status: 'prepared-not-authorized', snapshotSha256: snapshot, chainId: 56,
    creationInput: input, creationInputKeccak256: keccak256(input), deployer: a('7'), guardian: a('6'),
    maximumGasSpendWei: '1000000000' };
  const c = config(), client = { getChainId: async () => 56, getBlockNumber: async () => 200n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: h('9') }),
    getCode: async () => '0x1234', readContract: async () => 18,
    estimateGas: async () => 100000n, getGasPrice: async () => 100n, getBalance: async () => 10000000000n };
  return { plan, c, client, inspect: () => inspectDeploymentReadiness({ plan, config: c, snapshotSha256: snapshot, client }) };
}
test('deployment RPC preflight binds input and decimals, budgets gas margin, and never authorizes a route', async () => {
  const f = deploymentFixture(), r = await f.inspect();
  assert.equal(r.estimate.gasWithTwentyPercentMargin, '120000');
  assert.equal(r.estimate.observedFeeWithMarginWei, '12000000');
  assert.equal(r.officialWalletRouteVerified, false); assert.equal(r.mainnetBroadcast, false);
});
test('deployment RPC fails closed on wrong chain, decimals, empty code, inadequate budget or balance', async () => {
  for (const mutate of [
    f => f.client.getChainId = async () => 97, f => f.client.readContract = async () => 6,
    f => f.client.getCode = async () => '0x', f => f.plan.maximumGasSpendWei = '1',
    f => f.client.getBalance = async () => 0n, f => f.plan.creationInput = '0x5678',
  ]) { const f = deploymentFixture(); mutate(f); await assert.rejects(f.inspect()); }
});

function publicationFixture(candidate = false) {
  const c = config();
  if (!candidate) Object.assign(c, { contract: null, deploymentBlock: null, resident: null, excluded: [] });
  const files = Object.fromEntries(publicFiles.map(name => [name, Buffer.from(`synthetic ${name}`)]));
  const manifest = { schemaVersion: 1, mode: candidate ? 'candidate' : 'staging', sourceSnapshotSha256: snapshot, config: c,
    files: Object.fromEntries(publicFiles.map(name => [name, { bytes: files[name].length,
      sha256: sha256(files[name]), mutable: candidate && name === 'stats.json' }])) };
  const input = { root: '/', manifest, snapshotSha256: snapshot, project: 'parley-staging',
    origin: c.site, readFile: name => files[name], now: seconds };
  return { input, files, inspect: () => inspectPublication(input) };
}
test('publication only stages exact public files and binds a reproducible exact-consent digest', t => {
  const f = publicationFixture(), result = f.inspect();
  assert.equal(result.report.publicUpload, false);
  assert.equal(Object.keys(result.entries).length, 15);
  assert.equal(result.report.publicationDigest, f.inspect().report.publicationDigest);
  const dir = path.join(temporary(t), 'site'); writePublication(dir, result);
  assert.ok(fs.existsSync(path.join(dir, 'release-manifest.json')));
  assert.throws(() => writePublication(dir, result), /New publication/);
});
test('publication rejects changed bytes, stale snapshots and incorrect/free-address targets', () => {
  for (const mutate of [
    f => f.files['index.html'] = Buffer.from('changed'),
    f => f.input.snapshotSha256 = 'b'.repeat(64), f => f.input.project = 'other',
    f => f.input.origin = 'https://example.com', f => f.input.project = '../escape',
  ]) { const f = publicationFixture(); mutate(f); assert.throws(f.inspect); }
});
test('candidate publication packages fresh collector statistics and refuses stale, wrong-deployment or private fields', () => {
  const f = publicationFixture(true);
  f.input.stats = { ...aggregate([], config(), 150n, seconds), blockHash: h('9') };
  const r = f.inspect(); assert.equal(r.report.statsUpdated, true);
  assert.equal(r.report.requiresProductionGate, true);
  assert.deepEqual(JSON.parse(r.entries['stats.json']), f.input.stats);
  for (const mutate of [
    s => s.contract = a('8'), s => s.updatedAt -= 1201, s => s.updatedAt += 1,
    s => s.excluded = [], s => s.privateKey = 'SECRET', s => s.mail.body = 'SECRET',
    s => s.daily = [{ date: '2026-11-24', newMembers: 0, activeMembers: 0, settled: 0, body: 'SECRET' }],
    s => s.members = -1,
  ]) {
    const g = publicationFixture(true); g.input.stats = { ...aggregate([], config(), 150n, seconds), blockHash: h('9') };
    mutate(g.input.stats); assert.throws(g.inspect);
  }
});
test('submission indexes genuine supplied references but never authenticates them or marks submission done', () => {
  const raw = Buffer.from('supplied evidence'), ref = { path: 'docs/private-evidence/test.json', sha256: sha256(raw) };
  const input = { schemaVersion: 1, snapshotSha256: snapshot,
    publicRepository: { url: 'https://github.com/example/parley', evidence: ref },
    demoVideo: { url: 'https://example.com/demo', evidence: ref },
    submissionForm: { url: 'https://example.com/form', evidence: ref },
    interviews: [{ participantId: 'p1', conductedAt: '2026-11-24T07:00:00Z', consentEvidence: ref, notesEvidence: ref }],
    growthEvidence: ref, consentedForPublication: true };
  const invoke = () => submissionPlan({ input, snapshotSha256: snapshot, readEvidence: () => raw, now });
  const r = invoke(); assert.equal(r.status, 'materials-indexed-needs-human-review');
  assert.equal(r.authenticityVerified, false); assert.equal(r.submissionMade, false);
  input.interviews.push(input.interviews[0]); assert.throws(invoke, /Duplicate/);
});
test('submission leaves absent interviews, growth and publication consent explicitly incomplete', () => {
  const input = { schemaVersion: 1, snapshotSha256: snapshot, publicRepository: null, demoVideo: null,
    submissionForm: null, interviews: [], growthEvidence: null, consentedForPublication: false };
  const r = submissionPlan({ input, snapshotSha256: snapshot, readEvidence: () => assert.fail('No evidence'), now });
  assert.equal(r.status, 'incomplete'); assert.equal(r.missing.length, 6);
  input.snapshotSha256 = 'b'.repeat(64);
  assert.throws(() => submissionPlan({ input, snapshotSha256: snapshot }), /stale/);
});
test('soak inspection requires a complete healthy window for all jobs, not a generated service plan', () => {
  const records = [];
  for (let checkedAt = seconds - 3600; checkedAt <= seconds; checkedAt += 120)
    for (const job of ['resident', 'health', 'stats']) records.push({ schemaVersion: 1, job, chainId: 56,
      contract: config().contract, checkedAt, status: 'passed', automaticSigning: false,
      ...(job === 'health' ? { health: { status: 'healthy' }, alert: { status: 'alerts-disabled' } } : {}) });
  const inspect = input => inspectOperationsSoak({ records, build: config(), now: seconds, durationSeconds: 3600, ...input });
  assert.equal(inspect({}).status, 'local-window-recorded-needs-review');
  assert.equal(inspect({ records: [] }).status, 'incomplete');
  assert.equal(inspect({ records: records.filter(r => r.checkedAt >= seconds - 1000) }).status, 'incomplete');
  const failed = structuredClone(records); failed[0].status = 'failed';
  assert.equal(inspect({ records: failed }).status, 'incomplete');
  const duplicate = [...records, records[0]]; assert.throws(() => inspect({ records: duplicate }), /Duplicate/);
  const wrong = structuredClone(records); wrong[0].contract = a('9');
  assert.throws(() => inspect({ records: wrong }), /deployment/);
  const future = structuredClone(records); future[0].checkedAt = seconds + 1;
  assert.throws(() => inspect({ records: future }), /time/);
  assert.equal(inspect({}).independentUptimeVerified, false);
});
