// Networks, listed stocks and prices.
import { createPublicClient, defineChain, http, parseUnits } from 'viem';

const deployments = Object.fromEntries(
  Object.values(import.meta.glob('./deployments/*.json', { eager: true, import: 'default' }))
    .filter((d) => d.pool)
    .map((d) => [d.chainId, d]),
);

const MAINNET_TOKENS = {
  USDG: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  NVDA: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  TSLA: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d',
  SPY: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  META: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35',
  AMZN: '0x12f190a9F9d7D37a250758b26824B97CE941bF54',
  GOOGL: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3',
};

const NAMES = {
  USDG: 'Global Dollar',
  NVDA: 'NVIDIA',
  TSLA: 'Tesla',
  SPY: 'S&P 500 ETF',
  META: 'Meta',
  AMZN: 'Amazon',
  GOOGL: 'Alphabet',
  AMD: 'AMD',
  PLTR: 'Palantir',
  NFLX: 'Netflix',
};

const stocks = (tokens) =>
  Object.entries(tokens).map(([symbol, address]) => ({
    symbol,
    name: NAMES[symbol] ?? symbol,
    address,
    decimals: symbol === 'USDG' ? 6 : 18,
    cash: symbol === 'USDG',
  }));

const NETWORKS = {
  31337: {
    id: 31337,
    label: 'Local fork of Robinhood Chain',
    short: 'Local fork',
    rpc: 'http://127.0.0.1:8545',
    explorer: null,
    quoter: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
    assets: stocks(MAINNET_TOKENS),
    relayer: import.meta.env.VITE_RELAYER_URL ?? 'http://127.0.0.1:8790',
    // anvil's well-known test account 1: local fork only, holds fork-minted USDG
    localKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  },
  // Robinhood Chain testnet: Robinhood's test stock tokens, traded against
  // Tint Test USDG on small Uniswap v3 "test pools" seeded by tools/testnet-deploy.sh.
  46630: {
    id: 46630,
    label: 'Robinhood Chain testnet',
    short: 'Testnet',
    relayer: import.meta.env.VITE_TESTNET_RELAYER_URL ?? 'http://127.0.0.1:8791',
    testPools: true,
  },
};

/** The assets listed in a deployment file (testnet), shaped like stocks(). */
const fromDeployment = (d) =>
  (d.assets ?? []).map((a) => ({ name: a.name ?? NAMES[a.symbol] ?? a.symbol, decimals: 18, cash: false, ...a }));

export const networks = Object.values(NETWORKS)
  .filter((n) => deployments[n.id])
  .map((n) => {
    const d = deployments[n.id];
    const chain = defineChain({
      id: n.id,
      name: n.label,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [d.rpc ?? n.rpc] } },
    });
    return {
      ...n,
      chain,
      assets: n.assets ?? fromDeployment(d),
      explorer: n.explorer ?? d.explorer ?? null,
      quoter: n.quoter ?? d.quoter,
      // testnet only: the cash token has an open faucet (TestUSDG.faucet)
      // a local anvil fork of testnet (FORK=1 tools/testnet-deploy.sh) gets the same public dev key as the mainnet fork
      localKey: n.localKey ?? (/127\.0\.0\.1|localhost/.test(d.rpc ?? '') ? NETWORKS[31337].localKey : undefined),
      testCash: d.assets?.find((a) => a.cash && /Test/.test(a.name ?? ''))?.address ?? null,
      pool: d.pool,
      startBlock: BigInt(d.startBlock ?? 0),
      client: createPublicClient({ chain, transport: http(undefined, { timeout: 30_000 }), pollingInterval: 1_000 }),
    };
  });

/** The network to open: ?chain=<id>, else VITE_CHAIN_ID, else testnet if deployed, else the first. */
export function pickNetwork() {
  const want = Number(new URLSearchParams(window.location.search).get('chain') ?? import.meta.env.VITE_CHAIN_ID ?? 46630);
  return networks.find((n) => n.id === want) ?? networks[0];
}

export const assetOf = (net, address) => net.assets.find((a) => a.address.toLowerCase() === String(address).toLowerCase());
export const cashOf = (net) => net.assets.find((a) => a.cash);

const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'ticksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
];

const FEE_TIERS = [500, 3000, 10000];

/** Best Uniswap v3 quote across fee tiers: { amountOut, poolFee } or null if no market. */
export async function quote(net, tokenIn, tokenOut, amountIn) {
  if (amountIn <= 0n) return null;
  const tries = await Promise.allSettled(
    FEE_TIERS.map((fee) =>
      net.client
        .simulateContract({
          address: net.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
        })
        .then((r) => ({ amountOut: r.result[0], poolFee: fee })),
    ),
  );
  const ok = tries.filter((t) => t.status === 'fulfilled' && t.value.amountOut > 0n).map((t) => t.value);
  if (!ok.length) return null;
  return ok.reduce((best, q) => (q.amountOut > best.amountOut ? q : best));
}

/** Dollar price of one share (from selling 0.01 share), as a number. Null if there's no market. */
export async function priceOf(net, asset) {
  const cash = cashOf(net);
  if (asset.cash) return 1;
  const q = await quote(net, asset.address, cash.address, parseUnits('0.01', asset.decimals));
  if (!q) return null;
  return (Number(q.amountOut) / 10 ** cash.decimals) * 100;
}
