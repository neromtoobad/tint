import { useState } from 'react';
import { encodeAddress, exportViewingKey } from '@tint/sdk';
import { assetOf } from './chain.js';
import { amt, short, toNumber, usd } from './format.js';
import * as I from './icons.jsx';

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

export function Money({ value, className = '' }) {
  if (value == null) return <span className={className}>—</span>;
  const [whole, cents] = usd(value).split('.');
  return (
    <span className={`money num ${className}`}>
      {whole}
      {cents != null && <span className="cents">.{cents}</span>}
    </span>
  );
}

export function BalanceCard({ net, balances, prices, synced, error, viewOnly, onGo }) {
  const list = rows(net, balances, prices);
  const total = list.reduce((s, r) => s + (r.usd ?? 0), 0);
  const unpriced = list.some((r) => r.usd == null);
  const stocks = list.filter((r) => !r.asset.cash).length;
  return (
    <section className="lens">
      <div className="lens-head">
        <span>Private balance</span>
        <span className="badge">
          <I.EyeOff width={14} height={14} /> Only you
        </span>
      </div>
      <div className="lens-total">{synced ? <Money value={total} /> : <span className="reading">Reading the pool…</span>}</div>
      <p className="lens-sub">
        {!synced
          ? 'Rebuilding your balance from the pool’s events on this device.'
          : `${stocks} stock${stocks === 1 ? '' : 's'} and USDG · ${viewOnly ? 'seen through a viewing key' : 'on chain it’s only encrypted notes'}`}
        {unpriced && ' · some holdings have no market price yet'}
      </p>
      {error && <p className="lens-error">Couldn’t reach the network: {error}</p>}
      {onGo && !viewOnly && (
        <div className="lens-actions">
          <button className="btn light" onClick={() => onGo('trade', 'buy')}>
            <I.Plus width={18} height={18} /> Buy a stock
          </button>
          <button className="btn glass" onClick={() => onGo('move', 'add')}>
            <I.ArrowDown width={18} height={18} /> Add money
          </button>
          <button className="btn glass" onClick={() => onGo('move', 'send')}>
            <I.ArrowUpRight width={18} height={18} /> Send
          </button>
          <button className="btn glass" onClick={() => onGo('agents')}>
            <I.Agent width={18} height={18} /> Agents
          </button>
        </div>
      )}
    </section>
  );
}

export function Ticker({ asset }) {
  return <span className={`ticker mono ${asset?.cash ? 'cash' : ''}`}>{asset?.cash ? '$' : asset?.symbol?.slice(0, 4)}</span>;
}

export function Holdings({ net, balances, prices, synced }) {
  const list = rows(net, balances, prices);
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>Holdings</h3>
        <span className="hint">Prices from Uniswap{net.testPools ? ' test pools' : ''}</span>
      </div>
      {!synced ? (
        <p className="muted">Reading the pool…</p>
      ) : !list.length ? (
        <p className="muted">Nothing here yet. Add USDG to start, then buy a stock with it.</p>
      ) : (
        <div className="table">
          {list.map(({ asset, value, price, usd: v }) => (
            <div className="tr" key={asset.address}>
              <Ticker asset={asset} />
              <span className="grow">
                <b>{asset.cash ? 'USDG' : asset.symbol}</b>
                <span className="muted sm num">
                  {asset.cash ? asset.name : `${amt(value, asset)} shares${price != null ? ` · ${usd(price)}` : ''}`}
                </span>
              </span>
              <Money value={v} className="right" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// What someone watching the chain learns about this account, next to what you see.
export function Explorer({ relayer, onGo }) {
  const rows = [
    ['Your balance', 'Hidden'],
    ['What you hold', 'Hidden'],
    ['Who you pay', 'Hidden'],
    ['Who sent your trades', relayer ? 'The relayer' : 'Your wallet'],
    ['Money you add', 'Your wallet and the amount'],
  ];
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>What the explorer sees</h3>
        {onGo && (
          <button className="link sm" onClick={() => onGo('privacy')}>
            Details
          </button>
        )}
      </div>
      <div className="table">
        {rows.map(([what, seen]) => (
          <div className="tr" key={what}>
            <span className="grow">{what}</span>
            <span className={`seen ${seen === 'Hidden' || seen === 'The relayer' ? 'hidden' : ''}`}>{seen}</span>
          </div>
        ))}
      </div>
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
  if (h.type === 'send') return { title: 'Sent privately', detail: q };
  if (h.type === 'fund-agent') return { title: `Funded agent “${h.name ?? h.agent + 1}”`, detail: q };
  if (h.type === 'receive') return { title: 'Received privately', detail: q };
  return { title: 'Combined notes', detail: q };
}

const KIND_ICON = {
  swap: <I.Trade width={16} height={16} />,
  deposit: <I.ArrowDown width={16} height={16} />,
  receive: <I.ArrowDown width={16} height={16} />,
  withdraw: <I.ArrowUpRight width={16} height={16} />,
  send: <I.ArrowUpRight width={16} height={16} />,
  'fund-agent': <I.Agent width={16} height={16} />,
};

export function Activity({ net, history, synced }) {
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>Activity</h3>
        <span className="hint">Only you see this list</span>
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
                <span className={`kind ${h.type}`}>{KIND_ICON[h.type] ?? <I.Move width={16} height={16} />}</span>
                <span className="grow">
                  <b>{d.title}</b>
                  <span className="muted sm num">{d.detail}</span>
                </span>
                <span className="mono xs muted right" title={h.tx}>
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

export function Visibility({ relayer }) {
  const by = relayer ? 'sent by the relayer, not your wallet' : 'with your wallet as the sender';
  const lines = [
    ['Add money', 'Your wallet address and the amount. This step always comes from your wallet.'],
    ['Hold', 'Nothing. Balances and holdings are never on chain.'],
    ['Buy or sell', `The pair and the size, ${by}.`],
    ['Send to a Tint user', `That a transfer happened${relayer ? ' and which token paid the fee' : ''}, ${by}. Not the amount or who got it.`],
    ['Take out', `The receiving address and the amount, ${by}.`],
  ];
  return (
    <section className="card pad">
      <div className="card-head">
        <h3>What others can see</h3>
        <span className={`state ${relayer ? 'on' : ''}`}>{relayer ? 'Relayer on' : 'No relayer'}</span>
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
      <p className="fine">
        {relayer
          ? 'The relayer sees your IP address and the transaction, never your keys. Take out to an address you have never used, or the link comes back through it.'
          : 'Start the relayer (relayer/) so trades and take-outs stop pointing back to your address.'}
      </p>
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
          {copied === 'addr' ? <I.Check width={16} height={16} /> : <I.Copy width={16} height={16} />} {copied === 'addr' ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="keyrow">
        <div className="grow">
          <b>Viewing key</b>
          <span className="muted sm">Shows your balance and history, and can’t move anything. For an accountant or auditor.</span>
        </div>
        <button className="btn ghost sm" onClick={() => copy('view', exportViewingKey(keys))}>
          {copied === 'view' ? <I.Check width={16} height={16} /> : <I.Copy width={16} height={16} />} {copied === 'view' ? 'Copied' : 'Copy'}
        </button>
      </div>
    </section>
  );
}
