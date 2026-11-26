import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentBuild } from './build-info.mjs';
import { sha256, sourceSnapshot } from './evidence.mjs';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  visit(node);
  for (const child of Object.values(node)) walk(child, visit);
}

// Structural checks complement runtime tests; they are not a whole-program safety proof.
export function checkSecurityBoundaries(build) {
  const ast = build.output?.sources?.['contracts/Parley.sol']?.ast;
  const contract = ast?.nodes?.find(n => n.nodeType === 'ContractDefinition' && n.name === 'Parley');
  assert.ok(contract, 'Missing compiled Parley AST');
  const guardAst = build.output.sources['@openzeppelin/contracts/utils/ReentrancyGuard.sol']?.ast;
  const guardIds = new Set();
  walk(guardAst, n => {
    if (n.nodeType === 'ModifierDefinition' && n.name === 'nonReentrant') guardIds.add(n.id);
  });
  assert.equal(guardIds.size, 1, 'Missing canonical ReentrancyGuard modifier');
  const functions = contract.nodes.filter(n => n.nodeType === 'FunctionDefinition' && n.kind !== 'constructor');
  const byId = new Map(functions.map(f => [f.id, f]));
  const guardian = contract.nodes.find(n => n.nodeType === 'VariableDeclaration' && n.name === 'GUARDIAN');
  assert.ok(guardian?.mutability === 'immutable', 'Guardian must remain immutable');
  const calls = new Map();
  const funds = new Set();
  for (const fn of functions) {
    const edges = new Set();
    walk(fn.body, n => {
      assert.notEqual(n.nodeType, 'InlineAssembly', 'New assembly requires separate security analysis');
      if (n.nodeType === 'FunctionCall' && byId.has(n.expression?.referencedDeclaration))
        edges.add(n.expression.referencedDeclaration);
      if (n.nodeType === 'MemberAccess') {
        assert.ok(!['delegatecall', 'callcode'].includes(n.memberName), 'Delegated execution is forbidden');
        if (['call', 'send', 'transfer', 'safeTransfer', 'safeTransferFrom'].includes(n.memberName))
          funds.add(fn.id);
        if (['call', 'send', 'transfer'].includes(n.memberName))
          assert.ok(['_pay', 'withdraw'].includes(fn.name), `Unexpected native push: ${fn.name}`);
      }
      if (n.nodeType === 'Identifier' && n.referencedDeclaration === guardian.id)
        assert.equal(fn.name, 'setPaused', 'Guardian authority expanded beyond setPaused');
    });
    calls.set(fn.id, edges);
  }
  const reachable = id => {
    const seen = new Set();
    const visit = current => {
      if (seen.has(current)) return;
      seen.add(current);
      for (const child of calls.get(current) || []) visit(child);
    };
    visit(id);
    return seen;
  };
  const fundedEntries = [];
  for (const fn of functions.filter(f => ['external', 'public'].includes(f.visibility))) {
    if (![...reachable(fn.id)].some(id => funds.has(id))) continue;
    assert.ok(fn.modifiers.some(m => guardIds.has(m.modifierName.referencedDeclaration)),
      `Funded entry lacks canonical nonReentrant: ${fn.name}`);
    fundedEntries.push(fn.name);
  }
  const exits = ['allow', 'claimPacket', 'refundPacket', 'declineRequest', 'cancelRequest',
    'declineOffer', 'cancelOffer', 'reclaimStamp', 'withdraw'];
  for (const name of exits) {
    const fn = functions.find(f => f.name === name);
    assert.ok(fn, `Missing exit: ${name}`);
    for (const id of reachable(fn.id))
      assert.ok(!byId.get(id).modifiers.some(m => m.modifierName.name === 'whenNotPaused'),
        `Exit depends on pause: ${name}`);
  }
  assert.ok(fundedEntries.length >= 13, 'Funded entry graph unexpectedly incomplete');
  return { status: 'passed', fundedEntries: fundedEntries.sort(), unpausableExits: exits,
    guardianAuthority: ['setPaused'], nativePushSites: ['_pay', 'withdraw'],
    scope: 'Parley AST internal-call graph and modifier checks; not an independent audit or dynamic-call proof' };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const build = currentBuild(root);
  const snapshot = sourceSnapshot(root);
  const report = { ...checkSecurityBoundaries(build), checkedAt: new Date().toISOString(),
    snapshotSha256: snapshot.sha256, compilerBuildSha256: sha256(JSON.stringify(build)) };
  const file = `docs/reports/security-boundaries-${report.checkedAt.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(root, file), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ report: file, ...report }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
