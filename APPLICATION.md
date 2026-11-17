# Arbitrum Mentorship Program, Cohort 2: application draft

> **Parked Nov 17 2026.** The user is launching Tint now and will build a different project for this programme. Kept for reference.

Form: https://tally.so/r/Xx6xqO · closes **6 Dec 2026** · aim to submit **Dec 5**.

These are the fields on page 1 of the form. Later pages only show after page 1 is filled, so add their questions here when you see them. Anything in [brackets] has to be true on the day you submit. Update it before pasting.

---

**Contact full name / Email / Telegram:** you fill these in.

**Company/Project name:** Tint

**What are you building?**
> Tint is a private wallet for stocks and dollars on Robinhood Chain. You keep USDG and Robinhood stock tokens in one balance that nobody watching the chain can see. From that balance you can get paid, send money, send someone shares, and buy or sell stocks. Trades go through the public Uniswap pools on Robinhood Chain, so the market sees that Tint traded but not who did. Because the users we want also have to file taxes, every account has a viewing key. You can give it to an accountant or an exchange so they can read your history without it going public.
>
> Today every Robinhood Chain wallet is a public brokerage statement. Anyone can see what you hold, what you paid and who pays you. Tint makes it work like a normal bank or brokerage account: private by default, and you choose who can see it.
>
> Built with Noir zero-knowledge proofs made in the browser, Solidity contracts, and the note tree in a Stylus (Rust) contract to keep gas low. [Live on Robinhood Chain testnet at https://tint.trade. Contracts verified: links in the README.]

**How would you classify the project primarily?** DeFi. If there's an option for payments or privacy, pick payments.

**Website URL:** [https://tint.trade]

**GitHub repo:** [https://github.com/neromtoobad/tint]

**X/Twitter URL:** [https://x.com/tinttrade]

**Project stage:** B. Pre-launch (actively building, no public release yet). If the testnet site is public with real users by then, pick **C. Very early**.

**Current status & state in 6 months**
> Now: [the private pool is live on Robinhood Chain testnet. You can deposit, send privately, send stock tokens, swap USDG ⇄ stock tokens privately, withdraw, and export a tax CSV with a viewing key. Each step has a public tx link in the README. Real-price swaps against Robinhood Chain mainnet pools are tested on a mainnet fork.]
>
> In 6 months: live on Robinhood Chain mainnet after an outside review, with deposit caps. A relayer so users need no ETH for gas. Proofs that deposits did not come from flagged addresses. Auto-invest from incoming payments. Private USDC payments on Arbitrum One. Revenue from a 0.25% fee on private swaps and 0.1% on withdrawals.

**Expected mainnet launch time:** C. Expected within 6 months.

**Arbitrum alignment:** A. Already building on Arbitrum (Robinhood Chain is an Arbitrum chain, and the tree contract uses Stylus).

---

## Points to have ready for the interview / due diligence

- **Why now:** Robinhood Chain mainnet has real stock-token trading (NVDA/USDG alone: about $1.8M of liquidity and $10M a day, Nov 17 2026), and every position on it is public.
- **Competition:** Rooq (private stock trading, testnet only; its operators can see every position), Gloam (private stablecoin payments, about $3.4k deposited), and about 10 "private USDG send" clones. Tint is the only one that combines payments and stocks in one balance, has no operator who sees positions, and ships viewing keys.
- **Business:** fees on private swaps and withdrawals, plus later a paid tax-report export for heavy users. Token only after mainnet, designed with the programme's tokenomics mentors.
- **Compliance:** viewing keys, geo-block for US persons (Robinhood stock tokens aren't offered to them), clean-funds proofs on the roadmap, deposit caps until audited.
- **Founder:** [full time on Tint from Nov 2026; past shipped work: list 3–4 live projects with links].
