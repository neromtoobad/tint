import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initHash } from '../src/hash.js';
import { ownerOf } from '../src/notes.js';
import {
  accountOwnerOf,
  agentAccountKeys,
  agentPubOf,
  checkAgentSwap,
  decodeAgentKey,
  decodeAgentMemo,
  encodeAgentKey,
  encodeAgentMemo,
  rulesHashOf,
} from '../src/agent.js';
import { decryptNote, encryptNote } from '../src/encrypt.js';
import { x25519 } from '@noble/curves/ed25519.js';

await initHash();

// Printed by `nargo test --show-output` in circuits/notes (print_known_values).
const RULES = { assets: [1, 2, 3], maxBuy: 100, maxFeeBps: 500, endsAt: 2000000000, relayer: 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bcn };
const NOIR = {
  rulesHash: 0x1196b9fd82be4cdca63fd6d3bb0b2ff561d8a27c04b44e8d9dd51dccddb74f7dn,
  account: 0x2d91ac0bda3c1146e38390a7e4207db19d042ce1fd4cc216fcfc46a3e3c5430en,
};

test('rules hash and account owner match the Noir circuits', () => {
  assert.equal(rulesHashOf(RULES), NOIR.rulesHash);
  assert.equal(accountOwnerOf(ownerOf(42n), agentPubOf(7n), NOIR.rulesHash), NOIR.account);
  assert.equal(agentAccountKeys({ agentKey: 7n, userOwner: ownerOf(42n), rules: RULES }).owner, NOIR.account);
});

test('only the right spend key unlocks moving money out', () => {
  assert.throws(() => agentAccountKeys({ agentKey: 7n, userOwner: ownerOf(42n), rules: RULES, spendKey: 43n }));
  const k = agentAccountKeys({ agentKey: 7n, userOwner: ownerOf(42n), rules: RULES, spendKey: 42n });
  assert.equal(k.agent.spendKey, 42n);
});

test('trades outside the rules fail before proving', () => {
  const ext = { relayer: RULES.relayer, fee: 1n, deadline: 1900000000n };
  checkAgentSwap(RULES, { assetIn: 1n, assetOut: 2n, amountIn: 50n, ext });
  assert.throws(() => checkAgentSwap(RULES, { assetIn: 1n, assetOut: 9n, amountIn: 50n, ext }), /not in the agent/);
  assert.throws(() => checkAgentSwap(RULES, { assetIn: 1n, assetOut: 2n, amountIn: 101n, ext }), /over the agent’s limit/);
  assert.throws(() => checkAgentSwap(RULES, { assetIn: 1n, assetOut: 2n, amountIn: 10n, ext }), /fee limit/);
  assert.throws(() => checkAgentSwap(RULES, { assetIn: 1n, assetOut: 2n, amountIn: 50n, ext: { ...ext, relayer: 5n } }), /relayer/);
  assert.throws(() => checkAgentSwap(RULES, { assetIn: 1n, assetOut: 2n, amountIn: 50n, ext: { ...ext, deadline: 2000000001n } }), /ended/);
  // selling a stock is not capped by maxBuy
  checkAgentSwap(RULES, { assetIn: 2n, assetOut: 1n, amountIn: 10_000n, ext: { ...ext, fee: 0n } });
});

test('agent key and memo round-trip', () => {
  const plan = { amount: '25000000', every: 604800, slippageBps: 100 };
  const s = encodeAgentKey({ agentKey: 7n, userOwner: 99n, rules: RULES, plan, name: 'Weekly' });
  const back = decodeAgentKey(s);
  assert.equal(back.agentKey, 7n);
  assert.equal(rulesHashOf(back.rules), NOIR.rulesHash);
  assert.deepEqual(back.plan, plan);

  const view = x25519.utils.randomSecretKey();
  const memo = encodeAgentMemo({ index: 3, rules: RULES, plan, name: 'Weekly' });
  const payload = encryptNote(x25519.getPublicKey(view), { asset: 1n, amount: 5n, blinding: 6n, memo });
  const note = decryptNote(view, payload);
  assert.equal(note.amount, 5n);
  const m = decodeAgentMemo(note.memo);
  assert.equal(m.index, 3);
  assert.equal(rulesHashOf(m.rules), NOIR.rulesHash);
});
