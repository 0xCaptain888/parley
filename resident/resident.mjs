import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { run } from '../helper/src/app.mjs';
import { stringify } from '../helper/src/calls.mjs';
import { readJson, atomicJson, locked, stateDir } from '../helper/src/state.mjs';
import { makeChain, offer } from '../helper/src/chain.mjs';
import { safePreview, withinBudget, acceptableOffer } from './rules.mjs';
import { parseArgs, address } from '../helper/src/normalize.mjs';
import { editableStatuses, settleProposal, executeProposal } from './lifecycle.mjs';
import { scanClaims, verifyClaim } from './claims.mjs';
import { queueTick } from './queue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const { options: opts } = parseArgs(process.argv.slice(2));
const configPath = opts.config ? path.resolve(opts.config) : path.join(root, 'resident/config.local.json');
const config = readJson(configPath, null), build = readJson(opts.build ? path.resolve(opts.build) : path.join(root, 'config/build.json'), null);
if (!config?.from || !build?.contract) throw new Error('Resident is unconfigured. Copy config.example.json; do not enable without operator approval.');
if (config.mode !== 'manual') throw new Error('Only per-proposal manual confirmation is enabled until the real-wallet release gates pass.');
const from = address(config.from);
if (fs.existsSync(path.join(root, 'resident/state', from, 'state.json')))
  throw new Error('Legacy resident state exists. Stop and reconcile its deployment, budgets and pending orders before operator migration; no automatic reset permitted.');
