# Tint — build plan

**Tint is a private AI agent that invests in stocks for you, on Robinhood Chain.** You set the rules once (which stocks, how much a week, the most per trade, until when). The agent buys and sells inside those rules, and nobody watching the chain can see your strategy, what you hold or that the trades are yours. Underneath is a private stock account (USDG and stock tokens in one hidden balance) that you can also trade from by hand, send from and take money out of.

The agent is the headline; the account is what it runs on. (Changed Nov 18: Tint used to be pitched as "a private stock wallet with agents". A private wallet alone is what Rooq and Gloam already say.)

Tagline idea: **"You can see out. They can't see in."**

## Parked: Arbitrum Mentorship Program

On Nov 17 the user chose to launch Tint now and build a different project for the Arbitrum programme (apply by 6 Dec 2026). Notes and the form draft are in `APPLICATION.md`. Two ideas from that plan are kept here because they make Tint better anyway: the Stylus tree contract and the viewing key at launch.

## Why invest first (changed Nov 17)

Private sending only helps when the other person also uses Tint, and privacy is weak while the pool is small. Buying stocks privately works with one user on day one. AI agents make it something people come back to and share, like Merrymen on the same chain. But every Merrymen agent's holdings are public, and Tint's are not. So the order is: **private buying first, then private agents, then payments.**

## What it does

| Feature | From | What the user sees |
|---|---|---|
| Private balance | both | One balance with USDG and stocks. Hidden on chain. |
| **Private stock buying** | Rooq | Buy and sell NVDA, SPY, TSLA and others from inside the private balance. The market sees that the Tint pool traded, not who did. |
| **Private AI agent** | new | Give an agent a budget and rules (which stocks, max per trade, end date). It buys and sells for you. Only your key can take money out. Nobody can see what it holds. |
| **Auto-invest** | new | The same agent with no AI: "put $20 into my basket every day" or "keep my basket at equal weight". |
| Use from Claude / Telegram | Merrymen | Ask "how is my agent doing?" or "buy $50 of NVDA" in chat. These tools can only trade, never withdraw. |
| Viewing key + tax report | new | Give an accountant a key that only lets them read your history, or download a CSV. Later: prove your money did not come from a flagged address without showing your wallet. |
| Private send / payment links | Gloam | Send USDG to a Tint address or share a link. The amount and both people stay hidden. |
| Pay in stocks | new | Send someone $50 of NVDA privately. They keep it or sell it. |
| No-wallet gas | both | A relayer pays the gas, so a trade or send is never linked to a funded wallet. Its fee comes out of the private balance. |

What Tint fixes compared with Rooq: nobody runs a maker or coordinator that can see everyone's positions. Trades go through public Uniswap pools. Compared with Merrymen: same idea of an agent inside signed limits, but its holdings and trades can't be tied to you.

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
- Merrymen (merrymen.si, repo millw14/merrymen): AI trading agents on Robinhood Chain with session-key limits, Telegram and a Claude connector. $MERRYMEN launched via Virtuals, ~$177k value, ~$7k/day volume. Its agent accounts are public. Ideas only; we write our own code.

## How it works

**Notes.** Each piece of money is a note: `commitment = Poseidon2(asset, amount, Poseidon2(owner, blinding))`. The inner hash lets a contract finish a note whose amount it only learns after a swap, without the owner showing up on chain. All assets share one Merkle tree, so even the asset is hidden. Spending a note publishes its nullifier, which stops double spends without showing which note was spent.

**Keys.** One wallet signature creates three keys:
- **Spend key:** proves you own a note.
- **Viewing key:** decrypts your notes. This is the key you share with an accountant.
- **Address:** what you give people so they can pay you (owner key + encryption key).

Note details are encrypted to the owner off-circuit (X25519 + ChaCha20) and posted on chain as an event. The wallet scans these events and rebuilds itself on any device.

**Agent accounts.** You move a budget (say $200) from your balance into an agent account. Its notes have `owner = Poseidon2(yourKey, agentKey, rulesHash)`. The rules are: allowed stocks, max per trade, end date. The agent gets its own agent key and a viewing key for that account only, never for your main balance.
- The agent key can only make swaps. The swap circuit forces the result back into the same agent account, checks that both assets are on the allowed list and the trade is under the cap, and the contract checks the end date against block time.
- Taking money out of the agent account, or sending it anywhere, needs your spend key.
- So the worst a stolen agent key can do is make bad trades with that budget until the end date. **The budget is the limit.** Change the rules or stop the agent by moving the money back with your key.

