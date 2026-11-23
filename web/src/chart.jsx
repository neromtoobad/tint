// A responsive line chart (SVG path + HTML dots, so dots stay round at any width).
import { useId } from 'react';
import { assetOf } from './chain.js';
import { toNumber } from './format.js';

/**
 * @param values  numbers, oldest first
 * @param marks   indexes of values to mark with a dot (e.g. the agent's buys)
 * @param step    draw a step line (a price that holds until the next trade)
 */
export function LineChart({ values, marks = [], height = 200, step = false, className = '' }) {
  const id = useId().replace(/:/g, '');
  if (values.length < 2) return null;
  const W = 1000;
  const pad = 10;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < max * 0.002) {
    // a flat line sits in the middle instead of on the floor
    const mid = (max + min) / 2 || 1;
    min = mid * 0.99;
    max = mid * 1.01;
  }
  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  let d = `M0 ${y(values[0]).toFixed(1)}`;
  values.slice(1).forEach((v, k) => {
    const i = k + 1;
    if (step) d += ` L${x(i).toFixed(1)} ${y(values[i - 1]).toFixed(1)}`;
    d += ` L${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });
  return (
    <div className={`chart ${className}`} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true">
        <defs>
          <linearGradient id={`fill${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--sky)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--sky)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={height * f} y2={height * f} className="grid-line" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${d} L${W} ${height} L0 ${height} Z`} fill={`url(#fill${id})`} />
        <path d={d} fill="none" stroke="var(--sky)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {marks
        .filter((i) => i >= 0 && i < values.length)
        .map((i) => (
          <i key={i} className="chart-dot" style={{ left: `${(x(i) / W) * 100}%`, top: y(values[i]) }} />
        ))}
    </div>
  );
}

/**
 * The private balance after each step of the account's history, valued at
 * today's prices. Walks back from today's balances, undoing each step, so the
 * last point is exactly what the account holds now.
 * Returns { values, marks } where marks are the trades.
 */
export function balanceSeries(net, history, balances, prices) {
  const held = { ...balances };
  const value = () =>
    Object.entries(held).reduce((s, [addr, v]) => {
      const a = assetOf(net, addr);
      const p = prices[addr];
      return a && p != null && v > 0n ? s + toNumber(v, a) * p : s;
    }, 0);
  const add = (addr, v) => {
    if (!addr || v == null) return;
    const k = String(addr).toLowerCase();
    held[k] = (held[k] ?? 0n) + BigInt(v);
    if (held[k] < 0n) held[k] = 0n;
  };
  const steps = history.filter((h) => h.type !== 'combine');
  const out = [value()];
  const isTrade = [];
  for (const h of steps) {
    // newest first: undo it
    if (h.type === 'swap') {
      add(h.assetOut, -BigInt(h.amountOut ?? 0n));
      add(h.assetIn, BigInt(h.amountIn ?? h.amountSold ?? 0n));
    } else if (h.type === 'deposit' || h.type === 'receive') add(h.asset, -BigInt(h.amount ?? 0n));
    else if (h.type === 'withdraw' || h.type === 'send' || h.type === 'fund-agent') add(h.asset, BigInt(h.amount ?? 0n) + BigInt(h.fee ?? 0n)); // the fee left too
    isTrade.push(h.type === 'swap');
    out.push(value());
  }
  const values = out.reverse();
  // values[i] is the balance after step i-1 (values[0] is before the first step)
  const marks = isTrade
    .reverse()
    .map((t, i) => (t ? i + 1 : -1))
    .filter((i) => i > 0);
  return { values, marks };
}
