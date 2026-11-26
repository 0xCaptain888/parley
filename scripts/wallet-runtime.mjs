import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export function walletEnvironment(runtime, environment = process.env) {
  assert.ok(path.isAbsolute(runtime) && path.basename(runtime) === 'node', 'Explicit absolute Node runtime required');
  const executable = fs.realpathSync(runtime);
  assert.ok(fs.statSync(executable).isFile(), 'Wallet runtime must be an executable file');
  fs.accessSync(executable, fs.constants.X_OK);
  return { ...environment, PATH: `${path.dirname(executable)}${path.delimiter}${environment.PATH || ''}` };
}