**The agent itself.** "The model suggests, the code decides."
- **Auto-invest (no AI):** fixed rules such as a daily buy into a basket, or keeping the basket at equal weight.
- **AI agent:** Claude reads prices and the agent account's holdings and suggests buy, sell or hold with a short reason. Plain code checks the rules, gets a Uniswap quote, builds the proof and submits it. The model never sees an address and never builds a transaction.
- **Where it runs:** the hosted worker (it can see the agent account's holdings, not your main balance, and the site says so), or on your own computer with the same code. The AI provider sees the holdings it is asked about.
- **Chat:** a Telegram bot and a Claude connector (MCP) with tools for balance, quote, buy, sell and rules. Both only hold the agent key, so they cannot withdraw.
- **Scoreboard:** agents can opt in to a public results page that shows returns, not holdings or owners.

**Circuits (Noir, UltraHonk via bb.js in the browser, `bb` on the worker):**
1. `transact`: 2 notes in, 2 notes out, one asset. Covers shield (deposit), moving money into or out of an agent account, private send, pay in stocks and unshield (withdraw), using a public in/out amount. It binds a hash of the recipient, relayer and fee, so a relayer can't change them.
2. `swap`: spend notes of asset A, publish only `assetIn, amountIn, assetOut, minOut` and the inner hash of the new note. The contract swaps on Uniswap and finishes the output note itself with Poseidon on chain. Spent either by your spend key, or by an agent key with the rule checks above. The trade amount is public (it's on a public pool). Who made the trade is not, and two trades by the same account can't be linked.
3. Later, `disclose`: prove facts about your own notes (total received in a date range, or deposit came from an approved list) for tax and compliance.

Why Noir and not Circom: no trusted-setup ceremony for each circuit, faster to change, and the Solidity verifier comes out of `bb`. UltraHonk costs ~4M gas to verify (Rooq's number). At 0.02 gwei that's ~0.00008 ETH, about 25¢. If that's too much, switching `transact` to Groth16 is a contained change.

**Contracts (Foundry + Stylus):**
- `TintPool` (Solidity): nullifier set, verifiers, token custody, Uniswap v3 swap adapter, fee to treasury.
- `TintTree` (Stylus, Rust): the note Merkle tree and Poseidon2 hashing that `TintPool` calls. Rust is installed with the wasm32 target. `cargo-stylus` still needs installing. A Solidity tree stays in the tests as a reference, to prove both give the same root.
- Allowed assets list (USDG + the stocks above), owner-controlled at first.
- Per-deposit cap (e.g. $1,000) and a pool-wide cap until an audit. Pause on deposits only; withdrawals always open.

**Relayer / agent worker:** one small Node service. It takes a proof, checks it, submits it and pays the gas, taking a fee in USDG from inside the proof. The same service runs the agents. Anyone can run one.

**Web:** Next.js. Proving runs in a Web Worker. It needs a wallet only to deposit and to create the keys.

## Token ($TINT)

**Where:** Pons (ponsfamily.com), the main Robinhood Chain launchpad. Checked Nov 17: public launches are open and you're already signed in there as "nerom". Orynth (where Gloam launched) is application-only. Virtuals also launches on Robinhood Chain (Merrymen used it, paired with VIRTUAL); Pons stays the pick because it pairs with ETH and pays the creator 70% of fees.

**Pons terms (from docs.ponsfamily.com):**
- 1,000,000,000 fixed supply, token and TINT/WETH pool created in one transaction, **liquidity locked automatically**, no bonding curve and no migration.
- 1% pool fee on every trade. **Creator gets 70%**, Pons 30%. Claimable any time.
- 0.0005 ETH launch fee. Launch protection: in the first two blocks only the creator's first buy goes through, then max 5% of supply per wallet.
- Fee wallet is set at launch and can't be changed later. Use a **new wallet just for Tint's treasury**, not your personal one.

**What the fees pay for (say this publicly on launch day):**
- 50% of creator fees buy back $TINT; half of that is burned and half funds rewards. Each buyback is posted with its tx link.
- 50% runs Tint: relayer gas (so private trades need no ETH), AI costs for hosted agents, hosting, and later the audit.

**What holding $TINT does (each perk starts when its feature ships):**
- Lower fees on private trades and agent trades (app fees: 0.25% on private swaps, 0.1% on withdrawals). Tiers by balance, read from any wallet you link; Tint never needs that wallet's key.
- More AI reviews per day for hosted agents.
- Votes on which stock gets added next and which agent strategies ship.

**Creator buy:** small and stated openly, e.g. 1–2% of supply, kept in the treasury wallet. No hidden team wallets.

**What not to say:** no price talk, no "investment" language, no promises about returns, and agents are never sold as making money. Stock tokens aren't for US persons, and that applies to the marketing too.

## Phases

The token launches with something people can use, not just a landing page. Rooq and Gloam both launched with a working app, and the "~10 private USDG send" clones on Robinhood Chain with only a landing page sit at about $13k.

| Day | What | Done when |
|---|---|---|
| **0 (today)** | Register **tint.trade** + **@tinttrade**. Set up the X profile (name, banner, pinned "building Tint" post). Install Noir, `bb`, `cargo-stylus`. Public repo `neromtoobad/tint` | Handle and domain are yours. Tools work |
| 1–3 | `transact` circuit, `TintPool`, `TintTree`, tests on a fork of Robinhood mainnet. A build post every day | Shield → unshield passes in `forge test` with real proofs |
| 3–6 | `swap` circuit + Uniswap adapter: private USDG ⇄ NVDA/TSLA/SPY | A private buy and sell pass on a mainnet fork at real prices |
| 6–8 ✅ | Web wallet v0: keys from one signature, note encryption, deposit, private buy and sell, send, withdraw, viewing key. Done Nov 18 on the mainnet fork, proofs in the browser | The loop runs from the browser with real proofs |
| ✅ | **Relayer** (done Nov 18 on the fork): sends each transaction for you and takes its fee from the private balance, so trades and take-outs stop pointing at your address | A buy from the site has the relayer as sender, not your wallet |
| next | **Agent accounts** in the circuits and contracts: the agent key can only swap back into the same account, within the signed rules. Auto-invest first (no AI), then the Claude agent ("the model suggests, the code decides"). Telegram bot and Claude connector | An agent trades a budget, a stolen-key test is refused, and nothing leaves without the spend key |
| then | Deploy on Robinhood Chain **testnet** (46630) with seeded test pools, verify the contracts. Landing page at tint.trade | The agent and the manual loop run on the live site, with tx links |
| **launch** | Launch **$TINT on Pons**. Same hour: a 30–45 s recording of a private agent trading on testnet, links to the app, repo and contracts | Token live, app live, fee wallet public |
| after | Private send links, pay in stocks, tax CSV, opt-in agent scoreboard | A new user trades and sends privately with zero ETH |
| 20–32 | Outside review, then **mainnet beta with low deposit caps** ($100–$500) | Real deposits and real agent trades on Robinhood Chain mainnet |
| Later | Clean-funds proofs, private USDC on Arbitrum One, perps | — |

If a step runs late, the launch date moves. The rule stays: launch only when the loop works on the live site, now with an agent trading in it. If that isn't ready by day 11, cut the Stylus tree (keep the Solidity one) and the viewing key UI, never the loop itself.

Agents now ship before the launch (changed Nov 18): the launch shows the thing that is new, a private agent trading real stocks, instead of a private wallet. This moves the launch from ~day 9 to after the agent works on testnet.

Testing uses `anvil --fork-url https://rpc.mainnet.chain.robinhood.com`, so swaps hit the real pools with fake money. Testnet has Robinhood's test stock tokens (TSLA, AMZN, PLTR, NFLX, AMD) but no real pools, so testnet swaps use small pools we seed, **labelled as test pools in the app**.

**Build in public (every day from day 0):** one post per day on @tinttrade with a short clip or screenshot of what works today, plus one honest "what's next". The posts are what bring buyers on launch day.

**Needs from the user:** the domain and handle, a new treasury wallet, a working Anthropic API key for the hosted AI agent (the shared key expired Nov 8), and a Telegram bot token from @BotFather.

## Risks

- **Unaudited ZK code holding real money.** Keep caps low and say so clearly on the site.
- **Agents lose money.** No limit fixes bad judgement. Show losses and refused trades as plainly as wins, start on fake money, and never promise returns.
- **Hosted agents see their own account.** The hosted worker and the AI provider see the agent account's holdings (not your main balance and not who you are). Say so, and offer the run-it-yourself option.
- **AI cost.** Each AI review costs money. Cap reviews per agent per day; holders get more.
- **Small anonymity set at launch.** Privacy grows with users. Encourage fixed deposit amounts ($100 / $500 / $1,000) at first, so deposits look alike.
- **Shield and unshield are public.** Same limit as Rooq. Timing and amounts can link them. The UI should warn when an unshield matches a recent deposit.
- **Rooq's code is BUSL-1.1.** Read it for ideas only; don't copy it. Merrymen's code is open, but we still write our own.
- **US users and sanctions.** Geo-block the front end and add the clean-funds proof early.
