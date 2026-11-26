const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = ethers.parseEther;
const ZERO = ethers.ZeroAddress;
const KEY = n => ethers.zeroPadValue(ethers.toBeHex(n), 32);
const STAMP = E("0.0003");
const SHARE = E("0.0001");

async function fixture() {
  const [alice, bob, carol, guardian] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("RevocableRegistry")).deploy();
  const wallet = await (await ethers.getContractFactory("CallbackWallet")).deploy();
  const token = await (await ethers.getContractFactory("CallbackToken")).deploy();
  const standard = await (await ethers.getContractFactory("MockToken")).deploy("STANDARD");
  const parley = await (await ethers.getContractFactory("Parley")).deploy(
    registry.target, guardian.address, STAMP, E("0.03"), 1,
    [ZERO, standard.target], [E("0.5"), E("300")],
  );
  for (const [name, address] of [
    ["alice", alice.address], ["bob", bob.address], ["carol", carol.address],
    ["receiver", wallet.target], ["callback", token.target],
  ]) await registry.register(name, address);
  for (const [i, actor] of [alice, bob, carol].entries()) {
    await parley.connect(actor).openMailbox(KEY(i + 1));
    await token.mint(actor.address, E("1000"));
    await standard.mint(actor.address, E("1000"));
  }
  const data = (fn, args = []) => parley.interface.encodeFunctionData(fn, args);
  await wallet.invoke(parley.target, data("openMailbox", [KEY(4)]));
  await token.invoke(parley.target, data("openMailbox", [KEY(5)]));
  const offer = patch => ({
    toHandle: "", giveToken: ZERO, giveAmount: E("0.001"),
    wantToken: token.target, wantAmount: E("1"), ttl: 600,
    stamp: 0, refOfferId: 0, memo: "0x", ...patch,
  });
  const guardError = parley.interface.getError("ReentrancyGuardReentrantCall").selector;
  return { alice, bob, carol, guardian, registry, wallet, token, standard, parley, data, offer, guardError };
}

