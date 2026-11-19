#!/usr/bin/env node
// Agent accounts end to end on the local fork (tools/dev-fork.sh + the relayer):
//   1. the user adds USDG to their private balance
//   2. creates an agent (rules + plan) and funds it with a private send through
//      the relayer; the rules ride in an encrypted memo on the user's own change note
//   3. a fresh wallet finds the agent again from the chain alone
//   4. the real runner (agent/run.mjs, ONCE=1) does one round: proves agent_swap
//      for each stock and sends the buys through the relayer
//   5. the agent key alone can't move money out
//   6. the user stops the agent: agent_transact moves everything back
// Every step is a real transaction with a real proof.
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
  TintWallet,
  tintPoolAbi,
} from '../src/index.js';
import { proverFor } from '../src/node.js';

const depPath = process.env.DEPLOYMENT ?? fileURLToPath(new URL('../../contracts/deployments/31337.json', import.meta.url));
const dep = JSON.parse(readFileSync(depPath));
const RELAYER = process.env.RELAYER_URL ?? 'http://127.0.0.1:8790';
const chain = defineChain({ id: dep.chainId, name: `chain ${dep.chainId}`, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [process.env.RPC_URL ?? dep.rpc] } } });
// Tokens: from the deployment file (testnet: tUSDG + Robinhood's test stocks), else the mainnet fork's.
const cashAsset = dep.assets?.find((a) => a.cash);
const stockAssets = dep.assets?.filter((a) => !a.cash) ?? [];
const USDG = cashAsset?.address ?? '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NVDA = stockAssets[0]?.address ?? '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';
const TSLA = stockAssets[1]?.address ?? '0x322F0929c4625eD5bAd873c95208D54E1c003b2d';
const names = { [USDG.toLowerCase()]: 'USDG', [NVDA.toLowerCase()]: stockAssets[0]?.symbol ?? 'NVDA', [TSLA.toLowerCase()]: stockAssets[1]?.symbol ?? 'TSLA' };
const fmt = (b) => Object.fromEntries(Object.entries(b).map(([a, v]) => [names[a] ?? a, formatUnits(v, names[a] === 'USDG' ? 6 : 18)]));
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

