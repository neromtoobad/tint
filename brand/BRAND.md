# Tint brand

**Idea:** your agent wears shades. Tinted glass lets you see out while nobody sees in, which is exactly what Tint does to a wallet.

**Tagline:** You can see out. They can't see in.

## Files

| What | File | Use it for |
|---|---|---|
| Mark, ink | `logo/tint-mark-ink.svg`, `final/logo-mark-ink.png` | Light backgrounds |
| Mark, cream | `logo/tint-mark-cream.svg`, `final/logo-mark-cream.png` | Cobalt or dark backgrounds |
| Lockup (mark + "tint") | `logo/tint-lockup-ink.svg` / `-cream.svg`, PNGs in `final/` | Site header, post corners, slides |
| App icon | `logo/tint-icon.svg`, `final/logo-icon.png` | Favicon, app icon, Telegram bot |
| X profile picture | `final/x-avatar.png` (800×800) | @tinttrade avatar |
| X banner | `final/x-banner.png` (3000×1000) | @tinttrade header |
| Intro poster | `final/poster-intro.png` | Pinned post, launch day |
| Agents poster | `final/poster-agents.png` | Agents announcement |
| Daily build post | `final/post-day-00.png` | Template for every build-in-public post |
| Mascot | `art/mascot.png`, `art/mascot-cutout.png` (transparent), `art/squad-a.png` | Posters, site hero, empty states |

All PNGs come from `kit.html`. Edit the text there and run:

```bash
node brand/tools/render.mjs brand/kit.html brand/final 2
```

The SVG logos come from `node brand/tools/logo.mjs`. The wordmark is outlined from Bricolage Grotesque ExtraBold, so the SVGs need no font installed.

## Colour

| Name | Hex | Use |
|---|---|---|
| Paper | `#F3EFE9` | Default background (matches the mascot renders) |
| White | `#FFFFFF` | Cards, chips |
| Ink | `#121318` | Text, ink mark |
| Muted | `#6F6E69` | Secondary text, labels |
| Line | `#E2DED4` | Borders |
| Cobalt | `#1B2A6B` | The one accent: second headline line, dots, icon background |
| Deep | `#0B1230` | Darkest lens tone, dark surfaces |
| Sky | `#9DB4FF` | Lens highlight, used sparingly |

One accent only: cobalt. No other colours in posts.

## Type

- **Bricolage Grotesque** 700 for headlines (tracking −0.05em, sentence case), 400 for body.
- **DM Mono** 400/500 for labels, numbers, tickers, URLs (small, uppercase labels at +0.1em tracking).

## The post template

Every post looks the same, so people know it's Tint before they read it:
1. Lockup top-left.
2. Small mono label with a cobalt dot (what this is: "Day 03 · building in public", "Tint agents").
3. Headline in two lines: the plain fact in ink, the twist in cobalt.
4. One sentence under it.
5. Proof on the right: the mascot, a screenshot, a tx table or a number.
6. Footer: `tint.trade · @tinttrade` left, status right.

Best post types (from the reference study): real numbers ("37 private trades so far"), a real tx table with the hidden fields shown as "?", "can you find my trade?" puzzles, short screen recordings of the app.

## Mascot

- Always wearing the shades. The lenses go dark at the top and clear at the bottom, with a rising chart line reflected.
- Matte warm-white body, two stubby feet, no arms, no mouth.
- Lens tint can change to show different agents (light, medium, dark), as in the squad image.
- New poses: generate with `art/mascot.png` as the reference image and the prompt in `art/CREDITS.md`, then log the credits there.

## Words

- Plain and short. Say what it does, not how clever it is.
- Never talk about price, returns or "investment". Agents are never sold as making money.
- Use tickers as text (NVDA, SPY). No company logos, and never Robinhood's logo or look.
- Only claim what works today. Planned things say "coming" or "next".
