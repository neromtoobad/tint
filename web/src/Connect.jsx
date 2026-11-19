import { useState } from 'react';
import { friendly } from './format.js';
import * as I from './icons.jsx';

export default function Connect({ net, onUnlock }) {
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

  return (
    <div className="hero">
      <div className="hero-copy">
        <span className="eyebrow mono">
          <i className="dot live" /> Private stock agent · {net.short}
        </span>
        <h1>
          An agent that invests for you.
          <span className="accent"> Nobody sees what you hold.</span>
        </h1>
        <p className="lead">
          You set the rules once: which stocks, how much a week, the most per trade. Tint’s agent buys inside them, from a private
          account on Robinhood Chain that only you can read.
        </p>

        <section className="card pad connect">
          <ol className="steps">
            <li className="step">
              <span className="n mono">1</span>
              <div>
                <b>Connect a wallet</b>
                <p className="muted sm">It pays gas and moves money in and out.</p>
              </div>
            </li>
            <li className="step">
              <span className="n mono">2</span>
              <div>
                <b>Sign one message</b>
                <p className="muted sm">That signature makes your private keys in this browser. It isn’t a transaction and costs nothing.</p>
              </div>
            </li>
          </ol>
          <div className="row gap wrap">
            <button className="btn" disabled={!!busy} onClick={() => go('injected')}>
              {busy === 'injected' ? 'Waiting for your wallet…' : 'Connect wallet'}
            </button>
            {net.localKey && (
              <button className="btn ghost" disabled={!!busy} onClick={() => go('local')}>
                {busy === 'local' ? 'Unlocking…' : 'Use local test account'}
              </button>
            )}
          </div>
          {net.localKey && <p className="fine">The local test account is anvil’s public dev key. It only exists on this local fork.</p>}
          <div className="view-key">
            <button className="link sm" onClick={() => setShowView((v) => !v)}>
              {showView ? 'Hide' : 'Have a viewing key? Open the account read only'}
            </button>
            {showView && (
              <div className="row gap-s">
                <input className="input mono" placeholder="tintview1…" value={viewing} onChange={(e) => setViewing(e.target.value)} />
                <button className="btn ghost" disabled={!viewing.trim() || !!busy} onClick={() => go('view')}>
                  Open
                </button>
              </div>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </section>

        <p className="today">
          <b>Today:</b>{' '}
          {net.testPools
            ? 'Robinhood Chain testnet. Robinhood’s test stock tokens, small test pools Tint seeded, and test USDG. The private account, the relayer and agents all run for real.'
            : 'a local fork of Robinhood Chain. The private account, the relayer and agents all run for real.'}
        </p>
      </div>

      <div className="hero-art">
        <img src="/mascot-cutout.webp" alt="Tint’s mascot, a white pebble in silver shades" className="hero-mascot" />
        <div className="peek">
          <span className="peek-head mono">
            <I.EyeOff width={14} height={14} /> What the explorer shows
          </span>
          {['Your balance', 'What you hold', 'Who you paid'].map((k) => (
            <div key={k}>
              <span>{k}</span>
              <b className="mono">?</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
