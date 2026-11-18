import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initHash } from '../src/hash.js';
import { keysFromSignature, decodeAddress, exportViewingKey, importViewingKey } from '../src/keys.js';
import { encryptNote, decryptNote, SWAP_OUT, PAYLOAD_LEN } from '../src/encrypt.js';
import { ownerOf, nullifierKeyOf } from '../src/notes.js';

await initHash();
const SIG = '0x' + 'ab'.repeat(65);

test('keys are deterministic from the signature', () => {
  const a = keysFromSignature(SIG);
  const b = keysFromSignature(SIG);
  assert.equal(a.spendKey, b.spendKey);
  assert.equal(a.owner, ownerOf(a.spendKey));
  assert.equal(a.nk, nullifierKeyOf(a.spendKey));
  assert.notEqual(keysFromSignature('0x' + 'cd'.repeat(65)).spendKey, a.spendKey);
});

test('address round-trips', () => {
  const k = keysFromSignature(SIG);
  const d = decodeAddress(k.address);
  assert.equal(d.owner, k.owner);
  assert.deepEqual(d.viewPublic, k.viewPublic);
  assert.throws(() => decodeAddress('tint1abc'));
});

test('viewing key shows notes but has no spend key', () => {
  const k = keysFromSignature(SIG);
  const v = importViewingKey(exportViewingKey(k));
  assert.equal(v.owner, k.owner);
  assert.equal(v.nk, k.nk);
  assert.equal(v.spendKey, undefined);
  const note = { asset: 0x5fc5360d0400a0fd4f2af552add042d716f1d168n, amount: 123456789n, blinding: 42n };
  const dec = decryptNote(v.viewSecret, encryptNote(k.viewPublic, note));
  assert.equal(dec.amount, note.amount);
});

test('notes decrypt only for their owner', () => {
  const me = keysFromSignature(SIG);
  const other = keysFromSignature('0x' + '01'.repeat(65));
  const note = { asset: 0xd0601ce157db5bdc3162bbac2a2c8af5320d9eecn, amount: 2n * 10n ** 18n, blinding: 7n };
  const ct = encryptNote(me.viewPublic, note);
  assert.equal(ct.length, PAYLOAD_LEN);
  const got = decryptNote(me.viewSecret, ct);
  assert.deepEqual({ asset: got.asset, amount: got.amount, blinding: got.blinding }, note);
  assert.equal(decryptNote(other.viewSecret, ct), null);
  const tampered = ct.slice();
  tampered[50] ^= 1;
  assert.equal(decryptNote(me.viewSecret, tampered), null);
  assert.equal(decryptNote(me.viewSecret, encryptNote(me.viewPublic, { kind: SWAP_OUT, asset: 1n, blinding: 2n })).kind, SWAP_OUT);
});