// USER_KEY, or anvil test account 1 (public key, local only)
const account = privateKeyToAccount(process.env.USER_KEY ?? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
// a cold fork pulls state from the public RPC, so first calls can be slow
const client = createPublicClient({ chain, transport: http(undefined, { timeout: 120_000 }) });
const wallet = createWalletClient({ chain, transport: http(undefined, { timeout: 120_000 }), account });
await initHash();
const keys = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
const make = (k) => new TintWallet({ client, pool: dep.pool, fromBlock: BigInt(dep.startBlock), keys: k });
const provers = {};
const prove = async (a) => (await (provers[a.circuit] ??= proverFor(a.circuit))).prove(a.circuitInputs);

async function direct(action, label) {
  const { proof } = await prove(action);
  const hash = await wallet.writeContract({ address: dep.pool, abi: tintPoolAbi, functionName: action.functionName, args: callArgs(action, proof) });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  lastBlock = r.blockNumber;
  console.log(`${label}: gas ${r.gasUsed}, sent by the user's wallet`);
}

let lastBlock = 0n; // the newest receipt: wallets made after it must read past it

async function relayed(action, label) {
  const { proof } = await prove(action);
  const [p, ext] = callArgs(action, proof);
  const res = await fetch(`${RELAYER}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ functionName: action.functionName, p, ext }) });
  const out = await res.json();
  if (!res.ok) throw new Error(`${label}: ${out.error}`);
  const r = await client.waitForTransactionReceipt({ hash: out.hash });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  lastBlock = r.blockNumber;
  console.log(`${label}: gas ${r.gasUsed}, sent by the relayer ${r.from}, tx ${out.hash}`);
}

const info = await (await fetch(`${RELAYER}/info`)).json();
const feeIn = async (asset) => BigInt((await (await fetch(`${RELAYER}/fee?asset=${asset}`)).json()).fee);

// 1. 300 USDG into the private balance (testnet: take it from the tUSDG faucet first)
if (cashAsset?.name?.includes('Test')) {
  const h = await wallet.writeContract({ address: USDG, abi: [{ type: 'function', name: 'faucet', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] }], functionName: 'faucet', args: [parseUnits('300', 6)] });
  await client.waitForTransactionReceipt({ hash: h });
}
await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: USDG, abi: erc20Abi, functionName: 'approve', args: [dep.pool, 2n ** 256n - 1n] }) });
let user = await make(keys).syncPast(lastBlock);
await direct(user.deposit({ asset: USDG, amount: parseUnits('300', 6) }), 'add 300 USDG');

// 2. an agent: two stocks, 40 USDG a round (20 each), at most 25 a buy, fee at most 5%, one week
const now = Number((await client.getBlock()).timestamp);
const index = Math.max(-1, ...(await user.syncPast(lastBlock)).agents().map((a) => a.index)) + 1;
const rules = { cash: USDG, stocks: [NVDA, TSLA], maxBuy: parseUnits('25', 6), maxFeeBps: 500n, endsAt: BigInt(now + 7 * 86400), relayer: info.relayer };
const plan = { amount: parseUnits('40', 6).toString(), every: 604800, slippageBps: 100 };
const agentKey = agentKeyOf(keys.spendKey, index);
const acct = agentAccountKeys({ agentKey, userOwner: keys.owner, rules });
const fee = await feeIn(USDG);
await relayed(
  user.send({ asset: USDG, amount: parseUnits('100', 6), to: acct.address, relayer: info.relayer, fee, memo: encodeAgentMemo({ index, rules, plan, name: `Weekly ${names[NVDA.toLowerCase()]} + ${names[TSLA.toLowerCase()]}` }) }),
  `fund agent #${index} with 100 USDG (private send)`,
);

// 3. a fresh wallet finds the agent from the chain alone
user = await make(keys).syncPast(lastBlock);
const found = user.agents().find((a) => a.index === index);
if (!found) throw new Error('agent memo not found');
console.log(`found agent #${found.index} "${found.name}" from chain events, plan ${json(found.plan)}`);

// 4. the runner does one round
const agentString = encodeAgentKey({ agentKey, userOwner: keys.owner, rules: found.rules, plan: found.plan, name: found.name });
const runner = fileURLToPath(new URL('../../agent/run.mjs', import.meta.url));
const out = execFileSync(process.execPath, [runner], {
  env: { ...process.env, AGENT_KEY: agentString, DEPLOYMENT: depPath, RELAYER_URL: RELAYER, ONCE: '1' },
  encoding: 'utf8',
});
process.stdout.write(out.trimEnd().replace(/^/gm, '  runner | ') + '\n');
if (!/Bought/.test(out)) throw new Error('runner bought nothing');
for (const h of out.match(/0x[0-9a-f]{64}/g) ?? []) {
  const r = await client.getTransactionReceipt({ hash: h }).catch(() => null);
  if (r && r.blockNumber > lastBlock) lastBlock = r.blockNumber;
}

// the runner reads the same account; a second check finds no round due
const out2 = execFileSync(process.execPath, [runner], { env: { ...process.env, AGENT_KEY: agentString, DEPLOYMENT: depPath, RELAYER_URL: RELAYER, ONCE: '1' }, encoding: 'utf8' });
if (!/next round in/.test(out2)) throw new Error('second check should wait for the next round');
console.log('second check: no round due until next week');

const agentOnly = await make(agentAccountKeys({ agentKey, userOwner: keys.owner, rules: found.rules })).syncPast(lastBlock);
console.log('agent account holds:', fmt(agentOnly.balances()));

// 5. the agent key alone can't move money out
try {
  agentOnly.send({ asset: USDG, amount: 1n, to: 'tint1' + '0'.repeat(128) });
  throw new Error('agent could move money out');
} catch (e) {
  if (!/only trade/.test(e.message)) throw e;
  console.log('agent key alone, moving money out:', e.message);
}

// 6. the user stops the agent: everything back to the private balance
const owned = await make(agentAccountKeys({ agentKey, userOwner: keys.owner, rules: found.rules, spendKey: keys.spendKey })).syncPast(lastBlock);
for (const asset of [USDG, NVDA, TSLA]) {
  for (;;) {
    await owned.syncPast(lastBlock);
    const notes = owned.unspent(asset).sort((a, b) => (a.amount > b.amount ? -1 : 1)).slice(0, 2);
    if (!notes.length) break;
    const total = notes.reduce((s, n) => s + n.amount, 0n);
    const f = await feeIn(asset);
    await relayed(owned.send({ asset, amount: total - f, to: keys.address, relayer: info.relayer, fee: f }), `stop agent: ${names[asset.toLowerCase()]} back to the user`);
  }
}
user = await make(keys).syncPast(lastBlock);
console.log('agent account after stop:', fmt((await owned.syncPast(lastBlock)).balances()));
console.log('user private balance:', fmt(user.balances()));
for (const p of Object.values(provers)) await (await p).destroy();
process.exit(0);
