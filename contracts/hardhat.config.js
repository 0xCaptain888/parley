require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("solidity-coverage");

// DEPLOYER_KEY is only needed for `--network bsc` / `--network bscTestnet`. Never commit it.
const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
  networks: {
    // Current post-Osaka EVM approximation only; not a BSC consensus replay.
    hardhat: process.env.FORK_RPC ? { hardfork: "osaka", forking: { url: process.env.FORK_RPC,
      ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}) } } : {},
    bsc: { url: process.env.BSC_RPC || "https://bsc-dataseed.binance.org", chainId: 56, accounts },
    bscTestnet: { url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545", chainId: 97, accounts },
  },
};
