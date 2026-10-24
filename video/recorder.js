/*
 * Shared screen-recording helpers for the VOZZ promo/tutorial videos.
 *
 * record(options, script) serves the repo over HTTP, opens a page in Chromium with an
 * on-screen cursor, caption card and full-screen title card injected, runs `script`
 * with helpers, captures frames through the Chrome DevTools screencast and encodes them
 * to a constant-frame-rate H.264 MP4 (+ JPEG poster) with ffmpeg.
 */
const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const FPS = 30;

// Caption card placement: "side" (left edge, vertically centred) or "bottom" (bottom-left).
const CAPTION_POS = {
  side: "left:28px;top:50%;--y:-50%",
  bottom: "left:28px;bottom:28px;--y:0px",
};

const overlay = (captions) => `
window.addEventListener("DOMContentLoaded", () => {
  const css = document.createElement("style");
  css.textContent = \`
    #__cur{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;transition:transform .02s linear}
    #__cur svg{width:26px;height:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
    .__rip{position:fixed;z-index:2147483645;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #00ffaa;pointer-events:none;animation:__rip .6s ease-out forwards}
    @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #__cap{position:fixed;${CAPTION_POS[captions]};width:300px;z-index:2147483645;transform:translate(-40px,var(--y));opacity:0;transition:all .35s cubic-bezier(.2,1.3,.4,1);
      display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:20px 22px;border-radius:18px;background:rgba(5,9,16,.95);border:1px solid rgba(0,255,170,.45);
      box-shadow:0 0 40px rgba(0,255,170,.25);font-family:Inter,sans-serif;color:#e6f1ff}
    #__cap.on{transform:translate(0,var(--y));opacity:1}
    #__cap b{flex:none;display:grid;place-items:center;min-width:44px;height:44px;padding:0 10px;border-radius:11px;background:linear-gradient(135deg,#00ffaa,#00d4ff);color:#02110b;font:900 18px Orbitron,sans-serif}
    #__cap span{display:block;font:700 22px/1.3 Inter,sans-serif}
    #__cap small{display:block;font:400 15px/1.45 Inter,sans-serif;color:#9fb0c8;margin-top:6px}
    #__card{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;text-align:center;background:radial-gradient(ellipse 60% 50% at 50% 45%,rgba(0,255,170,.12),transparent 70%),#05070d;opacity:0;transition:opacity .5s;pointer-events:none}
    #__card.on{opacity:1}
    #__card img{width:130px;filter:drop-shadow(0 0 30px rgba(0,255,170,.6))}
    #__card h1{font:900 54px Orbitron,sans-serif;color:#e6f1ff;margin:22px 0 10px;letter-spacing:.02em}
    #__card h1 em{font-style:normal;background:linear-gradient(90deg,#00ffaa,#00d4ff);-webkit-background-clip:text;color:transparent}
    #__card p{font:500 21px Inter,sans-serif;color:#b9c7dc;margin:0}
    #__card .k{margin-top:26px;font:600 18px 'JetBrains Mono',monospace;color:#ccff00}\`;
  document.head.append(css);
  const cur = document.createElement("div");
  cur.id = "__cur";
  cur.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.7L21 10.7z" fill="#fff" stroke="#05070d" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  cur.style.transform = "translate(" + (innerWidth - 180) + "px," + (innerHeight - 80) + "px)";
  document.body.append(cur);
  document.addEventListener("mousemove", (e) => (cur.style.transform = \`translate(\${e.clientX - 3}px,\${e.clientY - 2}px)\`), true);
  document.addEventListener("mousedown", (e) => {
    const r = document.createElement("div");
    r.className = "__rip";
    r.style.left = e.clientX + "px";
    r.style.top = e.clientY + "px";
    document.body.append(r);
    setTimeout(() => r.remove(), 700);
  }, true);
  const cap = document.createElement("div");
  cap.id = "__cap";
  document.body.append(cap);
  window.__cap = (n, text, sub) => {
    if (!text) return cap.classList.remove("on");
    cap.innerHTML = (n ? "<b>" + n + "</b>" : "") + "<div><span></span><small></small></div>";
    cap.querySelector("span").textContent = text;
    cap.querySelector("small").textContent = sub || "";
    cap.classList.add("on");
  };
  const card = document.createElement("div");
  card.id = "__card";
  document.body.append(card);
  window.__card = (html) => {
    if (!html) return card.classList.remove("on");
    card.innerHTML = html;
    card.classList.add("on");
  };
});`;

