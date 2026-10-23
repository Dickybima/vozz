# VOZZ Mining Pass contract

`src/VozzMiningPass.sol` is an ERC-721 NFT intended to unlock mining in the game (`play/`).

> **Status: on hold.** The game is free to play right now and doesn't check for this pass, and the contract hasn't been deployed. To turn it back on, deploy it and restore the game's pass gate (git commit `95c77ae`).

- **Price:** exactly 0.001 ETH (`PRICE`). Each mint forwards the payment immediately, in the same transaction, to the **payout address**. The default is the VOZZ treasury `0xC7AdA4182aA21A8840Dc0bC732a36B2D32A2dDA1`.
- **One per wallet:** `mint()` reverts with `AlreadyHasPass` if the caller already holds one
- **Game check:** `hasPass(address)` returns true while the wallet holds a pass. Passes are transferable, so a pass works for whichever wallet currently holds it.
- **Owner controls:** `setMintOpen(bool)` pauses or resumes minting, and `setPayout(address)` changes where payments go. `withdraw(to)` only recovers ETH that reached the contract some other way, since mints never leave ETH in it.
- **Artwork:** the name, description and SVG image are generated on-chain in `tokenURI`, so there's no IPFS or server to host

Built on OpenZeppelin Contracts 5.0.2 and compiled with solc 0.8.26 (optimizer on, `shanghai` EVM target).

## Setup

```bash
cd contracts
npm install
npm run build   # compile -> build/VozzMiningPass.json
npm test        # 8 tests on a local in-process chain
```

## Deploy

You need a deployer wallet with a little ETH on the target network for gas. **Deploy to testnet first**, try the full mint flow, then deploy to mainnet.

```bash
# Robinhood Chain Testnet (chain ID 46630) — get test ETH from the testnet faucet
PRIVATE_KEY=0x... npm run deploy:testnet

# Robinhood Chain mainnet (chain ID 4663)
PRIVATE_KEY=0x... OWNER=0xYourOwnerOrSafe npm run deploy:mainnet
```

- `PAYOUT` is where every mint payment goes. It defaults to `0xC7AdA4182aA21A8840Dc0bC732a36B2D32A2dDA1`, so you only need to set it to use a different address.
- `OWNER` is the address that can change the payout address and pause minting. It defaults to the deployer. A multisig (e.g. a Safe) is strongly recommended for mainnet.
- `RPC_URL` optionally overrides the RPC in `../config.js`.
- The script checks the RPC's chain ID and deploys. It then writes the contract address into `../config.js` under that network's `passAddress`.

After deploying, set `network` in `../config.js` to the network you want the site to use (`"testnet"` or `"mainnet"`), then commit and publish the site.

Never commit a private key. Pass it through the environment only, and use a fresh deployer wallet that holds just enough ETH for gas.

## Revenue

There is nothing to withdraw: each mint sends its 0.001 ETH straight to the payout address. To send future mint payments elsewhere, call `setPayout(<address>)` from the owner wallet. You can do that, for example, from the contract's "Write contract" tab on the block explorer once the source is verified. Make sure the payout address can receive ETH: a normal wallet or a Safe works. If it can't, mints will revert with `PayoutFailed`.

## Before mainnet

- Verify the contract source on the Robinhood Chain explorer so players can read it.
- Double-check the network settings in `../config.js` against https://docs.robinhood.com/chain.
- The game's check runs in the browser. It stops normal players from mining without a pass, but anyone can bypass it with dev tools, because the game itself runs client-side. If you ever pay out real on-chain rewards, verify the pass and game state on a server or on-chain.
