import { useEffect, useMemo, useRef, useState } from 'react';
import { parseUnits } from 'viem';
import {
  agentAccountKeys,
  agentKeyOf,
  encodeAgentKey,
  encodeAgentMemo,
  roundStatus,
  runRound,
  TintWallet,
} from '@tint/sdk';
import { assetOf, cashOf, quote } from './chain.js';
import { relayerFee, runAction } from './engine.js';
import { amt, friendly, parseAmount, short, toNumber, usd } from './format.js';

const FEE_CAP_BPS = 500n; // the most an agent may pay its relayer per trade: 5%
const EVERY = [
  [604800, 'Every week'],
  [86400, 'Every day'],
  [3600, 'Every hour'],
];
const DAY = 86400;

const when = (secs) => {
  if (secs <= 0) return 'now';
  if (secs < 3600) return `in ${Math.ceil(secs / 60)} min`;
  if (secs < DAY) return `in ${Math.round(secs / 3600)} h`;
  return `in ${Math.round(secs / DAY)} days`;
};
const day = (unix) => new Date(Number(unix) * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const everyLabel = (s) => (EVERY.find(([v]) => v === Number(s))?.[1] ?? `Every ${Number(s) / 60} min`).toLowerCase();

export default function Agents({ net, wallet, session, prices, relayer, synced, tick, onDone }) {
  const [creating, setCreating] = useState(false);
  const agents = useMemo(() => (synced ? wallet.agents() : []), [wallet, synced, tick]);

  // One read-and-trade wallet per agent account, kept across renders.
  const wallets = useRef(new Map());
  const accountOf = (memo) => {
    let w = wallets.current.get(memo.index);
    if (!w) {
      const keys = agentAccountKeys({
        agentKey: agentKeyOf(session.keys.spendKey, memo.index),
        userOwner: session.keys.owner,
        rules: memo.rules,
        spendKey: session.keys.spendKey,
      });
      w = new TintWallet({ client: net.client, pool: net.pool, fromBlock: net.startBlock, keys });
      wallets.current.set(memo.index, w);
    }
    return w;
  };

  return (
    <section className="card pad agents">
      <div className="card-head">
        <h3>Agents</h3>
        <span className="label mono">Rules checked by a proof</span>
      </div>
      {!synced ? (
        <p className="muted">Reading the pool…</p>
      ) : (
        <>
          {!agents.length && !creating && (
            <p className="muted">
              An agent buys stocks for you on a schedule, from its own private account. You set the rules: which stocks,
              how much each time, the most per buy, and until when. It can’t buy anything else, and it can’t take money out.
            </p>
          )}
          {agents.map((m) => (
            <AgentCard key={m.index} memo={m} account={accountOf(m)} net={net} session={session} prices={prices} relayer={relayer} tick={tick} onDone={onDone} />
          ))}
          {creating ? (
            <NewAgent
              net={net}
              wallet={wallet}
              session={session}
              relayer={relayer}
              prices={prices}
              nextIndex={agents.reduce((m, a) => Math.max(m, a.index + 1), 0)}
              onCancel={() => setCreating(false)}
              onDone={async () => {
                await onDone();
                setCreating(false);
              }}
            />
          ) : (
            <button className="btn wide" onClick={() => setCreating(true)} disabled={!relayer}>
              New agent
            </button>
          )}
          {!relayer && <p className="fine mono">Agents need the relayer: their rules name the one relayer they may pay. It isn’t answering.</p>}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ one agent

function AgentCard({ memo, account, net, session, prices, relayer, tick, onDone }) {
  const [state, setState] = useState(null); // { balances, history, status }
  const [busy, setBusy] = useState(null);
  const [line, setLine] = useState(null);
  const [error, setError] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const { rules, plan } = memo;
  const cash = cashOf(net);
  const stocks = rules.assets.slice(1).filter((a) => a !== 0n).map((a) => assetOf(net, '0x' + a.toString(16).padStart(40, '0')));

  useEffect(() => {
    let stop = false;
    (async () => {
      await account.sync();
      const now = Math.max(Math.floor(Date.now() / 1000), Number((await net.client.getBlock()).timestamp));
      const status = await roundStatus({ wallet: account, rules, plan, now, blockTime: async (n) => Number((await net.client.getBlock({ blockNumber: n })).timestamp) });
      if (!stop) setState({ balances: account.balances(), history: account.history(), status: { ...status, now } });
    })().catch((e) => !stop && setError(friendly(e)));
    return () => {
      stop = true;
    };
  }, [account, tick]);

  const holdings = state
    ? Object.entries(state.balances)
        .map(([addr, v]) => {
          const a = assetOf(net, addr);
          const p = prices[addr];
          return a && { a, v, usd: p == null ? null : toNumber(v, a) * p };
        })
        .filter(Boolean)
    : [];
  const total = holdings.reduce((s, h) => s + (h.usd ?? 0), 0);
  const trades = (state?.history ?? []).filter((h) => h.type === 'swap').slice(0, 4);
  const status = state?.status;

  const agentKey = useMemo(
    () => encodeAgentKey({ agentKey: account.keys.agent.agentKey, userOwner: session.keys.owner, rules, plan, name: memo.name }),
    [account, session, memo],
  );

  async function roundNow() {
    setBusy('round');
    setError(null);
    try {
      await account.sync();
      const block = await net.client.getBlock();
      const now = Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp));
      const made = await runRound({
        wallet: account,
        rules,
        plan,
        relayer: relayer.relayer,
        now,
        quote: async (tin, tout, a) => {
          const q = await quote(net, tin, tout, a);
          return q && { amountOut: q.amountOut, fee: q.poolFee };
        },
        relayerFee: (asset) => relayerFee(relayer, asset),
        submit: (action) =>
          runAction({ net, action, relayer, step: (s, d) => setLine(s === 'prove' ? 'Proving the trade follows the rules…' : s === 'relay' ? `Proved in ${(d.proveMs / 1000).toFixed(1)} s. Sending through the relayer…` : s === 'mine' ? 'Waiting for the block…' : null) }),
        log: (l) => setLine(l.startsWith('Bought') ? null : l),
      });
      setLine(made.length ? `Bought ${made.length} stock${made.length === 1 ? '' : 's'} this round.` : null);
      await onDone();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  async function stop() {
    setBusy('stop');
    setError(null);
    try {
      let moved = 0;
      for (const asset of rules.assets.filter((a) => a !== 0n)) {
        const a = assetOf(net, '0x' + asset.toString(16).padStart(40, '0'));
        for (;;) {
          await account.sync();
          const notes = account.unspent(asset).sort((x, y) => (x.amount > y.amount ? -1 : 1)).slice(0, 2);
          if (!notes.length) break;
          const fee = await relayerFee(relayer, a.address);
          const total = notes.reduce((s, n) => s + n.amount, 0n);
          if (total <= fee) break; // dust worth less than the fee stays
          setLine(`Bringing back ${amt(total - fee, a)} ${a.symbol}…`);
          const action = account.send({ asset: a.address, amount: total - fee, to: session.keys.address, relayer: relayer.relayer, fee });
          await runAction({ net, action, relayer, step: () => {} });
          moved++;
        }
      }
      setLine(moved ? 'Stopped. Everything is back in your private balance.' : 'Nothing to bring back.');
      await onDone();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  const ended = status?.ended;
  const empty = state && !holdings.length;
  return (
    <div className="agent">
      <div className="agent-head">
        <div>
          <b>{memo.name || `Agent ${memo.index + 1}`}</b>
          <span className="muted sm">
            {usd(Number(plan.amount) / 10 ** cash.decimals)} {everyLabel(plan.every)}, split over {stocks.map((s) => s?.symbol).join(', ')}
          </span>
        </div>
        <div className="right">
          <div className="num agent-total">{state ? usd(total) : '…'}</div>
          <span className={`chip mono ${ended || empty ? '' : 'live'}`}>
            {!status ? '…' : ended ? 'Rules ended' : empty ? 'Empty' : status.due ? 'Round due' : `Next round ${when(status.nextAt - status.now)}`}
          </span>
        </div>
      </div>

      <div className="rules">
        <span className="label mono">The proof enforces</span>
        <ul>
          <li>Buys only {stocks.map((s) => s?.symbol).join(', ')}</li>
          <li>At most {usd(toNumber(rules.maxBuy, cash))} a buy</li>
          <li>Relayer fee at most {Number(rules.maxFeeBps) / 100}% a trade, to one relayer</li>
          <li>Stops trading {day(rules.endsAt)}</li>
          <li>Everything stays in this account</li>
        </ul>
      </div>

      {!!holdings.length && (
        <div className="table compact">
          {holdings.map(({ a, v, usd: u }) => (
            <div className="tr" key={a.address}>
              <span className="ticker mono">{a.symbol}</span>
              <span className="grow muted sm num">
                {amt(v, a)} {a.cash ? 'USDG' : 'shares'}
              </span>
              <span className="num right">{usd(u)}</span>
            </div>
          ))}
        </div>
      )}
      {!!trades.length && (
        <div className="trades">
          <span className="label mono">Recent trades</span>
          {trades.map((t) => {
            const out = assetOf(net, t.assetOut);
            const inA = assetOf(net, t.assetIn);
            return (
              <div key={t.tx} className="sm row gap-s">
                <span className="grow">
                  {inA?.cash ? 'Bought' : 'Sold'} {amt(t.amountOut, out)} {out?.symbol} for {amt(t.amountSold, inA)} {inA?.symbol}
                </span>
                <span className="mono muted">{short(t.tx)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="row gap wrap">
        <button className="btn sm" disabled={!!busy || !relayer || !status?.due || empty} onClick={roundNow} title="Runs this round in this tab: proves each buy here and sends it through the relayer">
          {busy === 'round' ? 'Running…' : 'Run this round now'}
        </button>
        <button className="btn ghost sm" disabled={!!busy} onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Hide agent key' : 'Agent key'}
        </button>
        <button className="btn ghost sm" disabled={!!busy || !relayer || empty} onClick={stop}>
          {busy === 'stop' ? 'Stopping…' : 'Stop and bring back'}
        </button>
      </div>
      {showKey && (
        <div className="keybox">
          <p className="sm">
            Give this to the runner (<span className="mono">agent/run.mjs</span>) to run rounds on schedule without this tab. With it the
            runner can trade inside these rules. It can’t move money out; that needs your keys.
          </p>
          <div className="keyrow">
            <code className="mono">{short(agentKey, 18, 8)}</code>
            <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(agentKey)}>
              Copy
            </button>
          </div>
        </div>
      )}
      {line && <p className="sm muted">{line}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ create

function NewAgent({ net, wallet, session, relayer, prices, nextIndex, onCancel, onDone }) {
  const cash = cashOf(net);
  const stocks = net.assets.filter((a) => !a.cash);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState(() => stocks.slice(0, 2).map((s) => s.address));
  const [perRound, setPerRound] = useState('40');
  const [every, setEvery] = useState(604800);
  const [maxBuy, setMaxBuy] = useState('25');
  const [weeks, setWeeks] = useState('12');
  const [fund, setFund] = useState('160');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(null);
  const [error, setError] = useState(null);

  const amount = parseAmount(perRound, cash);
  const cap = parseAmount(maxBuy, cash);
  const funding = parseAmount(fund, cash);
  const fee = parseUnits('0.5', cash.decimals); // the relayer's flat fee today
  const each = amount && picked.length ? amount / BigInt(picked.length) : null;
  const eachBuy = each != null && cap != null ? (each > cap ? cap : each) : null;
  const have = (wallet.balances()[cash.address.toLowerCase()] ?? 0n);

  const problem = !picked.length
    ? 'Pick at least one stock.'
    : picked.length > 5
      ? 'Pick at most five stocks.'
      : !amount
        ? 'Set how much each round spends.'
        : !cap
          ? 'Set the most per buy.'
          : !Number(weeks) || Number(weeks) <= 0
            ? 'Set how many weeks it runs.'
            : eachBuy * FEE_CAP_BPS < fee * 10_000n
              ? `Each buy would be ${usd(toNumber(eachBuy, cash))}. Make it at least ${usd(toNumber((fee * 10_000n) / FEE_CAP_BPS, cash))} so the $0.50 relayer fee stays under 5%.`
              : !funding
                ? 'Set how much to put in.'
                : funding + fee > have
                  ? `You have ${amt(have, cash)} USDG in your private balance. Add more first.`
                  : null;

  const toggle = (addr) => setPicked((p) => (p.includes(addr) ? p.filter((x) => x !== addr) : [...p, addr]));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await wallet.sync();
      const block = await net.client.getBlock();
      const rules = {
        cash: cash.address,
        stocks: picked,
        maxBuy: cap,
        maxFeeBps: FEE_CAP_BPS,
        endsAt: block.timestamp + BigInt(Math.round(Number(weeks) * 7 * DAY)),
        relayer: relayer.relayer,
      };
      const plan = { amount: amount.toString(), every, slippageBps: 100 };
      const label = name.trim() || `${picked.map((a) => assetOf(net, a).symbol).join(' + ')} ${everyLabel(every).replace('every ', '')}`;
      const acct = agentAccountKeys({ agentKey: agentKeyOf(session.keys.spendKey, nextIndex), userOwner: session.keys.owner, rules });
      const f = await relayerFee(relayer, cash.address);
      const action = wallet.send({
        asset: cash.address,
        amount: funding,
        to: acct.address,
        relayer: relayer.relayer,
        fee: f,
        memo: encodeAgentMemo({ index: nextIndex, rules, plan, name: label }),
      });
      await runAction({ net, action, relayer, step: (s) => setLine(s === 'prove' ? 'Proving…' : s === 'relay' ? 'Sending the money to the agent’s account through the relayer…' : s === 'mine' ? 'Waiting for the block…' : null) });
      await onDone();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent new">
      <div className="field">
        <span className="label mono">Stocks it may buy</span>
        <div className="pills">
          {stocks.map((s) => {
            const p = prices[s.address.toLowerCase()];
            return (
              <button key={s.address} className={`pill ${picked.includes(s.address) ? 'on' : ''}`} disabled={busy || p == null} onClick={() => toggle(s.address)}>
                <b className="mono">{s.symbol}</b>
                <span className="num">{p == null ? 'no market' : usd(p)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="form-grid">
        <label className="field">
          <span className="label mono">Each round spends ($)</span>
          <input className="input num" inputMode="decimal" value={perRound} onChange={(e) => setPerRound(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="label mono">How often</span>
          <select className="input" value={every} onChange={(e) => setEvery(Number(e.target.value))} disabled={busy}>
            {(net.localKey ? [...EVERY, [300, 'Every 5 min (test)']] : EVERY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label mono">Most per buy ($)</span>
          <input className="input num" inputMode="decimal" value={maxBuy} onChange={(e) => setMaxBuy(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="label mono">Runs for (weeks)</span>
          <input className="input num" inputMode="numeric" value={weeks} onChange={(e) => setWeeks(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="label mono">Put in now ($)</span>
          <input className="input num" inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="label mono">Name (optional)</span>
          <input className="input" value={name} placeholder="Weekly tech" onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>
      </div>
      {eachBuy != null && !problem && (
        <p className="sm muted">
          Each round: {picked.length} buy{picked.length === 1 ? '' : 's'} of {usd(toNumber(eachBuy, cash))}, each paying the relayer $0.50. The
          money moves from your private balance to the agent’s with a private send (+ $0.50 fee).
        </p>
      )}
      {problem && <p className="sm warn">{problem}</p>}
      <div className="row gap">
        <button className="btn" disabled={busy || !!problem} onClick={create}>
          {busy ? 'Creating…' : `Create agent and put in ${usd(Number(fund) || 0)}`}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {line && busy && <p className="sm muted">{line}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
