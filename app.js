/*
 * VOZZ — waitlist page logic: live stats, beta countdown, and the signup flow.
 *
 * Joining is a two-step flow inside a modal: complete four X (Twitter) missions
 * in order, then paste a wallet address. X actions can't be verified from the
 * browser, so a mission counts as done once its intent link has been opened.
 *
 * Signups are stored in localStorage by default. To collect them on a server,
 * set WAITLIST_ENDPOINT to a URL that accepts a JSON POST: { wallet, chainId, ref, tasks }.
 *
 * VOZZ runs on Robinhood Chain (an EVM Layer 2), so wallets are 0x addresses.
 */
(() => {
  const WAITLIST_ENDPOINT = ""; // e.g. "https://api.example.com/waitlist"
  const BETA_DATE = new Date("2027-01-15T12:00:00+07:00");
  const BASE_WAITLIST = 12847; // seed count shown before any real signups
  const STORAGE_KEY = "vozz-waitlist";
  // Robinhood Chain mainnet. Docs: https://docs.robinhood.com/chain
  const CHAIN = {
    chainId: "0x1237", // 4663
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  };
  const STARTER_GPUS = ["VX 5070", "RZ 6800 XT", "VX 6090", "RZ 7900"];

  // X account and post used for the missions — replace with the real ones.
  const X_HANDLE = "vozzGPU";
  const X_POST_ID = "2113652208571228400";
  const VERIFY_MS = 3500; // fake "verifying" delay after a mission link is opened
  const TASKS_KEY = "vozz-tasks";

  const TASKS = [
    {
      id: "follow",
      title: `Follow @${X_HANDLE} on X`,
      desc: "Stay up to date with VOZZ news.",
      action: "Follow",
      url: `https://x.com/intent/follow?screen_name=${X_HANDLE}`,
    },
    {
      id: "like",
      title: "Like the post",
      desc: "Show some love for the announcement.",
      action: "Like",
      url: `https://x.com/intent/like?tweet_id=${X_POST_ID}`,
    },
    {
      id: "repost",
      title: "Repost the post",
      desc: "Share it with your followers.",
      action: "Repost",
      url: `https://x.com/intent/retweet?tweet_id=${X_POST_ID}`,
    },
    {
      id: "comment",
      title: "Comment on the post",
      desc: "Drop a reply and tag a fellow miner.",
      action: "Comment",
      url: `https://x.com/intent/post?in_reply_to=${X_POST_ID}`,
    },
  ];

  const $ = (id) => document.getElementById(id);
  const joinBtn = $("join-btn");
  const msg = $("form-msg");
  const modal = $("waitlist-modal");
  const taskList = $("tasks");
  const addressForm = $("address-form");
  const walletInput = $("wallet");
  const addressMsg = $("address-msg");
  const addressSubmit = $("address-submit");
  const ticket = $("ticket");
  const toastEl = $("toast");

  const store = (key) => ({
    get() {
      try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
    },
    set(v) {
      try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ }
    },
  });
  const storage = store(STORAGE_KEY);
  const taskStorage = store(TASKS_KEY);

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ---------- Stats ---------- */
  function formatHashrate(h) {
    const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s", "EH/s"];
    let i = 0;
    while (h >= 1000 && i < units.length - 1) { h /= 1000; i++; }
    return h.toFixed(2) + " " + units[i];
  }

  function bump(el) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  let waitlistCount = BASE_WAITLIST + Math.floor((Date.now() / 3.6e6) % 500);
  const statWait = $("stat-waitlist");
  const statHash = $("stat-hashrate");
  const statBlocks = $("stat-blocks");
  const statCountdown = $("stat-countdown");
  const footerHash = $("footer-hash");

  function renderWaitlist() {
    statWait.textContent = waitlistCount.toLocaleString("en-US");
  }

  setInterval(() => {
    if (window.miningSim) statHash.textContent = formatHashrate(window.miningSim.hashrate);
  }, 250);

  window.addEventListener("block-found", () => {
    statBlocks.textContent = window.miningSim.blocks.toLocaleString("en-US");
    footerHash.textContent = window.miningSim.lastHash;
    bump(statBlocks);
  });

  // Simulated new signups trickling in.
  (function trickle() {
    setTimeout(() => {
      waitlistCount += 1 + Math.floor(Math.random() * 3);
      renderWaitlist();
      bump(statWait);
      trickle();
    }, 4000 + Math.random() * 7000);
  })();

  function renderCountdown() {
    const diff = Math.max(0, BETA_DATE - Date.now());
    const d = Math.floor(diff / 864e5);
    const h = Math.floor((diff % 864e5) / 36e5);
    const m = Math.floor((diff % 36e5) / 6e4);
    statCountdown.textContent = diff ? `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m` : "LIVE";
  }
  setInterval(renderCountdown, 1000 * 20);

  /* ---------- Waitlist ---------- */
  const shortAddr = (a) => (a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a);

  function showTicket(entry) {
    $("ticket-id").textContent = "#" + entry.id;
    $("ticket-pos").textContent = "#" + entry.position.toLocaleString("en-US");
    $("ticket-gpu").textContent = entry.gpu;
    $("ticket-wallet").textContent = shortAddr(entry.wallet || "");
    ticket.hidden = false;
    joinBtn.hidden = true;
    msg.className = "form-msg success";
    msg.textContent = `✓ ${shortAddr(entry.wallet || entry.email || "")} is on the list. See you in the closed beta, miner!`;
  }

  function referralLink(entry) {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "?ref=" + entry.id;
    return url.toString();
  }

  /* ---------- Missions modal ---------- */
  // Per-task state: undefined (todo) | "verifying" | "done". Only "done" is persisted.
  const taskState = {};
  for (const id of taskStorage.get() || []) taskState[id] = "done";

  const doneCount = () => TASKS.filter((t) => taskState[t.id] === "done").length;
  const firstOpenIndex = () => TASKS.findIndex((t) => taskState[t.id] !== "done");

  function renderTasks() {
    const open = firstOpenIndex();
    taskList.innerHTML = "";
    TASKS.forEach((t, i) => {
      const state = taskState[t.id] || (i > open && open !== -1 ? "locked" : "todo");
      const li = document.createElement("li");
      li.className = "task " + state;

      const num = document.createElement("span");
      num.className = "task-num";
      num.textContent = state === "done" ? "✓" : String(i + 1);

      const text = document.createElement("span");
      text.className = "task-text";
      const title = document.createElement("span");
      title.className = "task-title";
      title.textContent = t.title;
      const desc = document.createElement("span");
      desc.className = "task-desc";
      desc.textContent = t.desc;
      text.append(title, desc);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "task-btn";
      btn.disabled = state !== "todo";
      if (state === "verifying") {
        btn.innerHTML = '<span class="mini-spinner" aria-hidden="true"></span>Verifying';
      } else {
        btn.textContent = state === "done" ? "Done" : state === "locked" ? "Locked" : t.action;
      }
      btn.addEventListener("click", () => startTask(t));

      li.append(num, text, btn);
      taskList.append(li);
    });

    const done = doneCount();
    $("task-progress").style.width = (done / TASKS.length) * 100 + "%";
    $("task-count").textContent = `${done}/${TASKS.length}`;

    const allDone = done === TASKS.length;
    if (allDone && addressForm.hidden) {
      addressForm.hidden = false;
      walletInput.focus();
    }
    addressForm.hidden = !allDone;
  }

  function startTask(t) {
    window.open(t.url, "_blank", "noopener");
    taskState[t.id] = "verifying";
    renderTasks();
    setTimeout(() => {
      taskState[t.id] = "done";
      taskStorage.set(TASKS.filter((x) => taskState[x.id] === "done").map((x) => x.id));
      renderTasks();
      toast(doneCount() === TASKS.length ? "All missions complete! Paste your address." : `Mission ${TASKS.indexOf(t) + 1} complete ✓`);
    }, VERIFY_MS);
  }

  let lastFocus = null;
  function openModal() {
    if (storage.get()) {
      toast("You're already on the waitlist ✓");
      return;
    }
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    renderTasks();
    const target = modal.querySelector(".task.todo .task-btn") || (!addressForm.hidden && walletInput) || modal.querySelector(".modal-close");
    target.focus();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (lastFocus) lastFocus.focus();
  }

  document.querySelectorAll("[data-open-waitlist]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    })
  );
  modal.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  /* ---------- Beta gameplay video ---------- */
  const videoModal = $("video-modal");
  const video = $("beta-video");
  let videoLastFocus = null;

  function openVideo() {
    videoLastFocus = document.activeElement;
    videoModal.hidden = false;
    document.body.style.overflow = "hidden";
    videoModal.querySelector(".modal-close").focus();
    video.play().catch(() => { /* autoplay blocked: controls are visible */ });
  }

  function closeVideo() {
    video.pause();
    videoModal.hidden = true;
    document.body.style.overflow = "";
    if (videoLastFocus) videoLastFocus.focus();
  }

  document.querySelectorAll("[data-open-video]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      openVideo();
    })
  );
  videoModal.querySelectorAll("[data-close-video]").forEach((el) => el.addEventListener("click", closeVideo));
  $("video-join").addEventListener("click", () => {
    closeVideo();
    openModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !videoModal.hidden) closeVideo();
  });

  /* ---------- Wallet address ---------- */
  const isWallet = (v) => /^0x[a-fA-F0-9]{40}$/.test(v);

  function addressError(text) {
    const wrap = walletInput.closest(".address-input");
    wrap.classList.remove("invalid");
    void wrap.offsetWidth;
    wrap.classList.add("invalid");
    addressMsg.className = "form-msg error";
    addressMsg.textContent = text;
  }

  $("paste-btn").addEventListener("click", async () => {
    try {
      walletInput.value = (await navigator.clipboard.readText()).trim();
      walletInput.dispatchEvent(new Event("input"));
    } catch {
      toast("Press Ctrl+V / ⌘V to paste");
    }
    walletInput.focus();
  });

  // Optional: fill the address from an injected EVM wallet and add/switch to Robinhood Chain.
  $("add-chain-btn").addEventListener("click", async () => {
    const eth = window.ethereum;
    if (!eth) {
      toast("No wallet found — install MetaMask or paste your address");
      return;
    }
    try {
      const [account] = await eth.request({ method: "eth_requestAccounts" });
      if (account) {
        walletInput.value = account;
        walletInput.dispatchEvent(new Event("input"));
      }
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainId }] });
      } catch (err) {
        if (err && err.code === 4902) {
          await eth.request({ method: "wallet_addEthereumChain", params: [CHAIN] });
        } else {
          throw err;
        }
      }
      toast("Connected to Robinhood Chain ✓");
    } catch (err) {
      toast(err && err.code === 4001 ? "Request cancelled in wallet" : "Couldn't connect — paste your address instead");
    }
  });

  walletInput.addEventListener("input", () => {
    walletInput.closest(".address-input").classList.remove("invalid");
    addressMsg.className = "form-msg";
    addressMsg.textContent = "";
  });

  addressForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const wallet = walletInput.value.trim();

    if (doneCount() !== TASKS.length) {
      addressError("✗ Complete all missions first.");
      return;
    }
    if (!isWallet(wallet)) {
      addressError("✗ Enter a valid Robinhood Chain (EVM) address: 0x + 40 hex characters.");
      walletInput.focus();
      return;
    }

    addressSubmit.disabled = true;
    addressSubmit.classList.add("loading");
    addressMsg.className = "form-msg";
    addressMsg.textContent = "> connecting to node... verifying hash...";

    const ref = new URLSearchParams(window.location.search).get("ref") || null;

    try {
      if (WAITLIST_ENDPOINT) {
        const res = await fetch(WAITLIST_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet, chainId: parseInt(CHAIN.chainId, 16), ref, tasks: TASKS.map((t) => t.id) }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      } else {
        await new Promise((r) => setTimeout(r, 1100));
      }

      waitlistCount += 1;
      renderWaitlist();
      bump(statWait);

      const entry = {
        wallet,
        chainId: parseInt(CHAIN.chainId, 16),
        ref,
        id: Math.random().toString(16).slice(2, 8).toUpperCase(),
        position: waitlistCount,
        gpu: STARTER_GPUS[Math.floor(Math.random() * STARTER_GPUS.length)],
        createdAt: new Date().toISOString(),
      };
      storage.set(entry);
      closeModal();
      showTicket(entry);
      toast("⛏  Spot secured! +500 VZ");
    } catch (err) {
      addressMsg.className = "form-msg error";
      addressMsg.textContent = "✗ Connection failed. Please try again in a moment.";
    } finally {
      addressSubmit.disabled = false;
      addressSubmit.classList.remove("loading");
    }
  });

  $("share-btn").addEventListener("click", async () => {
    const entry = storage.get();
    if (!entry) return;
    const link = referralLink(entry);
    try {
      await navigator.clipboard.writeText(link);
      toast("Referral link copied!");
    } catch {
      toast(link);
    }
  });

  /* ---------- Init ---------- */
  $("year").textContent = new Date().getFullYear();
  renderWaitlist();
  renderCountdown();

  const existing = storage.get();
  if (existing) showTicket(existing);
})();
