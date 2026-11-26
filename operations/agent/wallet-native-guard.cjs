'use strict';

// This preload makes native storage errors fatal before the CLI can catch them.
function wrapNative(native, fatal, before = () => {}) {
  for (const name of ['getPassword', 'setPassword', 'deletePassword', 'findPassword', 'findCredentials']) {
    if (typeof native[name] !== 'function') throw new Error('NATIVE_METHOD_MISSING');
    const original = native[name].bind(native);
    native[name] = async (...args) => {
      try { before(); return await original(...args); }
      catch {
        fatal();
        throw new Error('NATIVE_FAILURE_MUST_TERMINATE');
      }
    };
  }
  return native;
}

module.exports = { wrapNative };

if (process.env.PARLEY_REQUIRE_NATIVE_STORAGE === '1') {
  const fatal = () => {
    process.stderr.write('WALLET_NATIVE_STORAGE_FAILED_CLOSED\n');
    process.exit(70);
  };
  try {
    const { createRequire } = require('node:module');
    const { spawnSync } = require('node:child_process');
    const assert = require('node:assert/strict');
    const unlocked = () => {
      const args = ['call', '--session', '--dest', 'org.freedesktop.secrets',
        '--object-path', '/org/freedesktop/secrets/collection/login',
        '--method', 'org.freedesktop.DBus.Properties.Get',
        'org.freedesktop.Secret.Collection', 'Locked'];
      const result = spawnSync('/usr/bin/gdbus', args, {
        encoding: 'utf8', timeout: 5000, maxBuffer: 4096,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout.trim(), '(<false>,)');
    };
    const load = createRequire('/opt/parley-agent-host/node_modules/@binance/agentic-wallet/package.json');
    unlocked();
    wrapNative(load('@github/keytar'), fatal, unlocked);
  } catch { fatal(); }
}
