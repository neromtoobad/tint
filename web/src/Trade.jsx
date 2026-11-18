import { useEffect, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { cashOf, quote } from './chain.js';
import { ensureAllowance, runAction, tokenBalance } from './engine.js';
import { amt, friendly, parseAmount, short, usd } from './format.js';

const TABS = [
  ['buy', 'Buy'],
  ['sell', 'Sell'],
  ['add', 'Add'],
  ['send', 'Send'],
  ['out', 'Take out'],
];
const SLIPPAGE_BPS = 100n; // 1%

const STAGES = {
  approve: 'Allow Tint to move this token',
  prove: 'Making the proof on this device',
  sign: 'Confirm in your wallet',
  mine: 'Waiting for the block',
  done: 'Done',
};

export default function Trade({ net, wallet, session, address, balances, prices, synced, onDone }) {
  const cash = cashOf(net);
  const stocks = useMemo(() => net.assets.filter((a) => !a.cash), [net]);
  const tradeable = stocks.filter((s) => prices[s.address.toLowerCase()] != null);
  const held = (a) => balances[a.address.toLowerCase()] ?? 0n;

  const [tab, setTab] = useState('buy');
  const [stockAddr, setStockAddr] = useState(stocks[0].address);
  const [assetAddr, setAssetAddr] = useState(cash.address); // for add / send / take out
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState(null); // { amountOut, poolFee } | 'none' | null
  const [publicBal, setPublicBal] = useState(null);
  const [run, setRun] = useState(null); // { stage, proveMs, hash, gas }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [needsCombine, setNeedsCombine] = useState(false);

  const stock = stocks.find((s) => s.address === stockAddr);
  const asset = net.assets.find((a) => a.address === assetAddr);
  const isSwap = tab === 'buy' || tab === 'sell';
  const inAsset = tab === 'buy' ? cash : tab === 'sell' ? stock : asset;
  const outAsset = tab === 'buy' ? stock : cash;
  const amount = parseAmount(text, inAsset);

  // Wallet balance (public) for "Add".
  useEffect(() => {
    if (tab !== 'add' || !address) return;
    let stop = false;
    tokenBalance(net, asset.address, address)
      .then((b) => !stop && setPublicBal(b))
      .catch(() => !stop && setPublicBal(null));
    return () => {
      stop = true;
    };
  }, [tab, asset, address, net, run?.stage]);

  // Live quote for buy / sell.
  useEffect(() => {
    setQ(null);
    if (!isSwap || !amount) return;
    let stop = false;
    const id = setTimeout(async () => {
      const r = await quote(net, inAsset.address, outAsset.address, amount).catch(() => null);
      if (!stop) setQ(r ?? 'none');
    }, 350);
    return () => {
      stop = true;
      clearTimeout(id);
    };
  }, [isSwap, amount, inAsset, outAsset, net]);

  // A new choice clears the last result (but finishing an action keeps "Done" on screen).
  const clear = () => {
    setError(null);
    setNeedsCombine(false);
    setRun(null);
  };
  useEffect(clear, [tab, stockAddr, assetAddr]);
  const type = (v) => {
    setText(v);
    if (!busy) clear();
  };

  useEffect(() => {
    if (tab === 'out' && !to && address) setTo(address);
  }, [tab, to, address]);

  const spendable = tab === 'add' ? publicBal : held(inAsset);
  const over = amount != null && spendable != null && amount > spendable;
  const validTo = tab === 'out' ? /^0x[0-9a-fA-F]{40}$/.test(to.trim()) : tab === 'send' ? /^tint1[0-9a-f]{128}$/.test(to.trim()) : true;
  const canGo = synced && !busy && amount && !over && validTo && (!isSwap || (q && q !== 'none'));

  const step = (stage, d = {}) => setRun((r) => ({ ...r, ...d, stage }));

  async function submit(combine = false) {
    setBusy(true);
    setError(null);
    setRun(null);
    try {
      const account = session.account;
      const walletClient = session.walletClient;
      await wallet.sync();
      let action;
      if (combine) {
        action = wallet.combine({ asset: inAsset.address });
      } else if (tab === 'add') {
        await ensureAllowance({ net, walletClient, account, token: asset.address, amount, step });
        action = wallet.deposit({ asset: asset.address, amount });
      } else if (tab === 'out') {
        action = wallet.withdraw({ asset: asset.address, amount, recipient: to.trim() });
      } else if (tab === 'send') {
        action = wallet.send({ asset: asset.address, amount, to: to.trim() });
      } else {
        const fresh = await quote(net, inAsset.address, outAsset.address, amount);
        if (!fresh) throw new Error('There is no market for this pair right now.');
        const block = await net.client.getBlock();
        action = wallet.swap({
          assetIn: inAsset.address,
          assetOut: outAsset.address,
          amountIn: amount,
          minOut: (fresh.amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n,
          poolFee: fresh.poolFee,
          deadline: block.timestamp + 600n,
        });
      }
      await runAction({ net, walletClient, account, action, step });
      await onDone();
      if (!combine) setText('');
      setNeedsCombine(false);
    } catch (e) {
      if (/Combine your notes/.test(e.message)) setNeedsCombine(true);
      setError(friendly(e));
      setRun((r) => (r ? { ...r, failed: true } : r));
    } finally {
      setBusy(false);
    }
  }

  const price = stock ? prices[stock.address.toLowerCase()] : null;
  const label = {
    buy: `Buy ${stock?.symbol} privately`,
    sell: `Sell ${stock?.symbol} privately`,
    add: 'Add to private balance',
    send: 'Send privately',
    out: 'Take out',
  }[tab];

  return (
    <section className="card pad trade">
      <div className="seg" role="tablist">
        {TABS.map(([k, v]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} disabled={busy}>
            {v}
          </button>
        ))}
      </div>

      {isSwap && (
        <div className="field">
          <span className="label mono">Stock</span>
          <div className="pills">
            {stocks.map((s) => {
              const p = prices[s.address.toLowerCase()];
              return (
                <button key={s.address} className={`pill ${s.address === stockAddr ? 'on' : ''}`} disabled={busy || p == null} onClick={() => setStockAddr(s.address)} title={p == null ? 'No market yet' : s.name}>
                  <b className="mono">{s.symbol}</b>
                  <span className="num">{p == null ? 'no market' : usd(p)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!isSwap && (
        <div className="field">
          <span className="label mono">Asset</span>
          <select className="input" value={assetAddr} onChange={(e) => setAssetAddr(e.target.value)} disabled={busy}>
            {net.assets.map((a) => (
              <option key={a.address} value={a.address}>
                {a.symbol} · {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <div className="field-head">
          <span className="label mono">{tab === 'buy' ? 'Pay with USDG' : tab === 'sell' ? `Shares of ${stock?.symbol}` : 'Amount'}</span>
          {spendable != null && (
            <button className="link sm num" onClick={() => type(formatUnits(spendable, inAsset.decimals))} disabled={busy}>
              {tab === 'add' ? 'In your wallet' : 'Private'}: {amt(spendable, inAsset)} {inAsset.symbol}
            </button>
          )}
        </div>
        <input className="input big-input num" inputMode="decimal" placeholder="0.00" value={text} onChange={(e) => type(e.target.value)} disabled={busy} />
        {over && <span className="warn">That is more than you have.</span>}
      </div>

      {(tab === 'out' || tab === 'send') && (
        <div className="field">
          <span className="label mono">{tab === 'out' ? 'Send to address' : 'Their Tint address'}</span>
          <input className="input mono" placeholder={tab === 'out' ? '0x…' : 'tint1…'} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
          {tab === 'out' && <span className="hint">Taking out to an address you have never used keeps the link hidden.</span>}
          {tab === 'send' && to && !validTo && <span className="warn">That is not a Tint address.</span>}
        </div>
      )}

      {isSwap && (
        <div className="quote">
          {!amount ? (
            <span className="muted">Enter an amount to see a price.</span>
          ) : q === null ? (
            <span className="muted">Getting a price…</span>
          ) : q === 'none' ? (
            <span className="warn">No market for this pair.</span>
          ) : (
            <>
              <div className="quote-main">
                <span className="muted">You get about</span>
                <b className="num">
                  {amt(q.amountOut, outAsset)} {outAsset.cash ? 'USDG' : outAsset.symbol}
                </b>
              </div>
              <div className="quote-meta mono">
                {price != null && <span>{usd(price)} a share</span>}
                <span>pool fee {q.poolFee / 10000}%</span>
                <span>at least {amt((q.amountOut * (10_000n - SLIPPAGE_BPS)) / 10_000n, outAsset)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'add' && <p className="hint">This step is public: the explorer shows this wallet adding this amount. What you do after it is not.</p>}

      <button className="btn wide" disabled={!canGo} onClick={() => submit(false)}>
        {busy ? STAGES[run?.stage] ?? 'Working…' : label}
      </button>

      {needsCombine && (
        <button className="btn ghost wide" disabled={busy} onClick={() => submit(true)}>
          Combine my {inAsset.symbol} notes first
        </button>
      )}

      {run && <Progress run={run} tab={tab} net={net} />}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function Progress({ run, tab, net }) {
  const order = tab === 'add' ? ['approve', 'prove', 'sign', 'mine', 'done'] : ['prove', 'sign', 'mine', 'done'];
  const at = order.indexOf(run.stage);
  return (
    <ol className="progress">
      {order.map((s, i) => (
        <li key={s} className={i < at || run.stage === 'done' ? 'past' : i === at ? (run.failed ? 'fail' : 'now') : ''}>
          <i />
          <span>
            {STAGES[s]}
            {s === 'prove' && run.proveMs != null && <em className="mono"> {(run.proveMs / 1000).toFixed(1)} s</em>}
            {s === 'mine' && run.hash && (
              <em className="mono">
                {' '}
                {net.explorer ? (
                  <a href={`${net.explorer}/tx/${run.hash}`} target="_blank" rel="noreferrer">
                    {short(run.hash)}
                  </a>
                ) : (
                  short(run.hash)
                )}
              </em>
            )}
            {s === 'done' && run.gas != null && <em className="mono"> gas {Number(run.gas).toLocaleString('en-US')}</em>}
          </span>
        </li>
      ))}
    </ol>
  );
}