const dir = stateDir(build, from, config.stateRoot || path.join(root, 'resident/state'));
const stateFile = path.join(dir, 'state.json');
const flags = ['--from', from, ...(config.rpc ? ['--rpc', config.rpc] : []), ...(config.home ? ['--home', config.home] : [])];
const save = state => atomicJson(stateFile, state);
const alert = text => console.error(`[Parley resident] ${text}`);
async function wallet(action, args) {
  const { stdout } = await exec('baw', ['contract-call', action, ...args, '--json'], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout);
}
async function tick() {
  await locked(dir, async () => {
    const state = readJson(stateFile, { handled: [], welcomed: [], gifted: [], queue: [], publicDate: null, boardOpen: false });
    const now = Math.floor(Date.now() / 1000);
    if(opts.cancel || opts.retry){
      const q=state.queue.find(q=>q.id===(opts.cancel||opts.retry));
      if(!q || !editableStatuses.includes(q.status))
        throw new Error('Only unbroadcast or failed proposals can be cancelled/retried; settle pending wallet orders first.');
      q.status=opts.cancel?'cancelled':'queued';delete q.preview;delete q.previewCall;
      save(state);console.log(stringify({queueId:q.id,status:q.status}));return;
    }
    if (opts.settle) {
      if (!opts.plan) throw new Error('--settle <txHash> requires --plan <planId>.');
      const q = state.queue.find(q => q.planId === opts.plan);
      if (!q) throw new Error('Unknown queue plan');
      const r = await run(['result', opts.settle, '--plan', q.planId, ...flags], build);
      settleProposal(state, q, r.summary, now);
      save(state); console.log(stringify(r)); return;
    }
    if (opts.preview || opts.approve) {
      const q = state.queue.find(q => q.id === (opts.preview || opts.approve) && ['queued','previewed','approval_confirmed'].includes(q.status));
      if (!q) throw new Error('Queue entry not found or already handled');
      const checked = await run([...q.args, ...flags], build);
      if (String(q.index).startsWith('claim:')) {
        if (!config.logRpc || !q.claim) throw new Error('Claim proposal lacks canonical provenance; operator reconciliation required.');
        await verifyClaim(makeChain({ ...build, rpcs: [config.logRpc], multicall: null }), build, from, q.claim);
      }
      if(q.args[0]==='offer' && q.args[1]==='accept'
        && !acceptableOffer({give:checked.summary.receive,want:checked.summary.pay,expiresAt:checked.summary.expiresAt},config,now))
        throw new Error('Offer no longer satisfies the fresh reference price or small-amount policy. Review it again; no execution permitted.');
      if (!withinBudget(config, state.queue.filter(x => x.id !== q.id), checked.calls.reduce((n, c) => n + BigInt(c.value), 0n), now))
        throw new Error('Resident budget exceeded');
      const call = checked.calls[0];
      q.bnb = checked.calls.reduce((n,c)=>n+BigInt(c.value),0n).toString();
      if (!call.simulated) throw new Error('Unsimulated call refused');
      if (opts.preview) {
        const { stdout } = await exec('baw',['wallet','settings','--json'],{timeout:60000});
        const settings = JSON.parse(stdout);
        if (settings.success !== true || settings.data?.devMode?.enabled !== true) throw new Error('Developer Mode is not enabled.');
        const raw = await wallet('preview', ['--binanceChainId', String(build.chainId), '--from', from,
          '--to', call.to, '--value', call.value, '--inputData', call.data]);
        const d=raw.data;
        q.planId=checked.planId; q.previewCall=call;
        q.preview=d ? {requestId:d.requestId,expiresAt:d.expiresAt,parsedTx:d.parsedTx,risks:d.risks,
          simulationResult:d.simulationResult,requireConfirmation:d.requireConfirmation,authorityChanges:d.authorityChanges} : null;
        q.status=safePreview(raw)?'previewed':'risk_blocked'; save(state);
        console.log(stringify({queueId:q.id,status:q.status,preview:q.preview,error:raw.error,
          next:q.status==='previewed'?'Inspect this preview and DYOR. Only then run --approve <queueId> --request <requestId> --once.':'No execute permitted.'}));
        return;
      }
      if (!opts.request || opts.request !== q.preview?.requestId || q.status !== 'previewed')
        throw new Error('First run --preview and review its parsed transaction, risks and authority changes. Then confirm that exact request ID.');
      if (Number(q.preview.expiresAt) <= Date.now()) throw new Error('Preview expired. Preview and review again.');
      if (call.to !== q.previewCall.to || call.value !== q.previewCall.value || call.data !== q.previewCall.data)
        throw new Error('Call changed after preview; a new preview and explicit confirmation are required.');
      q.planId = checked.planId;
      await executeProposal(state, q, save, requestId => wallet('execute', ['--requestId', requestId]), now);
      if (q.status === 'PENDING_CONFIRMATION') alert(`Approve this order in the Binance App: ${q.orderId}`);
      if (q.txHash) console.log(stringify({ planId: q.planId, txHash: q.txHash, next: 'Run --settle <txHash> --plan <planId> --once.' }));
      return;
    }
    if (state.boardId) {
      const chain = makeChain(build, config.rpc);
      const current = offer(await chain.read('offers', [BigInt(state.boardId)]));
      if (current.status !== 1 || Number(current.expiry) <= now) {
        state.boardOpen = false;
        if (current.status === 1 && !state.queue.some(q => q.key === `cancel-board:${state.boardId}` && !['failed','cancelled','confirmed'].includes(q.status))) {
          const r = await run(['offer', 'cancel', String(state.boardId), ...flags], build);
          state.queue.push({ id: r.planId, planId: r.planId, key: `cancel-board:${state.boardId}`, args: ['offer', 'cancel', String(state.boardId)],
            createdAt: now, status: 'queued', bnb: '0', prepared: r });
        }
      }
    }
    await queueTick({ state, config, now, save,
      inbox: () => run(['inbox', '--limit', '50', ...flags], build),
      claims: config.logRpc ? s => scanClaims(makeChain({ ...build, rpcs: [config.logRpc], multicall: null }), build, from, s) : null,
      prepare: args => run([...args, ...flags], build),
      ack: index => run(['ack', String(index), ...flags], build),
      alert,
      emit: q => console.log(stringify({ queueId: q.id, key: q.key, proposal: q.prepared,
        next: 'Review preview, then explicitly approve this one queue ID.' })),
    });
  });
}
await tick();
if (!opts.once && !opts.approve && !opts.preview && !opts.settle && !opts.cancel && !opts.retry) {
  const poll = async () => {
    try { await tick(); } catch (e) { alert(e.code || 'TICK_FAILED'); }
    setTimeout(poll, 60000);
  };
  setTimeout(poll, 60000);
}
