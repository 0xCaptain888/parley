import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSecurityBoundaries } from '../../scripts/security-boundaries.mjs';
import { currentBuild } from '../../scripts/build-info.mjs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = () => structuredClone(currentBuild(root));
const functions = b => b.output.sources['contracts/Parley.sol'].ast.nodes
  .find(n => n.nodeType === 'ContractDefinition' && n.name === 'Parley').nodes;
const fn = (b, name) => functions(b).find(n => n.nodeType === 'FunctionDefinition' && n.name === name);

test('compiler AST covers funded entry points and every documented unpausable exit', () => {
  const result = checkSecurityBoundaries(fixture());
  assert.equal(result.fundedEntries.length, 13);
  assert.equal(result.unpausableExits.length, 9);
  assert.ok(result.fundedEntries.includes('createOffer'));
  assert.ok(result.fundedEntries.includes('withdraw'));
});

test('a missing guard on direct or transitive payout entries fails closed', () => {
  for (const name of ['withdraw', 'createOffer', 'declineOffer', 'allow', 'payRequest']) {
    const build = fixture();
    fn(build, name).modifiers = [];
    assert.throws(() => checkSecurityBoundaries(build), /lacks canonical nonReentrant/);
  }
});

test('an exit cannot acquire a direct or indirect pause dependency', () => {
  for (const name of ['withdraw', 'claimPacket', '_pay', '_refundGive']) {
    const build = fixture();
    fn(build, name).modifiers.push({ modifierName: { name: 'whenNotPaused' } });
    assert.throws(() => checkSecurityBoundaries(build), /Exit depends on pause/);
  }
});

test('an identically named replacement modifier cannot impersonate the inherited guard', () => {
  const build = fixture();
  fn(build, 'withdraw').modifiers = [{ modifierName: { name: 'nonReentrant', referencedDeclaration: -1 } }];
  assert.throws(() => checkSecurityBoundaries(build), /lacks canonical nonReentrant/);
});

test('guardian expansion, assembly and new native push sites require intervention', () => {
  const build = fixture();
  const guardian = functions(build).find(n => n.name === 'GUARDIAN');
  fn(build, 'setKey').body.statements.push({ nodeType: 'Identifier', referencedDeclaration: guardian.id });
  assert.throws(() => checkSecurityBoundaries(build), /Guardian authority expanded/);
  const assembly = fixture();
  fn(assembly, '_mail').body.statements.push({ nodeType: 'InlineAssembly' });
  assert.throws(() => checkSecurityBoundaries(assembly), /assembly/);
  const push = fixture();
  fn(push, 'setKey').body.statements.push({ nodeType: 'MemberAccess', memberName: 'call' });
  assert.throws(() => checkSecurityBoundaries(push), /Unexpected native push/);
  const delegated = fixture();
  fn(delegated, '_mail').body.statements.push({ nodeType: 'MemberAccess', memberName: 'delegatecall' });
  assert.throws(() => checkSecurityBoundaries(delegated), /Delegated execution/);
});
