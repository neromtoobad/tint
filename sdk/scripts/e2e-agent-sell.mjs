#!/usr/bin/env node
// Selling by plan, end to end on the local fork (tools/dev-fork.sh + the relayer):
//   1. the user funds an agent whose plan sells: take profit at +3% (half),
//      stop loss at -3% (all)
//   2. the runner (agent/run.mjs, ONCE=1) makes the first round: one NVDA buy
//   3. a public trader buys NVDA on the real Uniswap pools and the price rises 8%;
//      the next check sells half (take profit)
//   4. one more check sells nothing: the next take profit is measured from that sale
//   5. a public trader sells NVDA and the price falls 12%, below the average cost;
//      the next check sells the rest (stop loss)
// Every agent trade is a real agent_swap proof sent through the relayer. The
// price moves are real swaps on the forked Uniswap pool by a test-only contract
// (scripts/fork-price.mjs, contracts/test/mocks/PricePusher.sol).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  agentAccountKeys,
  agentKeyOf,
  callArgs,
  encodeAgentKey,
  encodeAgentMemo,
  erc20Abi,
  initHash,
  KEY_MESSAGE,
  keysFromSignature,
  positions,
  TintWallet,
  tintPoolAbi,
} from '../src/index.js';
import { proverFor } from '../src/node.js';
import { forkPricer } from './fork-price.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const depPath = process.env.DEPLOYMENT ?? `${root}contracts/deployments/31337.json`;
const dep = JSON.parse(readFileSync(depPath));
if (dep.chainId !== 31337) throw new Error('this test moves prices with anvil: run it on the local fork');
const RPC = process.env.RPC_URL ?? dep.rpc;
const RELAYER = process.env.RELAYER_URL ?? 'http://127.0.0.1:8790';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NVDA = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';
const chain = defineChain({ id: 31337, name: 'fork', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

// anvil test account 1 (public key, local only)
const account = privateKeyToAccount(process.env.USER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 120_000 }) });
const wallet = createWalletClient({ chain, transport: http(undefined, { timeout: 120_000 }), account });
await initHash();
const keys = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
const make = (k) => new TintWallet({ client, pool: dep.pool, fromBlock: BigInt(dep.startBlock), keys: k });
const provers = {};
const prove = async (a) => (await (provers[a.circuit] ??= proverFor(a.circuit))).prove(a.circuitInputs);
let lastBlock = 0n;

async function mined(hash, label) {
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  if (r.blockNumber > lastBlock) lastBlock = r.blockNumber;
  return r;
}

