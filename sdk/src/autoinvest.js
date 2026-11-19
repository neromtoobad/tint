// Auto-invest: what the agent does each round. Shared by the Node runner
// (agent/run.mjs) and the web app ("Run a round now").
//
// The rules (which stocks, most per buy, fee cap, relayer, end date) are
// enforced by the agent_swap proof. The plan (how much per round, how often,
// slippage) is code: this file. Model suggests, code decides, proof enforces.

import { amountSold } from './swap.js';

const toAddr = (x) => '0x' + BigInt(x).toString(16).padStart(40, '0');

/**
 * When the next round is due. A round is a set of buys from cash; the last one
 * is read from the account's own history on chain, so the runner keeps no state.
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

/**
 * Runs one round: for each buy, price it, prove it and send it through the relayer.
 * Hooks (all async):
 *   quote(tokenIn, tokenOut, amountIn) -> { amountOut, fee }  best Uniswap tier
 *   relayerFee(asset) -> bigint
 *   submit(action) -> { hash }   proves the action and gets it mined
 *   log(line)
 * Returns the trades it made.
 */
export async function runRound({ wallet, rules, plan, relayer, swapFeeBps = 0n, quote, relayerFee, submit, log = () => {}, now }) {
  const { buys, reason } = planRound({ wallet, rules, plan });
  if (!buys.length) {
    log(reason);
    return [];
  }
  const done = [];
  for (const b of buys) {
    const fee = await relayerFee(b.assetIn);
    if (fee * 10_000n > b.amountIn * BigInt(rules.maxFeeBps)) {
      log(`Skipped a ${b.amountIn} buy: the relayer fee (${fee}) is over the rules' fee cap. Raise the amount per round.`);
      continue;
    }
    const toSell = amountSold(b.amountIn, fee, swapFeeBps);
    const q = await quote(b.assetIn, b.assetOut, toSell);
    if (!q || q.amountOut === 0n) {
      log(`Skipped ${b.assetOut}: no market right now.`);
      continue;
    }
    const minOut = (q.amountOut * (10_000n - BigInt(plan.slippageBps ?? 100))) / 10_000n;
    const deadline = BigInt(Math.min(now + 600, Number(rules.endsAt)));
    const action = wallet.swap({ ...b, minOut, poolFee: q.fee, deadline, relayer, fee });
    const { hash } = await submit(action);
    await wallet.sync();
    const swap = wallet.swapsByTx.get(hash);
    done.push({ ...b, fee, minOut, hash, amountOut: swap?.amountOut });
    log(`Bought ${swap?.amountOut ?? '?'} of ${b.assetOut} for ${b.amountIn} (fee ${fee}) in ${hash}`);
  }
  return done;
}
