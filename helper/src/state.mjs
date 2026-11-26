import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fail } from './errors.mjs';

export function readJson(file, fallback) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('UNSAFE_STATE', '状态文件不能是符号链接。');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}
export function atomicJson(file, value) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('UNSAFE_STATE', '拒绝覆盖符号链接。');
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}
export function rows(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fail('UNSAFE_STATE', '拒绝读取符号链接。');
    return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s));
  } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
export function append(file, row) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) fail('UNSAFE_STATE', '拒绝追加符号链接。');
  fs.appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
export function latestRows(file) {
  return [...new Map(rows(file).map(r => [r.id, r])).values()];
}
export function stateDir(config, from, home = path.join(os.homedir(), '.parley')) {
  const dir = path.join(home, `${config.chainId}-${config.contract.slice(2, 10).toLowerCase()}`, from.toLowerCase());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let p = dir;
  while (p !== path.dirname(p)) {
    if (fs.lstatSync(p).isSymbolicLink()) fail('UNSAFE_STATE', '状态目录不能经过符号链接。');
    p = path.dirname(p);
  }
  fs.chmodSync(dir, 0o700);
  const manifest = path.join(dir, 'deployment.json');
  const expected = { chainId: config.chainId, contract: config.contract.toLowerCase(), from: from.toLowerCase() };
  const old = readJson(manifest, expected);
  if (JSON.stringify(old) !== JSON.stringify(expected)) fail('STATE_COLLISION', '状态目录对应另一份部署，请使用不同 --home。');
  atomicJson(manifest, expected);
  return dir;
}
export async function locked(dir, fn) {
  const lock = path.join(dir, '.lock');
  let fd;
  try {
    fd = fs.openSync(lock, 'wx', 0o600);
  } catch (e) {
    if (e.code === 'EEXIST') fail('STATE_BUSY', '另一个命令正在使用状态目录。若进程已退出，请核实后移除 .lock。');
    throw e;
  }
  try { fs.writeSync(fd, String(process.pid)); return await fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
