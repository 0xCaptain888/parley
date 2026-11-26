// Usage (mainnet):
//   GUARDIAN=0x... DEFAULT_POSTAGE=0.0003 MAX_POSTAGE=0.03 MIN_SHARE=0.0001 CAP_BNB=0.5 CAP_USD=300 \
//   npx hardhat run scripts/deploy.js --network bsc
// On the local hardhat network a MockRegistry is deployed automatically.
const { ethers, network } = require("hardhat");

const MAINNET = {
  registry: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f", // SPACE ID Agent ID (HandleRegistry)
  usdt: "0x55d398326f99059fF775485246999027B3197955",
  usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

async function main() {
  if (network.name !== "hardhat" && network.name !== "localhost") {
    if (process.env.PARLEY_DEPLOY_CONFIRM !== `deploy:${network.name}`) {
      throw new Error(`External deployment is disabled. Review docs/release-gates.md and explicitly set PARLEY_DEPLOY_CONFIRM=deploy:${network.name} only after authorization.`);
    }
    for (const name of ["GUARDIAN","DEFAULT_POSTAGE","MAX_POSTAGE","MIN_SHARE","CAP_BNB","CAP_USD"]) need(name);
  }
  const [deployer] = await ethers.getSigners();
  let registry = process.env.REGISTRY;
  let usdt = MAINNET.usdt, usdc = MAINNET.usdc;
  if (network.name === "bsc") {
    registry = registry || MAINNET.registry;
  } else if (!registry) {
    const mock = await (await ethers.getContractFactory("MockRegistry")).deploy();
    await mock.waitForDeployment();
    registry = mock.target;
  }
  const guardian = network.name === "bsc" ? need("GUARDIAN") : process.env.GUARDIAN || deployer.address;
  const E = ethers.parseEther;
  const args = [
    registry,
    guardian,
    E(process.env.DEFAULT_POSTAGE || "0.0003"),
    E(process.env.MAX_POSTAGE || "0.03"),
    E(process.env.MIN_SHARE || "0.0001"),
    [ethers.ZeroAddress, usdt, usdc],
    [E(process.env.CAP_BNB || "0.5"), E(process.env.CAP_USD || "300"), E(process.env.CAP_USD || "300")],
  ];
  const parley = await (await ethers.getContractFactory("Parley")).deploy(...args);
  await parley.waitForDeployment();
  const tx = parley.deploymentTransaction();
  const receipt = await tx.wait();
  console.log(JSON.stringify({
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address: parley.target,
    deployer: deployer.address,
    transactionHash: tx.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    constructorArgs: args.map((a) => (Array.isArray(a) ? a.map(String) : String(a))),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
