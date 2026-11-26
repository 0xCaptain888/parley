import assert from 'node:assert/strict';
import { address } from '../helper/src/normalize.mjs';

export const walletVersions = Object.freeze({ skill: '1.15.0', cli: '1.12.0' });
const expiry = value => {
  const n = typeof value === 'number' || /^\d+$/.test(String(value))
    ? Number(value) * 1000 : Date.parse(value);
  assert.ok(Number.isFinite(n) && n > 0, 'Wallet returned invalid expiry');
  return new Date(n).toISOString();
};
const quota = v => {
  assert.ok((typeof v === 'number' || typeof v === 'string') && /^(0|[1-9]\d*)(\.\d+)?$/.test(String(v))
    && Number.isFinite(Number(v)), 'Wallet returned invalid quota');
  return String(v);
};
export function sanitizedWalletSettings(raw, now) {
  assert.equal(raw.success, true, 'Wallet settings failed');
  const s = raw.data;
  assert.ok(typeof s?.devMode?.enabled === 'boolean', 'Missing developer mode status');
  const sessionExpireTime = expiry(s.sessionExpireTime);
  assert.ok(typeof s.devMode.balanceExceeded === 'boolean', 'Missing developer mode balance-cap status');
  const devMode = { enabled: s.devMode.enabled, expiresAt: s.devMode.enabled ? expiry(s.devMode.expiresAt) : null,
    balanceExceeded: s.devMode.balanceExceeded,
    dailyLimitUSD: quota(s.devMode.dailyLimit ?? 0), usedUSD: quota(s.developerModeQuotaUsed ?? 0) };
  return { sessionExpireTime, sessionValid: Date.parse(sessionExpireTime) > now,
    sessionExpiringSoon: Date.parse(sessionExpireTime) - now <= 3 * 3600000,
    dailyLimitUSD: quota(s.dailyLimit), quotaLeftUSD: quota(s.quotaLeft),
    abnormalTxnHandling: ['AutoReject', 'NeedConfirmation'].includes(s.abnormalTxnHandling) ? s.abnormalTxnHandling : 'UNKNOWN',
    devMode, externalSigningReady: devMode.enabled && Date.parse(devMode.expiresAt) > now
      && !devMode.balanceExceeded && Date.parse(sessionExpireTime) > now };
}

export async function inspectWallet(runCLI, now = Date.now()) {
  let skill;
  try { skill = await runCLI(['skill-check', '--skill-name', 'binance-agentic-wallet', '--current-version', walletVersions.skill]); }
  catch { /* Optional skill-check failures do not block the documented preflight. */ }
  if (skill?.data?.needUpdateSkill === true)
    return { status: 'skill-update-needs-user-confirmation', currentSkillVersion: walletVersions.skill,
      latestSkillVersion: /^\d+\.\d+\.\d+$/.test(skill.data.latestSkillVersion || '') ? skill.data.latestSkillVersion : null,
      walletAccess: false, mainnetBroadcast: false, productionRelease: false };
  const cli = await runCLI(['cli-check', '--required-version', walletVersions.cli]);
  assert.ok(cli.success === true && cli.data?.needUpdateCli === false, 'Wallet CLI requires installation/update');
  const status = await runCLI(['wallet', 'status']);
  assert.equal(status.success, true, 'Wallet status failed');
  if (status.data?.status !== 'CONNECTED')
    return { status: 'not-connected', walletAccess: true, mainnetBroadcast: false, productionRelease: false };
  const settings = sanitizedWalletSettings(await runCLI(['wallet', 'settings']), now);
  const addresses = await runCLI(['wallet', 'address']);
  assert.equal(addresses.success, true, 'Wallet address failed');
  const bsc = addresses.data?.addresses?.filter(a => String(a.binanceChainId) === '56');
  assert.equal(bsc?.length, 1, 'Exactly one BSC wallet required');
  const from = address(bsc[0].address);
  const lock = await runCLI(['wallet', 'tx-lock', '--binanceChainId', '56']);
  assert.ok(lock.success === true && ['LOCKED', 'UNLOCKED'].includes(lock.data?.status), 'Unknown wallet lock state');
  return { schemaVersion: 1, checkedAt: new Date(now).toISOString(), status: 'connected', from, versions: walletVersions,
    settings, transactionLock: lock.data.status,
    scope: 'Read-only connection/settings/address/lock observation; no business call acceptance',
    walletAccess: true, mainnetBroadcast: false, productionRelease: false };
}