describe("security: callback isolation", () => {
  for (const targetId of [1, 2]) {
    it(`blocks native claim callback into packet ${targetId} without duplicate payout`, async () => {
      const { parley, wallet, data, guardError } = await loadFixture(fixture);
      await parley.createPacket(2, 600, [], "", { value: SHARE * 2n });
      await parley.createPacket(1, 600, [], "", { value: SHARE });
      await wallet.configure(parley.target, data("claimPacket", [targetId, KEY(0)]), false);
      await expect(wallet.invoke(parley.target, data("claimPacket", [1, KEY(0)]), { gasLimit: 600000 }))
        .to.emit(wallet, "CallbackAttempt").withArgs(false, guardError);
      expect((await parley.packets(1)).remaining).to.equal(SHARE);
      expect((await parley.packets(1)).claimed).to.equal(1);
      expect((await parley.packets(2)).remaining).to.equal(SHARE);
      expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
      expect(await ethers.provider.getBalance(parley.target)).to.equal(SHARE * 2n);
      expect(await parley.pending(wallet.target)).to.equal(0);
    });
  }

  it("blocks recursive pull and pays an existing pending balance only once", async () => {
    const { parley, wallet, data, guardError } = await loadFixture(fixture);
    await parley.createPacket(1, 600, [], "", { value: SHARE });
    await wallet.configure(ZERO, "0x", true);
    await wallet.invoke(parley.target, data("claimPacket", [1, KEY(0)]));
    expect(await parley.pending(wallet.target)).to.equal(SHARE);
    await wallet.configure(parley.target, data("withdraw"), false);
    await expect(wallet.invoke(parley.target, data("withdraw")))
      .to.emit(wallet, "CallbackAttempt").withArgs(false, guardError)
      .and.to.emit(parley, "Withdrawn").withArgs(wallet.target, SHARE);
    expect(await parley.pending(wallet.target)).to.equal(0);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0);
    await expect(wallet.invoke(parley.target, data("withdraw")))
      .to.be.revertedWithCustomError(parley, "NothingToDo");
  });

  it("restores pending on failed pull, then permits an independent retry", async () => {
    const { parley, wallet, data } = await loadFixture(fixture);
    await parley.createPacket(1, 600, [], "", { value: SHARE });
    await wallet.configure(ZERO, "0x", true);
    await wallet.invoke(parley.target, data("claimPacket", [1, KEY(0)]));
    await expect(wallet.invoke(parley.target, data("withdraw"))).to.be.revertedWith("withdraw failed");
    expect(await parley.pending(wallet.target)).to.equal(SHARE);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(SHARE);
    await wallet.configure(ZERO, "0x", false);
    await wallet.invoke(parley.target, data("withdraw"));
    expect(await parley.pending(wallet.target)).to.equal(0);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
  });

  it("prevents an unguarded cancelRequest from reopening or cancelling the currently paid request", async () => {
    const { parley, wallet, bob, data } = await loadFixture(fixture);
    await parley.connect(bob).allow("receiver");
    await wallet.invoke(parley.target, data("requestPayment", ["bob", ZERO, SHARE, 600, "0x"]));
    await wallet.configure(parley.target, data("cancelRequest", [1]), false);
    await expect(parley.connect(bob).payRequest(1, { value: SHARE, gasLimit: 600000 }))
      .to.emit(wallet, "CallbackAttempt")
      .withArgs(false, parley.interface.getError("NotOpen").selector);
    expect((await parley.requests(1)).status).to.equal(2);
    expect(await parley.dealsDone(wallet.target)).to.equal(1);
    expect(await parley.dealsDone(bob.address)).to.equal(1);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
  });

  it("blocks cross-function deposits from a token callback while recording the actual escrow", async () => {
    const { parley, token, standard, offer, data, guardError } = await loadFixture(fixture);
    await token.approve(parley.target, E("10"));
    await token.arm(parley.target, data("createPacket", [1, 600, [], ""]));
    await expect(parley.createOffer(offer({
      giveToken: token.target, giveAmount: E("10"), wantToken: standard.target,
    }))).to.emit(token, "CallbackAttempt").withArgs(false, guardError);
    expect((await parley.offers(1)).giveAmount).to.equal(E("10"));
    expect(await token.balanceOf(parley.target)).to.equal(E("10"));
    expect(await parley.packetCount()).to.equal(0);
  });

  it("blocks repeated swap settlement from the wanted-token callback", async () => {
    const { parley, token, bob, alice, offer, data, guardError } = await loadFixture(fixture);
    await parley.createOffer(offer({}), { value: E("0.001") });
    await token.connect(bob).approve(parley.target, E("1"));
    await token.arm(parley.target, data("acceptOffer", [1, E("1")]));
    const before = await token.balanceOf(alice.address);
    await expect(parley.connect(bob).acceptOffer(1, E("1")))
      .to.emit(token, "CallbackAttempt").withArgs(false, guardError);
    expect(await token.balanceOf(alice.address)).to.equal(before + E("1"));
    expect((await parley.offers(1)).status).to.equal(2);
    expect(await parley.dealsDone(alice.address)).to.equal(1);
    expect(await parley.dealsDone(bob.address)).to.equal(1);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0);
  });

  it("blocks repeated payment from a request-token callback", async () => {
    const { parley, token, bob, data, guardError } = await loadFixture(fixture);
    await parley.connect(bob).allow("alice");
    await parley.requestPayment("bob", token.target, E("2"), 600, "0x");
    await token.connect(bob).approve(parley.target, E("2"));
    await token.arm(parley.target, data("payRequest", [1]));
    await expect(parley.connect(bob).payRequest(1))
      .to.emit(token, "CallbackAttempt").withArgs(false, guardError);
    expect((await parley.requests(1)).status).to.equal(2);
    expect(await token.balanceOf(bob.address)).to.equal(E("998"));
    expect(await token.allowance(bob.address, parley.target)).to.equal(0);
  });

  it("permits a recipient to rotate only its own key during swap payout without changing escrow", async () => {
    const { parley, wallet, standard, bob, data, offer, alice } = await loadFixture(fixture);
    await standard.mint(wallet.target, E("10"));
    await wallet.invoke(standard.target, standard.interface.encodeFunctionData("approve", [parley.target, E("10")]));
    await wallet.invoke(parley.target, data("createOffer", [offer({
      giveToken: standard.target, giveAmount: E("10"), wantToken: ZERO, wantAmount: SHARE,
    })]));
    await wallet.configure(parley.target, data("setKey", [KEY(99)]), false);
    await expect(parley.connect(bob).acceptOffer(1, 0, { value: SHARE, gasLimit: 600000 }))
      .to.emit(wallet, "CallbackAttempt").withArgs(true, "0x");
    expect((await parley.mailboxes(wallet.target)).pubKey).to.equal(KEY(99));
    expect((await parley.mailboxes(alice.address)).pubKey).to.equal(KEY(1));
    expect(await standard.balanceOf(bob.address)).to.equal(E("1010"));
    expect(await standard.balanceOf(parley.target)).to.equal(0);
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
    expect(await parley.inboxLength(wallet.target)).to.equal(1);
  });

  it("credits a rejecting swap maker without reversing token delivery or paying twice", async () => {
    const { parley, wallet, standard, bob, data, offer } = await loadFixture(fixture);
    await standard.mint(wallet.target, E("10"));
    await wallet.invoke(standard.target, standard.interface.encodeFunctionData("approve", [parley.target, E("10")]));
    await wallet.invoke(parley.target, data("createOffer", [offer({
      giveToken: standard.target, giveAmount: E("10"), wantToken: ZERO, wantAmount: SHARE,
    })]));
    await wallet.configure(ZERO, "0x", true);
    await expect(parley.connect(bob).acceptOffer(1, 0, { value: SHARE }))
      .to.emit(parley, "Owed").withArgs(wallet.target, SHARE);
    expect((await parley.offers(1)).status).to.equal(2);
    expect(await standard.balanceOf(bob.address)).to.equal(E("1010"));
    expect(await parley.pending(wallet.target)).to.equal(SHARE);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(SHARE);
    await expect(parley.connect(bob).acceptOffer(1, 0, { value: SHARE }))
      .to.be.revertedWithCustomError(parley, "NotOpen");
    await wallet.configure(ZERO, "0x", false);
    await wallet.invoke(parley.target, data("withdraw"));
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(SHARE);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0);
  });

  it("credits released postage after settlement when the taker rejects its final push", async () => {
    const { parley, wallet, standard, data, offer, alice } = await loadFixture(fixture);
    await standard.approve(parley.target, E("10"));
    await parley.createOffer(offer({
      toHandle: "receiver", giveToken: standard.target, giveAmount: E("10"),
      wantToken: ZERO, wantAmount: SHARE, stamp: STAMP,
    }), { value: STAMP });
    await wallet.configure(ZERO, "0x", true);
    await expect(wallet.invoke(parley.target, data("acceptOffer", [1, 0]), { value: SHARE }))
      .to.emit(parley, "Owed").withArgs(wallet.target, STAMP);
    expect((await parley.offers(1)).status).to.equal(2);
    expect(await standard.balanceOf(wallet.target)).to.equal(E("10"));
    expect(await parley.pending(wallet.target)).to.equal(STAMP);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(STAMP);
    expect((await parley.stamps(wallet.target, alice.address)).amount).to.equal(0);
    await wallet.configure(ZERO, "0x", false);
    await wallet.invoke(parley.target, data("withdraw"));
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(STAMP);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0);
  });

  it("rolls back an earlier native payout when a later token delivery reverts", async () => {
    const { parley, alice, bob, offer } = await loadFixture(fixture);
    const bad = await (await ethers.getContractFactory("BlacklistToken")).deploy();
    await bad.mint(alice.address, E("10"));
    await bad.approve(parley.target, E("10"));
    await parley.createOffer(offer({
      giveToken: bad.target, giveAmount: E("10"), wantToken: ZERO, wantAmount: SHARE,
    }));
    await bad.deny(bob.address, true);
    const before = await ethers.provider.getBalance(alice.address);
    await expect(parley.connect(bob).acceptOffer(1, 0, { value: SHARE }))
      .to.be.revertedWith("blacklisted");
    expect(await ethers.provider.getBalance(alice.address)).to.equal(before);
    expect((await parley.offers(1)).status).to.equal(1);
    expect(await bad.balanceOf(parley.target)).to.equal(E("10"));
    expect(await parley.dealsDone(alice.address)).to.equal(0);
    expect(await parley.dealsDone(bob.address)).to.equal(0);
    expect(await parley.mailCount()).to.equal(0);
    expect(await parley.allowed(alice.address, bob.address)).to.equal(false);
  });
});

