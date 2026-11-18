import { formatUnits, parseUnits } from 'viem';

export const usd = (n) =>
  n == null || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Token amount for display: cash to 2 places, shares to 4. */
export function amt(value, asset, places) {
  let p = places ?? (asset.cash ? 2 : 4);
  const n = Number(formatUnits(value, asset.decimals));
  // show dust (e.g. 0.0012 USDG left after a trade) instead of a misleading 0.00
  if (places == null && n > 0 && n < 10 ** -p) p = Math.min(asset.decimals, 8);
  return n.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p });
}

export const toNumber = (value, asset) => Number(formatUnits(value, asset.decimals));

/** Parse what the user typed; null if it isn't a positive amount. */
export function parseAmount(text, asset) {
  const t = String(text).trim().replace(/,/g, '');
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  try {
    const v = parseUnits(t, asset.decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export const short = (s, a = 6, b = 4) => (s && s.length > a + b + 1 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);

const REASONS = [
  [/User rejected|User denied|rejected the request/i, 'You cancelled it in your wallet.'],
  [/TooLittleReceived/, 'The price moved more than your 1% limit. Try again.'],
  [/DepositTooLarge/, 'That is over the per-deposit limit for this pool.'],
  [/PoolCapReached/, 'The pool is at its limit for this asset.'],
  [/DepositsArePaused/, 'New deposits are paused right now. You can still trade and take out.'],
  [/AssetNotListed/, 'That token is not listed in Tint.'],
  [/UnknownRoot/, 'Your wallet was out of date. It has refreshed; try again.'],
  [/NullifierSpent/, 'One of these notes was already spent. Your wallet has refreshed; try again.'],
  [/NoUniswapPool/, 'There is no market for this pair.'],
  [/Expired/, 'The trade took too long and expired. Try again.'],
  [/insufficient funds/i, 'This wallet has no ETH for gas.'],
  [/exceeds balance|transfer amount exceeds/i, 'Your wallet does not hold that much.'],
];

export function friendly(e) {
  const text = [e?.shortMessage, e?.message, e?.cause?.shortMessage].filter(Boolean).join(' ');
  for (const [re, msg] of REASONS) if (re.test(text)) return msg;
  return e?.shortMessage || e?.message || String(e);
}
