#!/usr/bin/env node
// Tint agent runner.
//
// Holds one agent key (tintagent1…), reads the agent account from the chain,
// and when a round is due it buys the picked stocks with the account's cash:
// it prices each buy on Uniswap, proves it with circuits/agent_swap and sends
// it through the relayer. The proof is what keeps it inside the rules; this
// process can't move money out of the account even if it wanted to.
//
// It keeps no state: the last round is read from the account's own history.
import { readFileSync } from 'node:fs';
import { createPublicClient, defineChain, getAddress, http } from 'viem';
import { agentAccountKeys, callArgs, decodeAgentKey, initHash, roundStatus, runRound, TintWallet } from '@tint/sdk';
import { proverFor } from '@tint/sdk/node';

const env = process.env;
if (!env.AGENT_KEY) throw new Error('set AGENT_KEY (see .env.example)');
const dep = env.DEPLOYMENT ? JSON.parse(readFileSync(env.DEPLOYMENT, 'utf8')) : {};
const RPC = env.RPC_URL ?? dep.rpc;
const POOL = getAddress(env.POOL ?? dep.pool);
const CHAIN_ID = Number(env.CHAIN_ID ?? dep.chainId);
const START = BigInt(env.START_BLOCK ?? dep.startBlock ?? 0);
const RELAYER_URL = (env.RELAYER_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const QUOTER = getAddress(env.QUOTER ?? dep.quoter ?? '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7');
const CHECK_EVERY = Number(env.CHECK_EVERY ?? 60);

const chain = defineChain({ id: CHAIN_ID, name: `chain ${CHAIN_ID}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

const log = (line) => console.log(new Date().toISOString(), line);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

await initHash();
const agent = decodeAgentKey(env.AGENT_KEY);
const keys = agentAccountKeys(agent); // no spend key: this process can only trade
const { rules, plan } = agent;
const wallet = new TintWallet({ client, pool: POOL, fromBlock: START, keys });

// ------------------------------------------------------------------ chain + relayer

const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
    outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }, { type: 'uint256' }],
  },
];
const swapFeeAbi = [{ type: 'function', name: 'swapFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] }];

async function quote(tokenIn, tokenOut, amountIn) {
  const tries = await Promise.allSettled(
    [500, 3000, 10000].map((fee) =>
      client
        .simulateContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }] })
        .then((r) => ({ amountOut: r.result[0], fee })),
    ),
  );
  return tries.filter((t) => t.status === 'fulfilled').map((t) => t.value).sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))[0];
}

async function relayer(path, body) {
  const res = await fetch(RELAYER_URL + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: json(body) } : {});
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `relayer ${res.status}`);
  return out;
}

const relayerFee = async (asset) => BigInt((await relayer(`/fee?asset=${asset}`)).fee);

const provers = {};
async function submit(action) {
  provers[action.circuit] ??= await proverFor(action.circuit);
  const t = Date.now();
  const { proof } = await provers[action.circuit].prove(action.circuitInputs);
  log(`proved ${action.circuit} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  const [p, ext] = callArgs(action, proof);
  const { hash } = await relayer('/relay', { functionName: action.functionName, p, ext });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`reverted: ${hash}`);
  return { hash };
}

// ------------------------------------------------------------------ loop

const info = await relayer('/info');
if (BigInt(info.relayer) !== rules.relayer) {
  throw new Error(`The rules only allow relayer 0x${rules.relayer.toString(16)}; ${RELAYER_URL} is ${info.relayer}.`);
}
const swapFeeBps = BigInt(await client.readContract({ address: POOL, abi: swapFeeAbi, functionName: 'swapFeeBps' }));
const blockTime = async (n) => Number((await client.getBlock({ blockNumber: n })).timestamp);
const chainNow = async () => Math.max(Math.floor(Date.now() / 1000), Number((await client.getBlock()).timestamp));

log(`agent ${agent.name ?? ''} account ${keys.address.slice(0, 18)}… on chain ${CHAIN_ID}`);
log(`plan: ${plan.amount} cash every ${plan.every}s over ${rules.assets.slice(1).filter((a) => a).length} stocks, ends ${new Date(Number(rules.endsAt) * 1000).toISOString()}`);

for (;;) {
  try {
    await wallet.sync();
    const now = await chainNow();
    const status = await roundStatus({ wallet, rules, plan, now, blockTime });
    if (status.ended) {
      log('The rules have ended. The agent stops; the owner can take everything back.');
      break;
    }
    if (status.due) {
      log(`round due (${status.buys} buys so far)`);
      await runRound({ wallet, rules, plan, relayer: info.relayer, swapFeeBps, quote, relayerFee, submit, log, now });
    } else {
      log(`next round in ${status.nextAt - now}s`);
    }
  } catch (e) {
    log(`error: ${e.shortMessage ?? e.message}`);
  }
  if (env.ONCE) break;
  await new Promise((r) => setTimeout(r, CHECK_EVERY * 1000));
}
for (const p of Object.values(provers)) await p.destroy();
process.exit(0);
