import { useState } from 'react';
import { encodeAddress, exportViewingKey } from '@tint/sdk';
import { assetOf } from './chain.js';
import { amt, short, toNumber, usd } from './format.js';

function rows(net, balances, prices) {
  return Object.entries(balances)
    .map(([addr, value]) => {
      const asset = assetOf(net, addr);
      if (!asset) return null;
      const price = prices[addr];
      return { asset, value, price, usd: price == null ? null : toNumber(value, asset) * price };
    })
    .filter(Boolean)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
}

export function BalanceCard({ net, balances, prices, synced, error, viewOnly }) {
  const list = rows(net, balances, prices);
  const total = list.reduce((s, r) => s + (r.usd ?? 0), 0);
  const unpriced = list.some((r) => r.usd == null);
  return (
    <section className="card dark balance">
      <div className="balance-text">
        <span className="label mono light">
          <i className="dot sky" /> Private balance
        </span>
        <div className="big num">{synced ? usd(total) : 'Reading the pool…'}</div>
        <p className="light-muted">
          {viewOnly
            ? 'You are looking through a viewing key.'
            : 'Only you, and anyone you give your viewing key, can see this number.'}
          {unpriced && ' Some holdings have no market price yet.'}
        </p>
        {error && <p className="light-error">Couldn’t reach the network: {error}</p>}
        <div className="row gap-s">
          <span className="chip dark mono">{list.length} holding{list.length === 1 ? '' : 's'}</span>
          <span className="chip dark mono">Rebuilt from chain events, nothing stored</span>
        </div>
      </div>
      <img src="/mascot.png" alt="" className="balance-mascot" />
    </section>
  );
}

export function Holdings({ net, balances, prices, synced }) {
  const list = rows(net, balances, prices);
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>Holdings</h3>
        <span className="label mono">Price from Uniswap</span>
      </div>
      {!synced ? (
        <p className="muted">Reading the pool…</p>
      ) : !list.length ? (
        <p className="muted">Nothing here yet. Add USDG to start, then buy a stock with it.</p>
      ) : (
        <div className="table">
          {list.map(({ asset, value, price, usd: v }) => (
            <div className="tr" key={asset.address}>
              <span className="ticker mono">{asset.symbol}</span>
              <span className="grow">
                <b>{asset.name}</b>
                <span className="muted sm num">
                  {amt(value, asset)} {asset.cash ? 'USDG' : 'shares'}
                  {!asset.cash && price != null && ` · ${usd(price)}`}
                </span>
              </span>
              <span className="num right">{usd(v)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function describe(net, h) {
  if (h.type === 'swap') {
    const inA = assetOf(net, h.assetIn);
    const outA = assetOf(net, h.assetOut);
    if (!inA || !outA) return { title: 'Trade', detail: '' };
    if (inA.cash) return { title: `Bought ${outA.symbol}`, detail: `${amt(h.amountOut, outA)} for ${amt(h.amountSold, inA)} USDG` };
    return { title: `Sold ${inA.symbol}`, detail: `${amt(h.amountSold, inA)} for ${amt(h.amountOut, outA)} USDG` };
  }
  const a = h.asset && assetOf(net, h.asset);
  const q = a ? `${amt(h.amount, a)} ${a.symbol}` : '';
  if (h.type === 'deposit') return { title: 'Added', detail: q };
  if (h.type === 'withdraw') return { title: 'Took out', detail: q };
  return { title: 'Private transfer', detail: q && `${q} landed here` };
}

export function Activity({ net, history, synced }) {
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>Activity</h3>
        <span className="label mono">Only you see this list</span>
      </div>
      {!synced ? (
        <p className="muted">Reading the pool…</p>
      ) : !history.length ? (
        <p className="muted">No activity yet.</p>
      ) : (
        <div className="table">
          {history.slice(0, 12).map((h) => {
            const d = describe(net, h);
            return (
              <div className="tr" key={h.tx + h.type}>
                <span className={`kind mono ${h.type}`}>{h.type === 'swap' ? 'Trade' : h.type === 'deposit' ? 'In' : h.type === 'withdraw' ? 'Out' : 'Note'}</span>
                <span className="grow">
                  <b>{d.title}</b>
                  <span className="muted sm num">{d.detail}</span>
                </span>
                <span className="mono sm muted right" title={h.tx}>
                  {net.explorer ? (
                    <a href={`${net.explorer}/tx/${h.tx}`} target="_blank" rel="noreferrer">
                      {short(h.tx)}
                    </a>
                  ) : (
                    short(h.tx)
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Visibility() {
  const lines = [
    ['Add money', 'Your wallet address and the amount. This step is public.'],
    ['Buy or sell', 'That someone in Tint traded, the pair and the size. Not who.'],
    ['Hold', 'Nothing. Balances are never on chain.'],
    ['Send to a Tint user', 'Only that a private transfer happened.'],
    ['Take out', 'The receiving address and the amount. Not which deposit it came from.'],
  ];
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>What others can see</h3>
      </div>
      <div className="table">
        {lines.map(([what, seen]) => (
          <div className="tr top" key={what}>
            <span className="grow">
              <b>{what}</b>
              <span className="muted sm">{seen}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="fine mono">For more privacy, take out to an address you have never used.</p>
    </section>
  );
}

export function Keys({ keys }) {
  const [copied, setCopied] = useState(null);
  const tintAddress = encodeAddress(keys.owner, keys.viewPublic);
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied('failed');
    }
  };
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>Your keys</h3>
      </div>
      <div className="keyrow">
        <div className="grow">
          <b>Tint address</b>
          <span className="muted sm">Give this to people who want to pay you privately.</span>
          <code className="mono">{short(tintAddress, 14, 8)}</code>
        </div>
        <button className="btn ghost sm" onClick={() => copy('addr', tintAddress)}>
          {copied === 'addr' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="keyrow">
        <div className="grow">
          <b>Viewing key</b>
          <span className="muted sm">Shows your balance and history, and can’t move anything. For an accountant or auditor.</span>
        </div>
        <button className="btn ghost sm" onClick={() => copy('view', exportViewingKey(keys))}>
          {copied === 'view' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}
