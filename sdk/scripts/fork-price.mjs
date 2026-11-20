#!/usr/bin/env node
// Local fork only: move a stock's real Uniswap price by public trades, to see an
// agent's take-profit or stop-loss react (tests, demos).
//
//   node scripts/fork-price.mjs NVDA 8     # NVDA up 8% on every NVDA/USDG pool
//   node scripts/fork-price.mjs NVDA -12   # down 12%
//
// A test-only contract (contracts/test/mocks/PricePusher.sol), given tokens with
// anvil_setStorageAt, trades on each fee tier until its price hits the target.
// The agent prices on the best tier, so every tier has to move.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http, parseUnits, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` };
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil account 0, public, local only

export const FORK_STOCKS = {
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  META: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35',
  AMZN: '0x12f190a9F9d7D37a250758b26824B97CE941bF54',
  GOOGL: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3',
};
export const FORK_USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';

const factoryAbi = [{ type: 'function', name: 'getPool', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }], outputs: [{ type: 'address' }] }];
const pushAbi = [{ type: 'function', name: 'pushTo', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint160' }], outputs: [] }];
const poolAbi = [
  { type: 'function', name: 'slot0', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }] },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
];
const BIG_CASH = parseUnits('100000000', 6);
const BIG_STOCK = parseUnits('1000000', 18);

const isqrt = (n) => {
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  for (let i = 0; i < 4; i++) x = (x + n / x) >> 1n;
  return x;
};

/**
 * Deploys the pusher and returns movePrice(stock, pct) -> [tx hashes].
 * `wallet` is any funded anvil account; `onTx(hash)` sees each receipt.
 */
export async function forkPricer({ client, wallet, rpc, factory, cash = FORK_USDG, onTx = () => {} }) {
  const out = execFileSync('forge', ['create', 'test/mocks/PricePusher.sol:PricePusher', '--rpc-url', rpc, '--private-key', DEPLOYER_KEY, '--broadcast'], { cwd: `${root}contracts`, env, encoding: 'utf8' });
  const pusher = out.match(/Deployed to: (0x[0-9a-fA-F]{40})/)[1];

  const give = async (token, amount) => {
    const o = execFileSync('forge', ['script', 'script/BalanceSlot.s.sol', '--rpc-url', rpc], { cwd: `${root}contracts`, env: { ...env, TOKEN: token, HOLDER: pusher }, encoding: 'utf8' });
    const slot = o.match(/0x[0-9a-f]{64}/g).at(-1);
    await client.request({ method: 'anvil_setStorageAt', params: [token, slot, toHex(amount, { size: 32 })] });
  };
  await give(cash, BIG_CASH);
  const funded = new Set();

  return async function movePrice(stock, pct) {
    if (!funded.has(stock)) {
      await give(stock, BIG_STOCK);
      funded.add(stock);
    }
    const f = BigInt(Math.round((1 + pct / 100) * 1e6)); // price factor × 1e6
    const hashes = [];
    for (const fee of [500, 3000, 10000]) {
      const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'getPool', args: [cash, stock, fee] });
      if (BigInt(pool) === 0n || !(await client.readContract({ address: pool, abi: poolAbi, functionName: 'liquidity' }))) continue;
      const stockIs0 = (await client.readContract({ address: pool, abi: poolAbi, functionName: 'token0' })).toLowerCase() === stock.toLowerCase();
      const [sqrtP] = await client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' });
      // the stock's price in cash is P if it is token0, 1/P otherwise; sqrtP scales with √price
      const target = stockIs0 ? (sqrtP * isqrt(f * 10n ** 18n)) / 10n ** 12n : (sqrtP * 10n ** 12n) / isqrt(f * 10n ** 18n);
      const tokenIn = (target < sqrtP) === stockIs0 ? stock : cash; // lowering sqrtP means selling token0
      const hash = await wallet.writeContract({ address: pusher, abi: pushAbi, functionName: 'pushTo', args: [pool, tokenIn, tokenIn === cash ? BIG_CASH : BIG_STOCK, target] });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error(`price push on the ${fee / 10000}% pool reverted`);
      onTx(r);
      hashes.push({ fee, hash, side: tokenIn === cash ? 'bought' : 'sold' });
    }
    return hashes;
  };
}

// ------------------------------------------------------------------ CLI

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sym, pctArg] = process.argv.slice(2);
  const stock = FORK_STOCKS[sym?.toUpperCase()];
  if (!stock || !Number(pctArg)) throw new Error(`usage: fork-price.mjs <${Object.keys(FORK_STOCKS).join('|')}> <percent, e.g. 8 or -12>`);
  const dep = JSON.parse(readFileSync(`${root}contracts/deployments/31337.json`));
  const rpc = process.env.RPC_URL ?? dep.rpc;
  const chain = defineChain({ id: 31337, name: 'fork', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  if ((await createPublicClient({ chain, transport: http() }).getChainId()) !== 31337) throw new Error('local fork only');
  const client = createPublicClient({ chain, transport: http(undefined, { timeout: 120_000 }) });
  const wallet = createWalletClient({ chain, transport: http(undefined, { timeout: 120_000 }), account: privateKeyToAccount(DEPLOYER_KEY) });
  const move = await forkPricer({ client, wallet, rpc, factory: dep.uniswapFactory });
  for (const t of await move(stock, Number(pctArg))) console.log(`${sym.toUpperCase()} ${Number(pctArg) > 0 ? 'up' : 'down'} ${Math.abs(Number(pctArg))}%: ${t.side} on the ${t.fee / 10000}% pool, tx ${t.hash}`);
}
