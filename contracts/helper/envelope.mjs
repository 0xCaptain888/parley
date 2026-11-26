// Parley mail envelope v1. Node.js >= 20, built-in crypto only.
//
//   envelope = 0x01 | senderPub(32) | salt(16) | nonce(12) | ciphertext | tag(16)
//   shared   = X25519(mySecret, peerPublic)
//   key      = HKDF-SHA256(ikm = shared, salt = salt, info = "parley/v1", 32 bytes)
//   cipher   = ChaCha20-Poly1305(key, nonce) with
//   AAD      = chainId(32, big endian) | contract(20) | from(20) | to(20) | kind(1)
//
// The AAD binds a ciphertext to one chain, one contract, one sender, one recipient and one
// mail kind. There is no forward secrecy: whoever obtains a mailbox secret key can read past
// mail for that key.
import {
  generateKeyPairSync, diffieHellman, hkdfSync, randomBytes,
  createCipheriv, createDecipheriv, createPublicKey, createPrivateKey,
} from 'node:crypto';

export const MAX_ENVELOPE = 1024; // Parley.MAX_DATA_BYTES
export const OVERHEAD = 77;

const b64u = (b) => Buffer.from(b).toString('base64url');
const hex = (s) => Buffer.from(s.slice(2), 'hex');

/** Returns { pub, sec }: two 32-byte Buffers. `pub` goes on-chain, `sec` never leaves the machine. */
export function newKey() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    pub: Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'),
    sec: Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url'),
  };
}

const pubObj = (pub) =>
  createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(pub) }, format: 'jwk' });
const secObj = (sec, pub) =>
  createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(pub), d: b64u(sec) }, format: 'jwk' });

function aad({ chainId, contract, from, to, kind }) {
  const chain = Buffer.alloc(32);
  chain.writeBigUInt64BE(BigInt(chainId), 24);
  return Buffer.concat([chain, hex(contract), hex(from), hex(to), Buffer.from([kind])]);
}

function deriveKey(my, peerPub, salt) {
  const shared = diffieHellman({ privateKey: secObj(my.sec, my.pub), publicKey: pubObj(peerPub) });
  return Buffer.from(hkdfSync('sha256', shared, salt, 'parley/v1', 32));
}

/** my = { pub, sec }; theirPub = 32-byte Buffer; ctx = { chainId, contract, from, to, kind }. */
export function seal(my, theirPub, ctx, plaintext) {
  if (plaintext.length + OVERHEAD > MAX_ENVELOPE) throw new Error('plaintext too long');
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('chacha20-poly1305', deriveKey(my, theirPub, salt), nonce, { authTagLength: 16 });
  cipher.setAAD(aad(ctx));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), my.pub, salt, nonce, ct, cipher.getAuthTag()]);
}

/**
 * Throws when the envelope is malformed, was tampered with, or was not sealed for `my` in this ctx.
 * To re-open mail you sent, pass a copy of the envelope whose bytes 1..32 are the recipient's
 * public key.
 */
export function open(my, ctx, env) {
  if (env.length < OVERHEAD || env[0] !== 1) throw new Error('bad envelope');
  const peerPub = env.subarray(1, 33);
  const salt = env.subarray(33, 49);
  const nonce = env.subarray(49, 61);
  const ct = env.subarray(61, env.length - 16);
  const tag = env.subarray(env.length - 16);
  const decipher = createDecipheriv('chacha20-poly1305', deriveKey(my, peerPub, salt), nonce, { authTagLength: 16 });
  decipher.setAAD(aad(ctx));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
