<p align="center"><img src="assets/logo.svg" alt="VOZZ" width="360"></p>

# VOZZ — GPU Mining Game Waitlist

Waitlist landing page for VOZZ, a GPU-themed mining simulation game built on **Robinhood Chain**, with an animated GPU mining simulation running in the background (canvas).

## Files

- `index.html` — page structure (hero + waitlist form, features, roadmap, FAQ)
- `style.css` — neon/cyberpunk theme, responsive
- `background.js` — canvas mining simulation: a wall of GPUs with spinning fans & RGB lighting, hash rain, *share* particles flying to the block being mined, and a blockchain that slides along every time a block is found
- `app.js` — live stats, beta countdown, waitlist form & "Miner License" ticket
- `assets/logo.svg` — full logo (mark + wordmark)
- `assets/logo-mark.svg` — logo mark only (hex GPU chip with a V and a mined block)
- `favicon.svg` — simplified mark for small sizes
- `assets/brand/` — logo exports: SVG + PNG mark (512/1024, transparent), full logo (transparent and on dark), 1000×1000 avatar and 1500×500 X banner
- `assets/beta-mining.mp4` / `.webm` + `beta-mining-poster.jpg` — 38s "Beta Mining Gameplay" video, opened from the **Beta Gameplay** item in the top menu
- `video/beta-demo.html` — source of that video (a scripted canvas mock of the beta UI; open it in a browser to preview in real time)
- `video/render.js` — renders the video frame by frame and encodes it
- `play/` — the playable beta game (`index.html`, `game.css`, `game.js`)

## Playable beta (`play/`)

`play/index.html` is a playable closed-beta prototype, linked from **Play Beta** in the nav and the hero. It's an idle GPU-mining game:

- **Rig:** buy GPUs (6 models) into slots; sell for 50% back. Each card shows live hashrate, temperature, wattage and spinning fans.
- **Overclock:** core / memory / power limit / fan sliders trade hashrate against heat and power bill. Cards throttle at 88°C and crash for 8s at 100°C.
- **Upgrades:** rig slots (4 → 12), PSU wattage (cards beyond PSU capacity get no power), cooling.
- **Mining:** the simulated network finds a block about every 10s (50 VOZZ reward). Pool mining (NEON-FORGE steady, HashLords variable) pays your share of every block; solo mining wins whole blocks by chance. Network hashrate and difficulty grow over time.
- **Missions** with VOZZ rewards, a leaderboard against simulated miners, an event log and a Robinhood Chain block lane (simulated).
- Progress autosaves to `localStorage`; offline earnings are credited at 50% for up to 2 hours. A wallet linked through the waitlist shows in the top bar.

Nothing in the beta is on-chain yet. Balancing constants are at the top of `play/game.js`.

## Running

No build step — open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
```

## Re-rendering the beta video

Requires Node with Playwright and ffmpeg (libx264 + libvpx-vp9):

```bash
node video/render.js            # writes assets/beta-mining.mp4 + poster
ffmpeg -i assets/beta-mining.mp4 -c:v libvpx-vp9 -crf 36 -b:v 0 assets/beta-mining.webm
node video/render.js 6 16 22    # just save PNG stills at those seconds
```

## Waitlist flow

Clicking **Join Waitlist** opens a modal with 4 missions that unlock in order:

1. Follow on X
2. Like the post
3. Repost the post
4. Comment on the post

Each mission button opens the matching X intent link in a new tab, then marks the mission done after a short "verifying" delay. X actions can't be verified from the browser alone, so this only confirms that the link was opened. Once all 4 are done, the Robinhood Chain wallet address step appears, with a **Paste** button. Only EVM addresses (`0x` + 40 hex characters) are accepted. There is also an optional **Connect wallet & add Robinhood Chain** button that reads the address from an injected wallet (e.g. MetaMask) and switches it to — or adds — Robinhood Chain.

Set the X account and post in `app.js`:

```js
const X_HANDLE = "vozzGPU";
const X_POST_ID = "2113652208571228400";
```

## Robinhood Chain

Network settings live in the `CHAIN` constant in `app.js` (mainnet, chain ID 4663 / `0x1237`, gas in ETH, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`). Check them against [docs.robinhood.com/chain](https://docs.robinhood.com/chain) before launch; for the testnet use chain ID 46630 and `https://rpc.testnet.chain.robinhood.com`.

## Storing waitlist signups

By default signups are only saved in the visitor's browser (`localStorage`). To collect real signups, set `WAITLIST_ENDPOINT` in `app.js` to a URL that accepts a JSON `POST` of `{ wallet, chainId, ref, tasks }` (e.g. Formspree, Supabase, or your own API).

The beta date is set via `BETA_DATE` in `app.js`.
