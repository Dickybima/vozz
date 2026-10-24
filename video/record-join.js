/*
 * Records the "How to join the VOZZ waitlist" tutorial video from the real landing page.
 *
 * Drives the actual waitlist flow in Chromium (Join → 4 X missions → paste wallet →
 * Miner License) with an on-screen cursor and captions, and encodes
 * assets/how-to-join.mp4 plus a poster. X links are stubbed so nothing is posted anywhere.
 *
 *   node video/record-join.js
 *
 * Requires Playwright (Chromium) and ffmpeg with libx264.
 */
const path = require("path");
const { record, ROOT } = require("./recorder");

const DEMO_WALLET = "0x7A3f9c2B41d8E06a5F3c7b9D2e1A4c8B6f0D1c9E";

record(
  {
    url: "/index.html",
    out: path.join(ROOT, "assets", "how-to-join.mp4"),
    poster: path.join(ROOT, "assets", "how-to-join-poster.jpg"),
    width: 1280,
    height: 720,
    captions: "side",
    async prepare(ctx, origin) {
      await ctx.grantPermissions(["clipboard-write"], { origin });
      await ctx.route(/x\.com/, (r) => r.fulfill({ contentType: "text/html", body: "<title>X</title>" }));
      ctx.on("page", (p) => p.url() !== "about:blank" && setTimeout(() => p.close().catch(() => {}), 400));
    },
  },
  async ({ page, wait, cap, card, start, stop, moveTo, click }) => {
    await card(`<div><img src="/assets/logo-mark.svg"><h1>HOW TO JOIN THE<br><em>VOZZ WAITLIST</em></h1><p>4 quick missions + your Robinhood Chain wallet</p><p class="k">vozz · Robinhood Chain</p></div>`);
    await start();
    await wait(3200);
    await card("");
    await wait(900);

    await cap("STEP 1", "Click “Join Waitlist”", "On the VOZZ homepage");
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
      await cap(`STEP ${i + 2}`, `Mission ${i + 1}: ${missions[i][0]}`, missions[i][1]);
      await wait(900);
      await click(`.task:nth-child(${i + 1}) .task-btn`);
      await page.bringToFront();
      await moveTo(`.task:nth-child(${i + 1}) .task-title`);
      await page.waitForSelector(`.task:nth-child(${i + 1}).done`, { timeout: 15000 });
      await wait(700);
    }

    await cap("STEP 6", "Paste your Robinhood Chain wallet address", "Any EVM address (0x…) — or use Connect wallet");
    // Stand in for the viewer's clipboard (headless Chromium has no real one).
    await page.evaluate((a) => { navigator.clipboard.readText = async () => a; }, DEMO_WALLET);
    await page.evaluate(() => document.getElementById("address-submit").scrollIntoView({ block: "end", behavior: "smooth" }));
    await wait(1400);
    await click("#paste-btn");
    await wait(1300);

    await cap("STEP 7", "Submit your address", "That's it — no fee to join the waitlist");
    await wait(900);
    await click("#address-submit");
    await page.waitForSelector("#waitlist-modal", { state: "hidden", timeout: 15000 });
    await wait(600);
    await page.evaluate(() => document.getElementById("ticket").scrollIntoView({ block: "center", behavior: "smooth" }));
    await wait(900);

    await cap("STEP 8", "Your Miner License is ready!", "Queue position, starter GPU and +500 VOZZ bonus");
    await moveTo(".ticket-head");
    await wait(2600);
    await cap("STEP 9", "Copy your referral link", "Invite friends to move the community up");
    await click("#share-btn");
    await wait(2400);
    await cap(null, "");
    await wait(400);

    await card(`<div><img src="/assets/logo-mark.svg"><h1>YOU'RE ON THE <em>LIST</em> ⛏</h1><p>Follow us for the closed beta announcement</p><p class="k">x.com/vozzGPU</p></div>`);
    await wait(3600);
    await stop();
  }
);
