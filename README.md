<p align="center"><img src="assets/logo.svg" alt="VOZZ" width="360"></p>

# VOZZ — GPU Mining Game Waitlist

Waitlist landing page for VOZZ, a GPU-themed mining simulation game, with an animated GPU mining simulation running in the background (canvas).

## Files

- `index.html` — page structure (hero + waitlist form, features, roadmap, FAQ)
- `style.css` — neon/cyberpunk theme, responsive
- `background.js` — canvas mining simulation: a wall of GPUs with spinning fans & RGB lighting, hash rain, *share* particles flying to the block being mined, and a blockchain that slides along every time a block is found
- `app.js` — live stats, beta countdown, waitlist form & "Miner License" ticket
- `assets/logo.svg` — full logo (mark + wordmark)
- `assets/logo-mark.svg` — logo mark only (hex GPU chip with a V and a mined block)
- `favicon.svg` — simplified mark for small sizes

## Running

No build step — open `index.html` in a browser, or:

```bash
python3 -m http.server 8000
```

## Storing waitlist signups

By default signups are only saved in the visitor's browser (`localStorage`). To collect real emails, set `WAITLIST_ENDPOINT` in `app.js` to a URL that accepts a JSON `POST` of `{ email, ref }` (e.g. Formspree, Supabase, or your own API).

The beta date is set via `BETA_DATE` in `app.js`.
