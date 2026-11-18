// Agent accounts, matching circuits/notes (agent section), agent_swap and agent_transact.
//
// An agent account is a set of notes owned by
//   account = H(user_owner, agent_pub, rules_hash),  agent_pub = H(3, agent_key)
// with nullifier key H(2, agent_key). The agent key can only trade inside the
// account, within the rules (agent_swap). Moving money out needs the user's
// spend key too (agent_transact).
//
// agent_key = H(9, spend_key, index), so the user can always re-derive every
// agent they made from the one wallet signature. The rules are remembered in an
// encrypted memo on the user's own change note when the agent is funded.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hash2, hash3, toBytes32, toHex } from './hash.js';
import { encodeAddress } from './keys.js';
import { nullifierKeyOf, ownerOf } from './notes.js';
import { buildSwap } from './swap.js';
import { buildTransact } from './transact.js';

export const AGENT_TAG = 3n;
const AGENT_KEY_TAG = 9n;
export const RULE_ASSETS = 6;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const agentKeyOf = (spendKey, index) => hash3(AGENT_KEY_TAG, BigInt(spendKey), BigInt(index));
export const agentPubOf = (agentKey) => hash2(AGENT_TAG, BigInt(agentKey));
export const accountOwnerOf = (userOwner, agentPub, rulesHash) => hash3(BigInt(userOwner), agentPub, rulesHash);

/**
 * Rules: { cash, stocks: [addr…] (≤ 5), maxBuy, maxFeeBps, endsAt, relayer }
 * or the circuit shape { assets: [6], maxBuy, maxFeeBps, endsAt, relayer }.
 */
export function normalizeRules(r) {
  const assets = (r.assets ?? [r.cash, ...r.stocks]).map((a) => BigInt(a ?? 0));
  if (assets.length > RULE_ASSETS) throw new Error(`at most ${RULE_ASSETS - 1} stocks`);
  while (assets.length < RULE_ASSETS) assets.push(0n);
  if (assets[0] === 0n) throw new Error('rules need a cash token');
  const out = {
    assets,
    maxBuy: BigInt(r.maxBuy),
    maxFeeBps: BigInt(r.maxFeeBps),
    endsAt: BigInt(r.endsAt),
    relayer: BigInt(r.relayer),
  };
  if (out.maxFeeBps > 10_000n) throw new Error('fee cap is in basis points (at most 10000)');
  return out;
}

export function rulesHashOf(rules) {
  const r = normalizeRules(rules);
  let h = hash3(r.assets[0], r.assets[1], r.assets[2]);
  h = hash3(h, r.assets[3], r.assets[4]);
  h = hash3(h, r.assets[5], r.maxBuy);
  h = hash3(h, r.maxFeeBps, r.endsAt);
  return hash2(h, r.relayer);
}

const rulesInput = (r) => ({
  assets: r.assets.map(toHex),
  max_buy: toHex(r.maxBuy),
  max_fee_bps: toHex(r.maxFeeBps),
  ends_at: toHex(r.endsAt),
  relayer: toHex(r.relayer),
});

const allowed = (r, asset) => BigInt(asset) !== 0n && r.assets.includes(BigInt(asset));

/**
 * Everything a TintWallet needs to read an agent account, plus what its proofs need.
 * Pass spendKey only on the user's side: it is what lets money leave the account.
 */
export function agentAccountKeys({ agentKey, userOwner, rules, spendKey }) {
  agentKey = BigInt(agentKey);
  const r = normalizeRules(rules);
  const rulesHash = rulesHashOf(r);
  const owner = accountOwnerOf(userOwner, agentPubOf(agentKey), rulesHash);
  const viewSecret = hkdf(sha256, toBytes32(agentKey), enc.encode('tint'), enc.encode('agent view'), 32);
  const viewPublic = x25519.getPublicKey(viewSecret);
  if (spendKey !== undefined && ownerOf(spendKey) !== BigInt(userOwner)) throw new Error('spend key is not this user’s');
  return {
    owner,
    nk: nullifierKeyOf(agentKey),
    viewSecret,
    viewPublic,
    address: encodeAddress(owner, viewPublic),
    agent: { agentKey, userOwner: BigInt(userOwner), rules: r, rulesHash, spendKey: spendKey === undefined ? undefined : BigInt(spendKey) },
  };
}