async function relayed(action, label) {
  const { proof } = await prove(action);
  const [p, ext] = callArgs(action, proof);
  const res = await fetch(`${RELAYER}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ functionName: action.functionName, p, ext }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`${label}: ${out.error}`);
  await mined(out.hash, label);
  console.log(`${label}: tx ${out.hash}`);
}

// ------------------------------------------------------------------ the public trader

const move = await forkPricer({ client, wallet, rpc: RPC, factory: dep.uniswapFactory, cash: USDG, onTx: (r) => r.blockNumber > lastBlock && (lastBlock = r.blockNumber) });
async function movePrice(pct, label) {
  for (const t of await move(NVDA, pct)) console.log(`${label}: ${t.side} NVDA on the ${t.fee / 10000}% pool, tx ${t.hash}`);
}

// ------------------------------------------------------------------ the runner

const runner = `${root}agent/run.mjs`;
async function runOnce(agentString) {
  await client.request({ method: 'evm_mine', params: [] });
  const out = execFileSync(process.execPath, [runner], { env: { ...process.env, AGENT_KEY: agentString, DEPLOYMENT: depPath, RELAYER_URL: RELAYER, ONCE: '1' }, encoding: 'utf8' });
  process.stdout.write(out.trimEnd().replace(/^/gm, '  runner | ') + '\n');
  for (const h of out.match(/0x[0-9a-f]{64}/g) ?? []) await client.getTransactionReceipt({ hash: h }).then((r) => r.blockNumber > lastBlock && (lastBlock = r.blockNumber)).catch(() => {});
  return out;
}

// ------------------------------------------------------------------ 1. the agent

const info = await (await fetch(`${RELAYER}/info`)).json();
const feeIn = async (asset) => BigInt((await (await fetch(`${RELAYER}/fee?asset=${asset}`)).json()).fee);
await mined(await wallet.writeContract({ address: USDG, abi: erc20Abi, functionName: 'approve', args: [dep.pool, 2n ** 256n - 1n] }), 'approve');
let user = await make(keys).syncPast(lastBlock);
{
  const action = user.deposit({ asset: USDG, amount: parseUnits('200', 6) });
  const { proof } = await prove(action);
  await mined(await wallet.writeContract({ address: dep.pool, abi: tintPoolAbi, functionName: action.functionName, args: callArgs(action, proof) }), 'add');
  console.log('add 200 USDG to the private balance');
}
user = await make(keys).syncPast(lastBlock);
const now = Number((await client.getBlock()).timestamp);
const index = Math.max(-1, ...user.agents().map((a) => a.index)) + 1;
const rules = { cash: USDG, stocks: [NVDA], maxBuy: parseUnits('50', 6), maxFeeBps: 500n, endsAt: BigInt(now + 7 * 86400), relayer: info.relayer };
const plan = { amount: parseUnits('40', 6).toString(), every: 604800, slippageBps: 100, takeProfitBps: 300, takeProfitSellBps: 5000, stopLossBps: 300 };
const agentKey = agentKeyOf(keys.spendKey, index);
const acct = agentAccountKeys({ agentKey, userOwner: keys.owner, rules });
await relayed(
  user.send({ asset: USDG, amount: parseUnits('100', 6), to: acct.address, relayer: info.relayer, fee: await feeIn(USDG), memo: encodeAgentMemo({ index, rules, plan, name: 'NVDA with exits' }) }),
  `fund agent #${index} with 100 USDG, plan ${json(plan)}`,
);
const agentString = encodeAgentKey({ agentKey, userOwner: keys.owner, rules, plan, name: 'NVDA with exits' });
const show = async (label) => {
  const w = await make(acct).syncPast(lastBlock);
  const p = positions({ wallet: w, rules }).get(BigInt(NVDA));
  const b = w.balances();
  console.log(`${label}: ${formatUnits(b[NVDA.toLowerCase()] ?? 0n, 18)} NVDA, ${formatUnits(b[USDG.toLowerCase()] ?? 0n, 6)} USDG; cost of what is held ${formatUnits(p?.cost ?? 0n, 6)}, realized ${formatUnits(p?.realized ?? 0n, 6)}`);
  return w;
};

// 2. first round: one buy, nothing to sell
const r1 = await runOnce(agentString);
if (!/Bought/.test(r1) || /Sold/.test(r1)) throw new Error('round 1 should buy and not sell');
await show('after round 1');

// 3. price up → take profit sells half
await movePrice(8, 'NVDA up 8%');
const r2 = await runOnce(agentString);
if (!/Sold .*take profit/.test(r2)) throw new Error('take profit did not sell');
await show('after take profit');

// 4. same price → nothing more to sell
const r3 = await runOnce(agentString);
if (/Sold/.test(r3)) throw new Error('take profit sold twice on one rise');
console.log('one more check: no sale (the next take profit counts from the last sale price)');

// 5. price down below cost → stop loss sells the rest
await movePrice(-12, 'NVDA down 12%');
const r4 = await runOnce(agentString);
if (!/Sold .*stop loss/.test(r4)) throw new Error('stop loss did not sell');
const end = await show('after stop loss');
if (end.unspent(NVDA).length) throw new Error('stop loss left NVDA in the account');

for (const p of Object.values(provers)) await (await p).destroy();
process.exit(0);
