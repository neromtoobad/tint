#!/usr/bin/env node
// End to end on the local fork (tools/dev-fork.sh): deposit, private buy,
// rebuild the wallet from chain events alone, private sell, withdraw.
// Every step sends a real transaction with a real proof.
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, http, defineChain, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { initHash, keysFromSignature, KEY_MESSAGE, TintWallet, callArgs, tintPoolAbi, erc20Abi, exportViewingKey, importViewingKey } from '../src/index.js';
import { proverFor } from '../src/node.js';

const dep = JSON.parse(readFileSync(new URL('../../contracts/deployments/31337.json', import.meta.url)));
const chain = defineChain({ id: 31337, name: 'Robinhood fork', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [dep.rpc] } } });
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const NVDA = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';
const QUOTER = '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7';
// anvil test account 1 (public key, local only)
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const client = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ chain, transport: http(), account });
await initHash();

const keys = keysFromSignature(await account.signMessage({ message: KEY_MESSAGE }));
const make = (k) => new TintWallet({ client, pool: dep.pool, fromBlock: BigInt(dep.startBlock), keys: k });
const provers = { transact: await proverFor('transact'), swap: await proverFor('swap') };

async function run(action, label) {
  const t = Date.now();
  const { proof } = await provers[action.circuit].prove(action.circuitInputs);
  const proveMs = Date.now() - t;
  const hash = await wallet.writeContract({ address: dep.pool, abi: tintPoolAbi, functionName: action.functionName, args: callArgs(action, proof) });
  const r = await client.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`${label} reverted`);
  console.log(`${label}: proof ${proveMs} ms, gas ${r.gasUsed}, tx ${hash}`);
}

const fmt = (b) => Object.fromEntries(Object.entries(b).map(([a, v]) => [a === USDG.toLowerCase() ? 'USDG' : a === NVDA.toLowerCase() ? 'NVDA' : a, formatUnits(v, a === USDG.toLowerCase() ? 6 : 18)]));

// 1. deposit 500 USDG
await wallet.writeContract({ address: USDG, abi: erc20Abi, functionName: 'approve', args: [dep.pool, 2n ** 256n - 1n] });
let w = await make(keys).sync();
await run(w.deposit({ asset: USDG, amount: parseUnits('500', 6) }), 'deposit 500 USDG');

// 2. buy NVDA with 200 USDG at the live pool price, 1% slippage
await w.sync();
const { result } = await client.simulateContract({
  address: QUOTER,
  abi: [{ type: 'function', name: 'quoteExactInputSingle', stateMutability: 'nonpayable', inputs: [{ type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }], outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }, { type: 'uint256' }] }],
  functionName: 'quoteExactInputSingle',
  args: [{ tokenIn: USDG, tokenOut: NVDA, amountIn: parseUnits('200', 6), fee: 500, sqrtPriceLimitX96: 0n }],
});
const quote = result[0];
const deadline = (await client.getBlock()).timestamp + 600n;
await run(w.swap({ assetIn: USDG, assetOut: NVDA, amountIn: parseUnits('200', 6), minOut: (quote * 99n) / 100n, poolFee: 500, deadline }), 'buy NVDA privately');

// 3. a fresh wallet object rebuilt only from chain events (as on a new device)
w = await make(keys).sync();
console.log('balance rebuilt from chain:', fmt(w.balances()));
const nvdaHeld = w.balances()[NVDA.toLowerCase()];
if (!nvdaHeld) throw new Error('bought NVDA note not found');

// 4. a viewing key sees the same balance and cannot spend
const viewer = await make(importViewingKey(exportViewingKey(keys))).sync();
console.log('viewing key sees:', fmt(viewer.balances()));
try {
  viewer.withdraw({ asset: USDG, amount: 1n, recipient: account.address });
  throw new Error('viewing key could spend');
} catch (e) {
  if (!/viewing key/.test(e.message)) throw e;
}

// 5. sell half the NVDA, then withdraw all USDG
const deadline2 = (await client.getBlock()).timestamp + 600n;
await run(w.swap({ assetIn: NVDA, assetOut: USDG, amountIn: nvdaHeld / 2n, minOut: 1n, poolFee: 500, deadline: deadline2 }), 'sell half the NVDA privately');
await w.sync();
console.log('after sell:', fmt(w.balances()));
const usdgNotes = w.unspent(USDG);
console.log('USDG notes:', usdgNotes.map((n) => formatUnits(n.amount, 6)));
const all = w.balances()[USDG.toLowerCase()];
const fresh = '0x000000000000000000000000000000000000beef';
await run(w.withdraw({ asset: USDG, amount: all, recipient: fresh }), 'withdraw all USDG to a fresh address');
await w.sync();
console.log('fresh address got', formatUnits(await client.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [fresh] }), 6), 'USDG');
console.log('left in private balance:', fmt(w.balances()));
console.log('history:', w.history().map((h) => h.type).join(', '));
for (const p of Object.values(provers)) await p.destroy();
process.exit(0);
