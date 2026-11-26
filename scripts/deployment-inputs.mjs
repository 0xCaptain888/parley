import assert from 'node:assert/strict';
import { zeroAddress } from 'viem';
import { amount, address } from '../helper/src/normalize.mjs';
import { httpsOrigin } from './site-release.mjs';

export const monetaryFields = Object.freeze({
  defaultPostageBNB: { bits: 64, positive: false, unit: 'BNB' },
  maxPostageBNB: { bits: 64, positive: false, unit: 'BNB' },
  minShareBNB: { bits: 128, positive: true, unit: 'BNB' },
  capBNB: { bits: 256, positive: true, unit: 'BNB' },
  capUSDT: { bits: 256, positive: true, unit: 'USDT' },
  capUSDC: { bits: 256, positive: true, unit: 'USDC' },
  gasBudgetBNB: { bits: 256, positive: true, unit: 'BNB' },
});

export function inspectDeploymentInputs(intent, config) {
  assert.ok(intent && typeof intent === 'object' && !Array.isArray(intent), 'Deployment intent required');
  assert.deepEqual(Object.keys(intent).sort(), ['schemaVersion', 'chainId', 'deployer', 'guardian', 'site',
    ...Object.keys(monetaryFields)].sort(), 'Unknown deployment intent field');
  assert.equal(intent.schemaVersion, 1, 'Unknown deployment intent');
  assert.equal(intent.chainId, 56, 'Only the reviewed BSC target is supported');
  assert.equal(config.chainId, intent.chainId, 'Build chain differs from intent');
  const checks = [], raw = {};
  const check = (field, validate) => {
    if (intent[field] === null || intent[field] === undefined || intent[field] === '') {
      checks.push({ field, status: 'missing', code: 'OPERATOR_INPUT_REQUIRED' });
      return;
    }
    try {
      validate();
      checks.push({ field, status: 'valid' });
    } catch {
      checks.push({ field, status: 'invalid', code: 'INVALID_DEPLOYMENT_INPUT' });
    }
  };
  for (const key of ['deployer', 'guardian'])
    check(key, () => assert.notEqual(address(intent[key]), zeroAddress));
  check('site', () => assert.equal(httpsOrigin(intent.site), intent.site));
  for (const [key, spec] of Object.entries(monetaryFields)) {
    check(key, () => { raw[key] = amount(intent[key], 18, (1n << BigInt(spec.bits)) - 1n, spec.positive); });
  }
  const consistency = [];
  for (const [left, right, code] of [
    ['defaultPostageBNB', 'maxPostageBNB', 'DEFAULT_POSTAGE_EXCEEDS_MAXIMUM'],
    ['maxPostageBNB', 'capBNB', 'MAXIMUM_POSTAGE_EXCEEDS_NATIVE_CAP'],
    ['minShareBNB', 'capBNB', 'MINIMUM_SHARE_EXCEEDS_NATIVE_CAP'],
  ]) if (raw[left] !== undefined && raw[right] !== undefined && raw[left] > raw[right])
    consistency.push({ code, fields: [left, right] });
  const missing = checks.filter(c => c.status === 'missing').map(c => c.field);
  const invalid = checks.filter(c => c.status === 'invalid').map(c => c.field);
  return { schemaVersion: 1, status: missing.length || invalid.length || consistency.length
    ? 'blocked' : 'complete-needs-operator-approval', chainId: 56, checks, missing, invalid, consistency,
    amountUnits: Object.fromEntries(Object.entries(monetaryFields).map(([key, spec]) => [key, spec.unit])),
    inputsApproved: false, gasEstimated: false, walletAccess: false,
    mainnetBroadcast: false, productionRelease: false };
}

export function requireDeploymentInputs(intent, config) {
  const report = inspectDeploymentInputs(intent, config);
  assert.equal(report.status, 'complete-needs-operator-approval',
    `Deployment inputs incomplete or inconsistent: ${[...report.missing, ...report.invalid,
      ...report.consistency.map(c => c.code)].join(', ')}`);
}
