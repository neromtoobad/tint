import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountSold } from '../src/swap.js';
import { runRound } from '../src/autoinvest.js';

// TintPool._swap: afterRelayer = amountIn - fee; toSell = afterRelayer - afterRelayer * swapFeeBps / 10000
const poolSells = (amountIn, fee, bps) => {
  const afterRelayer = amountIn - fee;
  return afterRelayer - (afterRelayer * bps) / 10_000n;
};

test('amountSold matches what the pool sells', () => {
  for (const [amountIn, fee, bps] of [
    [20_000_000n, 500_000n, 0n],
    [20_000_000n, 500_000n, 30n],
    [20_000_000n, 500_000n, 100n],
    [1n, 0n, 100n],
    [999_999n, 3n, 77n],
  ]) {
    assert.equal(amountSold(amountIn, fee, bps), poolSells(amountIn, fee, bps));
  }
  assert.equal(amountSold(1_000n), 1_000n);
});

test('a round quotes and bounds what the pool sells after its swap fee', async () => {
  const CASH = 0x5fc5360d0400a0fd4f2af552add042d716f1d168n;
  const NVDA = 0xd0601ce157db5bdc3162bbac2a2c8af5320d9eecn;
  const rules = { assets: [CASH, NVDA, 0n, 0n, 0n, 0n], maxBuy: 20_000_000n, maxFeeBps: 500n, endsAt: 2_000_000_000n };
  const plan = { amount: '20000000', every: 604800, slippageBps: 100 };
  const quoted = [];
  const swaps = [];
  const wallet = {
    unspent: () => [{ amount: 100_000_000n }],
    swap: (a) => (swaps.push(a), { a }),
    sync: async () => {},
    swapsByTx: new Map(),
  };
  await runRound({
    wallet,
    rules,
    plan,
    relayer: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    swapFeeBps: 100n,
    now: 1_900_000_000,
    relayerFee: async () => 500_000n,
    quote: async (tin, tout, amountIn) => (quoted.push(amountIn), { amountOut: amountIn * 2n, fee: 3000 }),
    submit: async () => ({ hash: '0x01' }),
  });
  const sold = poolSells(20_000_000n, 500_000n, 100n);
  assert.deepEqual(quoted, [sold]);
  assert.equal(swaps[0].amountIn, 20_000_000n);
  assert.equal(swaps[0].minOut, (sold * 2n * 9_900n) / 10_000n);
});
