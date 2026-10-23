/*
 * VOZZ wallet connector + Mining Pass helpers, shared by the landing page and the game.
 *
 * - Finds installed wallets via EIP-6963 (MetaMask, Rabby, Coinbase Wallet, OKX, …),
 *   falling back to window.ethereum, and shows a picker. On phones without an injected
 *   wallet it offers "open in wallet app" deep links instead.
 * - Connects, switches to (or adds) the configured Robinhood Chain network.
 * - Reads hasPass(address) and mints the Mining Pass (0.001 ETH) on the contract from config.js.
 *
 * Exposes window.VozzWallet. Needs config.js to be loaded first. No dependencies.
 */
(() => {
  const CFG = window.VOZZ_CONFIG;
  const NET = CFG.networks[CFG.network];
  const CHAIN_HEX = "0x" + NET.chainId.toString(16);
  const PRICE_WEI = BigInt(Math.round(parseFloat(CFG.passPriceEth) * 1e6)) * 10n ** 12n;
  const STORE_KEY = "vozz-wallet";

  const SEL = {
    mint: "0x1249c58b",
    hasPass: "0x937cde20",
    mintOpen: "0x24bbd049",
    totalSupply: "0x18160ddd",
  };
  const ERRORS = {
    "0xf7760f25": "The mint price must be exactly " + CFG.passPriceEth + " ETH.",
    "0x6fea4950": "This wallet already has a Mining Pass.",
    "0x589ed34b": "Minting is closed right now.",
  };

  // Suggested wallets when they aren't installed. Matched to EIP-6963 `rdns`.
  const SUGGESTED = [
    { rdns: "io.metamask", name: "MetaMask", install: "https://metamask.io/download/", open: (u) => "https://metamask.app.link/dapp/" + u.replace(/^https?:\/\//, "") },
    { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", install: "https://www.coinbase.com/wallet/downloads", open: (u) => "https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(u) },
    { rdns: "io.rabby", name: "Rabby Wallet", install: "https://rabby.io/" },
    { rdns: "com.okex.wallet", name: "OKX Wallet", install: "https://www.okx.com/web3", open: (u) => "okx://wallet/dapp/url?dappUrl=" + encodeURIComponent(u) },
    { rdns: "com.trustwallet.app", name: "Trust Wallet", install: "https://trustwallet.com/download", open: (u) => "https://link.trustwallet.com/open_url?coin_id=60&url=" + encodeURIComponent(u) },
  ];

  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const safeIcon = (src) => (typeof src === "string" && /^data:image\/(svg\+xml|png|webp|jpeg|gif)[;,]/.test(src) ? src : "");

  /* ---------- Discovery ---------- */
  const found = new Map(); // rdns/uuid -> { info, provider }
  window.addEventListener("eip6963:announceProvider", (e) => {
    const { info, provider } = e.detail || {};
    if (!info || !provider) return;
    found.set(info.rdns || info.uuid, { info, provider });
  });
  const discover = () => {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return new Promise((r) => setTimeout(r, 250));
  };
  function wallets() {
    const list = [...found.values()];
    if (!list.length && window.ethereum) {
      list.push({ info: { rdns: "injected", name: "Browser Wallet", icon: "" }, provider: window.ethereum });
    }
    return list;
  }

  /* ---------- State + events ---------- */
  const state = { provider: null, info: null, address: null, chainOk: false };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn({ ...state }));

  function bindProvider(p) {
    if (!p.on) return;
    p.on("accountsChanged", (accs) => {
      if (state.provider !== p) return;
      state.address = accs && accs[0] ? accs[0] : null;
      if (!state.address) forget();
      emit();
    });
    p.on("chainChanged", (id) => {
      if (state.provider !== p) return;
      state.chainOk = String(id).toLowerCase() === CHAIN_HEX;
      emit();
    });
  }

  function forget() {
    state.provider = null;
    state.info = null;
    state.address = null;
    state.chainOk = false;
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }

  async function connectWith(w) {
    const accounts = await w.provider.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts[0]) throw new Error("No account returned by the wallet.");
    state.provider = w.provider;
    state.info = w.info;
    state.address = accounts[0];
    bindProvider(w.provider);
    try { localStorage.setItem(STORE_KEY, w.info.rdns || "injected"); } catch { /* ignore */ }
    await ensureChain();
    emit();
    return { ...state };
  }

  async function ensureChain() {
    const p = state.provider;
    if (!p) throw new Error("Connect a wallet first.");
    const current = String(await p.request({ method: "eth_chainId" })).toLowerCase();
    if (current !== CHAIN_HEX) {
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
      } catch (err) {
        const code = err && (err.code ?? (err.data && err.data.originalError && err.data.originalError.code));
        if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String(err && err.message))) throw err;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CHAIN_HEX,
            chainName: NET.name,
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: [NET.rpcUrl],
            blockExplorerUrls: [NET.explorerUrl],
          }],
        });
      }
    }
    state.chainOk = String(await p.request({ method: "eth_chainId" })).toLowerCase() === CHAIN_HEX;
    emit();
    if (!state.chainOk) throw new Error(`Please switch your wallet to ${NET.name}.`);
  }

  // Reconnect silently (no popup) to the wallet used last time, if it still authorizes us.
  async function restore() {
    let rdns;
    try { rdns = localStorage.getItem(STORE_KEY); } catch { /* ignore */ }
    if (!rdns) return { ...state };
    await discover();
    const w = wallets().find((x) => (x.info.rdns || "injected") === rdns);
    if (!w) return { ...state };
    try {
      const accounts = await w.provider.request({ method: "eth_accounts" });
      if (accounts && accounts[0]) {
        state.provider = w.provider;
        state.info = w.info;
        state.address = accounts[0];
        state.chainOk = String(await w.provider.request({ method: "eth_chainId" })).toLowerCase() === CHAIN_HEX;
        bindProvider(w.provider);
        emit();
      }
    } catch { /* ignore */ }
    return { ...state };
  }

  function disconnect() {
    const p = state.provider;
    forget();
    // Best effort: some wallets support revoking the site's permission.
    if (p) p.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    emit();
  }

  /* ---------- RPC helpers ---------- */
  async function rpc(method, params) {
    if (state.provider && state.chainOk) return state.provider.request({ method, params });
    const res = await fetch(NET.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) throw Object.assign(new Error(json.error.message), json.error);
    return json.result;
  }
  const pad = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const call = (data) => rpc("eth_call", [{ to: NET.passAddress, data }, "latest"]);

  function revertMessage(err) {
    const raw = (JSON.stringify(err && (err.data || err)) || "") + String(err && err.message);
    const sel = Object.keys(ERRORS).find((k) => raw.toLowerCase().includes(k));
    if (sel) return ERRORS[sel];
    if (err && (err.code === 4001 || /reject|denied|cancel/i.test(err.message))) return "Transaction cancelled in your wallet.";
    if (/insufficient funds/i.test(err && err.message)) return `Not enough ETH on ${NET.name} for the mint plus gas.`;
    return (err && (err.shortMessage || err.message)) || "Transaction failed.";
  }

  const passConfigured = () => /^0x[0-9a-fA-F]{40}$/.test(NET.passAddress || "");

  async function hasPass(address = state.address) {
    if (!passConfigured() || !address) return false;
    const out = await call(SEL.hasPass + pad(address));
    return BigInt(out || "0x0") !== 0n;
  }

  async function passStats() {
    if (!passConfigured()) return null;
    const [open, supply] = await Promise.all([call(SEL.mintOpen), call(SEL.totalSupply)]);
    return { mintOpen: BigInt(open) !== 0n, minted: Number(BigInt(supply)) };
  }

  /**
   * Mint one Mining Pass. `onStatus(stage, info)` is called with
   * "checking" | "confirm" (waiting for the wallet) | "pending" (tx hash) | "done".
   */
  async function mintPass(onStatus = () => {}) {
    if (!passConfigured()) throw new Error("The Mining Pass contract isn't live yet.");
    await ensureChain();
    const from = state.address;
    const tx = { from, to: NET.passAddress, value: "0x" + PRICE_WEI.toString(16), data: SEL.mint };
    onStatus("checking");

    const balance = BigInt(await rpc("eth_getBalance", [from, "latest"]));
    if (balance < PRICE_WEI) throw new Error(`You need at least ${CFG.passPriceEth} ETH (plus gas) on ${NET.name}.`);
    try {
      await rpc("eth_call", [tx, "latest"]); // simulate first so contract errors read nicely
    } catch (err) {
      throw new Error(revertMessage(err));
    }

    onStatus("confirm");
    let hash;
    try {
      hash = await state.provider.request({ method: "eth_sendTransaction", params: [tx] });
    } catch (err) {
      throw new Error(revertMessage(err));
    }
    onStatus("pending", hash);

    const started = Date.now();
    while (Date.now() - started < 5 * 60 * 1000) {
      const receipt = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
      if (receipt) {
        if (receipt.status !== "0x1") throw new Error("The mint transaction reverted.");
        onStatus("done", hash);
        return hash;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("Still waiting for confirmation — check the explorer and refresh.");
  }

  /* ---------- Picker UI ---------- */
  const CSS = `
  .vw-overlay{position:fixed;inset:0;z-index:100;display:grid;place-items:center;padding:16px;background:rgba(2,4,8,.78);backdrop-filter:blur(6px)}
  .vw-panel{width:100%;max-width:400px;max-height:calc(100vh - 32px);overflow-y:auto;padding:22px 18px 18px;border-radius:18px;background:linear-gradient(160deg,#0e1626,#070b14);border:1px solid rgba(0,255,170,.22);box-shadow:0 0 80px rgba(0,255,170,.15);color:#e6f1ff;font-family:Inter,system-ui,sans-serif;animation:vwIn .35s cubic-bezier(.2,1.3,.4,1)}
  @keyframes vwIn{from{opacity:0;transform:translateY(16px) scale(.97)}}
  .vw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
  .vw-head h2{font-family:Orbitron,sans-serif;font-size:1.05rem;letter-spacing:.04em;margin:0}
  .vw-x{width:32px;height:32px;border:none;border-radius:8px;background:none;color:#8a9bb4;font-size:1.5rem;cursor:pointer}
  .vw-x:hover{background:rgba(255,255,255,.06);color:#e6f1ff}
  .vw-sub{color:#8a9bb4;font-size:.85rem;margin:0 0 14px}
  .vw-sub b{color:#ccff00;font-weight:600}
  .vw-label{font-family:Orbitron,sans-serif;font-size:.62rem;letter-spacing:.1em;color:#8a9bb4;margin:14px 0 8px}
  .vw-list{display:grid;gap:8px}
  .vw-opt{display:flex;align-items:center;gap:12px;width:100%;padding:11px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:#e6f1ff;font:600 .92rem Inter,system-ui,sans-serif;text-align:left;cursor:pointer;text-decoration:none;transition:border-color .15s,background .15s}
  .vw-opt:hover{border-color:#00ffaa;background:rgba(0,255,170,.06)}
  .vw-opt:disabled{opacity:.6;cursor:wait}
  .vw-ico{width:32px;height:32px;border-radius:9px;flex:none;display:grid;place-items:center;background:rgba(0,255,170,.1);color:#00ffaa;font:700 .85rem Orbitron,sans-serif;overflow:hidden}
  .vw-ico img{width:100%;height:100%;object-fit:contain}
  .vw-name{flex:1}
  .vw-tag{font:600 .66rem 'JetBrains Mono',monospace;padding:2px 7px;border-radius:6px;color:#00ffaa;background:rgba(0,255,170,.1)}
  .vw-tag.dim{color:#8a9bb4;background:rgba(255,255,255,.06)}
  .vw-msg{min-height:1.2em;margin:12px 0 0;font:.8rem 'JetBrains Mono',monospace;color:#8a9bb4}
  .vw-msg.err{color:#ff2bd6}
  .vw-foot{margin:14px 0 0;font-size:.72rem;color:#5d6d84;text-align:center}`;

  let styled = false;
  function ensureStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement("style");
    s.textContent = CSS;
    document.head.append(s);
  }

  function option({ icon, name, tag, dim, href, onClick }) {
    const el = document.createElement(href ? "a" : "button");
    el.className = "vw-opt";
    if (href) { el.href = href; el.target = href.startsWith("http") ? "_blank" : "_self"; el.rel = "noopener"; }
    else el.type = "button";
    const ico = document.createElement("span");
    ico.className = "vw-ico";
    const src = safeIcon(icon);
    if (src) { const img = document.createElement("img"); img.src = src; img.alt = ""; ico.append(img); }
    else ico.textContent = name.charAt(0);
    const label = document.createElement("span");
    label.className = "vw-name";
    label.textContent = name;
    el.append(ico, label);
    if (tag) { const t = document.createElement("span"); t.className = "vw-tag" + (dim ? " dim" : ""); t.textContent = tag; el.append(t); }
    if (onClick) el.addEventListener("click", onClick);
    return el;
  }

  /** Opens the wallet picker. Resolves with the connected state, or null if closed. */
  function pick() {
    ensureStyle();
    return new Promise(async (resolve) => {
      await discover();
      const overlay = document.createElement("div");
      overlay.className = "vw-overlay";
      overlay.innerHTML = `
        <div class="vw-panel" role="dialog" aria-modal="true" aria-labelledby="vw-title">
          <div class="vw-head"><h2 id="vw-title">Connect a wallet</h2><button class="vw-x" type="button" aria-label="Close">&times;</button></div>
          <p class="vw-sub">VOZZ runs on <b>${NET.name}</b>. Pick a wallet to continue.</p>
          <div class="vw-body"></div>
          <p class="vw-msg" role="status"></p>
          <p class="vw-foot">We only read your address. Transactions always need your approval in the wallet.</p>
        </div>`;
      const body = overlay.querySelector(".vw-body");
      const msg = overlay.querySelector(".vw-msg");
      const close = (result) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (e) => e.key === "Escape" && close(null);
      overlay.addEventListener("click", (e) => e.target === overlay && close(null));
      overlay.querySelector(".vw-x").addEventListener("click", () => close(null));
      document.addEventListener("keydown", onKey);

      const installed = wallets();
      if (installed.length) {
        body.append(Object.assign(document.createElement("p"), { className: "vw-label", textContent: "INSTALLED" }));
        const list = document.createElement("div");
        list.className = "vw-list";
        installed.forEach((w) => {
          const btn = option({
            icon: w.info.icon,
            name: w.info.name,
            tag: "Detected",
            onClick: async () => {
              list.querySelectorAll("button").forEach((b) => (b.disabled = true));
              msg.className = "vw-msg";
              msg.textContent = `Approve the connection in ${w.info.name}…`;
              try {
                close(await connectWith(w));
              } catch (err) {
                msg.className = "vw-msg err";
                msg.textContent = err && err.code === 4001 ? "Connection cancelled." : (err && err.message) || "Couldn't connect.";
                list.querySelectorAll("button").forEach((b) => (b.disabled = false));
              }
            },
          });
          list.append(btn);
        });
        body.append(list);
      }

      const have = new Set(installed.map((w) => w.info.rdns));
      const others = SUGGESTED.filter((s) => !have.has(s.rdns) && (!isMobile || s.open));
      if (others.length) {
        body.append(Object.assign(document.createElement("p"), {
          className: "vw-label",
          textContent: isMobile && !installed.length ? "OPEN IN A WALLET APP" : installed.length ? "OTHER WALLETS" : "GET A WALLET",
        }));
        const list = document.createElement("div");
        list.className = "vw-list";
        others.forEach((s) =>
          list.append(option({
            name: s.name,
            tag: isMobile && s.open ? "Open app" : "Install",
            dim: true,
            href: isMobile && s.open ? s.open(location.href) : s.install,
          }))
        );
        body.append(list);
      }

      document.body.append(overlay);
      const first = overlay.querySelector(".vw-opt");
      (first || overlay.querySelector(".vw-x")).focus();
    });
  }

  window.VozzWallet = {
    network: NET,
    priceEth: CFG.passPriceEth,
    get state() { return { ...state }; },
    onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    pick,
    restore,
    ensureChain,
    disconnect,
    hasPass,
    passStats,
    mintPass,
    passConfigured,
    short,
    explorerTx: (h) => `${NET.explorerUrl}/tx/${h}`,
    explorerAddress: (a) => `${NET.explorerUrl}/address/${a}`,
  };
})();
