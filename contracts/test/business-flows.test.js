const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { exerciseBusinessFlows } = require("../scripts/business-flows");

async function fixture(tokenName = "MockToken") {
  const [guardian, a, b] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("MockRegistry")).deploy();
  await registry.register("scenarioalice", a.address); await registry.register("scenariobob", b.address);
  const factory = await ethers.getContractFactory(tokenName);
  const usdt = await factory.deploy(...(tokenName === "MockToken" ? ["USDT"] : []));
  const usdc = await (await ethers.getContractFactory("MockToken")).deploy("USDC");
  await usdt.mint(b.address, ethers.parseEther("0.03"));
  await usdc.mint(a.address, ethers.parseEther("0.02"));
  const p = await (await ethers.getContractFactory("Parley")).deploy(registry.target, guardian.address,
    ethers.parseEther("0.0003"), ethers.parseEther("0.03"), 1,
    [ethers.ZeroAddress, usdt.target, usdc.target],
    [ethers.parseEther("0.5"), ethers.parseEther("300"), ethers.parseEther("300")]);
  return { ethers, network, parley: p, usdt, usdc, a, b, guardian,
    names: ["scenarioalice", "scenariobob"] };
}
describe("shared local/fork business scenarios", () => {
  it("runs encrypted A-E contract flows and pause exits with only declared minimum balances", async () => {
    const result = await exerciseBusinessFlows(await fixture());
    expect(result.status).to.equal("passed");
    expect(result.checks).to.have.length(22);
    expect(result.transactions.length).to.be.greaterThan(40);
    expect(result.checks.every(check => check.status === "passed")).to.equal(true);
    expect(JSON.stringify(result)).not.to.match(/"sec"|"privateKey"|"secretKey"/);
  });
  it("fails the shared scenario on taxed request underdelivery rather than reporting success", async () => {
    const f = await fixture("FeeToken");
    let failure;
    try { await exerciseBusinessFlows(f); } catch (error) { failure = error; }
    expect(failure).to.exist;
    expect(failure.scenarioStep).to.equal("D: exact approval, direct request settlement and zero remaining allowance");
    expect((await f.parley.requests(1)).status).to.equal(1n);
    expect(await f.usdt.balanceOf(f.b.address)).to.equal(ethers.parseEther("0.03"));
    expect(await f.usdt.balanceOf(f.a.address)).to.equal(0n);
    expect(failure.completedChecks.every(check => check.status === "passed")).to.equal(true);
  });
  it("rejects reused actors before making a transaction", async () => {
    const f = await fixture();
    await expect(exerciseBusinessFlows({ ...f, b: f.a })).to.be.rejected;
    expect(await f.parley.memberCount()).to.equal(0n);
    expect(await f.parley.packetCount()).to.equal(0n);
  });
});
