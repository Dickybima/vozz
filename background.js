/*
 * VOZZ — animated GPU mining simulation used as the page background.
 *
 * Layers (back to front):
 *   1. Hash rain   — falling hex characters on an offscreen canvas with fading trails
 *   2. GPU wall    — a tiled grid of graphics cards with spinning fans, RGB strips and live load/temp
 *   3. Shares      — glowing packets that fly from each GPU to the block currently being mined
 *   4. Blockchain  — a lane of blocks along the bottom; when a block fills up it is "found"
 *
 * Exposes `window.miningSim` (hashrate / blocks) and dispatches a `block-found` event on window.
 */
(() => {
  const canvas = document.getElementById("mining-bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const rain = document.createElement("canvas");
  const rctx = rain.getContext("2d");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SPEED = reduceMotion ? 0.25 : 1;

  const COLORS = {
    green: "#00ffaa",
    cyan: "#00d4ff",
    magenta: "#ff2bd6",
    amber: "#ffb020",
    red: "#ff3b5c",
  };
  const MODELS = ["VX 9070", "VX 8080 Ti", "RZ 7900", "VX 6090", "RZ 6800 XT", "VX 5070"];
  const HEX = "0123456789abcdef";

  let W = 0, H = 0, DPR = 1;
  let gpus = [];
  let shares = [];
  let chain = [];
  let rainCols = [];
  let current = null;       // the block currently being mined
  let blocksFound = 0;
  let laneY = 0, blockSize = 0, blockGap = 0;
  let mouseX = 0.5, mouseY = 0.5, parX = 0, parY = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const randHex = (n) => {
    let s = "";
    for (let i = 0; i < n; i++) s += HEX[(Math.random() * 16) | 0];
    return s;
  };

  /* ---------------- Setup ---------------- */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    for (const c of [canvas, rain]) {
      c.width = Math.floor(W * DPR);
      c.height = Math.floor(H * DPR);
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    rctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    buildRain();
    buildGpus();
    buildChain();
  }

  function buildRain() {
    const step = 18;
    rainCols = [];
    for (let x = 0; x < W; x += step) {
      rainCols.push({ x, y: rand(-H, 0), speed: rand(40, 140), next: 0 });
    }
    rctx.fillStyle = "#05070d";
    rctx.fillRect(0, 0, W, H);
  }

  function buildGpus() {
    const cardW = W < 640 ? 132 : 176;
    const cardH = cardW * 0.5;
    const gapX = cardW * 0.22;
    const gapY = cardH * 0.55;
    const cols = Math.ceil((W + gapX) / (cardW + gapX)) + 1;
    const rows = Math.ceil((H * 0.85) / (cardH + gapY)) + 1;
    const offsetX = (W - (cols * (cardW + gapX) - gapX)) / 2;

    const old = gpus;
    gpus = [];
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const prev = old[i];
        const fanCount = Math.random() < 0.35 ? 2 : 3;
        gpus.push({
          x: offsetX + c * (cardW + gapX) + (r % 2 ? (cardW + gapX) / 2 : 0) - (cardW + gapX) / 4,
          y: 30 + r * (cardH + gapY),
          w: cardW,
          h: cardH,
          depth: 0.4 + (r % 3) * 0.3,
          model: prev ? prev.model : MODELS[(Math.random() * MODELS.length) | 0],
          fans: prev && prev.fans.length === fanCount ? prev.fans : Array.from({ length: fanCount }, () => rand(0, Math.PI * 2)),
          baseRate: prev ? prev.baseRate : rand(58, 132),
          load: prev ? prev.load : rand(0.7, 1),
          temp: prev ? prev.temp : rand(55, 72),
          hue: prev ? prev.hue : rand(0, 360),
          shareTimer: rand(0, 2),
          overheat: 0,
          flash: 0,
        });
        i++;
      }
    }
  }

  function buildChain() {
    blockSize = W < 640 ? 38 : 50;
    blockGap = blockSize * 0.55;
    laneY = H - blockSize - 26;
    const keep = chain.slice(-30);
    chain = [];
    // Pre-fill the lane with already-mined blocks to the left of the current one.
    const headX = W - blockSize * 2.2;
    const count = Math.ceil(headX / (blockSize + blockGap)) + 1;
    for (let k = 0; k < count; k++) {
      const src = keep[keep.length - 1 - k];
      chain.unshift({
        x: headX - (k + 1) * (blockSize + blockGap),
        height: src ? src.height : 812400 - k,
        hash: src ? src.hash : "0000" + randHex(4),
        glow: 0,
      });
    }
    if (!current) newCurrentBlock();
    current.x = headX;
  }

  function newCurrentBlock() {
    const last = chain[chain.length - 1];
    current = {
      x: W - blockSize * 2.2,
      height: last ? last.height + 1 : 812401,
      progress: 0,
      need: 26 + ((Math.random() * 18) | 0), // shares needed to "find" the block
      nonce: 0,
    };
  }

  /* ---------------- Simulation ---------------- */

  function update(dt) {
    // Parallax eases toward the mouse.
    parX += ((mouseX - 0.5) * 18 - parX) * Math.min(1, dt * 3);
    parY += ((mouseY - 0.5) * 12 - parY) * Math.min(1, dt * 3);

    let totalRate = 0;
    for (const g of gpus) {
      // Load and temperature wander; occasional thermal spike.
      g.load += (rand(0.72, 1) - g.load) * dt * 0.4;
      const targetTemp = 52 + g.load * 24 + (g.overheat > 0 ? 18 : 0);
      g.temp += (targetTemp - g.temp) * dt * 0.6;
      if (g.overheat > 0) g.overheat -= dt;
      else if (Math.random() < dt * 0.004) g.overheat = rand(2, 4);

      const fanSpeed = (6 + (g.temp - 50) * 0.55) * SPEED;
      for (let f = 0; f < g.fans.length; f++) g.fans[f] += fanSpeed * dt * (f % 2 ? 1 : 1.07);

      g.hue = (g.hue + dt * 40) % 360;
      g.flash = Math.max(0, g.flash - dt * 3);

      const rate = g.baseRate * g.load * (g.overheat > 0 ? 0.55 : 1);
      totalRate += rate;

      // Emit shares proportional to hashrate.
      g.shareTimer -= dt * SPEED * (rate / 90);
      if (g.shareTimer <= 0) {
        g.shareTimer = rand(1.4, 3.6);
        g.flash = 1;
        spawnShare(g);
      }
    }

    // Shares travel along a quadratic curve toward the current block.
    const tx = current.x + blockSize / 2;
    const ty = laneY + blockSize / 2;
    for (let i = shares.length - 1; i >= 0; i--) {
      const s = shares[i];
      s.t += (dt * SPEED) / s.dur;
      if (s.t >= 1) {
        shares.splice(i, 1);
        current.progress++;
        if (current.progress >= current.need) blockFound();
        continue;
      }
      s.tx = tx;
      s.ty = ty;
    }

    current.nonce = (current.nonce + ((dt * 1e6) | 0)) >>> 0;

    // Chain slides left whenever a new block was appended.
    const headX = W - blockSize * 2.2;
    for (let k = chain.length - 1, x = headX - (blockSize + blockGap); k >= 0; k--, x -= blockSize + blockGap) {
      const b = chain[k];
      b.x += (x - b.x) * Math.min(1, dt * 4 * SPEED + 0.02);
      b.glow = Math.max(0, b.glow - dt * 0.6);
    }
    while (chain.length && chain[0].x < -blockSize * 3) chain.shift();

    // Rain
    for (const c of rainCols) {
      c.y += c.speed * dt * SPEED;
      if (c.y > H + 40) {
        c.y = rand(-200, 0);
        c.speed = rand(40, 140);
      }
    }

    window.miningSim.hashrate = totalRate * 1e6 * 1400; // scale the visible rigs up to a "network"
  }

  function spawnShare(g) {
    const sx = g.x + parX * g.depth + g.w / 2;
    const sy = g.y + parY * g.depth + g.h / 2;
    shares.push({
      sx,
      sy,
      cx: (sx + current.x) / 2 + rand(-W * 0.15, W * 0.15),
      cy: Math.min(sy, laneY) - rand(40, 160),
      tx: current.x,
      ty: laneY,
      t: 0,
      dur: rand(1.4, 2.8),
      color: Math.random() < 0.5 ? COLORS.green : COLORS.cyan,
    });
    if (shares.length > 260) shares.shift();
  }

  function blockFound() {
    blocksFound++;
    const hash = "0000" + randHex(4);
    chain.push({ x: current.x, height: current.height, hash, glow: 1 });
    window.miningSim.blocks = blocksFound;
    window.miningSim.lastHash = "0x0000" + randHex(12);
    window.dispatchEvent(new CustomEvent("block-found", { detail: { height: current.height, hash } }));
    pulses.push({ x: current.x + blockSize / 2, y: laneY + blockSize / 2, r: 0, a: 1 });
    newCurrentBlock();
  }

  const pulses = [];

  /* ---------------- Rendering ---------------- */

  function drawRain() {
    rctx.fillStyle = "rgba(5, 7, 13, 0.12)";
    rctx.fillRect(0, 0, W, H);
    rctx.font = "13px 'JetBrains Mono', monospace";
    rctx.textBaseline = "top";
    for (const c of rainCols) {
      rctx.fillStyle = Math.random() < 0.03 ? "rgba(180,255,230,0.55)" : "rgba(0,255,170,0.22)";
      rctx.fillText(HEX[(Math.random() * 16) | 0], c.x, c.y);
    }
    ctx.drawImage(rain, 0, 0, W, H);
  }

  function drawGrid() {
    ctx.strokeStyle = "rgba(0, 255, 170, 0.035)";
    ctx.lineWidth = 1;
    const s = 48;
    const ox = (parX * 0.3) % s;
    const oy = (parY * 0.3) % s;
    ctx.beginPath();
    for (let x = ox; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function drawFan(cx, cy, r, angle, hot) {
    // Housing
    ctx.fillStyle = "#070b12";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hot ? "rgba(255,59,92,0.5)" : "rgba(120,140,170,0.25)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Blades
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = hot ? "rgba(255,120,140,0.35)" : "rgba(150,175,205,0.28)";
    const blades = 7;
    for (let b = 0; b < blades; b++) {
      ctx.rotate((Math.PI * 2) / blades);
      ctx.beginPath();
      ctx.moveTo(r * 0.2, 0);
      ctx.quadraticCurveTo(r * 0.55, -r * 0.42, r * 0.92, -r * 0.12);
      ctx.quadraticCurveTo(r * 0.6, r * 0.05, r * 0.2, 0);
      ctx.fill();
    }
    ctx.restore();

    // Motion blur ring + hub
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = r * 0.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#121a26";
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawGpu(g) {
    const x = g.x + parX * g.depth;
    const y = g.y + parY * g.depth;
    const { w, h } = g;
    const hot = g.overheat > 0;
    const accent = hot ? COLORS.red : `hsl(${g.hue}, 100%, 60%)`;

    ctx.globalAlpha = 0.45 + g.depth * 0.35;

    // Glow under card when it submits a share
    if (g.flash > 0 || hot) {
      ctx.shadowColor = hot ? COLORS.red : COLORS.green;
      ctx.shadowBlur = hot ? 24 : 18 * g.flash;
    }

    // Shroud
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, "#1a2333");
    grad.addColorStop(1, "#0b111b");
    ctx.fillStyle = grad;
    roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // PCIe bracket + connector
    ctx.fillStyle = "#2a3446";
    ctx.fillRect(x - 5, y + 4, 5, h - 8);
    ctx.fillStyle = "#a88a2a";
    ctx.fillRect(x + w * 0.18, y + h, w * 0.42, 4);

    // RGB strip
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10;
    ctx.fillRect(x + 8, y + 4, w - 16, 2.5);
    ctx.shadowBlur = 0;

    // Fans
    const n = g.fans.length;
    const fanArea = w - 16;
    const r = Math.min(h * 0.33, fanArea / n / 2 - 3);
    for (let f = 0; f < n; f++) {
      const cx = x + 8 + fanArea * ((f + 0.5) / n);
      drawFan(cx, y + h * 0.5, r, g.fans[f], hot);
    }

    // Labels: model + live hashrate / temp
    ctx.font = `600 ${Math.max(8, w * 0.052)}px 'JetBrains Mono', monospace`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(200,215,235,0.55)";
    ctx.fillText(g.model, x + 8, y + h - 5);
    const rate = (g.baseRate * g.load * (hot ? 0.55 : 1)).toFixed(1) + " MH/s";
    ctx.fillStyle = hot ? COLORS.red : "rgba(0,255,170,0.75)";
    const tw = ctx.measureText(rate).width;
    ctx.fillText(rate, x + w - 8 - tw, y + h - 5);

    // Temperature bar on the right edge
    const t = Math.min(1, (g.temp - 40) / 50);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x + w - 6, y + 10, 3, h - 24);
    ctx.fillStyle = t > 0.75 ? COLORS.red : t > 0.55 ? COLORS.amber : COLORS.green;
    ctx.fillRect(x + w - 6, y + 10 + (h - 24) * (1 - t), 3, (h - 24) * t);

    ctx.globalAlpha = 1;
  }

  function drawShares() {
    ctx.globalCompositeOperation = "lighter";
    for (const s of shares) {
      const t = s.t, it = 1 - t;
      const px = it * it * s.sx + 2 * it * t * s.cx + t * t * s.tx;
      const py = it * it * s.sy + 2 * it * t * s.cy + t * t * s.ty;
      // short trail
      const t2 = Math.max(0, t - 0.06), it2 = 1 - t2;
      const qx = it2 * it2 * s.sx + 2 * it2 * t2 * s.cx + t2 * t2 * s.tx;
      const qy = it2 * it2 * s.sy + 2 * it2 * t2 * s.cy + t2 * t2 * s.ty;

      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(px, py);
      ctx.stroke();

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBlock(x, y, label, sub, fill, glow) {
    const s = blockSize;
    // 3D cube faces
    const d = s * 0.18;
    ctx.fillStyle = "rgba(0,255,170,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + d, y - d);
    ctx.lineTo(x + s + d, y - d);
    ctx.lineTo(x + s, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(0,255,170,0.05)";
    ctx.beginPath();
    ctx.moveTo(x + s, y);
    ctx.lineTo(x + s + d, y - d);
    ctx.lineTo(x + s + d, y + s - d);
    ctx.lineTo(x + s, y + s);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(8,14,24,0.92)";
    ctx.fillRect(x, y, s, s);
    if (fill > 0) {
      ctx.fillStyle = "rgba(0,255,170,0.22)";
      ctx.fillRect(x, y + s * (1 - fill), s, s * fill);
    }
    if (glow > 0) {
      ctx.shadowColor = COLORS.green;
      ctx.shadowBlur = 30 * glow;
    }
    ctx.strokeStyle = glow > 0 ? `rgba(0,255,170,${0.5 + glow * 0.5})` : "rgba(0,255,170,0.45)";
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x, y, s, s);
    ctx.shadowBlur = 0;

    ctx.font = `600 ${s * 0.2}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(220,240,255,0.85)";
    ctx.textAlign = "center";
    ctx.fillText(label, x + s / 2, y + s * 0.45);
    ctx.font = `${s * 0.17}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(0,255,170,0.7)";
    ctx.fillText(sub, x + s / 2, y + s * 0.75);
    ctx.textAlign = "left";
  }

  function drawChain(dt) {
    // Lane backdrop
    const g = ctx.createLinearGradient(0, laneY - 40, 0, H);
    g.addColorStop(0, "rgba(5,7,13,0)");
    g.addColorStop(0.4, "rgba(5,7,13,0.85)");
    g.addColorStop(1, "rgba(5,7,13,0.95)");
    ctx.fillStyle = g;
    ctx.fillRect(0, laneY - 40, W, H - laneY + 40);

    const midY = laneY + blockSize / 2;

    // Links between blocks
    ctx.strokeStyle = "rgba(0,255,170,0.35)";
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -performance.now() / 60;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const first = chain[0] ? chain[0].x : current.x;
    ctx.moveTo(first, midY);
    ctx.lineTo(current.x, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    for (const b of chain) {
      if (b.x > W + blockSize || b.x < -blockSize * 2) continue;
      drawBlock(b.x, laneY, "#" + (b.height % 100000), b.hash, 1, b.glow);
    }

    // Current block: being mined, fills up as shares arrive, pulsing outline.
    const pct = current.progress / current.need;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    drawBlock(current.x, laneY, "#" + (current.height % 100000), (pct * 100).toFixed(0) + "%", pct, pulse * 0.6);

    ctx.font = `${Math.max(9, blockSize * 0.2)}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(0,255,170,0.55)";
    ctx.textAlign = "center";
    ctx.fillText("MINING", current.x + blockSize / 2, laneY - blockSize * 0.32);
    ctx.fillStyle = "rgba(140,160,190,0.5)";
    ctx.fillText("nonce " + current.nonce.toString(16).padStart(8, "0"), current.x + blockSize / 2, laneY + blockSize + 16);
    ctx.textAlign = "left";

    // "Block found" shockwaves
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.r += dt * 260 * SPEED;
      p.a -= dt * 0.9 * SPEED;
      if (p.a <= 0) { pulses.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(0,255,170,${p.a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `700 ${blockSize * 0.28}px Orbitron, sans-serif`;
      ctx.fillStyle = `rgba(0,255,170,${p.a})`;
      ctx.textAlign = "center";
      ctx.fillText("BLOCK FOUND", p.x - blockSize, laneY - blockSize * 0.75 - (1 - p.a) * 30);
      ctx.textAlign = "left";
    }
  }

  /* ---------------- Loop ---------------- */

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    update(dt);

    ctx.clearRect(0, 0, W, H);
    drawRain();
    drawGrid();
    for (const g of gpus) drawGpu(g);
    drawShares();
    drawChain(dt);

    requestAnimationFrame(frame);
  }

  window.miningSim = { hashrate: 0, blocks: 0, lastHash: "0x0000000000000000" };

  window.addEventListener("resize", () => {
    clearTimeout(resize._t);
    resize._t = setTimeout(resize, 120);
  });
  window.addEventListener("pointermove", (e) => {
    mouseX = e.clientX / W;
    mouseY = e.clientY / H;
  });

  resize();
  requestAnimationFrame(frame);
})();
