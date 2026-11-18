// Poseidon2 over BN254, the same hash the circuits (noir-lang/poseidon v0.4.0)
// and the TintTree contract (poseidon2-evm) use. Values are bigints.
import { BarretenbergSync } from '@aztec-foundation/bb.js';

export const FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

let bb;
export async function initHash() {
  if (!bb) bb = await BarretenbergSync.initSingleton();
  return bb;
}

function api() {
  if (!bb) throw new Error('call initHash() first');
  return bb;
}

export function toBytes32(x) {
  const v = BigInt(x);
  if (v < 0n || v >= FIELD) throw new Error(`not a field element: ${v}`);
  const out = new Uint8Array(32);
  let t = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(t & 0xffn);
    t >>= 8n;
  }
  return out;
}

export function fromBytes(b) {
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

export function hash(inputs) {
  const { hash: h } = api().poseidon2Hash({ inputs: inputs.map(toBytes32) });
  return fromBytes(h);
}

export const hash2 = (a, b) => hash([a, b]);
export const hash3 = (a, b, c) => hash([a, b, c]);

export function randomField() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return fromBytes(b) % FIELD;
}

export const toHex = (x) => '0x' + BigInt(x).toString(16).padStart(64, '0');
