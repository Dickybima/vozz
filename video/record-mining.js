/*
 * Records the "VOZZ beta — mining gameplay" video from the real playable beta (play/).
 *
 * Starts from a demo save (a mid-game rig with some VOZZ to spend) so the video gets to
 * the good parts quickly, then plays: buy GPUs → overclock → overheat & cool down →
 * cooling upgrade → solo mining until a block is found → claim missions → leaderboard.
 * Encodes assets/mining-gameplay.mp4 (1920×1080) plus a poster.
 *
 *   node video/record-mining.js
 *
 * Solo block finds are random, so the run is retried if no block lands in time.
 * Requires Playwright (Chromium) and ffmpeg with libx264.
 */
const path = require("path");
const { record, ROOT } = require("./recorder");

// Demo save, in the game's own save format (merged over a fresh state by play/game.js).
const DEMO_SAVE = {
  v: 1,
  balance: 2600,
  totalMined: 640,
  gpus: [
    { id: "d1", model: "vx5070", paid: 24 },
    { id: "d2", model: "rz6800", paid: 70 },
    { id: "d3", model: "rz7900", paid: 180 },
  ],
  slotLvl: 2,
  psuLvl: 4,
  coolLvl: 1,
  oc: { core: 0, mem: 0, pl: 100, fan: 60 },
  pool: "neon",
  netBase: 400, // small demo network so solo blocks land within the video
  seenWelcome: false,
  starter: "VX 5070",
};

const scenario = async ({ page, wait, cap, card, start, stop, moveTo, click, slide }) => {
  const tab = (name) => click(`.tab[data-tab="${name}"]`);

  await card(`<div><img src="/assets/logo-mark.svg"><h1>VOZZ BETA<br><em>MINING GAMEPLAY</em></h1><p>Build · Overclock · Mine blocks on Robinhood Chain</p><p class="k">Play free in your browser</p></div>`);
  await start();
  await wait(3200);
  await card("");
  await wait(700);

  await cap("01", "Start mining", "Your rig goes online in the browser");
  await wait(1500);
  await click("#welcome-go");
  await wait(2000);

  await cap("02", "Buy GPUs in the Shop", "More cards = more hashrate. Watch your PSU wattage.");
  await wait(800);
  await click("#tab-shop .item:nth-child(6) .buy"); // VX 9070
  await wait(1600);
  await click("#tab-shop .item:nth-child(5) .buy"); // VX 8080 Ti
  await wait(2200);

  await cap("03", "Overclock for more hashrate", "Push core and memory clocks — the chart climbs");
  await tab("tune");
  await wait(700);
  await slide("#oc-core", 200);
  await wait(500);
  await slide("#oc-mem", 1000);
  await wait(1200);

  await cap("04", "Too hot! Cards throttle at 88°C", "Overclocking adds heat — and 100°C crashes a card");
  await moveTo(".gpu:nth-child(4) .g-temp");
  await page.waitForSelector(".gpu.hot", { timeout: 20000 });
  await wait(1500);

  await cap("05", "Crank the fans to cool down", "Fan speed and cooling upgrades keep clocks stable");
  await slide("#oc-fan", 100);
  await wait(1800);
  await tab("upgrades");
  await wait(600);
  await click("#tab-upgrades .item:nth-child(3) .buy"); // cooling
  await wait(1200);
  await moveTo(".gpu:nth-child(4) .g-temp");
  await page.waitForFunction(() => !document.querySelector(".gpu.hot"), null, { timeout: 20000 });
  await wait(1200);

  await cap("06", "Go solo — win the full 50 VOZZ block", "Or mine in a pool for steady payouts");
  await tab("pool");
  await wait(600);
  await click("#tab-pool .item:nth-child(4) .buy"); // Solo mining
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await wait(700);
  await moveTo("#chain", 200, 0);
  await page.waitForFunction(() => [...document.querySelectorAll("#log li")].some((li) => li.textContent.includes("YOU FOUND BLOCK")), null, { timeout: 45000 });
  await cap("07", "Block found! +50 VOZZ", "Your blocks show up green on the chain");
  await wait(3200);

  await cap("08", "Complete missions for bonus VOZZ", "Every milestone pays out");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await wait(600);
  await tab("missions");
  await wait(700);
  for (let i = 0; i < 3; i++) {
    const btn = await page.$("#tab-missions .buy.claim");
    if (!btn) break;
    await click("#tab-missions .buy.claim");
    await wait(900);
  }
  await wait(600);

  await cap("09", "Climb the leaderboard", "Compete with miners across the network");
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
  await wait(700);
  await click('.ltab[data-ltab="board"]');
  await wait(2800);
  await cap(null, "");
  await wait(400);

  await card(`<div><img src="/assets/logo-mark.svg"><h1>PLAY THE <em>BETA</em> ⛏</h1><p>Free in your browser — no download</p><p class="k">x.com/vozzGPU</p></div>`);
  await wait(3600);
  await stop();
};

(async () => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await record(
        {
          url: "/play/index.html",
          out: path.join(ROOT, "assets", "mining-gameplay.mp4"),
          poster: path.join(ROOT, "assets", "mining-gameplay-poster.jpg"),
          posterAt: 30,
          width: 1680,
          height: 945,
          scale: 1920 / 1680,
          captions: "bottom",
          async prepare(ctx) {
            await ctx.addInitScript((save) => {
              if (!sessionStorage.getItem("demo-loaded")) {
                localStorage.setItem("vozz-beta-save", JSON.stringify({ ...save, lastSave: Date.now() }));
                sessionStorage.setItem("demo-loaded", "1");
              }
            }, DEMO_SAVE);
          },
        },
        scenario
      );
      return;
    } catch (err) {
      console.error(`attempt ${attempt} failed: ${err.message.split("\n")[0]}`);
    }
  }
  process.exit(1);
})();
