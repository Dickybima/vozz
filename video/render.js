/*
 * Renders video/beta-demo.html frame by frame and encodes assets/beta-mining.mp4
 * plus a poster image. Requires Playwright (Chromium) and ffmpeg with libx264.
 *
 *   node video/render.js            # full video
 *   node video/render.js 5 12 20    # only write PNG stills at those seconds (for checking)
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");

const FPS = 30;
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets", "beta-mining.mp4");
const POSTER = path.join(ROOT, "assets", "beta-mining-poster.jpg");
const POSTER_AT = 21.5;

// Serve the repo over HTTP so the logo SVG doesn't taint the canvas (file:// does).
function serve() {
  const types = { ".html": "text/html", ".svg": "image/svg+xml", ".js": "text/javascript" };
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/video/beta-demo.html?capture`);
  await page.evaluate(() => window.ready);

  const grab = (t, type = "image/jpeg") =>
    page.evaluate(([t, type]) => {
      window.renderAt(t);
      return document.getElementById("c").toDataURL(type, 0.95).split(",")[1];
    }, [t, type]);

  const stills = process.argv.slice(2).map(Number);
  if (stills.length) {
    for (const t of stills) {
      const file = path.join(__dirname, `still-${t}.png`);
      fs.writeFileSync(file, Buffer.from(await grab(t, "image/png"), "base64"));
      console.log("wrote", file);
    }
    await browser.close();
    return server.close();
  }

  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", OUT,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  for (let f = 0; f < total; f++) {
    const buf = Buffer.from(await grab(f / FPS), "base64");
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % FPS === 0) process.stdout.write(`\r${f / FPS}s / ${duration}s`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error("ffmpeg exit " + c)) : r())));

  fs.writeFileSync(POSTER, Buffer.from(await grab(POSTER_AT), "base64"));
  console.log(`\nwrote ${OUT}\nwrote ${POSTER}`);
  await browser.close();
  server.close();
})();
