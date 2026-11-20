// Selling by plan: cost basis and when take-profit / stop-loss fire.
// A fake wallet stands in for the chain; the fork run is sdk/scripts/e2e-agent-sell.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSales, planSells, positions } from '../src/autoinvest.js';

const CASH = 0xc0n;
const STOCK = 0x5100n;
const addr = (x) => '0x' + x.toString(16).padStart(40, '0');
const rules = { assets: [CASH, STOCK, 0n, 0n, 0n, 0n], maxBuy: 100n, maxFeeBps: 500n, endsAt: 9_999_999_999n, relayer: 1n };
const E18 = 10n ** 18n;

// trades oldest first; history() returns newest first like TintWallet
function fakeWallet(trades, notes) {
  return {
    history: () => [...trades].reverse().map((t) => ({ type: 'swap', ...t })),
    unspent: (asset) => notes.filter((n) => n.asset === BigInt(asset)),
  };
}
const buy = (cash, shares) => ({ assetIn: addr(CASH), assetOut: addr(STOCK), amountIn: cash, amountSold: cash, amountOut: shares });
const sell = (shares, cash) => ({ assetIn: addr(STOCK), assetOut: addr(CASH), amountIn: shares, amountSold: shares, amountOut: cash });
// a quote that pays `price` cash units per whole share
const quoteAt = (price) => async (_in, _out, amount) => ({ amountOut: (BigInt(amount) * BigInt(price)) / E18 });

test('average cost includes fees and a sale takes out its share', () => {
  const w = fakeWallet([buy(40n, 2n * E18), buy(20n, 2n * E18), sell(2n * E18, 50n)], []);
  const p = positions({ wallet: w, rules }).get(STOCK);
  assert.equal(p.shares, 2n * E18);
  assert.equal(p.cost, 30n); // 60 for 4 shares, half sold
  assert.equal(p.realized, 20n); // sold for 50, cost 30
  assert.equal(p.lastSell, 25n); // 25 cash units a whole share (price scale 1e18 per unit)
});

test('no sell rules: nothing to sell', async () => {
  assert.equal(planSells({ amount: '1', every: 1 }), false);
  const w = fakeWallet([buy(100n, E18)], [{ asset: STOCK, amount: E18 }]);
  assert.deepEqual(await planSales({ wallet: w, rules, plan: { amount: '1', every: 1 }, quote: quoteAt(1000) }), []);
});

test('take profit sells half once the price is up enough', async () => {
  const plan = { amount: '1', every: 1, takeProfitBps: 1000 };
  const w = fakeWallet([buy(100n, E18)], [{ asset: STOCK, amount: E18 }]);
  assert.deepEqual(await planSales({ wallet: w, rules, plan, quote: quoteAt(109) }), []);
  const [s] = await planSales({ wallet: w, rules, plan, quote: quoteAt(110) });
  assert.equal(s.why, 'take profit');
  assert.equal(s.amountIn, E18 / 2n);
  assert.equal(s.changeBps, 1000);
});

test('after a take-profit sale the next one counts from the sale price', async () => {
  const plan = { amount: '1', every: 1, takeProfitBps: 1000 };
  // bought at 100, sold half at 110: still up 10% on cost, but not on the last sale
  const w = fakeWallet([buy(100n, E18), sell(E18 / 2n, 55n)], [{ asset: STOCK, amount: E18 / 2n }]);
  assert.deepEqual(await planSales({ wallet: w, rules, plan, quote: quoteAt(110) }), []);
  const [s] = await planSales({ wallet: w, rules, plan, quote: quoteAt(122) });
  assert.equal(s.why, 'take profit');
});

test('stop loss sells everything, up to the two biggest notes', async () => {
  const plan = { amount: '1', every: 1, stopLossBps: 1000, takeProfitBps: 1000 };
  const notes = [3n, 2n, 1n].map((k) => ({ asset: STOCK, amount: k * E18 }));
  const w = fakeWallet([buy(600n, 6n * E18)], notes);
  assert.deepEqual(await planSales({ wallet: w, rules, plan, quote: quoteAt(91) }), []);
  const [s] = await planSales({ wallet: w, rules, plan, quote: quoteAt(90) });
  assert.equal(s.why, 'stop loss');
  assert.equal(s.amountIn, 5n * E18); // an agent can't combine notes, so 3 + 2 now and 1 on the next check
});

test('stock the agent never bought has no cost, so it is never sold by plan', async () => {
  const plan = { amount: '1', every: 1, stopLossBps: 1000 };
  const w = fakeWallet([], [{ asset: STOCK, amount: E18 }]);
  assert.deepEqual(await planSales({ wallet: w, rules, plan, quote: quoteAt(1) }), []);
});

test('the sale’s own relayer fee counts: a gain the fee eats is no gain', async () => {
  const plan = { amount: '1', every: 1, takeProfitBps: 500 };
  const w = fakeWallet([buy(100n, E18)], [{ asset: STOCK, amount: E18 }]);
  // up 6% before fees; a fee of 0.05 share (5%) leaves about +0.7%
  assert.deepEqual(await planSales({ wallet: w, rules, plan, quote: quoteAt(106), relayerFee: async () => E18 / 20n }), []);
  const [s] = await planSales({ wallet: w, rules, plan, quote: quoteAt(106) });
  assert.equal(s.why, 'take profit');
});
