import { useState } from 'react';
import { friendly } from './format.js';

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
        <span className="label mono">
          <i className="dot" /> Private stock agent
        </span>
        <h1>
          An agent that invests for you.
          <br />
          <span className="accent">Nobody sees what you hold.</span>
        </h1>
        <p className="lead">
          You set the rules once: which stocks, how much a week, the most per trade. Tint’s agent buys and sells inside
          them, from a private account on Robinhood Chain that only you can read.
        </p>
        <p className="today mono">
          <b>Today:</b> runs end to end on a local fork of Robinhood Chain: the private account, the relayer and agents. Testnet is next.
        </p>

        <div className="steps">
          <div className="step">
            <span className="n mono">1</span>
            <div>
              <b>Connect a wallet</b>
              <p className="muted">It pays gas and moves money in and out.</p>
            </div>
          </div>
          <div className="step">
            <span className="n mono">2</span>
            <div>
              <b>Sign one message</b>
              <p className="muted">That signature makes your private keys here. It is not a transaction and costs nothing.</p>
            </div>
          </div>
        </div>

        <div className="row gap">
          <button className="btn" disabled={!!busy} onClick={() => go('injected')}>
            {busy === 'injected' ? 'Waiting for your wallet…' : 'Connect wallet'}
          </button>
          {net.localKey && (
            <button className="btn ghost" disabled={!!busy} onClick={() => go('local')}>
              {busy === 'local' ? 'Unlocking…' : 'Use local test account'}
            </button>
          )}
        </div>
        {net.localKey && (
          <p className="fine mono">The local test account is anvil’s public dev key. It only exists on this local fork.</p>
        )}

        <button className="link" onClick={() => setShowView((v) => !v)}>
          {showView ? 'Hide' : 'Open with a viewing key instead'}
        </button>
        {showView && (
          <div className="row gap">
            <input className="input mono" placeholder="tintview1…" value={viewing} onChange={(e) => setViewing(e.target.value)} />
            <button className="btn ghost" disabled={!viewing.trim() || !!busy} onClick={() => go('view')}>
              Open
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <div className="hero-card dark">
        <img src="/mascot.png" alt="" className="hero-mascot" />
        <div className="hero-card-text">
          <span className="label mono light">
            <i className="dot sky" /> What the explorer shows
          </span>
          <div className="peek">
            <div>
              <span className="mono">Who they paid</span>
              <b>?</b>
            </div>
            <div>
              <span className="mono">Their balance</span>
              <b>?</b>
            </div>
            <div>
              <span className="mono">What they hold</span>
              <b>?</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
