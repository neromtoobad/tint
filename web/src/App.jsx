import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, http, numberToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { KEY_MESSAGE, TintWallet, importViewingKey, initHash, keysFromSignature } from '@tint/sdk';
import { pickNetwork, priceOf } from './chain.js';
import { relayerInfo, warmProvers } from './engine.js';
import { short } from './format.js';
import Connect from './Connect.jsx';
import Trade from './Trade.jsx';
import Agents from './Agents.jsx';
import { Activity, BalanceCard, Explorer, Holdings, Keys, Visibility } from './parts.jsx';
import * as I from './icons.jsx';

const ready = initHash();

export default function App() {
  const [net] = useState(pickNetwork);
  const [session, setSession] = useState(null); // { account, walletClient, keys, viewOnly, label }
  const [wallet, setWallet] = useState(null);
  const [tick, setTick] = useState(0); // bumps after every sync
  const [prices, setPrices] = useState({});
  const [syncError, setSyncError] = useState(null);
  const [relayer, setRelayer] = useState(null);
  const [page, setPage] = useState('home');
  const [tab, setTab] = useState(null); // which tab a page opens on, when a button sends you there
  const syncing = useRef(false);

  const sync = useCallback(async () => {
    if (!wallet || syncing.current) return;
    syncing.current = true;
    try {
      await wallet.sync();
      setSyncError(null);
      setTick((t) => t + 1);
    } catch (e) {
      setSyncError(e.shortMessage || e.message);
    } finally {
      syncing.current = false;
    }
  }, [wallet]);

  // Rebuild the private balance from the pool's events whenever someone unlocks.
  useEffect(() => {
    if (!session) return;
    const w = new TintWallet({ client: net.client, pool: net.pool, fromBlock: net.startBlock, keys: session.keys });
    setWallet(w);
    setTick(0);
  }, [session, net]);

  useEffect(() => {
    if (!wallet) return;
    sync();
    const id = setInterval(sync, 4000);
    return () => clearInterval(id);
  }, [wallet, sync]);

  // Is a relayer up for this pool? Checked every 30 s.
  useEffect(() => {
    if (!net) return;
    let stop = false;
    const check = () => relayerInfo(net).then((r) => !stop && setRelayer(r));
    check();
    const id = setInterval(check, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [net]);

  // Prices from the Uniswap pools, every 30 s.
  useEffect(() => {
    if (!net) return;
    let stop = false;
    let retry;
    const load = async () => {
      const entries = await Promise.all(net.assets.map(async (a) => [a.address.toLowerCase(), await priceOf(net, a).catch(() => null)]));
      if (stop) return;
      setPrices(Object.fromEntries(entries));
      // a cold RPC (or a fresh local fork) can time out the first quotes; try again soon
      if (entries.filter(([, p]) => p == null).length > 1) retry = setTimeout(load, 5_000);
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(id);
      clearTimeout(retry);
    };
  }, [net]);

  const unlock = useCallback(
    async (how, viewingKey) => {
      await ready;
      if (how === 'view') {
        setSession({ keys: importViewingKey(viewingKey.trim()), viewOnly: true, label: 'Viewing key' });
        return;
      }
      let account;
      let walletClient;
      if (how === 'local') {
        account = privateKeyToAccount(net.localKey);
        walletClient = createWalletClient({ account, chain: net.chain, transport: http() });
      } else {
        if (!window.ethereum) throw new Error('No browser wallet found. Install one, or use the local test account.');
        walletClient = createWalletClient({ chain: net.chain, transport: custom(window.ethereum) });
        const [addr] = await walletClient.requestAddresses();
        account = addr;
        await switchChain(walletClient, net);
      }
      const signature = await walletClient.signMessage({ account, message: KEY_MESSAGE });
      warmProvers().catch(() => {});
      setSession({ account, walletClient, keys: keysFromSignature(signature), viewOnly: false, label: how === 'local' ? 'Local test account' : 'Browser wallet' });
    },
    [net],
  );

  const lock = () => {
    setSession(null);
    setWallet(null);
    setPage('home');
  };

  const address = session?.account?.address ?? session?.account;
  const synced = wallet && tick > 0;
  const balances = useMemo(() => (synced ? wallet.balances() : {}), [wallet, synced, tick]);
  const history = useMemo(() => (synced ? wallet.history() : []), [wallet, synced, tick]);
  const block = wallet && wallet.nextBlock > 0n ? wallet.nextBlock - 1n : null;

  if (!net) {
    return (
      <div className="lock-page">
        <div className="card pad">
          <h2>No Tint pool found</h2>
          <p className="muted">Deploy one first (tools/dev-fork.sh), then restart this page.</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="lock-page">
        <header className="lock-top">
          <img src="/tint-lockup-ink.svg" alt="Tint" className="logo" />
          <NetChip net={net} />
        </header>
        <Connect net={net} onUnlock={unlock} />
        <StatusLine net={net} relayer={relayer} block={null} />
      </div>
    );
  }

  const pages = PAGES.filter((p) => !session.viewOnly || p.viewOnly);
  const current = pages.find((p) => p.key === page) ? page : 'home';
  const go = (key, tab) => {
    setPage(key);
    setTab(tab ?? null);
    window.scrollTo({ top: 0 });
  };
  const props = { net, wallet, session, address, balances, prices, synced, relayer, tick, onDone: sync };

  return (
    <div className="app">
      <aside className="side">
        <img src="/tint-lockup-ink.svg" alt="Tint" className="logo" />
        <NetChip net={net} />
        <nav className="nav">
          {pages.map(({ key, label, Icon }) => (
            <button key={key} className={current === key ? 'on' : ''} onClick={() => go(key)}>
              <Icon /> {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="who-label">{session.viewOnly ? 'Viewing key' : session.label}</span>
            <span className="mono who-addr">{session.viewOnly ? 'Read only' : short(address)}</span>
          </div>
          <button className="icon-btn" onClick={lock} title="Lock">
            <I.Lock />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="m-top">
          <img src="/tint-lockup-ink.svg" alt="Tint" className="logo" />
          <div className="row gap-s">
            <NetChip net={net} />
            <button className="icon-btn" onClick={lock} title="Lock">
              <I.Lock />
            </button>
          </div>
        </header>

        {current === 'home' && (
          <Page title="Portfolio" sub={session.viewOnly ? 'Read only, through a viewing key.' : 'Your private balance. Only you can read it.'}>
            <BalanceCard net={net} balances={balances} prices={prices} synced={synced} error={syncError} viewOnly={session.viewOnly} onGo={go} />
            <div className="two">
              <Holdings net={net} balances={balances} prices={prices} synced={synced} />
              <Explorer relayer={relayer} onGo={session.viewOnly ? null : go} />
            </div>
            <Activity net={net} history={history} synced={synced} />
          </Page>
        )}
        {current === 'trade' && (
          <Page title="Trade" sub="Buy and sell stock tokens from your private balance. The relayer sends the trade, so it doesn't point back to you.">
            <Trade key={`trade-${tab}`} {...props} tabs={['buy', 'sell']} initialTab={tab ?? 'buy'} />
          </Page>
        )}
        {current === 'move' && (
          <Page title="Move money" sub="Add USDG or stocks, send to another Tint user, or take money out.">
            <Trade key={`move-${tab}`} {...props} tabs={['add', 'send', 'out']} initialTab={tab ?? 'add'} />
          </Page>
        )}
        {current === 'agents' && (
          <Page title="Agents" sub="An agent buys stocks for you on a schedule, from its own private account, inside rules a proof enforces.">
            <Agents {...props} />
          </Page>
        )}
        {current === 'privacy' && (
          <Page title="Privacy and keys" sub="What anyone watching the chain can see, and the keys that let you share your history.">
            <div className="two">
              <Visibility relayer={relayer} />
              {session.viewOnly ? (
                <section className="card pad">
                  <h3>Read only</h3>
                  <p className="muted">This is a viewing key. It shows the balance and history, and can’t move anything.</p>
                </section>
              ) : (
                <Keys keys={session.keys} />
              )}
            </div>
          </Page>
        )}

        <StatusLine net={net} relayer={relayer} block={block} />
      </div>

      <nav className="tabbar">
        {pages.map(({ key, short: label, Icon }) => (
          <button key={key} className={current === key ? 'on' : ''} onClick={() => go(key)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

const PAGES = [
  { key: 'home', label: 'Portfolio', short: 'Home', Icon: I.Home, viewOnly: true },
  { key: 'trade', label: 'Trade', short: 'Trade', Icon: I.Trade },
  { key: 'move', label: 'Move money', short: 'Money', Icon: I.Move },
  { key: 'agents', label: 'Agents', short: 'Agents', Icon: I.Agent },
  { key: 'privacy', label: 'Privacy and keys', short: 'Privacy', Icon: I.EyeOff, viewOnly: true },
];

function Page({ title, sub, children }) {
  return (
    <main className="page">
      <div className="page-head">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children}
    </main>
  );
}

function NetChip({ net, block }) {
  return (
    <span className="net-chip" title={net.label}>
      <i className="dot live" />
      <span className="net-long">{net.label}</span>
      <span className="net-short">{net.short}</span>
      {block != null && <span className="mono muted">#{block.toLocaleString('en-US')}</span>}
    </span>
  );
}

function StatusLine({ net, relayer, block }) {
  return (
    <footer className="status mono">
      <span>
        <i className="dot live" /> {net.short}
        {block != null && ` · block ${block.toLocaleString('en-US')}`}
      </span>
      <span>{relayer ? 'Relayer on' : 'Relayer off'}</span>
      <span>Proofs are made in this browser. Keys never leave it.</span>
      {net.explorer && (
        <a href={`${net.explorer}/address/${net.pool}`} target="_blank" rel="noreferrer">
          Pool contract
        </a>
      )}
    </footer>
  );
}

async function switchChain(walletClient, net) {
  const current = await walletClient.getChainId();
  if (current === net.id) return;
  try {
    await walletClient.switchChain({ id: net.id });
  } catch (e) {
    if (e.code !== 4902 && !/Unrecognized chain/i.test(e.message)) throw e;
    await walletClient.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: numberToHex(net.id),
          chainName: net.label,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: net.chain.rpcUrls.default.http,
        },
      ],
    });
  }
}
