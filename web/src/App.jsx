import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, http, numberToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { KEY_MESSAGE, TintWallet, importViewingKey, initHash, keysFromSignature } from '@tint/sdk';
import { networks, priceOf } from './chain.js';
import { warmProvers } from './engine.js';
import { short } from './format.js';
import Connect from './Connect.jsx';
import Trade from './Trade.jsx';
import { Activity, BalanceCard, Holdings, Keys, Visibility } from './parts.jsx';

const ready = initHash();

export default function App() {
  const [net] = useState(networks[0]);
  const [session, setSession] = useState(null); // { account, walletClient, keys, viewOnly, label }
  const [wallet, setWallet] = useState(null);
  const [tick, setTick] = useState(0); // bumps after every sync
  const [prices, setPrices] = useState({});
  const [syncError, setSyncError] = useState(null);
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
  };

  const address = session?.account?.address ?? session?.account;
  const synced = wallet && tick > 0;
  const balances = useMemo(() => (synced ? wallet.balances() : {}), [wallet, synced, tick]);
  const history = useMemo(() => (synced ? wallet.history() : []), [wallet, synced, tick]);

  if (!net) {
    return (
      <Shell>
        <div className="card pad">
          <h2>No Tint pool found</h2>
          <p className="muted">Deploy one first (tools/dev-fork.sh), then restart this page.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      net={net}
      right={
        session && (
          <>
            <span className="chip mono">
              <i className="dot" /> {session.viewOnly ? 'Viewing key · read only' : `${session.label} · ${short(address)}`}
            </span>
            <button className="btn ghost sm" onClick={lock}>
              Lock
            </button>
          </>
        )
      }
      block={wallet ? wallet.nextBlock - 1n : null}
    >
      {!session ? (
        <Connect net={net} onUnlock={unlock} />
      ) : (
        <div className="grid">
          <div className="col">
            <BalanceCard net={net} balances={balances} prices={prices} synced={synced} error={syncError} viewOnly={session.viewOnly} />
            <Holdings net={net} balances={balances} prices={prices} synced={synced} />
            <Activity net={net} history={history} synced={synced} />
          </div>
          <div className="col">
            {session.viewOnly ? (
              <div className="card pad">
                <h3>Read only</h3>
                <p className="muted">This is a viewing key. It shows the balance and history, and can’t move anything.</p>
              </div>
            ) : (
              <Trade net={net} wallet={wallet} session={session} address={address} balances={balances} prices={prices} synced={synced} onDone={sync} />
            )}
            <Visibility />
            {!session.viewOnly && <Keys keys={session.keys} />}
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children, net, right, block }) {
  return (
    <div className="page">
      <header className="top">
        <img src="/tint-lockup-ink.svg" alt="Tint" className="logo" />
        <div className="top-right">
          {net && (
            <span className="chip mono" title={net.label}>
              {net.short}
              {block != null && block > 0n ? ` · block ${block.toLocaleString('en-US')}` : ''}
            </span>
          )}
          {right}
        </div>
      </header>
      <main>{children}</main>
      <footer className="foot mono">
        <span>Tint · private stock wallet on Robinhood Chain</span>
        <span>Proofs are made in this browser. Keys never leave it.</span>
      </footer>
    </div>
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