describe("security: exact time boundaries", () => {
  it("rejects packet claims at the exact expiry second", async () => {
    const { parley, bob } = await loadFixture(fixture);
    await parley.createPacket(1, 600, [], "", { value: SHARE });
    const expiry = (await parley.packets(1)).expiry;
    await time.setNextBlockTimestamp(expiry);
    await expect(parley.connect(bob).claimPacket(1, KEY(0))).to.be.revertedWithCustomError(parley, "Expired");
    expect((await parley.packets(1)).remaining).to.equal(SHARE);
  });

  it("allows a packet refund at the exact expiry second, once", async () => {
    const { parley, alice } = await loadFixture(fixture);
    await parley.createPacket(1, 600, [], "", { value: SHARE });
    await time.setNextBlockTimestamp((await parley.packets(1)).expiry);
    await expect(parley.refundPacket(1)).to.changeEtherBalances([alice, parley], [SHARE, -SHARE]);
    await expect(parley.refundPacket(1)).to.be.revertedWithCustomError(parley, "NothingToDo");
  });

  it("rejects swap acceptance at exact expiry while keeping cancellation available", async () => {
    const { parley, token, bob, offer } = await loadFixture(fixture);
    await parley.createOffer(offer({}), { value: E("0.001") });
    await token.connect(bob).approve(parley.target, E("1"));
    await time.setNextBlockTimestamp((await parley.offers(1)).expiry);
    await expect(parley.connect(bob).acceptOffer(1, E("1"))).to.be.revertedWithCustomError(parley, "Expired");
    expect((await parley.offers(1)).status).to.equal(1);
    await parley.cancelOffer(1);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0);
  });

  it("rejects payment at exact request expiry without counting a completed deal", async () => {
    const { parley, bob } = await loadFixture(fixture);
    await parley.connect(bob).allow("alice");
    await parley.requestPayment("bob", ZERO, SHARE, 600, "0x");
    await time.setNextBlockTimestamp((await parley.requests(1)).expiry);
    await expect(parley.connect(bob).payRequest(1, { value: SHARE })).to.be.revertedWithCustomError(parley, "Expired");
    expect((await parley.requests(1)).status).to.equal(1);
    expect(await parley.dealsDone(bob.address)).to.equal(0);
  });

  it("reclaims postage at exactly 72 hours but not one second before", async () => {
    const { parley, bob, alice } = await loadFixture(fixture);
    await parley.sendMessage("bob", 1, "0x01", { value: STAMP });
    const sentAt = (await parley.stamps(bob.address, alice.address)).sentAt;
    await time.setNextBlockTimestamp(sentAt + 259199n);
    await expect(parley.reclaimStamp("bob")).to.be.revertedWithCustomError(parley, "NotExpired");
    await time.setNextBlockTimestamp(sentAt + 259200n);
    await expect(parley.reclaimStamp("bob")).to.changeEtherBalances([alice, parley], [STAMP, -STAMP]);
  });

  it("resets the stranger quota at UTC midnight, not a rolling 24-hour boundary", async () => {
    const { parley, alice, bob } = await loadFixture(fixture);
    await parley.connect(bob).setPostage(0);
    const nextDay = (Math.floor(await time.latest() / 86400) + 1) * 86400;
    await time.setNextBlockTimestamp(nextDay - 22);
    for (let i = 0; i < 20; i++) await parley.sendMessage("bob", 1, "0x01");
    await expect(parley.sendMessage("bob", 1, "0x01")).to.be.revertedWithCustomError(parley, "QuotaExceeded");
    expect((await parley.reach(alice.address, "bob")).quotaLeft).to.equal(0);
    await time.setNextBlockTimestamp(nextDay);
    await parley.sendMessage("bob", 1, "0x01");
    expect((await parley.reach(alice.address, "bob")).quotaLeft).to.equal(19);
    expect((await parley.mailboxes(alice.address)).quotaUsed).to.equal(1);
  });
});

