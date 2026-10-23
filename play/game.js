/*
 * VOZZ — playable closed-beta prototype.
 *
 * An idle GPU-mining game: buy GPUs into a rig, tune clocks/power/fans, keep temps
 * under control, and earn VOZZ from a simulated network that finds a block about every
 * 10 seconds. Mine in a pool (steady share of every block) or solo (win whole blocks).
 *
 * Mining is gated: the player connects a wallet (wallet.js) and must hold a VOZZ Mining
 * Pass NFT on Robinhood Chain (contracts/). The game itself still runs client-side;
 * progress is saved per wallet in localStorage and VOZZ rewards are not on-chain yet.
 */
(() => {
  /* ---------- Config ---------- */
  const SAVE_KEY = "vozz-beta-save";
  const WAITLIST_KEY = "vozz-waitlist";
  const START_BALANCE = 10;
  const BLOCK_REWARD = 50; // VOZZ
  const BLOCK_TIME = 10; // seconds, average
  const BASE_NET = 3000; // MH/s of everyone else at the start
  const NET_GROWTH = 1.004; // network grows a little every block (difficulty)
  const NET_CAP = BASE_NET * 40;
  const ELEC = 0.0001; // VOZZ per watt per second
  const AMBIENT = 27; // °C
  const THROTTLE_AT = 88;
  const CRASH_AT = 100;
  const CRASH_SECS = 8;
  const OFFLINE_CAP = 2 * 3600;
  const OFFLINE_RATE = 0.5;

  const MODELS = [
    { id: "vx3050", name: "VX 3050", hash: 22, watt: 90, heat: 30, price: 8 },
    { id: "vx5070", name: "VX 5070", hash: 60, watt: 150, heat: 38, price: 24 },
    { id: "rz6800", name: "RZ 6800 XT", hash: 95, watt: 210, heat: 42, price: 70 },
    { id: "rz7900", name: "RZ 7900", hash: 140, watt: 260, heat: 46, price: 180 },
    { id: "vx8080", name: "VX 8080 Ti", hash: 210, watt: 320, heat: 50, price: 460 },
    { id: "vx9070", name: "VX 9070", hash: 300, watt: 360, heat: 52, price: 1150 },
  ];
  const MODEL = Object.fromEntries(MODELS.map((m) => [m.id, m]));
  const PRICE_STEP = 1.12; // each extra copy of a model costs 12% more

  const PSU = [650, 1000, 1300, 1600, 2000, 2600, 3200];
  const PSU_COST = [40, 120, 350, 900, 2200, 5000];
  const SLOT_LEVELS = [4, 6, 8, 10, 12];
  const SLOT_COST = [30, 110, 380, 1200];
  const COOL_COST = [25, 90, 300, 900, 2600];

  const POOLS = [
    { id: "neon", name: "NEON-FORGE", fee: 0.02, desc: "PPS · steady payout every block · 2% fee" },
    { id: "hash", name: "HashLords", fee: 0.01, variance: 0.4, desc: "PPLNS · 1% fee · payouts swing ±40%" },
    { id: "solo", name: "Solo mining", fee: 0, solo: true, desc: "No fee · win the full 50 VOZZ block — or nothing" },
  ];
  const OTHER_FINDERS = ["NEON-FORGE", "HashLords", "Silicon Cartel", "Block Party", "0xd4e…91a", "0x7bc…02f", "Kilowatt Kids"];

  const BOTS = [
    ["Silicon Cartel", 3800, 2.6], ["satoshi_jr", 2400, 1.9], ["GPUGoblin", 1500, 1.4], ["HashLords#7", 900, 1.0],
    ["0x7bc…02f", 420, 0.6], ["ThermalPaste", 160, 0.35], ["Kilowatt Kids", 60, 0.2], ["newminer42", 12, 0.06],
  ];

  const MISSIONS = [
    { id: "gpu2", text: "Own 2 GPUs", reward: 5, done: () => S.gpus.length >= 2 },
    { id: "oc", text: "Overclock the core to +100 MHz", reward: 8, done: () => S.oc.core >= 100 },
    { id: "h300", text: "Reach 300 MH/s", reward: 20, done: () => live.hash >= 300 },
    { id: "slots", text: "Expand your rig to 6 slots", reward: 15, done: () => S.slotLvl >= 1 },
    { id: "cool", text: "Buy a cooling upgrade", reward: 15, done: () => S.coolLvl >= 1 },
    { id: "solo", text: "Find a block solo", reward: 50, done: () => S.stats.soloBlocks >= 1 },
    { id: "h1g", text: "Reach 1 GH/s", reward: 120, done: () => live.hash >= 1000 },
    { id: "full8", text: "Run 8 GPUs at once", reward: 150, done: () => live.running >= 8 },
    { id: "top", text: "Own a VX 9070", reward: 300, done: () => S.gpus.some((g) => g.model === "vx9070") },
    { id: "lead", text: "Reach #1 on the leaderboard", reward: 500, done: () => rankOf() === 1 },
  ];

  /* ---------- Helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmtVZ = (v) => (v >= 10000 ? Math.floor(v).toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtHash = (mh) => (mh >= 1000 ? (mh / 1000).toFixed(2) + " GH/s" : mh.toFixed(1) + " MH/s");
  const short = (a) => (a && a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a || "");
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------- State ---------- */
  let S; // saved state
  const live = { hash: 0, watts: 0, running: 0, income: 0, bill: 0, hottest: 0, overload: false };
  const R = {}; // per-GPU runtime: { temp, crashUntil, flash }
  let net = { nextIn: BLOCK_TIME, total: BLOCK_TIME };
  const chain = []; // recent blocks for the lane
  const hist = [];
  let now = 0; // seconds since page load (sim clock)
  let account = null; // connected wallet that passed the Mining Pass check
  let unlocked = false; // simulation runs only while unlocked

  function newState() {
    const wl = readWaitlist();
    const starter = (wl && MODELS.find((m) => m.name === wl.gpu)) || MODEL.vx5070;
    return {
      v: 1,
      balance: START_BALANCE,
      totalMined: 0,
      gpus: [{ id: uid(), model: starter.id, paid: starter.price }],
      slotLvl: 0,
      psuLvl: 0,
      coolLvl: 0,
      oc: { core: 0, mem: 0, pl: 100, fan: 60 },
      pool: "neon",
      height: 812440,
      netBase: BASE_NET,
      claimed: {},
      stats: { soloBlocks: 0, payouts: 0 },
      bots: BOTS.map(([name, total, rate]) => ({ name, total, rate })),
      lastSave: Date.now(),
      lastRate: 0,
      seenWelcome: false,
      starter: starter.name,
    };
  }

  function readWaitlist() {
    try { return JSON.parse(localStorage.getItem(WAITLIST_KEY)) || null; } catch { return null; }
  }

  const saveKey = () => SAVE_KEY + ":" + account.toLowerCase();

  function load() {
    try {
      let raw = JSON.parse(localStorage.getItem(saveKey()));
      // One-time move of a save from before wallets were required.
      if (!raw) {
        raw = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (raw) localStorage.removeItem(SAVE_KEY);
      }
      if (raw && raw.v === 1) return Object.assign(newState(), raw);
    } catch { /* ignore */ }
    return null;
  }

  function save() {
    if (!unlocked || !account) return;
    S.lastSave = Date.now();
    S.lastRate = S.pool === "solo" ? live.income * 0.8 : live.income;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch { /* private mode */ }
  }

  /* ---------- Economy ---------- */
  const priceOf = (m) => +(m.price * Math.pow(PRICE_STEP, S.gpus.filter((g) => g.model === m.id).length)).toFixed(2);
  const slotCount = () => SLOT_LEVELS[S.slotLvl];
  const psuCap = () => PSU[S.psuLvl];
  const pool = () => POOLS.find((p) => p.id === S.pool);

  function spend(v) {
    if (S.balance + 1e-9 < v) return false;
    S.balance -= v;
    return true;
  }

  function buyGpu(m) {
    if (S.gpus.length >= slotCount()) return toast("No free slot — expand your rig in Upgrades");
    const cost = priceOf(m);
    if (!spend(cost)) return toast("Not enough VOZZ");
    const g = { id: uid(), model: m.id, paid: cost };
    S.gpus.push(g);
    R[g.id] = { temp: AMBIENT, crashUntil: 0, flash: 0 };
    log(`Installed ${m.name} for ${fmtVZ(cost)} VOZZ`, "c-cyan");
    buildRig();
    refreshLists(true);
    save();
  }

  function sellGpu(id) {
    const i = S.gpus.findIndex((g) => g.id === id);
    if (i < 0) return;
    if (S.gpus.length === 1) return toast("Keep at least one GPU in the rig");
    const g = S.gpus[i];
    const refund = +(g.paid * 0.5).toFixed(2);
    S.gpus.splice(i, 1);
    delete R[g.id];
    S.balance += refund;
    log(`Sold ${MODEL[g.model].name} for ${fmtVZ(refund)} VOZZ`, "muted");
    buildRig();
    refreshLists(true);
    save();
  }

  /* ---------- Simulation ---------- */
  function step(dt) {
    now += dt;
    const { core, mem, pl, fan } = S.oc;
    const hashMult = (1 + core / 600 + mem / 3000) * Math.pow(pl / 100, 0.8);
    const heatMult = Math.pow(pl / 100, 1.6) * (1 + core / 450 + mem / 5000);
    const cool = (0.55 + (0.75 * fan) / 100) * (1 + 0.22 * S.coolLvl);
    const cap = psuCap();

    let hash = 0, watts = 0, running = 0, hottest = 0;
    for (const g of S.gpus) {
      const m = MODEL[g.model];
      const r = R[g.id] || (R[g.id] = { temp: AMBIENT, crashUntil: 0, flash: 0 });
      const crashed = r.crashUntil > now;
      const w = m.watt * (pl / 100) * (1 + core / 1200) + 0.12 * fan;
      r.off = !crashed && watts + w > cap; // PSU can't feed this card
      const active = !crashed && !r.off;

      const target = active ? AMBIENT + (m.heat * heatMult) / cool : AMBIENT;
      r.temp += (target - r.temp) * Math.min(1, dt * 0.35);
      if (active && r.temp >= CRASH_AT) {
        r.crashUntil = now + CRASH_SECS;
        log(`${m.name} crashed at ${Math.round(r.temp)}°C — restarting`, "c-red");
        toast(`⚠ ${m.name} overheated and crashed!`);
      }
      r.throttled = active && r.temp >= THROTTLE_AT;
      r.hash = active ? m.hash * hashMult * (r.throttled ? 0.6 : 1) : 0;
      if (active) { watts += w; running++; }
      hash += r.hash;
      hottest = Math.max(hottest, r.temp);
    }

    const N = S.netBase + hash;
    const p = pool();
    const income = p.solo ? (hash / N) * (BLOCK_REWARD / BLOCK_TIME) : (hash / N) * (BLOCK_REWARD / BLOCK_TIME) * (1 - p.fee);
    const bill = watts * ELEC;
    Object.assign(live, { hash, watts, running, hottest, income, bill, overload: S.gpus.some((g) => R[g.id] && R[g.id].off), N });

    S.balance = Math.max(0, S.balance - bill * dt);

    net.nextIn -= dt;
    if (net.nextIn <= 0) networkBlock(hash, N);

    for (const b of S.bots) b.total += b.rate * dt;
  }

  function networkBlock(hash, N) {
    const p = pool();
    S.height++;
    const share = hash / N;
    let by, mine = false, gain = 0;

    if (p.solo) {
      if (Math.random() < share) {
        mine = true;
        by = "YOU";
        gain = BLOCK_REWARD;
        S.stats.soloBlocks++;
        log(`★ YOU FOUND BLOCK #${S.height.toLocaleString("en-US")} — +${BLOCK_REWARD} VOZZ`, "c-green");
        toast(`★ Block found! +${BLOCK_REWARD} VOZZ`, true);
      } else {
        by = OTHER_FINDERS[(Math.random() * OTHER_FINDERS.length) | 0];
      }
    } else {
      const swing = p.variance ? 1 - p.variance + Math.random() * 2 * p.variance : 1;
      gain = share * BLOCK_REWARD * (1 - p.fee) * swing;
      const poolFound = Math.random() < 0.35;
      by = poolFound ? p.name : OTHER_FINDERS.filter((f) => f !== p.name)[(Math.random() * (OTHER_FINDERS.length - 1)) | 0];
      if (gain > 0) {
        S.stats.payouts++;
        log(`#${S.height.toLocaleString("en-US")} by ${by} · pool payout +${gain.toFixed(3)} VOZZ`, poolFound ? "c-cyan" : "");
      }
    }

    S.balance += gain;
    S.totalMined += gain;
    chain.push({ h: S.height, by, mine, pool: !p.solo && by === p.name, t: now });
    if (chain.length > 30) chain.shift();
    if (gain >= 1) bump($("t-bal"));

    S.netBase = Math.min(NET_CAP, S.netBase * NET_GROWTH);
    const wait = clamp(-Math.log(1 - Math.random()) * BLOCK_TIME, 3, 24);
    net = { nextIn: wait, total: wait };
  }

  /* ---------- Rig UI ---------- */
  const BLADES = (() => {
    let d = "";
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const rot = (x, y) => [(x * Math.cos(a) - y * Math.sin(a)).toFixed(2), (x * Math.sin(a) + y * Math.cos(a)).toFixed(2)];
      const p0 = rot(5, 0), c1 = rot(14, -11), p1 = rot(25, -3), c2 = rot(16, 1);
      d += `M${p0}Q${c1} ${p1}Q${c2} ${p0}Z`;
    }
    return `<svg viewBox="-28 -28 56 56" aria-hidden="true"><path d="${d}"/><circle r="5" fill="#151f2e"/></svg>`;
  })();

  const cards = new Map();
  function buildRig() {
    const grid = $("gpu-grid");
    grid.innerHTML = "";
    cards.clear();
    S.gpus.forEach((g, i) => {
      const m = MODEL[g.model];
      const card = el("div", "gpu");
      card.style.setProperty("--rgb", `hsl(${(i * 57 + 150) % 360}, 100%, 60%)`);
      card.innerHTML = `
        <span class="gpu-badge" hidden></span>
        <div class="gpu-top"><b>GPU ${i + 1}</b><span>${m.name}</span></div>
        <div class="fans"><div class="fan">${BLADES}</div><div class="fan">${BLADES}</div></div>
        <div class="gpu-stats"><span class="g-hash c-green">0 MH/s</span><span class="g-temp">0°C</span></div>
        <div class="temp-bar"><div class="temp-fill"></div></div>
        <div class="gpu-foot"><span class="g-watt">0 W</span><button class="sell-btn" type="button">Sell ${fmtVZ(g.paid * 0.5)} VOZZ</button></div>`;
      card.querySelector(".sell-btn").addEventListener("click", () => sellGpu(g.id));
      grid.append(card);
      cards.set(g.id, {
        card,
        badge: card.querySelector(".gpu-badge"),
        hash: card.querySelector(".g-hash"),
        temp: card.querySelector(".g-temp"),
        fill: card.querySelector(".temp-fill"),
        watt: card.querySelector(".g-watt"),
      });
    });
    for (let i = S.gpus.length; i < SLOT_LEVELS[SLOT_LEVELS.length - 1]; i++) {
      const open = i < slotCount();
      if (!open && i >= slotCount() + 2) break;
      const b = el("button", "slot-empty" + (open ? "" : " slot-locked"), open ? "<span>+</span>BUY GPU" : "<span>🔒</span>LOCKED SLOT");
      b.type = "button";
      b.addEventListener("click", () => switchTab(open ? "shop" : "upgrades"));
      grid.append(b);
    }
  }

  function updateRig() {
    const { pl, core, fan } = S.oc;
    S.gpus.forEach((g) => {
      const c = cards.get(g.id);
      const r = R[g.id];
      if (!c || !r) return;
      const m = MODEL[g.model];
      const crashed = r.crashUntil > now;
      c.card.classList.toggle("crashed", crashed);
      c.card.classList.toggle("hot", r.throttled);
      c.card.classList.toggle("off", r.off);
      if (crashed) { c.badge.hidden = false; c.badge.className = "gpu-badge crash"; c.badge.textContent = `CRASHED · ${Math.ceil(r.crashUntil - now)}s`; }
      else if (r.off) { c.badge.hidden = false; c.badge.className = "gpu-badge off"; c.badge.textContent = "NO POWER — UPGRADE PSU"; }
      else if (r.throttled) { c.badge.hidden = false; c.badge.className = "gpu-badge hot"; c.badge.textContent = "⚠ THROTTLING"; }
      else c.badge.hidden = true;

      c.hash.textContent = (r.hash || 0).toFixed(1) + " MH/s";
      c.hash.className = "g-hash " + (r.throttled || crashed ? "c-red" : "c-green");
      const t = Math.round(r.temp);
      c.temp.textContent = t + "°C";
      const col = r.temp >= THROTTLE_AT ? "var(--red)" : r.temp >= 75 ? "var(--amber)" : "var(--cyan)";
      c.temp.style.color = col;
      c.fill.style.background = col;
      c.fill.style.width = clamp((r.temp - 20) / 85, 0, 1) * 100 + "%";
      const active = !crashed && !r.off;
      c.watt.textContent = active ? Math.round(m.watt * (pl / 100) * (1 + core / 1200) + 0.12 * fan) + " W" : "0 W";
      c.card.style.setProperty("--spin", (1.7 - (fan / 100) * 1.45).toFixed(2) + "s");
      c.card.style.setProperty("--play", active ? "running" : "paused");

      // brief glow when the card "submits a share"
      if (active && Math.random() < (r.hash || 0) / 2000) {
        c.card.classList.add("share");
        setTimeout(() => c.card.classList.remove("share"), 280);
      }
    });

    $("rig-count").textContent = `${S.gpus.length}/${slotCount()} GPUs`;
    const cap = psuCap();
    const demand = S.gpus.reduce((s, g) => s + (R[g.id] && R[g.id].crashUntil > now ? 0 : MODEL[g.model].watt * (pl / 100) * (1 + core / 1200) + 0.12 * fan), 0);
    $("rig-power").textContent = `${Math.round(live.watts)} / ${cap} W`;
    $("rig-power").classList.toggle("over", live.overload);
    $("power-fill").style.width = clamp(demand / cap, 0, 1) * 100 + "%";
    $("power-fill").classList.toggle("over", live.overload);
  }

  /* ---------- Lists (shop / upgrades / pool / missions) ---------- */
  const listKeys = {};
  function renderIfChanged(id, key, build) {
    if (listKeys[id] === key) return;
    listKeys[id] = key;
    const box = $(id);
    box.innerHTML = "";
    build(box);
  }

  function item(box, icon, title, sub, btnText, onClick, opts = {}) {
    const it = el("div", "item" + (opts.cls ? " " + opts.cls : ""));
    it.append(el("div", "item-icon", icon));
    const main = el("div", "item-main");
    main.append(el("b", "", title), el("small", "", sub));
    it.append(main);
    if (btnText) {
      const b = el("button", "buy" + (opts.btnCls ? " " + opts.btnCls : ""), btnText);
      b.type = "button";
      b.disabled = !!opts.disabled;
      b.addEventListener("click", onClick);
      it.append(b);
    }
    box.append(it);
  }

  function refreshLists(force) {
    if (force) for (const k in listKeys) delete listKeys[k];
    const bal = S.balance;
    const full = S.gpus.length >= slotCount();

    renderIfChanged("tab-shop", MODELS.map((m) => [priceOf(m), bal >= priceOf(m), full]).join("|"), (box) => {
      if (full) box.append(el("p", "hint", "All slots are full — expand the rig in Upgrades or sell a card."));
      MODELS.forEach((m, i) => {
        const price = priceOf(m);
        item(box, "GPU", m.name, `${m.hash} MH/s · ${m.watt} W · ${(m.hash / m.watt * 1000).toFixed(0)} KH/W`, fmtVZ(price) + " VOZZ", () => buyGpu(m), {
          disabled: full || bal < price,
        });
      });
    });

    renderIfChanged("tab-upgrades", [S.slotLvl, S.psuLvl, S.coolLvl, bal >= (SLOT_COST[S.slotLvl] || 1e9), bal >= (PSU_COST[S.psuLvl] || 1e9), bal >= (COOL_COST[S.coolLvl] || 1e9)].join("|"), (box) => {
      const slotMax = S.slotLvl >= SLOT_COST.length;
      item(box, "▦", "Rig frame", slotMax ? `${slotCount()} slots · maxed` : `${slotCount()} → ${SLOT_LEVELS[S.slotLvl + 1]} GPU slots`, slotMax ? "MAX" : fmtVZ(SLOT_COST[S.slotLvl]) + " VOZZ", () => {
        if (spend(SLOT_COST[S.slotLvl])) { S.slotLvl++; log(`Rig expanded to ${slotCount()} slots`, "c-cyan"); buildRig(); refreshLists(true); save(); }
      }, { disabled: slotMax || bal < SLOT_COST[S.slotLvl] });

      const psuMax = S.psuLvl >= PSU_COST.length;
      item(box, "⚡", "Power supply", psuMax ? `${psuCap()} W · maxed` : `${psuCap()} W → ${PSU[S.psuLvl + 1]} W`, psuMax ? "MAX" : fmtVZ(PSU_COST[S.psuLvl]) + " VOZZ", () => {
        if (spend(PSU_COST[S.psuLvl])) { S.psuLvl++; log(`PSU upgraded to ${psuCap()} W`, "c-cyan"); refreshLists(true); save(); }
      }, { disabled: psuMax || bal < PSU_COST[S.psuLvl] });

      const coolMax = S.coolLvl >= COOL_COST.length;
      item(box, "❄", "Cooling", coolMax ? `Level ${S.coolLvl} · maxed` : `Level ${S.coolLvl} → ${S.coolLvl + 1} · -${Math.round((1 - (1 + 0.22 * S.coolLvl) / (1 + 0.22 * (S.coolLvl + 1))) * 100)}% heat`, coolMax ? "MAX" : fmtVZ(COOL_COST[S.coolLvl]) + " VOZZ", () => {
        if (spend(COOL_COST[S.coolLvl])) { S.coolLvl++; log(`Cooling upgraded to level ${S.coolLvl}`, "c-cyan"); refreshLists(true); save(); }
      }, { disabled: coolMax || bal < COOL_COST[S.coolLvl] });
    });

    renderIfChanged("tab-pool", S.pool, (box) => {
      box.append(el("p", "hint", `The network finds a block about every ${BLOCK_TIME}s. Block reward: ${BLOCK_REWARD} VOZZ. Difficulty rises as the network grows.`));
      POOLS.forEach((p) => {
        const sel = S.pool === p.id;
        item(box, p.solo ? "SOLO" : "POOL", p.name, p.desc, sel ? "MINING ✓" : "SWITCH", () => {
          S.pool = p.id;
          log(`Switched to ${p.name}`, "c-cyan");
          $("mode-label").textContent = p.name;
          refreshLists();
          save();
        }, { btnCls: sel ? "selected" : "", cls: sel ? "done" : "" });
      });
    });

    const states = MISSIONS.map((m) => (S.claimed[m.id] ? "c" : m.done() ? "r" : "o"));
    const ready = states.filter((s) => s === "r").length;
    $("mission-badge").hidden = !ready;
    $("mission-badge").textContent = ready;
    renderIfChanged("tab-missions", states.join(""), (box) => {
      MISSIONS.forEach((m, i) => {
        const st = states[i];
        item(box, st === "c" ? "✓" : String(i + 1), m.text, `Reward: ${m.reward} VOZZ`, st === "c" ? "CLAIMED" : st === "r" ? "CLAIM" : "LOCKED", () => {
          if (S.claimed[m.id] || !m.done()) return;
          S.claimed[m.id] = true;
          S.balance += m.reward;
          log(`Mission complete: ${m.text} (+${m.reward} VOZZ)`, "c-green");
          toast(`✓ Mission complete! +${m.reward} VOZZ`);
          bump($("t-bal"));
          refreshLists();
          save();
        }, { disabled: st !== "r", btnCls: st === "r" ? "claim" : "", cls: st === "c" ? "done" : st === "r" ? "claimable" : "" });
      });
    });
  }

  /* ---------- Overclock controls ---------- */
  const ocInputs = { core: $("oc-core"), mem: $("oc-mem"), pl: $("oc-pl"), fan: $("oc-fan") };
  function syncOc() {
    for (const k in ocInputs) ocInputs[k].value = S.oc[k];
    $("v-core").textContent = `+${S.oc.core} MHz`;
    $("v-mem").textContent = `+${S.oc.mem} MHz`;
    $("v-pl").textContent = `${S.oc.pl}%`;
    $("v-fan").textContent = `${S.oc.fan}%`;
  }
  for (const k in ocInputs) {
    ocInputs[k].addEventListener("input", () => {
      S.oc[k] = +ocInputs[k].value;
      syncOc();
    });
    ocInputs[k].addEventListener("change", save);
  }
  $("oc-reset").addEventListener("click", () => {
    S.oc = { core: 0, mem: 0, pl: 100, fan: 60 };
    syncOc();
    save();
  });

  /* ---------- Tabs ---------- */
  function switchTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".tab-body").forEach((b) => (b.hidden = b.id !== "tab-" + name));
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  document.querySelectorAll(".ltab").forEach((t) =>
    t.addEventListener("click", () => {
      document.querySelectorAll(".ltab").forEach((x) => x.classList.toggle("active", x === t));
      $("log").hidden = t.dataset.ltab !== "log";
      $("board").hidden = t.dataset.ltab !== "board";
    })
  );

  /* ---------- Log, toast, leaderboard ---------- */
  function log(msg, cls = "") {
    const li = el("li", cls);
    const d = new Date();
    li.append(el("time", "", d.toTimeString().slice(0, 8)), el("span", "", ""));
    li.lastChild.textContent = msg;
    const list = $("log");
    list.prepend(li);
    while (list.children.length > 60) list.lastChild.remove();
  }

  let toastTimer;
  function toast(msg, big = false) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.toggle("big", big);
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function bump(e) {
    e.classList.remove("bump");
    void e.offsetWidth;
    e.classList.add("bump");
  }

  function standings() {
    return [...S.bots.map((b) => ({ name: b.name, total: b.total })), { name: "You", total: S.totalMined, me: true }].sort((a, b) => b.total - a.total);
  }
  const rankOf = () => standings().findIndex((r) => r.me) + 1;
  function renderBoard() {
    const list = $("board");
    list.innerHTML = "";
    standings().forEach((r, i) => {
      const li = el("li", r.me ? "me" : "");
      li.append(el("span", "", "#" + (i + 1)), el("span", "", ""), el("span", "", fmtVZ(r.total) + " VOZZ"));
      li.children[1].textContent = r.me ? "You" + (account ? " (" + short(account) + ")" : "") : r.name;
      list.append(li);
    });
  }

  /* ---------- Top bar ---------- */
  function updateTop() {
    $("t-hash").textContent = fmtHash(live.hash);
    const r = live.income - live.bill;
    $("t-rate").textContent = (r >= 0 ? "+" : "") + r.toFixed(3);
    $("t-rate").className = r >= 0 ? "c-green" : "c-red";
    $("t-height").textContent = "#" + S.height.toLocaleString("en-US");
    $("t-bal").textContent = fmtVZ(S.balance) + " VOZZ";
    $("chart-val").textContent = fmtHash(live.hash);
    $("net-hash").textContent = fmtHash(live.N || S.netBase);
    $("net-share").textContent = ((live.hash / (live.N || 1)) * 100).toFixed(2) + "%";
    $("net-next").textContent = Math.max(0, net.nextIn).toFixed(1) + "s";
    $("v-eff").textContent = live.watts ? Math.round((live.hash / live.watts) * 1000) + " KH/W" : "—";
    $("v-hot").textContent = Math.round(live.hottest) + "°C";
    $("v-hot").className = live.hottest >= THROTTLE_AT ? "c-red" : live.hottest >= 75 ? "c-amber" : "c-cyan";
    $("v-bill").textContent = "-" + live.bill.toFixed(3) + "/s";
  }

  /* ---------- Wallet + Mining Pass gate ---------- */
  const W = window.VozzWallet;
  const menu = $("wallet-menu");

  function renderWallet() {
    const st = W.state;
    const chip = $("wallet-chip");
    chip.classList.toggle("unlinked", !st.address);
    chip.innerHTML = "";
    chip.append(st.address ? "◆ " + short(st.address) : "Connect wallet");
    if (st.address && unlocked) chip.append(el("span", "pass-ok", "PASS ✓"));
    chip.title = st.address ? `${st.info ? st.info.name : "Wallet"} on ${W.network.name}` : "Connect a wallet to start mining";
    if (st.address) $("wallet-explorer").href = W.explorerAddress(st.address);
  }

  function toggleMenu(open) {
    menu.hidden = !open;
    $("wallet-chip").setAttribute("aria-expanded", String(open));
  }
  $("wallet-chip").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!W.state.address) W.pick();
    else toggleMenu(menu.hidden);
  });
  document.addEventListener("click", () => toggleMenu(false));
  menu.addEventListener("click", async (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    toggleMenu(false);
    if (act === "copy") {
      try { await navigator.clipboard.writeText(W.state.address); toast("Address copied"); } catch { toast(W.state.address); }
    } else if (act === "switch") {
      W.disconnect();
      W.pick();
    } else if (act === "disconnect") {
      W.disconnect();
    }
  });

  const gate = {
    el: $("gate"),
    action: $("gate-action"),
    msg: $("gate-msg"),
    stage: null,
  };
  $("gate-price").textContent = W.priceEth;
  $("gate-net").textContent = W.network.name;
  document.querySelectorAll(".gs-net").forEach((n) => (n.textContent = W.network.name));

  function gateMsg(text, cls = "") {
    gate.msg.className = "gate-msg" + (cls ? " " + cls : "");
    gate.msg.innerHTML = text;
  }

  // stage: connect | chain | checking | soon | mint | error
  function lock(stage, message) {
    if (unlocked) {
      save();
      unlocked = false;
      log("Rig paused — Mining Pass not detected for this wallet", "c-amber");
    }
    gate.stage = stage;
    gate.el.hidden = false;
    $("welcome").hidden = true;
    const st = W.state;
    const steps = { connect: !!st.address, chain: !!st.address && st.chainOk, pass: false };
    const current = !steps.connect ? "connect" : !steps.chain ? "chain" : "pass";
    document.querySelectorAll(".gate-steps li").forEach((li) => {
      li.classList.toggle("done", steps[li.dataset.step]);
      li.classList.toggle("current", li.dataset.step === current);
    });
    $("gs-connect").textContent = st.address ? short(st.address) : "";
    $("gate-switch").hidden = !st.address;

    const labels = {
      connect: ["Connect wallet", false],
      chain: [`Switch to ${W.network.name}`, false],
      checking: ["Checking your Mining Pass…", true],
      soon: ["Mint opens soon", true],
      mint: [`Mint Mining Pass · ${W.priceEth} ETH`, false],
      error: ["Try again", false],
    };
    const [label, disabled] = labels[stage];
    gate.action.textContent = label;
    gate.action.disabled = disabled;
    if (stage === "soon") gateMsg("The Mining Pass contract isn't deployed yet — check back soon.");
    else if (message !== undefined) gateMsg(message, stage === "error" ? "err" : "");
    else if (stage !== "mint") gateMsg("");
    renderWallet();
  }

  function unlock(addr) {
    if (unlocked && account === addr) return;
    account = addr;
    S = load() || newState();
    for (const k in R) delete R[k];
    for (const g of S.gpus) R[g.id] = { temp: AMBIENT + 10, crashUntil: 0, flash: 0 };
    chain.length = 0;
    hist.length = 0;
    $("log").innerHTML = "";
    syncOc();
    buildRig();
    $("mode-label").textContent = pool().name;
    unlocked = true;
    step(0.01);
    refreshLists(true);
    updateTop();
    renderBoard();
    gate.el.hidden = true;
    log(`Mining Pass verified for ${short(addr)} · ${W.network.name}`, "c-green");
    const away = (Date.now() - S.lastSave) / 1000;
    if (S.seenWelcome && away > 30) offlineEarnings(away);
    if (!S.seenWelcome) showWelcome();
    else toast("⛏ Mining Pass verified — rig online");
    last = performance.now();
    save();
    renderWallet();
  }

  let checkSeq = 0;
  async function evaluate() {
    const st = W.state;
    const seq = ++checkSeq;
    if (!st.address) return lock("connect");
    if (unlocked && account && st.address.toLowerCase() !== account.toLowerCase()) lock("checking");
    if (!st.chainOk) return lock("chain");
    if (!W.passConfigured()) return lock("soon");
    if (!(unlocked && account === st.address)) lock("checking");
    let has;
    try {
      has = await W.hasPass(st.address);
    } catch (err) {
      if (seq === checkSeq) lock("error", "Couldn't read the Mining Pass contract. Check your connection.");
      return;
    }
    if (seq !== checkSeq) return; // a newer check started (account/chain changed)
    if (has) return unlock(st.address);
    lock("mint");
    updateSupply();
  }

  async function updateSupply() {
    try {
      const s = await W.passStats();
      if (!s) return;
      $("gs-supply").textContent = `${s.minted.toLocaleString("en-US")} minted`;
      if (!s.mintOpen && gate.stage === "mint") {
        gate.action.disabled = true;
        gateMsg("Minting is paused right now.", "err");
      }
    } catch { /* ignore */ }
  }

  async function mint() {
    gate.action.disabled = true;
    const stages = {
      checking: "Checking your ETH balance…",
      confirm: "Confirm the transaction in your wallet…",
    };
    try {
      await W.mintPass((stage, hash) => {
        if (stages[stage]) gateMsg(stages[stage]);
        if (stage === "pending") gateMsg(`Minting… <a href="${W.explorerTx(hash)}" target="_blank" rel="noopener">view transaction</a>`);
        if (stage === "done") gateMsg("Mining Pass minted! ✓", "ok");
      });
      toast("★ Mining Pass minted!", true);
      await evaluate();
    } catch (err) {
      gateMsg("✗ " + ((err && err.message) || "Mint failed."), "err");
      gate.action.disabled = false;
    }
  }

  gate.action.addEventListener("click", async () => {
    const stage = gate.stage;
    if (stage === "connect") {
      await W.pick();
    } else if (stage === "chain") {
      try { await W.ensureChain(); } catch (err) { gateMsg("✗ " + ((err && err.message) || "Couldn't switch network."), "err"); }
    } else if (stage === "mint") {
      await mint();
    } else if (stage === "error") {
      evaluate();
    }
  });
  $("gate-switch").addEventListener("click", () => {
    W.disconnect();
    W.pick();
  });
  W.onChange(() => evaluate());

  /* ---------- Canvases ---------- */
  function fitCanvas(c) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = +c.getAttribute("height");
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.height = h + "px";
    }
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function drawChart() {
    const { ctx, w, h } = fitCanvas($("chart"));
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < 4; k++) { ctx.moveTo(0, (h * k) / 4); ctx.lineTo(w, (h * k) / 4); }
    ctx.stroke();
    if (hist.length < 2) return;
    const max = Math.max(100, ...hist) * 1.15;
    const stepX = w / 119;
    const pts = hist.map((v, i) => [w - (hist.length - 1 - i) * stepX, h - (v / max) * h]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = "#00ffaa";
    ctx.lineWidth = 2;
    ctx.shadowColor = "#00ffaa";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.lineTo(pts[0][0], h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(0,255,170,0.25)");
    g.addColorStop(1, "rgba(0,255,170,0)");
    ctx.fillStyle = g;
    ctx.fill();
  }

  function cube(ctx, x, y, s, fill, color, glow, label, sub) {
    const d = s * 0.18;
    ctx.fillStyle = color + "22";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + d, y - d); ctx.lineTo(x + s + d, y - d); ctx.lineTo(x + s, y); ctx.fill();
    ctx.fillStyle = color + "14";
    ctx.beginPath(); ctx.moveTo(x + s, y); ctx.lineTo(x + s + d, y - d); ctx.lineTo(x + s + d, y + s - d); ctx.lineTo(x + s, y + s); ctx.fill();
    ctx.fillStyle = "#08101c";
    ctx.fillRect(x, y, s, s);
    if (fill > 0) { ctx.fillStyle = color + "40"; ctx.fillRect(x, y + s * (1 - fill), s, s * fill); }
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = 24 * glow; }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x, y, s, s);
    ctx.shadowBlur = 0;
    ctx.textAlign = "center";
    ctx.font = `600 ${s * 0.2}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = "rgba(225,240,255,0.9)";
    ctx.fillText(label, x + s / 2, y + s * 0.46);
    ctx.font = `${s * 0.17}px 'JetBrains Mono', monospace`;
    ctx.fillStyle = color;
    ctx.fillText(sub, x + s / 2, y + s * 0.78);
    ctx.textAlign = "left";
  }

  function drawChain() {
    const { ctx, w, h } = fitCanvas($("chain"));
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(54, Math.max(40, w / 12));
    const gap = s * 0.42;
    const y = 30;
    const headX = w - s - 16;
    ctx.strokeStyle = "rgba(0,255,170,0.3)";
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -now * 20;
    ctx.beginPath(); ctx.moveTo(0, y + s / 2); ctx.lineTo(headX, y + s / 2); ctx.stroke();
    ctx.setLineDash([]);

    let x = headX - s - gap;
    for (let k = chain.length - 1; k >= 0 && x > -s; k--, x -= s + gap) {
      const b = chain[k];
      const age = now - b.t;
      const color = b.mine ? "#00ffaa" : b.pool ? "#00d4ff" : "#5d6d84";
      cube(ctx, x, y, s, b.mine || b.pool ? 1 : 0.4, color, age < 1.2 ? 1 - age / 1.2 : 0, "#" + (b.h % 100000), b.mine ? "YOU" : b.by.slice(0, 8));
    }
    const prog = 1 - net.nextIn / net.total;
    const pulse = 0.5 + 0.5 * Math.sin(now * 6);
    cube(ctx, headX, y, s, prog, "#00ffaa", pulse * 0.5, "#" + ((S.height + 1) % 100000), Math.round(prog * 100) + "%");
    ctx.textAlign = "center";
    ctx.font = "700 10px Orbitron, sans-serif";
    ctx.fillStyle = "#00ffaa";
    ctx.fillText("MINING", headX + s / 2, y - 14);
    ctx.font = "10px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#8a9bb4";
    ctx.fillText(S.pool === "solo" ? "solo" : pool().name, headX + s / 2, y + s + 18);
    ctx.textAlign = "left";
    ctx.fillStyle = "#00ffaa";
    ctx.fillText("■ you", 0, h - 6);
    ctx.fillStyle = "#00d4ff";
    ctx.fillText("■ your pool", 48, h - 6);
    ctx.fillStyle = "#5d6d84";
    ctx.fillText("■ other miners", 136, h - 6);
  }

  /* ---------- Loop ---------- */
  let last = performance.now();
  let uiT = 0, histT = 0, saveT = 0, boardT = 0;
  function frame(t) {
    let dt = Math.min(0.25, (t - last) / 1000);
    last = t;
    while (dt > 0) {
      const d = Math.min(0.1, dt);
      if (unlocked) step(d);
      dt -= d;
      uiT += d; histT += d; saveT += d; boardT += d;
    }
    if (uiT >= 0.25) { uiT = 0; updateTop(); updateRig(); refreshLists(); }
    if (histT >= 1) { histT = 0; hist.push(live.hash); if (hist.length > 120) hist.shift(); }
    if (boardT >= 2) { boardT = 0; renderBoard(); }
    if (saveT >= 5) { saveT = 0; save(); }
    drawChart();
    drawChain();
    requestAnimationFrame(frame);
  }

  // Catch up when the tab was in the background (rAF pauses there).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { save(); return; }
    last = performance.now();
    if (!unlocked) return;
    const away = (Date.now() - S.lastSave) / 1000;
    if (away > 30) offlineEarnings(away);
    last = performance.now();
  });
  window.addEventListener("beforeunload", save);

  function offlineEarnings(away) {
    const secs = Math.min(away, OFFLINE_CAP);
    const gain = Math.max(0, S.lastRate) * secs * OFFLINE_RATE;
    if (gain < 0.01) return;
    S.balance += gain;
    S.totalMined += gain;
    const mins = Math.round(secs / 60);
    log(`While you were away (${mins} min): +${fmtVZ(gain)} VOZZ`, "c-green");
    toast(`Welcome back! Your rig mined +${fmtVZ(gain)} VOZZ`, true);
    save();
  }

  /* ---------- Buttons ---------- */
  function showWelcome() {
    $("welcome-sub").textContent = `Your rig is online with a starter ${S.starter} and ${START_BALANCE} VOZZ.`;
    $("welcome").hidden = false;
    $("welcome-go").focus();
  }
  $("welcome-go").addEventListener("click", () => {
    $("welcome").hidden = true;
    S.seenWelcome = true;
    save();
  });
  $("help-btn").addEventListener("click", () => unlocked && showWelcome());
  $("reset-btn").addEventListener("click", () => {
    if (!confirm("Reset all beta progress? This can't be undone.")) return;
    try { localStorage.removeItem(saveKey()); } catch { /* ignore */ }
    window.removeEventListener("beforeunload", save);
    location.reload();
  });
  window.addEventListener("resize", () => { drawChart(); drawChain(); });

  /* ---------- Init ---------- */
  // Show a preview rig behind the gate until a wallet with a Mining Pass connects.
  S = newState();
  for (const g of S.gpus) R[g.id] = { temp: AMBIENT, crashUntil: 0, flash: 0 };
  syncOc();
  buildRig();
  $("mode-label").textContent = pool().name;
  refreshLists(true);
  updateTop();
  renderBoard();
  lock("connect");
  W.restore().then(evaluate);
  requestAnimationFrame(frame);
})();
