/*
 * Records the "How to join the VOZZ waitlist" tutorial video from the real landing page.
 *
 * Serves the repo over HTTP, drives the actual waitlist flow in Chromium (Join →
 * 4 X missions → paste wallet → Miner License) with an on-screen cursor and captions,
 * captures frames via the Chrome DevTools screencast and encodes assets/how-to-join.mp4
 * plus a poster. X links are stubbed so nothing is posted anywhere.
 *
 *   node video/record-join.js
 *
 * Requires Playwright (Chromium) and ffmpeg with libx264.
 */
const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "assets", "how-to-join.mp4");
const POSTER = path.join(ROOT, "assets", "how-to-join-poster.jpg");
const W = 1280, H = 720, FPS = 30;
const DEMO_WALLET = "0x7A3f9c2B41d8E06a5F3c7b9D2e1A4c8B6f0D1c9E";

// Cursor, captions and title cards drawn inside the page so the screencast picks them up.
const OVERLAY = `
window.addEventListener("DOMContentLoaded", () => {
  const css = document.createElement("style");
  css.textContent = \`
    #__cur{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;transition:transform .02s linear}
    #__cur svg{width:26px;height:26px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.6))}
    .__rip{position:fixed;z-index:2147483645;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #00ffaa;pointer-events:none;animation:__rip .6s ease-out forwards}
    @keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #__cap{position:fixed;left:28px;top:50%;width:300px;z-index:2147483645;transform:translate(-40px,-50%);opacity:0;transition:all .35s cubic-bezier(.2,1.3,.4,1);
      display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:20px 22px;border-radius:18px;background:rgba(5,9,16,.95);border:1px solid rgba(0,255,170,.45);
      box-shadow:0 0 40px rgba(0,255,170,.25);font-family:Inter,sans-serif;color:#e6f1ff}
    #__cap.on{transform:translate(0,-50%);opacity:1}
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
  cur.style.transform = "translate(1100px,640px)";
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
    cap.innerHTML = (n ? "<b>STEP " + n + "</b>" : "") + "<div><span></span><small></small></div>";
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

(async () => {
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await ctx.grantPermissions(["clipboard-write"], { origin });
  await ctx.route(/x\.com/, (r) => r.fulfill({ contentType: "text/html", body: "<title>X</title>" }));
  ctx.on("page", (p) => p.url() !== "about:blank" && setTimeout(() => p.close().catch(() => {}), 400));
  await ctx.addInitScript(OVERLAY);

  const page = await ctx.newPage();
  await page.goto(origin + "/index.html");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(800);

  // --- screencast capture ---
  const frames = [];
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });

  const wait = (ms) => page.waitForTimeout(ms);
  const cap = (n, text, sub) => page.evaluate(([n, t, s]) => window.__cap(n, t, s), [n, text, sub]);
  const card = (html) => page.evaluate((h) => window.__card(h), html);
  let mx = 1100, my = 640;
  async function moveTo(selector, dy = 0) {
    const box = await page.locator(selector).first().boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2 + dy;
    await page.mouse.move(x, y, { steps: Math.max(12, Math.round(Math.hypot(x - mx, y - my) / 18)) });
    mx = x; my = y;
  }
  async function click(selector) {
    await moveTo(selector);
    await wait(250);
    await page.mouse.down();
    await wait(90);
    await page.mouse.up();
  }

  await card(`<div><img src="/assets/logo-mark.svg"><h1>HOW TO JOIN THE<br><em>VOZZ WAITLIST</em></h1><p>4 quick missions + your Robinhood Chain wallet</p><p class="k">vozz · Robinhood Chain</p></div>`);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await wait(3200);
  await card("");
  await wait(900);

  await cap(1, "Click “Join Waitlist”", "On the VOZZ homepage");
  await wait(1200);
  await click("#join-btn");
  await wait(1600);

  const missions = [
    ["Follow @vozzGPU on X", "Opens X in a new tab — follow, then come back"],
    ["Like the post", "Like the VOZZ announcement on X"],
    ["Repost the post", "Share it with your followers"],
    ["Comment on the post", "Reply and tag a fellow miner"],
  ];
  for (let i = 0; i < missions.length; i++) {
    await cap(i + 2, `Mission ${i + 1}: ${missions[i][0]}`, missions[i][1]);
    await wait(900);
    await click(`.task:nth-child(${i + 1}) .task-btn`);
    await page.bringToFront();
    await moveTo(`.task:nth-child(${i + 1}) .task-title`);
    await page.waitForSelector(`.task:nth-child(${i + 1}).done`, { timeout: 15000 });
    await wait(700);
  }

  await cap(6, "Paste your Robinhood Chain wallet address", "Any EVM address (0x…) — or use Connect wallet");
  // Stand in for the viewer's clipboard (headless Chromium has no real one).
  await page.evaluate((a) => { navigator.clipboard.readText = async () => a; }, DEMO_WALLET);
  await page.evaluate(() => document.getElementById("address-submit").scrollIntoView({ block: "end", behavior: "smooth" }));
  await wait(1400);
  await click("#paste-btn");
  await wait(1300);

  await cap(7, "Submit your address", "That's it — no fee to join the waitlist");
  await wait(900);
  await click("#address-submit");
  await page.waitForSelector("#waitlist-modal", { state: "hidden", timeout: 15000 });
  await wait(600);
  await page.evaluate(() => document.getElementById("ticket").scrollIntoView({ block: "center", behavior: "smooth" }));
  await wait(900);

  await cap(8, "Your Miner License is ready!", "Queue position, starter GPU and +500 VOZZ bonus");
  await moveTo(".ticket-head");
  await wait(2600);
  await cap(9, "Copy your referral link", "Invite friends to move the community up");
  await click("#share-btn");
  await wait(2400);
  await cap(null, "");
  await wait(400);

  await card(`<div><img src="/assets/logo-mark.svg"><h1>YOU'RE ON THE <em>LIST</em> ⛏</h1><p>Follow us for the closed beta announcement</p><p class="k">x.com/vozzGPU</p></div>`);
  await wait(3600);
  await cdp.send("Page.stopScreencast");

  // --- encode: variable-timestamp frames -> constant 30fps H.264 ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vozz-join-"));
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const file = path.join(tmp, `f${String(i).padStart(5, "0")}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    const next = frames[i + 1] ? frames[i + 1].t : f.t + 1 / FPS;
    lines.push(`file '${file}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file '${path.join(tmp, `f${String(frames.length - 1).padStart(5, "0")}.jpg`)}'`);
  fs.writeFileSync(path.join(tmp, "list.txt"), lines.join("\n"));
  const ff = spawnSync("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(tmp, "list.txt"),
    "-vf", `fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-movflags", "+faststart", OUT,
  ], { stdio: "inherit" });
  if (ff.status !== 0) throw new Error("ffmpeg failed");
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2", "-i", OUT, "-frames:v", "1", "-q:v", "3", POSTER], { stdio: "inherit" });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${frames.length} frames captured\nwrote ${OUT}\nwrote ${POSTER}`);

  await browser.close();
  server.close();
})();
