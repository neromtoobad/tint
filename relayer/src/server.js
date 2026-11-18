// Tint relayer: sends private transactions for users so their own wallet never
// shows up as the sender. The user's browser makes the proof; the proof already
// fixes the relayer address and fee (they are inside ext_hash), so the relayer
// can't change the trade, the recipient or its own pay. It only chooses whether
// to send it.
//
//   GET  /info            relayer address, chain, pool, fee in USD
//   GET  /fee?asset=0x…   fee for a transaction paid in that asset (token units)
//   POST /relay           { functionName, p, ext }  ->  { hash }
//                         functionName: transact | swap | agentTransact | agentSwap
//
// Deposits are not relayed: they pull tokens from the sender's own wallet.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { tintPoolAbi } from '@tint/sdk/abi';

const env = process.env;
const dep = env.DEPLOYMENT ? JSON.parse(readFileSync(env.DEPLOYMENT, 'utf8')) : {};
const RPC = env.RPC_URL ?? dep.rpc;
const POOL = getAddress(env.POOL ?? dep.pool);
const CHAIN_ID = Number(env.CHAIN_ID ?? dep.chainId);
const CASH = getAddress(env.CASH_TOKEN ?? '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'); // USDG
const CASH_DECIMALS = Number(env.CASH_DECIMALS ?? 6);
const QUOTER = getAddress(env.QUOTER ?? '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7');
const FEE_USD = env.FEE_USD ?? '0.50'; // one private transaction is ~4.5M gas (~$0.30 at 0.02 gwei)
const PORT = Number(env.PORT ?? 8790);
const ALLOW_ORIGIN = env.ALLOW_ORIGIN ?? '*';
if (!env.RELAYER_KEY) throw new Error('set RELAYER_KEY (see .env.example)');
if (!RPC || !CHAIN_ID) throw new Error('set DEPLOYMENT, or RPC_URL + POOL + CHAIN_ID');

