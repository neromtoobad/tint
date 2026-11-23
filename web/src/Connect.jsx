import { useMemo, useState } from 'react';
import { friendly } from './format.js';
import { LineChart } from './chart.jsx';
import { Markets } from './parts.jsx';
import * as I from './icons.jsx';

const REPO = 'https://github.com/neromtoobad/tint';

// The landing page. The market list is live; the chart and the agent beside it are an example.
export default function Connect({ net, prices, relayer, onUnlock, status }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState('');
  const [showView, setShowView] = useState(false);

  const go = async (how) => {
    setBusy(how);
    setError(null);
    try {
      await onUnlock(how, viewing);
    } catch (e) {
      setError(how === 'view' ? 'That viewing key is not valid.' : friendly(e));
    } finally {
      setBusy(null);
    }
  };

  const example = useMemo(() => exampleRun(), []);
  const first = net.assets.find((a) => !a.cash);

  return (
    <div className="landing">
      <header className="pill-nav">
        <img src="/tint-lockup-cream.svg" alt="Tint" className="logo" />
        <nav>
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Code
          </a>
        </nav>
        <button className="btn light sm" disabled={!!busy} onClick={() => go('injected')}>
          {busy === 'injected' ? 'Waiting…' : 'Connect wallet'}
        </button>
      </header>

      <section className="land-hero">
        <div className="land-copy">
          <span className="eyebrow mono">
            <i className="dot live" /> Live on {net.label}
          </span>
          <h1>
            A private agent that <span className="accent">buys stocks for you.</span>
          </h1>
          <p className="lead">
            Set the rules once. Tint’s agent trades tokenized stocks on Robinhood Chain from an account only you can read. Nobody sees what
            you hold.
          </p>
          <div className="row gap wrap">
            <button className="btn light big" disabled={!!busy} onClick={() => go('injected')}>
              {busy === 'injected' ? 'Waiting for your wallet…' : 'Connect wallet'}
            </button>
            {net.localKey && (
              <button className="btn ghost big" disabled={!!busy} onClick={() => go('local')}>
                {busy === 'local' ? 'Unlocking…' : 'Use local test account'}
              </button>
            )}
            <button className="btn ghost big" onClick={() => setShowView((v) => !v)}>
              {showView ? 'Hide' : 'Open with a viewing key'}
            </button>
          </div>
          {showView && (
            <div className="row gap-s view-key">
              <input className="input mono" placeholder="tintview1…" value={viewing} onChange={(e) => setViewing(e.target.value)} />
              <button className="btn ghost" disabled={!viewing.trim() || !!busy} onClick={() => go('view')}>
                Open read only
              </button>
            </div>
          )}
          <p className="fine">
            Connecting asks your wallet for one signature. It makes your private keys in this browser; it isn’t a transaction and costs
            nothing.
            {net.localKey && ' The local test account is anvil’s public dev key and only exists on this fork.'}
          </p>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="land-art" aria-hidden="true">
          <img src="/mascot-cutout.webp" alt="" />
        </div>
      </section>

      <div className="preview-wrap">
        <span className="preview-tag mono">Prices: live from the {net.testPools ? 'test pools' : 'Uniswap pools'} · chart and agent: example</span>
        <section className="preview">
          <Markets net={net} prices={prices} on={first?.address} />
          <div className="card pad preview-chart">
            <div className="row gap-s wrap">
              <span className="chip">Example</span>
              <b className="preview-title">An agent account over three months</b>
            </div>
            <div className="row gap wrap preview-num">
              <span className="big num">${example.values.at(-1).toFixed(2)}</span>
              <span className="up mono">+{(((example.values.at(-1) - example.paid) / example.paid) * 100).toFixed(1)}% on $520 put in</span>
            </div>
            <LineChart values={example.values} marks={example.marks} height={230} />
            <span className="chart-note mono">Dots are the agent’s weekly buys</span>
          </div>
          <div className="card pad preview-agent">
            <div className="agent-head">
              <img src="/agent-dark.webp" alt="" className="agent-face sm" />
              <div className="grow">
                <b className="agent-name">Weekly tech</b>
                <span className="muted xs mono">Example agent</span>
              </div>
              <span className="state on">Running</span>
            </div>
            <span className="label">The proof enforces</span>
            <div className="kv">
              <span>Stocks</span>
              <span>TSLA · PLTR · AMD</span>
            </div>
            <div className="kv">
              <span>Most per buy</span>
              <span className="num">$50.00</span>
            </div>
            <div className="kv">
              <span>Money out</span>
              <span>Only to you</span>
            </div>
            <span className="label">The plan</span>
            <div className="kv">
              <span>Every week</span>
              <span className="num">$40.00</span>
            </div>
            <div className="kv">
              <span>Take profit</span>
              <span>+20%, sells half</span>
            </div>
            <div className="kv">
              <span>Stop loss</span>
              <span>−10%, sells all</span>
            </div>
          </div>
        </section>
      </div>

      <section className="land-section" id="how">
        <span className="label">How it works</span>
        <h2>Three steps, and only the first is public.</h2>
        <div className="how">
          {[
            ['1', 'Add USDG', 'Move USDG from your wallet into your private balance. This is the one step the explorer ties to you.'],
            ['2', 'Give an agent its rules', 'Which stocks, how much a week, the most per buy, when to take profit or cut a loss, and an end date.'],
            ['3', 'It buys, a proof checks', 'Every trade carries a zero-knowledge proof that it followed the rules. A relayer sends it, so it doesn’t point back to you.'],
          ].map(([n, t, d]) => (
            <div className="card pad how-step" key={n}>
              <span className="n mono">{n}</span>
              <h3>{t}</h3>
              <p className="muted">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section" id="privacy">
        <span className="label">Privacy</span>
        <h2>You see everything. The explorer sees a pool.</h2>
        <div className="compare">
          <div className="card pad">
            <div className="card-head">
              <h3>You</h3>
              <span className="badge">
                <I.EyeOff width={13} height={13} /> your keys
              </span>
            </div>
            {[
              ['Balance', '$1,248.50'],
              ['Holdings', 'TSLA, PLTR, AMD, USDG'],
              ['Agent trades', 'Bought TSLA for $40.00'],
              ['Sends', '$120.00 to tint1q8…k2'],
            ].map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                <span className="num">{v}</span>
              </div>
            ))}
          </div>
          <div className="card pad">
            <div className="card-head">
              <h3>Anyone on the explorer</h3>
              <span className="label">public</span>
            </div>
            {[
              ['Balance', null],
              ['Holdings', null],
              ['Agent trades', 'A swap on TSLA/USDG, sent by the relayer'],
              ['Sends', 'A transfer happened'],
            ].map(([k, v]) => (
              <div className="kv" key={k}>
                <span>{k}</span>
                {v ? <span>{v}</span> : <span className="dots">••••••</span>}
              </div>
            ))}
          </div>
        </div>
        <p className="today">
          <b>Today:</b>{' '}
          {net.testPools
            ? 'Robinhood Chain testnet, with Robinhood’s test stock tokens, small test pools Tint seeded and test USDG. The private account, the relayer and the agents all run for real. Example numbers above are marked.'
            : 'a local fork of Robinhood Chain. The private account, the relayer and the agents all run for real.'}{' '}
          {relayer ? 'The relayer is on.' : 'The relayer isn’t answering right now.'}
        </p>
      </section>

      {status}
    </div>
  );
}

// A made-up agent account for the landing chart: $40 a week into a rising, noisy market.
function exampleRun() {
  let price = 100;
  let shares = 0;
  let paid = 0;
  let seed = 11;
  const values = [];
  const marks = [];
  for (let d = 0; d < 91; d++) {
    seed = (seed * 9301 + 49297) % 233280;
    price *= 1 + (seed / 233280 - 0.46) * 0.035;
    if (d % 7 === 0) {
      shares += 40 / price;
      paid += 40;
      marks.push(d);
    }
    values.push(shares * price + (520 - paid));
  }
  return { values, marks, paid: 520 };
}
