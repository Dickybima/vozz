/*
 * VOZZ on-chain settings, shared by the landing page (index.html) and the game (play/).
 *
 * `network` picks which Robinhood Chain network the site uses. After deploying the
 * Mining Pass contract (see contracts/README.md), its address goes in `passAddress`
 * for that network — `npm run deploy:<network>` in contracts/ fills it in for you.
 */
window.VOZZ_CONFIG = Object.assign(
  {
    network: "mainnet",
    passPriceEth: "0.001",
    networks: {
      mainnet: {
        chainId: 4663,
        name: "Robinhood Chain",
        rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
        explorerUrl: "https://robinhoodchain.blockscout.com",
        passAddress: "",
      },
      testnet: {
        chainId: 46630,
        name: "Robinhood Chain Testnet",
        rpcUrl: "https://rpc.testnet.chain.robinhood.com",
        explorerUrl: "https://explorer.testnet.chain.robinhood.com",
        passAddress: "",
      },
    },
  },
  window.VOZZ_CONFIG || {}
);
