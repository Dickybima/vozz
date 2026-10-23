# VOZZ Mining Pass contract

`src/VozzMiningPass.sol` is the ERC-721 NFT that unlocks mining in the game (`play/`).

- **Price:** exactly 0.001 ETH (`PRICE`), paid to the contract on `mint()`
- **One per wallet:** `mint()` reverts with `AlreadyHasPass` if the caller already holds one
- **Game check:** `hasPass(address)` returns true while the wallet holds a pass. Passes are transferable, so a pass works for whichever wallet currently holds it.
- **Owner controls:** `setMintOpen(bool)` pauses or resumes minting, and `withdraw(to)` sends the collected ETH to `to`
- **Artwork:** the name, description and SVG image are generated on-chain in `tokenURI`, so there's no IPFS or server to host

Built on OpenZeppelin Contracts 5.0.2 and compiled with solc 0.8.26 (optimizer on, `shanghai` EVM target).

## Setup

```bash
cd contracts
npm install
npm run build   # compile -> build/VozzMiningPass.json
npm test        # 6 tests on a local in-process chain
```

## Deploy

You need a deployer wallet with a little ETH on the target network for gas. **Deploy to testnet first**, try the full mint flow, then deploy to mainnet.

```bash
# Robinhood Chain Testnet (chain ID 46630) — get test ETH from the testnet faucet
PRIVATE_KEY=0x... npm run deploy:testnet

# Robinhood Chain mainnet (chain ID 4663)
PRIVATE_KEY=0x... OWNER=0xYourOwnerOrSafe npm run deploy:mainnet
```

- `OWNER` is the address that can withdraw revenue and pause minting. It defaults to the deployer. A multisig (e.g. a Safe) is strongly recommended for mainnet.
- `RPC_URL` optionally overrides the RPC in `../config.js`.
- The script checks the RPC's chain ID and deploys. It then writes the contract address into `../config.js` under that network's `passAddress`.

After deploying, set `network` in `../config.js` to the network you want the site to use (`"testnet"` or `"mainnet"`), then commit and publish the site.

Never commit a private key. Pass it through the environment only, and use a fresh deployer wallet that holds just enough ETH for gas.

## Withdrawing revenue

Call `withdraw(<address>)` from the owner wallet, for example via the contract's "Write contract" tab on the block explorer once the source is verified.

## Before mainnet

- Verify the contract source on the Robinhood Chain explorer so players can read it.
- Double-check the network settings in `../config.js` against https://docs.robinhood.com/chain.
- The game's check runs in the browser. It stops normal players from mining without a pass, but anyone can bypass it with dev tools, because the game itself runs client-side. If you ever pay out real on-chain rewards, verify the pass and game state on a server or on-chain.
