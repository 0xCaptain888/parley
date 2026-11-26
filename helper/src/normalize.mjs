import { isAddress, parseUnits, formatUnits, zeroAddress } from 'viem';
import { input } from './errors.mjs';

export const ZERO = zeroAddress;
export const ZERO_KEY = `0x${'00'.repeat(32)}`;
export function handle(value) {
  input(typeof value === 'string', '需要一个 .ai 名字。');
  const h = value.trim().replace(/^@/, '').toLowerCase().replace(/\.ai$/, '');
  input(/^[a-z0-9]{1,64}$/.test(h), '名字只允许 1–64 个小写字母或数字。');
  return h;
}
export function address(value) {
  input(typeof value === 'string' && isAddress(value, { strict: false }), '需要完整的 0x 合约或钱包地址。');
  return value.toLowerCase();
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  input(/^(0|[1-9][0-9]*)$/.test(String(value)), '需要非负十进制整数。');
  const n = Number(value);
  input(Number.isSafeInteger(n) && n >= min && n <= max, `整数应在 ${min} 到 ${max} 之间。`);
  return n;
}
export function amount(value, decimals = 18, max = (1n << 128n) - 1n, positive = true) {
  input(typeof value === 'string' && value.length <= 320 && /^(0|[1-9]\d*)(\.\d+)?$/.test(value),
    '金额只能是十进制小数；不接受负数、科学计数法或多余字符。');
  input((value.split('.')[1] || '').length <= decimals, `金额超过代币的 ${decimals} 位小数精度。`);
  const n = parseUnits(value, decimals);
  input(n <= max && (positive ? n > 0n : n >= 0n), '金额为零或超过可用整数范围。');
  return n;
}
export const human = (n, decimals = 18) => formatUnits(BigInt(n), decimals);
export function packetId(value) {
  if (/^[1-9]\d*$/.test(String(value))) return integer(value, 1);
  const match = /Parley\s*(?:红包)?\s*#\s*(\d+)/i.exec(String(value));
  input(match, '没有找到 Parley 红包编号。');
  return integer(match[1], 1);
}
export const clean = (text) => text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
export const byteLength = (text) => Buffer.byteLength(text, 'utf8');
export function ttl(value, fallback) { return integer(value ?? String(fallback), 600, 604800); }
export function parseArgs(args) {
  const options = {}, positional = [];
  const flags = new Set(['mine', 'with-postage', 'once', 'dry-run', 'help']);
  for (let i = 0; i < args.length; i++) {
    const s = args[i];
    if (!s.startsWith('--')) { positional.push(s); continue; }
    const key = s.slice(2);
    input(!Object.hasOwn(options, key), `参数 --${key} 重复。`);
    if (flags.has(key)) options[key] = true;
    else {
      input(args[i + 1] !== undefined && !args[i + 1].startsWith('--'), `--${key} 缺少值。`);
      options[key] = args[++i];
    }
  }
  return { options, positional };
}
