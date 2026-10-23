# VOZZ — GPU Mining Game Waitlist

Landing page waitlist untuk VOZZ, game simulasi mining bertema GPU, dengan background simulasi mining GPU yang bergerak (canvas).

## Isi

- `index.html` — struktur halaman (hero + form waitlist, fitur, roadmap, FAQ)
- `style.css` — tema neon/cyberpunk, responsif
- `background.js` — simulasi mining di canvas: dinding GPU dengan kipas berputar & lampu RGB, hash rain, partikel *share* yang terbang ke blok, dan blockchain yang bergeser tiap kali blok ditemukan
- `app.js` — statistik live, countdown beta, form waitlist & tiket "Miner License"

## Menjalankan

Tanpa build step — buka `index.html` di browser, atau:

```bash
python3 -m http.server 8000
```

## Menyimpan data waitlist

Secara default pendaftaran hanya disimpan di `localStorage` browser. Untuk mengumpulkan email sungguhan, isi `WAITLIST_ENDPOINT` di `app.js` dengan URL yang menerima `POST` JSON `{ email, ref }` (mis. Formspree, Supabase, atau API sendiri).

Tanggal beta diatur lewat `BETA_DATE` di `app.js`.
