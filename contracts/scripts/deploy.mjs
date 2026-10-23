/*
 * Deploys VozzMiningPass to Robinhood Chain and writes its address into ../config.js.
 *
 *   PRIVATE_KEY=0x... npm run deploy:testnet
 *   PRIVATE_KEY=0x... OWNER=0xYourSafe npm run deploy:mainnet
 *
 * Mint payments are forwarded on every mint to PAYOUT (default: the VOZZ treasury below).
 *
 * Env: PRIVATE_KEY (required, the deployer, needs a little ETH for gas),
 *      OWNER (optional, who can change the payout / pause minting; defaults to the deployer),
 *      PAYOUT (optional, where mint payments go; defaults to DEFAULT_PAYOUT),
 *      RPC_URL (optional, overrides the RPC from config.js).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { compile } from "./compile.mjs";

const DEFAULT_PAYOUT = "0xC7AdA4182aA21A8840Dc0bC732a36B2D32A2dDA1";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG = path.join(ROOT, "config.js");

const network = process.argv[2];
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(CONFIG, "utf8"), sandbox);
const net = sandbox.window.VOZZ_CONFIG.networks[network];
if (!net) {
  console.error(`Usage: node scripts/deploy.mjs <${Object.keys(sandbox.window.VOZZ_CONFIG.networks).join("|")}>`);
  process.exit(1);
}
if (!process.env.PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY to the deployer's private key.");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || net.rpcUrl);
const { chainId } = await provider.getNetwork();
if (Number(chainId) !== net.chainId) {
  console.error(`RPC is chain ${chainId}, expected ${net.chainId} (${net.name}).`);
  process.exit(1);
}

const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const owner = process.env.OWNER || wallet.address;
const payout = process.env.PAYOUT || DEFAULT_PAYOUT;
if (!ethers.isAddress(owner)) throw new Error("OWNER is not a valid address");
if (!ethers.isAddress(payout)) throw new Error("PAYOUT is not a valid address");
console.log(`Network:  ${net.name} (${net.chainId})`);
console.log(`Deployer: ${wallet.address} (${ethers.formatEther(await provider.getBalance(wallet.address))} ETH)`);
console.log(`Owner:    ${owner}`);
console.log(`Payout:   ${payout}`);

const { abi, bytecode } = compile();
const contract = await new ethers.ContractFactory(abi, bytecode, wallet).deploy(owner, payout);
console.log(`Deploying… tx ${contract.deploymentTransaction().hash}`);
await contract.waitForDeployment();
const address = await contract.getAddress();
console.log(`Deployed: ${address}`);
console.log(`Explorer: ${net.explorerUrl}/address/${address}`);

// Write the address into config.js under this network.
const src = fs.readFileSync(CONFIG, "utf8");
const block = new RegExp(`(${network}:\\s*\\{[^}]*?passAddress:\\s*")[^"]*(")`);
if (!block.test(src)) throw new Error(`Couldn't find ${network}.passAddress in config.js — set it by hand.`);
fs.writeFileSync(CONFIG, src.replace(block, `$1${address}$2`));
console.log(`Updated config.js (${network}.passAddress). Set network: "${network}" there to use it.`);
