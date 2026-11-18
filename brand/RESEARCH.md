# Tint brand: what the reference X pages do (Nov 18 2026)

Studied the profile, banner, avatar and media tab of @rooqtrade, @gloamtrade, @MerrymenAI and @orenfinance_. Contact sheets are in `refs/` (not committed: other brands' images).

| | Rooq | Gloam | Merrymen | Oren |
|---|---|---|---|---|
| Avatar | White "q" glyph on an orange glow | Black squircle with a light inner square | Black dashed-bar figure on cream | Black blob mascot with two eyes and a pastel rim |
| Banner | Headline + one-line promise + ticker chips on a single orange glow | Headline + "live on" chain chips over an engraved desert landscape | Plain green-to-mint gradient | Painted landscape, mascot, wordmark, one line |
| Colour | Black + one orange glow, nothing else | Off-white + black, faint mint glow | Deep green to mint, lime for loud posts | Pastel, iridescent violet/cyan |
| Type | Clean grotesk, sentence case | Thin light grotesk | Grotesk; heavy caps for feature names | Heavy rounded grotesk |
| Posts | Same template every time: logo top centre, short headline, subline, glow. Real numbers ("168 private transactions so far"), real tx tables, "long or short? how big? whose wallet?" puzzle cards, video clips | Product UI screenshots, cinematic AI scenes, one-word cards ("Deposit") | Screen recordings, phone mockups, named modes ("TRENCHER MODE") | App UI on pastel, Claude/Cursor integration clips, mascot cameos |

## What the strong ones share

1. **One mark that works at 40 px.** It's simple enough to read as an avatar and in the corner of every post.
2. **One signature light or colour**, used every time (Rooq's orange glow). You recognise a post before reading it.
3. **One post template.** Logo, headline in sentence case, one subline, signature background. Rooq never breaks it, which is why it looks the most professional.
4. **Real proof in posts.** Numbers, tx tables and app clips, not slogans. The "can you find my trade?" card is the best privacy post in the set.
5. **Short, plain headlines.** "Private markets for stock tokens." "Private money on public chains."
6. **Weakest look:** Merrymen, because every post uses a different style.

## What Tint should do differently

- Nobody owns the **tint / one-way glass / sunglasses** idea. It is literally the tagline: you can see out, they can't see in.
- Rooq has the orange glow, Gloam black and mint, Merrymen green, Oren iridescent violet. A **cool blue or pure monochrome** is still free.
- Only Oren has a mascot. A mascot fits Tint's AI agents.
- Use tickers as text, not company logos (trademarks), and never Robinhood's own logo or look.

## The three directions

- **A · Lens:** a gradient lens (dark top, clear bottom). Dark, cinematic, one cool blue edge-light. Funnel Display + JetBrains Mono. `directions/a-lens.html`
- **B · Film:** window film is sold by VLT (how much light gets through); four strips, each darker. Light, editorial, black ink only. Schibsted Grotesk + IBM Plex Mono. `directions/b-film.html`
- **C · Shades:** a 3D mascot in gradient sunglasses for the AI agents; mark made of two lenses. Light, friendly, cobalt. Bricolage Grotesque + DM Mono. `directions/c-shades.html`

Render any direction with `node brand/tools/render.mjs brand/directions/<file>.html brand/out`.
