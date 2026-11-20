// Auto-invest: what the agent does each round. Shared by the Node runner
// (agent/run.mjs) and the web app ("Run a round now").
//
// The rules (which stocks, most per buy, fee cap, relayer, end date) are
// enforced by the agent_swap proof. The plan (how much per round, how often,
// slippage, when to sell) is code: this file. Model suggests, code decides,
// proof enforces.
//
// Plan fields (all strings or numbers, kept in the encrypted agent memo):
//   amount          cash each round spends, in token units
//   every           seconds between rounds
//   slippageBps     how far below the quote a trade may fill (default 100 = 1%)
//   takeProfitBps   sell when a stock is up this much (0 or missing: never)
//   takeProfitSellBps  how much of the holding a take-profit sells (default 5000 = half)
//   stopLossBps     sell everything when a stock is down this much (0 or missing: never)

import { normalizeRules } from './agent.js';
import { amountSold } from './swap.js';

const ONE = 10n ** 18n; // price scale: cash units per stock unit, times 1e18
const toAddr = (x) => '0x' + BigInt(x).toString(16).padStart(40, '0');
const bps = (x) => BigInt(x ?? 0);

/** True when the plan sells at all. */
export const planSells = (plan) => bps(plan?.takeProfitBps) > 0n || bps(plan?.stopLossBps) > 0n;

/**
 * When the next round of buys is due. The last one is read from the account's
 * own history on chain, so the runner keeps no state. Sales don't move the
 * schedule.
 * @param blockTime async (blockNumber) => unix seconds
 */
export async function roundStatus({ wallet, rules, plan, now, blockTime }) {
  const cash = BigInt(rules.assets[0]);
  const buys = wallet.history().filter((h) => h.type === 'swap' && BigInt(h.assetIn) === cash);
  const lastBlock = buys.reduce((m, h) => (h.block > m ? h.block : m), 0n);
  const lastAt = lastBlock ? await blockTime(lastBlock) : 0;
  const every = Number(plan.every);
  const nextAt = lastAt ? lastAt + every : now;
  const ended = BigInt(now) >= BigInt(rules.endsAt);
  return { lastAt, nextAt, due: !ended && now >= nextAt, ended, buys: buys.length };
}

/**
 * What the account paid for each stock, from its own trades (oldest first).
 * Average cost: a buy adds the cash that left the account, fees included; a sale
 * takes out its share of the cost. `lastSell` is the price of the latest sale.
 * Returns Map(stock bigint -> { shares, cost, realized, lastSell })
 */
export function positions({ wallet, rules }) {
  const cash = normalizeRules(rules).assets[0];
  const pos = new Map();
  const get = (a) => {
    if (!pos.has(a)) pos.set(a, { shares: 0n, cost: 0n, realized: 0n, lastSell: 0n });
    return pos.get(a);
  };
  for (const h of [...wallet.history()].reverse()) {
    if (h.type !== 'swap') continue;
    const inA = BigInt(h.assetIn);
    const outA = BigInt(h.assetOut);
    const paid = h.amountIn ?? h.amountSold;
    if (inA === cash) {
      const p = get(outA);
      p.shares += h.amountOut;
      p.cost += paid;
    } else if (outA === cash) {
      const p = get(inA);
      const sold = paid > p.shares ? p.shares : paid;
      const part = p.shares ? (p.cost * sold) / p.shares : 0n;
      p.realized += h.amountOut - part;
      p.cost -= part;
      p.shares -= sold;
      if (paid > 0n) p.lastSell = (h.amountOut * ONE) / paid;
    }
  }
  return pos;
}

/** The most one agent trade can sell: its two biggest notes (an agent can't combine notes). */
function sellable(wallet, asset) {
  return wallet
    .unspent(asset)
    .sort((a, b) => (a.amount > b.amount ? -1 : 1))
    .slice(0, 2)
    .reduce((s, n) => s + n.amount, 0n);
}

/**
 * The sales the plan calls for now. Each stock is priced by quoting what the
 * account could actually sell of it, after the relayer's fee for that sale, so
 * the price includes the pool's slippage and every fee: "up 5%" is what the
 * account would really get back.
 *   take profit: price ≥ reference × (1 + takeProfitBps), where the reference is
 *     the average cost or the last sale price, whichever is higher (so one rise
 *     sells once, not every round)
 *   stop loss:   price ≤ average cost × (1 − stopLossBps): sells everything
 * @param quote async (tokenIn, tokenOut, amountIn) -> { amountOut } | null
 * @param relayerFee async (asset) -> bigint  (optional; without it the sale's fee is left out)
 */
export async function planSales({ wallet, rules, plan, quote, relayerFee, swapFeeBps = 0n, log = () => {} }) {
  const out = [];
  if (!planSells(plan)) return out;
  const cash = BigInt(rules.assets[0]);
  const tp = bps(plan.takeProfitBps);
  const tpSell = bps(plan.takeProfitSellBps ?? 5000);
  const sl = bps(plan.stopLossBps);
  const pos = positions({ wallet, rules });
  for (const stock of rules.assets.slice(1).map(BigInt).filter((a) => a !== 0n)) {
    const held = wallet.unspent(stock).reduce((s, n) => s + n.amount, 0n);
    const p = pos.get(stock);
    if (!held || !p || !p.shares || !p.cost) continue; // nothing bought here, so no cost to compare with
    const max = sellable(wallet, stock);
    const fee = relayerFee ? await relayerFee(toAddr(stock)) : 0n;
    if (fee >= max) continue; // worth less than the fee to sell
    const q = await quote(toAddr(stock), toAddr(cash), amountSold(max, fee, swapFeeBps));
    if (!q || !q.amountOut) {
      log(`Couldn't price ${toAddr(stock)} to check the plan's sales: no market right now.`);
      continue;
    }
    const price = (q.amountOut * ONE) / max;
    const avg = (p.cost * ONE) / p.shares;
    const ref = p.lastSell > avg ? p.lastSell : avg;
    const changeBps = Number(((price - avg) * 10_000n) / avg);
    let amountIn = 0n;
    let why = null;
    if (sl > 0n && price * 10_000n <= avg * (10_000n - sl)) {
      amountIn = held;
      why = 'stop loss';
    } else if (tp > 0n && price * 10_000n >= ref * (10_000n + tp)) {
      amountIn = (held * tpSell) / 10_000n;
      why = 'take profit';
    }
    if (!why) continue;
    if (amountIn > max) amountIn = max;
    if (amountIn > 0n) out.push({ assetIn: toAddr(stock), assetOut: toAddr(cash), amountIn, why, changeBps });
  }
  return out;
}

