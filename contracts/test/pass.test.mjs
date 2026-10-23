// Runs VozzMiningPass against an in-process ganache chain: `npm test`.
import test from "node:test";
import assert from "node:assert/strict";
import ganache from "ganache";
import { ethers } from "ethers";
import { compile } from "../scripts/compile.mjs";

const { abi, bytecode } = compile();
const PRICE = ethers.parseEther("0.001");

async function setup() {
  const g = ganache.provider({ logging: { quiet: true }, chain: { chainId: 46630, hardfork: "shanghai", vmErrorsOnRPCResponse: true }, wallet: { totalAccounts: 3 } });
  const provider = new ethers.BrowserProvider(g);
  const [owner, alice, bob] = await Promise.all([0, 1, 2].map((i) => provider.getSigner(i)));
  const factory = new ethers.ContractFactory(abi, bytecode, owner);
  const pass = await factory.deploy(await owner.getAddress());
  await pass.waitForDeployment();
  return { g, provider, pass, owner, alice, bob };
}

// ganache doesn't hand revert data to ethers on estimateGas, so simulate the call
// directly and decode the custom error name from the raw revert data.
async function revertName({ g, pass }, signer, method, args = [], value = 0n) {
  const tx = {
    from: await signer.getAddress(),
    to: await pass.getAddress(),
    data: pass.interface.encodeFunctionData(method, args),
    value: ethers.toQuantity(value),
  };
  try {
    await g.request({ method: "eth_call", params: [tx, "latest"] });
  } catch (e) {
    const data = (e.data && (e.data.result || e.data)) || "0x";
    return pass.interface.parseError(data).name;
  }
  return null;
}

test("mints one pass for exactly 0.001 ETH", async () => {
  const { pass, alice } = await setup();
  const addr = await alice.getAddress();
  assert.equal(await pass.hasPass(addr), false);
  await (await pass.connect(alice).mint({ value: PRICE })).wait();
  assert.equal(await pass.hasPass(addr), true);
  assert.equal(await pass.ownerOf(1), addr);
  assert.equal(await pass.totalSupply(), 1n);
});

test("rejects the wrong price", async () => {
  const ctx = await setup();
  assert.equal(await revertName(ctx, ctx.alice, "mint", [], PRICE - 1n), "WrongPrice");
  assert.equal(await revertName(ctx, ctx.alice, "mint", [], PRICE * 2n), "WrongPrice");
  assert.equal(await revertName(ctx, ctx.alice, "mint"), "WrongPrice");
  assert.equal(await revertName(ctx, ctx.alice, "mint", [], PRICE), null);
});

test("allows only one pass per wallet", async () => {
  const ctx = await setup();
  await (await ctx.pass.connect(ctx.alice).mint({ value: PRICE })).wait();
  assert.equal(await revertName(ctx, ctx.alice, "mint", [], PRICE), "AlreadyHasPass");
});

test("owner can close minting", async () => {
  const ctx = await setup();
  assert.equal(await revertName(ctx, ctx.alice, "setMintOpen", [false]), "OwnableUnauthorizedAccount");
  await (await ctx.pass.connect(ctx.owner).setMintOpen(false)).wait();
  assert.equal(await revertName(ctx, ctx.alice, "mint", [], PRICE), "MintClosed");
});

test("only the owner can withdraw, and receives all revenue", async () => {
  const ctx = await setup();
  const { provider, pass, owner, alice, bob } = ctx;
  await (await pass.connect(alice).mint({ value: PRICE })).wait();
  await (await pass.connect(bob).mint({ value: PRICE })).wait();
  const target = ethers.Wallet.createRandom().address;
  assert.equal(await revertName(ctx, alice, "withdraw", [target]), "OwnableUnauthorizedAccount");
  await (await pass.connect(owner).withdraw(target)).wait();
  assert.equal(await provider.getBalance(target), PRICE * 2n);
  assert.equal(await provider.getBalance(await pass.getAddress()), 0n);
});

test("tokenURI returns on-chain JSON with an SVG image", async () => {
  const { pass, alice } = await setup();
  await (await pass.connect(alice).mint({ value: PRICE })).wait();
  const uri = await pass.tokenURI(1);
  assert.match(uri, /^data:application\/json;base64,/);
  const meta = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  assert.equal(meta.name, "VOZZ Mining Pass #1");
  assert.match(meta.image, /^data:image\/svg\+xml;base64,/);
  assert.match(Buffer.from(meta.image.split(",")[1], "base64").toString(), /MINING PASS/);
  await assert.rejects(pass.tokenURI(99));
});
