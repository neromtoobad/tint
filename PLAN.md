# Tint — build plan

Tint is a private stock wallet on Robinhood Chain. You hold dollars (USDG) and stock tokens in one private balance. You can get paid, send money and trade stocks, and nobody watching the chain can see who you are, what you hold or who you pay.

Tagline idea: **"You can see out. They can't see in."**

## What it does

| Feature | From | What the user sees |
|---|---|---|
| Private balance | both | One balance with USDG and stocks. Hidden on chain. |
| Private send / payment links | Gloam | Send USDG to a Tint address or share a link. The amount and both people stay hidden. |
| Private stock trading | Rooq | Buy and sell stock tokens from inside the private balance. The market sees that the Tint pool traded, not who did. |
| **Pay in stocks** | new | Send someone $50 of NVDA privately. They keep it or sell it. |
| **Auto-invest** | new | A share of every payment you receive is turned into stocks you pick. |
| **Viewing key + tax report** | new | Give an accountant a key that only lets them read your history, or download a CSV. Later: prove your money did not come from a flagged address without showing your wallet. |
| No-wallet gas | both | A relayer pays the gas, so a send or trade is never linked to a funded wallet. Its fee comes out of the private balance. |

What Tint fixes compared with Rooq: nobody runs a maker or coordinator that can see everyone's positions. Trades go through public Uniswap pools.

Not in v1: perps (Rooq's 2x trades). Maybe v2.

## Facts checked (Nov 17 2026)

- Robinhood Chain mainnet: chain id 4663, RPC `https://rpc.mainnet.chain.robinhood.com`, gas ~0.02 gwei.
- USDG (Global Dollar), 6 decimals: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Watch out: DexScreener also lists fake "USDG" tokens.
- Uniswap v3 factory: `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`. QuoterV2: `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7`. Swap router: still to confirm.
- Stock tokens ("NVIDIA • Robinhood Token", 18 decimals) with real pools against USDG:

| Token | Address | Biggest USDG pool liquidity | 24h volume |
|---|---|---|---|
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | $1.8M (0.05% fee) | $10.3M |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | $2.4M | $3.1M (best pool) |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | $1.4M | $0.5M |
| MSTR | `0xec262a75e413fAfD0dF80480274532C79D42da09` | $1.5M | $0.6M |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | $0.5M | $0.5M |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | $0.44M | $0.33M |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | $0.39M | $0.25M |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | $0.36M | $0.04M |
| COIN | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` | $0.56M | small vs USDG, $0.4M vs WETH |

  That is enough for retail-sized trades (hundreds to a few thousand dollars).
- Stock tokens are not for US persons. Tint should block US users on the front end, as Robinhood does.

## How it works

**Notes.** Each piece of money is a note: `commitment = Poseidon2(asset, amount, ownerKey, blinding)`. All assets share one Merkle tree, so even the asset is hidden. Spending a note publishes its nullifier, which stops double spends without showing which note was spent.

**Keys.** One wallet signature creates three keys:
- **Spend key:** proves you own a note.
- **Viewing key:** decrypts your notes. This is the key you share with an accountant.
- **Address:** what you give people so they can pay you (owner key + encryption key).

Note details are encrypted to the recipient off-circuit (X25519 + ChaCha20) and posted on chain as an event. The wallet scans these events and rebuilds itself on any device.

**Circuits (Noir, UltraHonk via bb.js in the browser):**
1. `transact`: 2 notes in, 2 notes out, one asset. Covers shield (deposit), private send, pay in stocks and unshield (withdraw), using a public in/out amount. It binds a hash of the recipient, relayer and fee, so a relayer can't change them.
2. `swap`: spend notes of asset A, publish only `assetIn, amountIn, assetOut, minOut, ownerHash`. The contract swaps on Uniswap and adds the output note itself with Poseidon on chain. The trade amount is public (it's on a public pool). Who made the trade is not.
3. Later, `disclose`: prove facts about your own notes (total received in a date range, or deposit came from an approved list) for tax and compliance.

Why Noir and not Circom: no trusted-setup ceremony for each circuit, faster to change, and the Solidity verifier comes out of `bb`. UltraHonk costs ~4M gas to verify (Rooq's number). At 0.02 gwei that's ~0.00008 ETH, about 25¢. If that's too much, switching `transact` to Groth16 is a contained change.

**Contracts (Foundry):**
- `TintPool`: Merkle tree (LeanIMT, Poseidon2), nullifier set, verifiers, token custody, Uniswap v3 swap adapter, fee to treasury.
- Allowed assets list (USDG + the stocks above), owner-controlled at first.
- Per-deposit cap (e.g. $1,000) and a pool-wide cap until an audit. Pause on deposits only; withdrawals always open.

**Relayer:** small Node service. It takes a proof, checks it, submits it and pays the gas. It takes a fee in USDG from inside the proof. Anyone can run one.

**Web:** Next.js. Proving runs in a Web Worker. It needs a wallet only to deposit and to create the keys.

## Token ($TINT)

- Fair launch on a Robinhood Chain launchpad (Orynth or Pons), locked LP, no team allocation.
- 0.25% on private swaps and 0.1% on unshields go to a treasury, which buys back $TINT on a public schedule with tx links. Half the buyback is burned.
- Holding $TINT lowers your fee. Holders vote on which stock gets added next.
- Launch after the private pool is live on mainnet with real users, not before. Rooq and Gloam both launched with a working product.

## Phases

| # | What | Done when |
|---|---|---|
| 0 | Install Noir (`noirup`) + `bb`. Register **tint.trade** and **@tinttrade** | `nargo --version` works, handle is yours |
| 1 | `transact` circuit + `TintPool` + tests on a local fork of Robinhood mainnet | Shield → send → unshield passes in `forge test` with real proofs |
| 2 | `swap` circuit + Uniswap adapter | Private USDG → NVDA → USDG round trip on the fork, with real pool prices |
| 3 | Web wallet: keys, scanning, send, payment links, trade | The full loop works in the browser against the fork |
| 4 | Relayer + viewing key + CSV tax report + pay in stocks | A send or trade works from a wallet with no ETH |
| 5 | Mainnet with caps, landing page, demo clips, daily build posts on X | Real deposits by you and a few testers |
| 6 | Auto-invest + clean-funds proof | — |
| 7 | $TINT launch + buyback script | — |

Testing uses `anvil --fork-url https://rpc.mainnet.chain.robinhood.com`, so swaps hit the real pools with fake money. A testnet deploy isn't needed for that.

## Risks

- **Unaudited ZK code holding real money.** Keep caps low and say so clearly on the site.
- **Small anonymity set at launch.** Privacy grows with users. Encourage fixed deposit amounts ($100 / $500 / $1,000) at first, so deposits look alike.
- **Shield and unshield are public.** Same limit as Rooq. Timing and amounts can link them. The UI should warn when an unshield matches a recent deposit.
- **Rooq's code is BUSL-1.1.** Read it for ideas only; don't copy it.
- **US users and sanctions.** Geo-block the front end and add the clean-funds proof early.