describe("security: payment request net receipts", () => {
  it("rejects a decreasing payee balance with Underpaid instead of an arithmetic panic", async () => {
    const { parley, alice, bob } = await loadFixture(fixture);
    const token = await (await ethers.getContractFactory("DecreasingBalanceToken")).deploy();
    await token.mint(alice.address, E("200"));
    await token.mint(bob.address, E("100"));
    await parley.connect(bob).allow("alice");
    await parley.requestPayment("bob", token.target, E("100"), 600, "0x");
    await token.connect(bob).approve(parley.target, E("100"));
    await expect(parley.connect(bob).payRequest(1)).to.be.revertedWithCustomError(parley, "Underpaid");
    expect(await token.balanceOf(alice.address)).to.equal(E("200"));
    expect(await token.balanceOf(bob.address)).to.equal(E("100"));
    expect(await token.totalSupply()).to.equal(E("300"));
    expect(await token.allowance(bob.address, parley.target)).to.equal(E("100"));
    expect((await parley.requests(1)).status).to.equal(1);
    expect(await parley.dealsDone(alice.address)).to.equal(0);
  });

  for (const existingBalance of [0n, E("200")]) {
    it(`rejects fee-on-transfer underdelivery with existing balance ${existingBalance}`, async () => {
      const { parley, alice, bob } = await loadFixture(fixture);
      const fee = await (await ethers.getContractFactory("FeeToken")).deploy();
      await fee.mint(alice.address, existingBalance);
      await fee.mint(bob.address, E("100"));
      await parley.requestPayment("bob", fee.target, E("100"), 600, "0x", { value: STAMP });
      await fee.connect(bob).approve(parley.target, E("100"));
      const mailCount = await parley.mailCount();
      const inboxLength = await parley.inboxLength(alice.address);
      const stamp = await parley.stamps(bob.address, alice.address);
      await expect(parley.connect(bob).payRequest(1)).to.be.revertedWithCustomError(parley, "Underpaid");
      expect(await fee.balanceOf(alice.address)).to.equal(existingBalance);
      expect(await fee.balanceOf(bob.address)).to.equal(E("100"));
      expect(await fee.totalSupply()).to.equal(existingBalance + E("100"));
      expect(await fee.allowance(bob.address, parley.target)).to.equal(E("100"));
      expect((await parley.requests(1)).amount).to.equal(E("100"));
      expect((await parley.requests(1)).status).to.equal(1);
      expect(await parley.dealsDone(alice.address)).to.equal(0);
      expect(await parley.dealsDone(bob.address)).to.equal(0);
      expect(await parley.mailCount()).to.equal(mailCount);
      expect(await parley.inboxLength(alice.address)).to.equal(inboxLength);
      expect((await parley.stamps(bob.address, alice.address)).amount).to.equal(stamp.amount);
      expect((await parley.stamps(bob.address, alice.address)).sentAt).to.equal(stamp.sentAt);
      expect(await parley.allowed(bob.address, alice.address)).to.equal(false);
      expect(await ethers.provider.getBalance(parley.target)).to.equal(STAMP);
      await parley.cancelRequest(1);
      expect((await parley.requests(1)).status).to.equal(4);
    });
  }

  it("accepts an exact no-return token payment against an existing payee balance, once", async () => {
    const { parley, alice, bob } = await loadFixture(fixture);
    const token = await (await ethers.getContractFactory("NoReturnToken")).deploy();
    await token.mint(alice.address, E("200"));
    await token.mint(bob.address, E("100"));
    await parley.connect(bob).allow("alice");
    await parley.requestPayment("bob", token.target, E("100"), 600, "0x");
    await token.connect(bob).approve(parley.target, E("100"));
    await expect(parley.connect(bob).payRequest(1))
      .to.emit(parley, "RequestClosed").withArgs(1, 2);
    expect(await token.balanceOf(alice.address)).to.equal(E("300"));
    expect(await token.balanceOf(bob.address)).to.equal(0);
    expect(await token.allowance(bob.address, parley.target)).to.equal(0);
    expect((await parley.requests(1)).status).to.equal(2);
    expect(await parley.dealsDone(alice.address)).to.equal(1);
    expect(await parley.dealsDone(bob.address)).to.equal(1);
    await expect(parley.connect(bob).payRequest(1)).to.be.revertedWithCustomError(parley, "NotOpen");
  });
});

describe("security: documented reference-contract limitations", () => {
  it("reproduces cached membership after hypothetical Agent ID balance revocation", async () => {
    const { parley, registry, alice, bob } = await loadFixture(fixture);
    await registry.setBalance(bob.address, 0);
    expect(await registry.balanceOf(bob.address)).to.equal(0);
    expect(await parley.isMember(bob.address)).to.equal(true);
    await parley.createPacket(1, 600, [], "", { value: SHARE });
    await expect(parley.connect(bob).claimPacket(1, KEY(0))).to.changeEtherBalance(bob, SHARE);
    expect((await parley.packets(1)).remaining).to.equal(0);
    expect(await parley.allowed(alice.address, bob.address)).to.equal(true);
  });
});