/** The buys for one round: plan.amount split evenly over the picked stocks, each capped at maxBuy. */
export function planRound({ wallet, rules, plan }) {
  const cash = BigInt(rules.assets[0]);
  const stocks = rules.assets.slice(1).filter((a) => BigInt(a) !== 0n);
  if (!stocks.length) return { buys: [], cashLeft: 0n, reason: 'No stocks in the rules.' };
  const have = wallet.unspent(cash).reduce((s, n) => s + n.amount, 0n);
  let each = BigInt(plan.amount) / BigInt(stocks.length);
  if (each > BigInt(rules.maxBuy)) each = BigInt(rules.maxBuy);
  const buys = [];
  let left = have;
  for (const s of stocks) {
    if (each === 0n || left < each) break;
    buys.push({ assetIn: toAddr(cash), assetOut: toAddr(s), amountIn: each });
    left -= each;
  }
  const reason = buys.length ? undefined : have === 0n ? 'The agent account has no cash.' : 'Not enough cash for this round.';
  return { buys, cashLeft: left, reason };
}

const pct = (b) => `${b >= 0 ? 'up' : 'down'} ${(Math.abs(b) / 100).toFixed(1)}%`;

/**
 * Prices one trade, proves it and sends it through the relayer. Returns the
 * trade, or null when it was skipped (fee over the cap, no market).
 */
async function trade(t, { wallet, rules, plan, relayer, swapFeeBps, quote, relayerFee, submit, log, now }) {
  const fee = await relayerFee(t.assetIn);
  if (fee * 10_000n > t.amountIn * BigInt(rules.maxFeeBps)) {
    log(`Skipped a ${t.amountIn} trade of ${t.assetIn}: the relayer fee (${fee}) is over the rules' fee cap.${t.why ? '' : ' Raise the amount per round.'}`);
    return null;
  }
  const q = await quote(t.assetIn, t.assetOut, amountSold(t.amountIn, fee, swapFeeBps));
  if (!q || q.amountOut === 0n) {
    log(`Skipped ${t.why ? t.assetIn : t.assetOut}: no market right now.`);
    return null;
  }
  const minOut = (q.amountOut * (10_000n - BigInt(plan.slippageBps ?? 100))) / 10_000n;
  const deadline = BigInt(Math.min(now + 600, Number(rules.endsAt)));
  const action = wallet.swap({ assetIn: t.assetIn, assetOut: t.assetOut, amountIn: t.amountIn, minOut, poolFee: q.fee, deadline, relayer, fee });
  const { hash, block, receipt } = await submit(action);
  const mined = block ?? receipt?.blockNumber;
  await (mined !== undefined && wallet.syncPast ? wallet.syncPast(mined) : wallet.sync());
  const swap = wallet.swapsByTx.get(hash);
  const done = { ...t, fee, minOut, hash, amountOut: swap?.amountOut };
  if (t.why) log(`Sold ${t.amountIn} of ${t.assetIn} for ${swap?.amountOut ?? '?'} (${t.why}, ${pct(t.changeBps)}) in ${hash}`);
  else log(`Bought ${swap?.amountOut ?? '?'} of ${t.assetOut} for ${t.amountIn} (fee ${fee}) in ${hash}`);
  return done;
}

/**
 * Sells whatever the plan's take-profit or stop-loss calls for right now.
 * The runner calls this on every check, not only when a round is due.
 * Hooks as in runRound. Returns the sales it made.
 */
export async function runSales(ctx) {
  const sales = await planSales({ wallet: ctx.wallet, rules: ctx.rules, plan: ctx.plan, quote: ctx.quote, relayerFee: ctx.relayerFee, swapFeeBps: ctx.swapFeeBps, log: ctx.log });
  const done = [];
  for (const s of sales) {
    const d = await trade(s, { log: () => {}, ...ctx });
    if (d) done.push(d);
  }
  return done;
}

/**
 * Runs one round: first any sales the plan calls for, then the buys. For each
 * trade it prices it, proves it and sends it through the relayer.
 * Hooks (all async):
 *   quote(tokenIn, tokenOut, amountIn) -> { amountOut, fee }  best Uniswap tier
 *   relayerFee(asset) -> bigint
 *   submit(action) -> { hash }   proves the action and gets it mined
 *   log(line)
 * Returns the trades it made (sales have a `why`).
 */
export async function runRound(ctx) {
  const c = { log: () => {}, swapFeeBps: 0n, ...ctx };
  const done = await runSales(c);
  const { buys, reason } = planRound({ wallet: c.wallet, rules: c.rules, plan: c.plan });
  if (!buys.length) c.log(reason);
  for (const b of buys) {
    const d = await trade(b, c);
    if (d) done.push(d);
  }
  return done;
}
