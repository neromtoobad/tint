// Note encryption: the pool posts each new note's details encrypted to its
// owner's viewing key, so a wallet can rebuild itself from the chain on any device.
//
//   payload = ephemeral X25519 public key (32) || ChaCha20-Poly1305(plaintext)
//   key     = HKDF-SHA256(X25519(ephemeral, viewing public), salt = ephemeral public)
//   plaintext (69 bytes) = kind (1) || asset (20) || amount (16) || blinding (32)
//
// kind 1: a normal note. kind 2: the note a swap buys; its amount is only known
// after the trade, so it is 0 here and the wallet reads it from the Swapped event.
// Every key is used once, so a fixed nonce is safe.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromBytes } from './hash.js';

export const NOTE = 1;
export const SWAP_OUT = 2;
const PLAINTEXT_LEN = 69;
export const PAYLOAD_LEN = 32 + PLAINTEXT_LEN + 16;
const INFO = new TextEncoder().encode('tint/note/v1');
const NONCE = new Uint8Array(12);

function be(x, len) {
  const out = new Uint8Array(len);
  let v = BigInt(x);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error('value too large');
  return out;
}

function noteKey(shared, ephPublic) {
  return hkdf(sha256, shared, ephPublic, INFO, 32);
}

/** Encrypts { kind, asset, amount, blinding } to a viewing public key. Returns bytes. */
export function encryptNote(viewPublic, { kind = NOTE, asset, amount = 0n, blinding }) {
  const eph = x25519.utils.randomSecretKey();
  const ephPublic = x25519.getPublicKey(eph);
  const key = noteKey(x25519.getSharedSecret(eph, viewPublic), ephPublic);
  const pt = new Uint8Array(PLAINTEXT_LEN);
  pt[0] = kind;
  pt.set(be(asset, 20), 1);
  pt.set(be(amount, 16), 21);
  pt.set(be(blinding, 32), 37);
  const ct = chacha20poly1305(key, NONCE).encrypt(pt);
  const out = new Uint8Array(32 + ct.length);
  out.set(ephPublic, 0);
  out.set(ct, 32);
  return out;
}

/** Returns the note if it was encrypted to this viewing secret, else null. */
export function decryptNote(viewSecret, payload) {
  if (payload.length !== PAYLOAD_LEN) return null;
  const ephPublic = payload.slice(0, 32);
  try {
    const key = noteKey(x25519.getSharedSecret(viewSecret, ephPublic), ephPublic);
    const pt = chacha20poly1305(key, NONCE).decrypt(payload.slice(32));
    return {
      kind: pt[0],
      asset: fromBytes(pt.slice(1, 21)),
      amount: fromBytes(pt.slice(21, 37)),
      blinding: fromBytes(pt.slice(37, 69)),
    };
  } catch {
    return null;
  }
}