function serve() {
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".webm": "video/webm" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

function encode(frames, { out, poster, posterAt, width, height }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vozz-rec-"));
  const name = (i) => path.join(tmp, `f${String(i).padStart(5, "0")}.jpg`);
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    fs.writeFileSync(name(i), Buffer.from(f.data, "base64"));
    const next = frames[i + 1] ? frames[i + 1].t : f.t + 1 / FPS;
    lines.push(`file '${name(i)}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${name(frames.length - 1)}'`);
  fs.writeFileSync(path.join(tmp, "list.txt"), lines.join("\n"));
  const ff = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
    "-vf", `fps=${FPS},scale=${width}:${height}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", out,
  ], { stdio: "inherit" });
  if (ff.status !== 0) throw new Error("ffmpeg failed");
  if (poster) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(posterAt), "-i", out, "-frames:v", "1", "-q:v", "3", poster], { stdio: "inherit" });
  fs.rmSync(tmp, { recursive: true, force: true });
}

/**
 * @param {object} o
 *   url        page path to open, e.g. "/index.html"
 *   out        output .mp4 path; poster/posterAt optional
 *   width, height  CSS viewport; scale = deviceScaleFactor (output is width*scale × height*scale)
 *   captions   "side" | "bottom"
 *   prepare(ctx, origin)  optional hook before the page opens (routes, init scripts…)
 * @param {(h: object) => Promise<void>} script  receives helpers (see below)
 */
async function record(o, script) {
  const { width, height, scale = 1, captions = "side" } = o;
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
    if (o.prepare) await o.prepare(ctx, origin);
    await ctx.addInitScript(overlay(captions));
    const page = await ctx.newPage();
    await page.goto(origin + o.url);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);

    const frames = [];
    const cdp = await ctx.newCDPSession(page);
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      frames.push({ data, t: metadata.timestamp });
      cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });

    let mx = width - 180, my = height - 80;
    const h = {
      page,
      wait: (ms) => page.waitForTimeout(ms),
      cap: (n, text, sub) => page.evaluate(([n, t, s]) => window.__cap(n, t, s), [n, text, sub]),
      card: (html) => page.evaluate((x) => window.__card(x), html),
      start: () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: width * scale, maxHeight: height * scale, everyNthFrame: 1 }),
      stop: () => cdp.send("Page.stopScreencast"),
      async moveTo(selector, dx = 0, dy = 0) {
        const box = await page.locator(selector).first().boundingBox();
        await h.moveXY(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
      },
      async moveXY(x, y) {
        await page.mouse.move(x, y, { steps: Math.max(12, Math.round(Math.hypot(x - mx, y - my) / 18)) });
        mx = x; my = y;
      },
      async click(selector) {
        await h.moveTo(selector);
        await h.wait(250);
        await page.mouse.down();
        await h.wait(90);
        await page.mouse.up();
      },
      // Drag a range input's thumb to `value`.
      async slide(selector, value, steps = 40) {
        const el = page.locator(selector).first();
        const box = await el.boundingBox();
        const { min, max, cur } = await el.evaluate((e) => ({ min: +e.min, max: +e.max, cur: +e.value }));
        const thumb = 9;
        const xOf = (v) => box.x + thumb + ((box.width - 2 * thumb) * (v - min)) / (max - min);
        const y = box.y + box.height / 2;
        await h.moveXY(xOf(cur), y);
        await h.wait(200);
        await page.mouse.down();
        await page.mouse.move(xOf(value), y, { steps });
        mx = xOf(value);
        await h.wait(120);
        await page.mouse.up();
      },
    };

    await script(h);
    encode(frames, { out: o.out, poster: o.poster, posterAt: o.posterAt ?? 2, width: width * scale, height: height * scale });
    console.log(`${frames.length} frames captured\nwrote ${o.out}${o.poster ? "\nwrote " + o.poster : ""}`);
  } finally {
    await browser.close();
    server.close();
  }
}

module.exports = { record, ROOT };
