/*
 * Renders the VOZZ hype trailer: assets/vozz-trailer.mp4 (1920×1080, 30 fps, with music).
 *
 *   node video/render-trailer.js
 *
 * 1. Cuts the clip frames it needs out of the recorded videos (assets/mining-gameplay.mp4,
 *    assets/how-to-join.mp4) into a temp folder.
 * 2. Synthesizes the soundtrack with video/trailer-music.py.
 * 3. Renders video/trailer.html frame by frame in Chromium and muxes video + audio with ffmpeg.
 *
 * Requires Playwright (Chromium), ffmpeg (libx264 + aac) and python3 with numpy.
 */
const { chromium } = require("playwright");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets", "vozz-trailer.mp4");
const POSTER = path.join(ROOT, "assets", "vozz-trailer-poster.jpg");
const FPS = 30;
const MINING = path.join(ROOT, "assets", "mining-gameplay.mp4");
const JOIN = path.join(ROOT, "assets", "how-to-join.mp4");

// id: [source, start (s), duration (s), crop [x, y, w, h] in source pixels]
const CLIPS = {
  A: [MINING, 11.5, 6.0, [0, 60, 1100, 619]], // rig filling up
  B: [MINING, 18.5, 5.0, [820, 60, 1100, 619]], // overclock sliders + chart
  C: [MINING, 25.0, 4.0, [0, 150, 1100, 619]], // throttling cards
  D: [MINING, 32.0, 3.2, [0, 0, 1564, 880]], // fans up, cooling upgrade
  E: [MINING, 41.0, 4.0, [380, 420, 1138, 640]], // solo → block found (~1.85s in)
  F: [MINING, 49.0, 2.0, [820, 60, 1100, 619]], // missions
  I: [MINING, 58.0, 1.5, [1040, 560, 880, 495]], // leaderboard
  G: [JOIN, 7.0, 9.0, [330, 60, 940, 529]], // waitlist missions
  H: [JOIN, 46.0, 2.0, [290, 140, 880, 495]], // Miner License
};

function serve(tmp) {
  const types = { ".html": "text/html", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".js": "text/javascript" };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const base = p.startsWith("/frames/") ? tmp : ROOT;
    const file = path.join(base, p);
    if (!file.startsWith(base) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vozz-trailer-"));
  try {
    // 1. clip frames
    const clipInfo = {};
    for (const [id, [src, start, dur, crop]] of Object.entries(CLIPS)) {
      const dir = path.join(tmp, "frames", id);
      fs.mkdirSync(dir, { recursive: true });
      const r = spawnSync("ffmpeg", ["-loglevel", "error", "-ss", String(start), "-t", String(dur), "-i", src, "-vf", `fps=${FPS}`, "-q:v", "2", path.join(dir, "%05d.jpg")], { stdio: "inherit" });
      if (r.status !== 0) throw new Error(`frame extraction failed for clip ${id}`);
      clipInfo[id] = { crop, frames: fs.readdirSync(dir).length };
    }

    // 2. music
    const wav = path.join(tmp, "music.wav");
    const py = spawnSync("python3", [path.join(__dirname, "trailer-music.py"), wav], { stdio: "inherit" });
    if (py.status !== 0) throw new Error("music synthesis failed");

    // 3. render
    const server = await serve(tmp);
    const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript((c) => (window.CLIPS = c), clipInfo);
    await page.goto(`http://127.0.0.1:${server.address().port}/video/trailer.html`);
    await page.evaluate(() => window.ready);
    const duration = await page.evaluate(() => window.DURATION);
    const total = Math.round(duration * FPS);

    const ff = spawn("ffmpeg", [
      "-y", "-loglevel", "error",
      "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
      "-i", wav,
      "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", OUT,
    ], { stdio: ["pipe", "inherit", "inherit"] });

    for (let f = 0; f < total; f++) {
      const b64 = await page.evaluate(async (t) => {
        await window.renderAt(t);
        return document.getElementById("c").toDataURL("image/jpeg", 0.93).split(",")[1];
      }, f / FPS);
      const buf = Buffer.from(b64, "base64");
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (f % FPS === 0) process.stdout.write(`\r${f / FPS}s / ${duration.toFixed(1)}s`);
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error("ffmpeg exit " + c)) : r())));
    spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "40", "-i", OUT, "-frames:v", "1", "-q:v", "2", POSTER], { stdio: "inherit" });
    console.log(`\nwrote ${OUT}\nwrote ${POSTER}`);
    await browser.close();
    server.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