const chain = defineChain({ id: CHAIN_ID, name: `chain ${CHAIN_ID}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const account = privateKeyToAccount(env.RELAYER_KEY);
const client = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });
const wallet = createWalletClient({ chain, transport: http(RPC, { timeout: 30_000 }), account });

// ------------------------------------------------------------------ fees

const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'tuple', components: [{ name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'fee', type: 'uint24' }, { name: 'sqrtPriceLimitX96', type: 'uint160' }] }],
    outputs: [{ type: 'uint256' }, { type: 'uint160' }, { type: 'uint32' }, { type: 'uint256' }],
  },
];
const feeCache = new Map(); // asset -> { fee, at }

/** The fee in `asset` units: FEE_USD worth, priced on the asset's Uniswap pool. */
export async function feeFor(asset) {
  asset = getAddress(asset);
  const cashFee = parseUnits(FEE_USD, CASH_DECIMALS);
  if (asset === CASH) return cashFee;
  const hit = feeCache.get(asset);
  if (hit && Date.now() - hit.at < 30_000) return hit.fee;
  const quotes = await Promise.allSettled(
    [500, 3000, 10000].map((fee) =>
      client
        .simulateContract({ address: QUOTER, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ tokenIn: CASH, tokenOut: asset, amountIn: cashFee, fee, sqrtPriceLimitX96: 0n }] })
        .then((r) => r.result[0]),
    ),
  );
  const best = quotes.filter((q) => q.status === 'fulfilled').reduce((m, q) => (q.value > m ? q.value : m), 0n);
  if (best === 0n) throw httpError(400, 'No market to price a fee in this asset.');
  feeCache.set(asset, { fee: best, at: Date.now() });
  return best;
}

// ------------------------------------------------------------------ checks

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const big = (v) => BigInt(v);
const addr = (v) => getAddress(v);

/** JSON from the browser -> the exact struct shapes the pool ABI expects. */
function parseCall({ functionName, p, ext }) {
  if (functionName === 'transact' || functionName === 'agentTransact') {
    return {
      functionName,
      p: { proof: p.proof, root: big(p.root), publicAsset: big(p.publicAsset), publicIn: big(p.publicIn), publicOut: big(p.publicOut), nullifiers: p.nullifiers.map(big), outCommitments: p.outCommitments.map(big) },
      ext: { recipient: addr(ext.recipient), relayer: addr(ext.relayer), fee: big(ext.fee), encryptedOutput0: ext.encryptedOutput0, encryptedOutput1: ext.encryptedOutput1 },
    };
  }
  if (functionName === 'swap' || functionName === 'agentSwap') {
    return {
      functionName,
      p: { proof: p.proof, root: big(p.root), nullifiers: p.nullifiers.map(big), assetIn: big(p.assetIn), amountIn: big(p.amountIn), assetOut: big(p.assetOut), minOut: big(p.minOut), changeCommitment: big(p.changeCommitment), outInner: big(p.outInner) },
      ext: { relayer: addr(ext.relayer), fee: big(ext.fee), poolFee: Number(ext.poolFee), deadline: big(ext.deadline), encryptedChange: ext.encryptedChange, encryptedOut: ext.encryptedOut },
    };
  }
  throw httpError(400, 'functionName must be transact, swap, agentTransact or agentSwap');
}

const toAddr = (x) => getAddress('0x' + x.toString(16).padStart(40, '0'));

async function check(call) {
  const { functionName, p, ext } = call;
  if (ext.relayer !== account.address) throw httpError(400, `This proof pays relayer ${ext.relayer}, not this one (${account.address}).`);
  let feeAsset;
  if (functionName === 'transact' || functionName === 'agentTransact') {
    if (p.publicIn > 0n) throw httpError(400, 'Deposits are sent from your own wallet, not through the relayer.');
    if (p.publicOut === 0n) throw httpError(400, 'This transaction pays no fee.');
    feeAsset = toAddr(p.publicAsset);
  } else {
    feeAsset = toAddr(p.assetIn);
  }
  const want = await feeFor(feeAsset);
  // prices move between the quote and the send; accept 10% under the current fee
  if (ext.fee * 10n < want * 9n) throw httpError(400, `Fee too low: ${ext.fee}, the relayer asks ${want}.`);
}

// ------------------------------------------------------------------ send

let queue = Promise.resolve(); // one transaction at a time, so nonces never collide

async function relay(call) {
  const args = [call.p, call.ext];
  try {
    await client.simulateContract({ account, address: POOL, abi: tintPoolAbi, functionName: call.functionName, args });
  } catch (e) {
    const name = e.cause?.data?.errorName ?? e.cause?.reason;
    throw httpError(400, name ? `The pool would reject this: ${name}` : `The pool would reject this: ${e.shortMessage ?? e.message}`);
  }
  const send = queue.then(async () => {
    const gas = await client.estimateContractGas({ account, address: POOL, abi: tintPoolAbi, functionName: call.functionName, args });
    return wallet.writeContract({ address: POOL, abi: tintPoolAbi, functionName: call.functionName, args, gas: (gas * 12n) / 10n });
  });
  queue = send.catch(() => {});
  return send;
}

// ------------------------------------------------------------------ http

const hits = new Map(); // ip -> [timestamps], in memory only, never logged
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

function reply(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': ALLOW_ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw httpError(413, 'Request too large.');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Body must be JSON.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') return reply(res, 204, {});
    if (limited(req.socket.remoteAddress)) throw httpError(429, 'Too many requests. Wait a minute.');
    if (req.method === 'GET' && url.pathname === '/info') {
      return reply(res, 200, { relayer: account.address, chainId: CHAIN_ID, pool: POOL, feeUsd: FEE_USD });
    }
    if (req.method === 'GET' && url.pathname === '/fee') {
      const asset = url.searchParams.get('asset');
      if (!asset) throw httpError(400, 'asset is required');
      return reply(res, 200, { asset: getAddress(asset), fee: await feeFor(asset), feeUsd: FEE_USD });
    }
    if (req.method === 'POST' && url.pathname === '/relay') {
      let call;
      try {
        call = parseCall(await readBody(req));
      } catch (e) {
        throw e.status ? e : httpError(400, `Malformed transaction: ${e.message}`);
      }
      await check(call);
      const hash = await relay(call);
      console.log(new Date().toISOString(), call.functionName, hash);
      return reply(res, 200, { hash });
    }
    throw httpError(404, 'Not found');
  } catch (e) {
    if (!e.status) console.error(e);
    reply(res, e.status ?? 500, { error: e.status ? e.message : 'Relayer error' });
  }
});

server.listen(PORT, () => {
  console.log(`Tint relayer ${account.address} on chain ${CHAIN_ID}, pool ${POOL}, fee $${FEE_USD}, port ${PORT}`);
});
