const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

async function fixture() {
  const [alice, guardian] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("MockRegistry")).deploy();
  const wallet = await (await ethers.getContractFactory("ReturnDataWallet")).deploy();
  await registry.register("alice", alice.address);
  await registry.register("receiver", wallet.target);
  const parley = await (await ethers.getContractFactory("Parley")).deploy(
    registry.target, guardian.address,
    ethers.parseEther("0.0003"), ethers.parseEther("0.03"),
    ethers.parseEther("0.000001"), [ethers.ZeroAddress], [ethers.parseEther("0.5")],
  );
  await parley.openMailbox(ethers.zeroPadValue("0x01", 32));
  const amount = ethers.parseEther("0.0001");
  await parley.createPacket(1, 600, [], "", { value: amount });
  return { parley, wallet, amount };
}

describe("adversarial native returndata", () => {
  it("does not copy a successful 128 KiB return payload into the payer", async () => {
    const { parley, wallet, amount } = await loadFixture(fixture);
    await wallet.configure(128 * 1024, false);
    await expect(wallet.claim(parley.target, 1, { gasLimit: 800000 }))
      .to.emit(parley, "PacketClaimed").withArgs(1, wallet.target, amount, true);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(amount);
    expect(await parley.pending(wallet.target)).to.equal(0n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
  });

  it("credits a reverting return bomb and allows an independent pull", async () => {
    const { parley, wallet, amount } = await loadFixture(fixture);
    await wallet.configure(128 * 1024, true);
    await expect(wallet.claim(parley.target, 1, { gasLimit: 800000 }))
      .to.emit(parley, "Owed").withArgs(wallet.target, amount);
    expect(await parley.pending(wallet.target)).to.equal(amount);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(amount);
    await wallet.configure(0, false);
    await expect(wallet.pull(parley.target)).to.emit(parley, "Withdrawn")
      .withArgs(wallet.target, amount);
    expect(await parley.pending(wallet.target)).to.equal(0n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
  });

  it("isolates an out-of-gas push and keeps accounting conserved", async () => {
    const { parley, wallet, amount } = await loadFixture(fixture);
    await wallet.configure(1024 * 1024, false);
    await expect(wallet.claim(parley.target, 1, { gasLimit: 800000 }))
      .to.emit(parley, "Owed").withArgs(wallet.target, amount);
    expect(await parley.pending(wallet.target)).to.equal(amount);
    expect((await parley.packets(1)).remaining).to.equal(0n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(amount);
    await wallet.configure(0, false);
    await wallet.pull(parley.target);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(amount);
  });
});
