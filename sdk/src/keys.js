// Tint keys, all derived from one wallet signature.
//
//   spend key    proves you own a note (never leaves the device)
//   nullifier key = H(2, spend key): shows which of your notes are spent
//   viewing key  X25519 secret that decrypts notes sent to you
//   address      what you give people so they can pay you: owner + viewing public key
//
// A "viewing key" you hand to an accountant = viewing secret + nullifier key +
// owner. It shows your full history and balance, and can't move anything.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { FIELD, fromBytes, toHex } from './hash.js';
import { nullifierKeyOf, ownerOf } from './notes.js';

export const KEY_MESSAGE =
  'Tint wallet keys v1\n\n' +
  'Signing this creates your private Tint keys on this device. ' +
  'It does not send a transaction and costs nothing. ' +
  'Only sign it on the Tint site.';

const enc = new TextEncoder();

function derive(seed, label, length) {
  return hkdf(sha256, seed, enc.encode('tint'), enc.encode(label), length);
}

const hexToBytes = (hex) => {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** Keys from the wallet's signature of KEY_MESSAGE (hex string). */
export function keysFromSignature(signatureHex) {
  return keysFromSeed(sha256(hexToBytes(signatureHex)));
}

/** Keys from 32 random or stored bytes. */
export function keysFromSeed(seed) {
  // 48 bytes then reduce: negligible bias mod the BN254 field.
  const spendKey = fromBytes(derive(seed, 'spend', 48)) % FIELD;
  const viewSecret = derive(seed, 'view', 32);
  return withPublic({ spendKey, viewSecret });
}

function withPublic({ spendKey, viewSecret }) {
  const owner = ownerOf(spendKey);
  const nk = nullifierKeyOf(spendKey);
  const viewPublic = x25519.getPublicKey(viewSecret);
  return { spendKey, nk, owner, viewSecret, viewPublic, address: encodeAddress(owner, viewPublic) };
}

/** tint1 + owner (32 bytes) + viewing public key (32 bytes), hex. */
export function encodeAddress(owner, viewPublic) {
  return 'tint1' + toHex(owner).slice(2) + bytesToHex(viewPublic);
}

export function decodeAddress(address) {
  if (!/^tint1[0-9a-f]{128}$/.test(address)) throw new Error('not a Tint address');
  const owner = BigInt('0x' + address.slice(5, 69));
  if (owner >= FIELD) throw new Error('not a Tint address');
  return { owner, viewPublic: hexToBytes(address.slice(69)) };
}

/** Read-only key: shows balance and history, can't spend. */
export function exportViewingKey(keys) {
  return 'tintview1' + toHex(keys.owner).slice(2) + toHex(keys.nk).slice(2) + bytesToHex(keys.viewSecret);
}

export function importViewingKey(s) {
  if (!/^tintview1[0-9a-f]{192}$/.test(s)) throw new Error('not a Tint viewing key');
  const viewSecret = hexToBytes(s.slice(137));
  return {
    owner: BigInt('0x' + s.slice(9, 73)),
    nk: BigInt('0x' + s.slice(73, 137)),
    viewSecret,
    viewPublic: x25519.getPublicKey(viewSecret),
    viewOnly: true,
  };
}

export { bytesToHex, hexToBytes };
