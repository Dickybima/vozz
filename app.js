/*
 * VOZZ — waitlist page logic: live stats, beta countdown, and the signup form.
 *
 * Signups are stored in localStorage by default. To collect them on a server,
 * set WAITLIST_ENDPOINT to a URL that accepts a JSON POST: { email, ref }.
 */
(() => {
  const WAITLIST_ENDPOINT = ""; // e.g. "https://api.example.com/waitlist"
  const BETA_DATE = new Date("2027-01-15T12:00:00+07:00");
  const BASE_WAITLIST = 12847; // seed count shown before any real signups
  const STORAGE_KEY = "vozz-waitlist";
  const STARTER_GPUS = ["VX 5070", "RZ 6800 XT", "VX 6090", "RZ 7900"];

  const $ = (id) => document.getElementById(id);
  const form = $("waitlist-form");
  const emailInput = $("email");
  const submitBtn = $("submit-btn");
  const msg = $("form-msg");
  const ticket = $("ticket");
  const toastEl = $("toast");

  const storage = {
    get() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
    },
    set(v) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)); } catch { /* private mode */ }
    },
  };

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
    statWait.textContent = waitlistCount.toLocaleString("id-ID");
  }

  setInterval(() => {
    if (window.miningSim) statHash.textContent = formatHashrate(window.miningSim.hashrate);
  }, 250);

  window.addEventListener("block-found", () => {
    statBlocks.textContent = window.miningSim.blocks.toLocaleString("id-ID");
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
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  function showTicket(entry) {
    $("ticket-id").textContent = "#" + entry.id;
    $("ticket-pos").textContent = "#" + entry.position.toLocaleString("id-ID");
    $("ticket-gpu").textContent = entry.gpu;
    ticket.hidden = false;
    form.hidden = true;
    msg.className = "form-msg success";
    msg.textContent = `✓ ${entry.email} terdaftar. Sampai jumpa di closed beta, miner!`;
  }

  function referralLink(entry) {
    const url = new URL(window.location.href);
    url.hash = "";
    url.search = "?ref=" + entry.id;
    return url.toString();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    form.classList.remove("invalid");

    if (!isEmail(email)) {
      void form.offsetWidth;
      form.classList.add("invalid");
      msg.className = "form-msg error";
      msg.textContent = "✗ Format email tidak valid.";
      emailInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add("loading");
    msg.className = "form-msg";
    msg.textContent = "> menghubungkan ke node... verifikasi hash...";

    const ref = new URLSearchParams(window.location.search).get("ref") || null;

    try {
      if (WAITLIST_ENDPOINT) {
        const res = await fetch(WAITLIST_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, ref }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      } else {
        await new Promise((r) => setTimeout(r, 1100));
      }

      waitlistCount += 1;
      renderWaitlist();
      bump(statWait);

      const entry = {
        email,
        ref,
        id: Math.random().toString(16).slice(2, 8).toUpperCase(),
        position: waitlistCount,
        gpu: STARTER_GPUS[Math.floor(Math.random() * STARTER_GPUS.length)],
        createdAt: new Date().toISOString(),
      };
      storage.set(entry);
      showTicket(entry);
      toast("⛏  Slot diamankan! +500 VZ");
    } catch (err) {
      msg.className = "form-msg error";
      msg.textContent = "✗ Gagal terhubung. Coba lagi sebentar lagi.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.classList.remove("loading");
    }
  });

  $("share-btn").addEventListener("click", async () => {
    const entry = storage.get();
    if (!entry) return;
    const link = referralLink(entry);
    try {
      await navigator.clipboard.writeText(link);
      toast("Link referral disalin!");
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