/** Same checks as agent_swap, so a bad trade fails here with a clear reason instead of in the prover. */
export function checkAgentSwap(rules, { assetIn, assetOut, amountIn, ext }) {
  const r = normalizeRules(rules);
  if (!allowed(r, assetIn) || !allowed(r, assetOut)) throw new Error('That asset is not in the agent’s rules.');
  if (BigInt(assetIn) === r.assets[0] && BigInt(amountIn) > r.maxBuy) throw new Error('That buy is over the agent’s limit per trade.');
  if (BigInt(ext.fee) * 10_000n > BigInt(amountIn) * r.maxFeeBps) throw new Error('The relayer fee is over the agent’s fee limit for a trade this size.');
  if (BigInt(ext.relayer) !== r.relayer) throw new Error('The agent can only use the relayer named in its rules.');
  if (BigInt(ext.deadline) > r.endsAt) throw new Error('The agent’s rules have ended.');
}

/** agent_swap inputs: the swap circuit's, with the account as owner, plus the rules. */
export function buildAgentSwap({ keys, ...args }) {
  const { agent } = keys;
  checkAgentSwap(agent.rules, args);
  const built = buildSwap({ ...args, owner: keys.owner, nk: keys.nk });
  const { spend_key: _drop, ...rest } = built.circuitInputs;
  const circuitInputs = {
    ...rest,
    relayer: toHex(BigInt(args.ext.relayer)),
    fee: toHex(args.ext.fee),
    deadline: toHex(args.ext.deadline),
    agent_key: toHex(agent.agentKey),
    user_owner: toHex(agent.userOwner),
    rules: rulesInput(agent.rules),
  };
  return { ...built, circuitInputs };
}

/** agent_transact inputs: needs the user's spend key and the agent key. */
export function buildAgentTransact({ keys, ...args }) {
  const { agent } = keys;
  if (agent.spendKey === undefined) throw new Error('Only the owner can move money out of an agent account.');
  const built = buildTransact({ ...args, spendKey: agent.spendKey, owner: keys.owner, nk: keys.nk });
  const circuitInputs = { ...built.circuitInputs, agent_key: toHex(agent.agentKey), rules_hash: toHex(agent.rulesHash) };
  return { ...built, circuitInputs };
}

// ---------------------------------------------------------------- memo and agent key

const hexRules = (r) => ({
  assets: r.assets.map((a) => '0x' + a.toString(16)),
  maxBuy: r.maxBuy.toString(),
  maxFeeBps: r.maxFeeBps.toString(),
  endsAt: r.endsAt.toString(),
  relayer: '0x' + r.relayer.toString(16),
});

/**
 * The plan is how the agent spends inside the rules (code, not proof):
 * { amount: cash per round (string, token units), every: seconds between rounds, slippageBps }
 */
export function encodeAgentMemo({ index, rules, plan, name }) {
  return enc.encode(JSON.stringify({ t: 'tint-agent', v: 1, i: index, name, rules: hexRules(normalizeRules(rules)), plan }));
}

export function decodeAgentMemo(bytes) {
  try {
    const m = JSON.parse(dec.decode(bytes));
    if (m.t !== 'tint-agent' || m.v !== 1) return null;
    return { index: Number(m.i), name: m.name, rules: normalizeRules(m.rules), plan: m.plan };
  } catch {
    return null;
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/**
 * What you hand the agent: its key, your owner (public anyway, it is in your
 * address), the rules and the plan. It lets the agent trade within the rules and
 * read the account. It can't move money out.
 */
export function encodeAgentKey({ agentKey, userOwner, rules, plan, name }) {
  const body = { k: '0x' + BigInt(agentKey).toString(16), u: '0x' + BigInt(userOwner).toString(16), rules: hexRules(normalizeRules(rules)), plan, name };
  return 'tintagent1' + b64url(enc.encode(JSON.stringify(body)));
}

export function decodeAgentKey(s) {
  s = s.trim();
  if (!s.startsWith('tintagent1')) throw new Error('not a Tint agent key');
  const m = JSON.parse(dec.decode(unb64url(s.slice('tintagent1'.length))));
  return { agentKey: BigInt(m.k), userOwner: BigInt(m.u), rules: normalizeRules(m.rules), plan: m.plan, name: m.name };
}
