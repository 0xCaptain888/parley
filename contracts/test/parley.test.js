const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E = ethers.parseEther;
const ZERO = ethers.ZeroAddress;
const KEY = (n) => ethers.zeroPadValue(ethers.toBeHex(n), 32);
const POSTAGE = E("0.0003");
const HOUR = 3600;

async function deploy() {
  const [guardian, alice, bob, carol, dave, eve, frank] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("MockRegistry");
  const registry = await Registry.deploy();
  for (const [h, s] of [["alice", alice], ["bob", bob], ["carol", carol], ["eve", eve], ["frank", frank]]) {
    await registry.register(h, s.address);
  }
  const Token = await ethers.getContractFactory("MockToken");
  const usdt = await Token.deploy("USDT");
  const cake = await Token.deploy("CAKE");
  const Fee = await ethers.getContractFactory("FeeToken");
  const fee = await Fee.deploy();
  const Parley = await ethers.getContractFactory("Parley");
  const parley = await Parley.deploy(
    registry.target, guardian.address, POSTAGE, E("0.05"), E("0.0002"),
    [ZERO, usdt.target], [E("1"), E("500")]
  );
  for (const s of [alice, bob, carol, eve, frank]) {
    await usdt.mint(s.address, E("1000"));
    await cake.mint(s.address, E("100000"));
    await fee.mint(s.address, E("1000"));
  }
  return { parley, registry, usdt, cake, fee, guardian, alice, bob, carol, dave, eve, frank };
}

async function deployOpened() {
  const f = await deploy();
  await f.parley.connect(f.alice).openMailbox(KEY(11));
  await f.parley.connect(f.bob).openMailbox(KEY(12));
  await f.parley.connect(f.carol).openMailbox(KEY(13));
  return f;
}

const offer = (o) => ({
  toHandle: "", giveToken: ZERO, giveAmount: 0n, wantToken: ZERO, wantAmount: 0n,
  ttl: HOUR, stamp: 0n, refOfferId: 0n, memo: "0x", ...o,
});

describe("mailbox", () => {
  it("only Agent ID holders can open, once, with a non-zero key", async () => {
    const { parley, alice, dave } = await loadFixture(deploy);
    await expect(parley.connect(dave).openMailbox(KEY(1))).to.be.revertedWithCustomError(parley, "NotAgentId");
    await expect(parley.connect(alice).openMailbox(ethers.ZeroHash)).to.be.revertedWithCustomError(parley, "BadKey");
    await expect(parley.connect(alice).openMailbox(KEY(1))).to.emit(parley, "MailboxOpened").withArgs(alice.address, KEY(1));
    expect(await parley.memberCount()).to.equal(1n);
    expect(await parley.isMember(alice.address)).to.equal(true);
    await expect(parley.connect(alice).openMailbox(KEY(2))).to.be.revertedWithCustomError(parley, "AlreadyMember");
  });

  it("key rotation and postage bounds", async () => {
    const { parley, alice, dave } = await loadFixture(deployOpened);
    await expect(parley.connect(alice).setKey(KEY(99))).to.emit(parley, "KeyChanged");
    expect((await parley.mailboxes(alice.address)).pubKey).to.equal(KEY(99));
    await expect(parley.connect(alice).setKey(ethers.ZeroHash)).to.be.revertedWithCustomError(parley, "BadKey");
    await expect(parley.connect(dave).setKey(KEY(1))).to.be.revertedWithCustomError(parley, "NotMember");
    await expect(parley.connect(alice).setPostage(E("0.06"))).to.be.revertedWithCustomError(parley, "BadParams");
    await parley.connect(alice).setPostage(0);
    expect(await parley.postageOf(alice.address)).to.equal(0n);
    expect(await parley.postageOf(ethers.Wallet.createRandom().address)).to.equal(POSTAGE);
  });
});

describe("red packets", () => {
  it("public packet: claim opens the mailbox, one share per Agent ID", async () => {
    const { parley, alice, bob, carol, dave, eve, frank } = await loadFixture(deploy);
    await parley.connect(alice).openMailbox(KEY(11));
    await expect(parley.connect(alice).createPacket(3, HOUR, [], "gm", { value: E("0.003") }))
      .to.emit(parley, "PacketCreated").withArgs(1n, alice.address, false, 3, E("0.001"), (v) => v > 0n, "gm");

    await expect(parley.connect(dave).claimPacket(1, KEY(1))).to.be.revertedWithCustomError(parley, "NotAgentId");
    await expect(parley.connect(bob).claimPacket(1, ethers.ZeroHash)).to.be.revertedWithCustomError(parley, "BadKey");
    await expect(parley.connect(alice).claimPacket(1, KEY(1))).to.be.revertedWithCustomError(parley, "SelfTarget");

    const tx = parley.connect(bob).claimPacket(1, KEY(12));
    await expect(tx).to.emit(parley, "PacketClaimed").withArgs(1n, bob.address, E("0.001"), true);
    await expect(tx).to.emit(parley, "MailboxOpened").withArgs(bob.address, KEY(12));
    await expect(tx).to.changeEtherBalances([bob, parley], [E("0.001"), -E("0.001")]);
    expect(await parley.isMember(bob.address)).to.equal(true);
    expect(await parley.allowed(alice.address, bob.address)).to.equal(true);
    await expect(parley.connect(bob).claimPacket(1, KEY(12))).to.be.revertedWithCustomError(parley, "AlreadyClaimed");

    await parley.connect(carol).claimPacket(1, KEY(13));
    await expect(parley.connect(eve).claimPacket(1, KEY(14))).to.emit(parley, "PacketClaimed").withArgs(1n, eve.address, E("0.001"), true);
    await expect(parley.connect(frank).claimPacket(1, KEY(15))).to.be.revertedWithCustomError(parley, "Empty");
    expect((await parley.packets(1)).claimed).to.equal(3n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
  });

  it("refund only after expiry and only what is left", async () => {
    const { parley, alice, bob, carol } = await loadFixture(deployOpened);
    await parley.connect(alice).createPacket(4, HOUR, [], "", { value: E("0.004") });
    await parley.connect(bob).claimPacket(1, KEY(0));
    await expect(parley.connect(alice).refundPacket(1)).to.be.revertedWithCustomError(parley, "NotExpired");
    await expect(parley.connect(bob).refundPacket(1)).to.be.revertedWithCustomError(parley, "NotYours");
    await time.increase(HOUR + 1);
    await expect(parley.connect(carol).claimPacket(1, KEY(0))).to.be.revertedWithCustomError(parley, "Expired");
    await expect(parley.connect(alice).refundPacket(1)).to.changeEtherBalances([alice, parley], [E("0.003"), -E("0.003")]);
    await expect(parley.connect(alice).refundPacket(1)).to.be.revertedWithCustomError(parley, "NothingToDo");
  });

  it("parameter checks", async () => {
    const { parley, alice, dave } = await loadFixture(deployOpened);
    const p = parley.connect(alice);
    await expect(p.createPacket(3, HOUR, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "BadParams"); // not divisible
    await expect(p.createPacket(10, HOUR, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "BadParams"); // below MIN_SHARE
    await expect(p.createPacket(0, HOUR, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createPacket(501, HOUR, [], "", { value: E("0.501") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createPacket(1, 60, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createPacket(1, 8 * 86400, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createPacket(1, HOUR, [], "", { value: E("1.5") })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(p.createPacket(1, HOUR, [], "x".repeat(281), { value: E("0.001") })).to.be.revertedWithCustomError(parley, "TooLong");
    await expect(parley.connect(dave).createPacket(1, HOUR, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "NotMember");
    await expect(p.claimPacket(77, KEY(1))).to.be.revertedWithCustomError(parley, "NotFound");
  });

  it("direct packet: only named handles, mail reaches a handle that has no mailbox yet", async () => {
    const { parley, alice, bob, carol, eve, frank } = await loadFixture(deploy);
    await parley.connect(alice).openMailbox(KEY(11));
    const p = parley.connect(alice);
    await expect(p.createPacket(0, HOUR, ["bob", "nobody"], "", { value: E("0.002") })).to.be.revertedWithCustomError(parley, "UnknownHandle");
    await expect(p.createPacket(0, HOUR, ["bob", "bob"], "", { value: E("0.002") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createPacket(0, HOUR, ["alice"], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "SelfTarget");
    await expect(p.createPacket(3, HOUR, ["bob", "carol"], "", { value: E("0.003") })).to.be.revertedWithCustomError(parley, "BadParams");

    const tx = p.createPacket(0, HOUR, ["bob", "carol"], "hi", { value: E("0.002") });
    await expect(tx).to.emit(parley, "Mail").withArgs(bob.address, alice.address, 10, 0n, 1n, "0x");
    await expect(tx).to.emit(parley, "Mail").withArgs(carol.address, alice.address, 10, 0n, 1n, "0x");
    expect(await parley.inboxLength(bob.address)).to.equal(1n); // waiting in the inbox before bob ever opens
    const waiting = (await parley.getMail(bob.address, 0, 10))[0];
    expect([waiting.from, waiting.kind, waiting.refId, waiting.data]).to.deep.equal([alice.address, 10n, 1n, "0x"]);
    expect(await parley.packetMemo(1)).to.equal("hi"); // greeting is readable with eth_call
    expect(await parley.isMember(bob.address)).to.equal(false);
    expect(await parley.allowed(alice.address, bob.address)).to.equal(true);

    await expect(parley.connect(eve).claimPacket(1, KEY(14))).to.be.revertedWithCustomError(parley, "NotEligible");
    await expect(parley.connect(bob).claimPacket(1, KEY(12))).to.changeEtherBalance(bob, E("0.001"));
    await expect(parley.connect(bob).claimPacket(1, KEY(12))).to.be.revertedWithCustomError(parley, "AlreadyClaimed");
    // bob can answer alice for free now
    await expect(parley.connect(bob).sendMessage("alice", 1, "0x01")).to.emit(parley, "Mail");

    // frank blocks alice -> alice cannot target frank
    await parley.connect(frank).openMailbox(KEY(15));
    await parley.connect(frank).blockHandle("alice");
    await expect(p.createPacket(0, HOUR, ["frank"], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "Blocked");
  });
});

describe("messages and postage", () => {
  it("first contact needs a stamp; a reply releases it; then both directions are free", async () => {
    const { parley, alice, bob } = await loadFixture(deployOpened);
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa"))
      .to.be.revertedWithCustomError(parley, "PostageRequired").withArgs(POSTAGE);
    const tx = parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE });
    await expect(tx).to.emit(parley, "StampPosted").withArgs(alice.address, bob.address, POSTAGE);
    await expect(tx).to.emit(parley, "Mail").withArgs(bob.address, alice.address, 1, 0n, 0n, "0xaa");
    expect((await parley.stamps(bob.address, alice.address)).amount).to.equal(POSTAGE);
    const r = await parley.reach(alice.address, "bob");
    expect(r.free).to.equal(false);
    expect(r.postage).to.equal(POSTAGE);
    expect(r.quotaLeft).to.equal(19n);
    expect(r.pubKey).to.equal(KEY(12));

    const reply = parley.connect(bob).sendMessage("alice", 1, "0xbb");
    await expect(reply).to.emit(parley, "StampReleased").withArgs(alice.address, bob.address, POSTAGE);
    await expect(reply).to.changeEtherBalances([bob, parley], [POSTAGE, -POSTAGE]);
    expect((await parley.stamps(bob.address, alice.address)).amount).to.equal(0n);

    await expect(parley.connect(alice).sendMessage("bob", 2, "0xcc", { value: 1n })).to.be.revertedWithCustomError(parley, "UnexpectedValue");
    await expect(parley.connect(alice).sendMessage("bob", 2, "0xcc")).to.emit(parley, "Mail");
    expect((await parley.reach(alice.address, "bob")).free).to.equal(true);
  });

  it("unanswered stamps can be reclaimed after 72 hours, not before", async () => {
    const { parley, alice, carol } = await loadFixture(deployOpened);
    await parley.connect(alice).sendMessage("carol", 1, "0xaa", { value: POSTAGE });
    await expect(parley.connect(alice).reclaimStamp("carol")).to.be.revertedWithCustomError(parley, "NotExpired");
    await time.increase(72 * HOUR + 1);
    await expect(parley.connect(alice).reclaimStamp("carol")).to.changeEtherBalances([alice, parley], [POSTAGE, -POSTAGE]);
    await expect(parley.connect(alice).reclaimStamp("carol")).to.be.revertedWithCustomError(parley, "NothingToDo");
    await expect(parley.connect(carol).sendMessage("alice", 1, "0xbb")).to.changeEtherBalance(carol, 0n);
  });

  it("stranger quota: 20 first-contact sends per day", async () => {
    const { parley, alice } = await loadFixture(deployOpened);
    for (let i = 0; i < 20; i++) await parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE });
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "QuotaExceeded");
    expect((await parley.reach(alice.address, "bob")).quotaLeft).to.equal(0n);
    await time.increase(24 * HOUR);
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE })).to.emit(parley, "Mail");
    expect((await parley.stamps((await ethers.getSigners())[2].address, alice.address)).amount).to.equal(POSTAGE * 21n);
  });

  it("direct packets to strangers use the same daily quota", async () => {
    const { parley, registry, alice } = await loadFixture(deployOpened);
    const names = [];
    for (let i = 0; i < 21; i++) { const w = ethers.Wallet.createRandom(); names.push("n" + i); await registry.register("n" + i, w.address); }
    await parley.connect(alice).createPacket(0, HOUR, names.slice(0, 20), "", { value: E("0.0002") * 20n });
    await expect(parley.connect(alice).createPacket(0, HOUR, [names[20]], "", { value: E("0.0002") })).to.be.revertedWithCustomError(parley, "QuotaExceeded");
  });

  it("block, unblock, allow", async () => {
    const { parley, alice, bob } = await loadFixture(deployOpened);
    await parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE });
    await parley.connect(bob).blockHandle("alice");
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "Blocked");
    await parley.connect(bob).unblockHandle("alice");
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa")).to.be.revertedWithCustomError(parley, "PostageRequired");
    // allow releases the pending stamp to bob and makes alice free
    await expect(parley.connect(bob).allow("alice")).to.changeEtherBalance(bob, POSTAGE);
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa")).to.emit(parley, "Mail");
  });

  it("input checks", async () => {
    const { parley, alice, dave, eve } = await loadFixture(deployOpened);
    const p = parley.connect(alice);
    await expect(p.sendMessage("eve", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "RecipientNoMailbox");
    await expect(p.sendMessage("nobody", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "UnknownHandle");
    await expect(p.sendMessage("alice", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "SelfTarget");
    await expect(p.sendMessage("bob", 9, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.sendMessage("bob", 1, "0x", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "TooLong");
    await expect(p.sendMessage("bob", 1, "0x" + "aa".repeat(1025), { value: POSTAGE })).to.be.revertedWithCustomError(parley, "TooLong");
    await expect(p.sendMessage("bob", 1, "0xaa", { value: E("0.06") })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(parley.connect(dave).sendMessage("bob", 1, "0xaa")).to.be.revertedWithCustomError(parley, "NotMember");
    await expect(parley.connect(eve).sendMessage("bob", 1, "0xaa")).to.be.revertedWithCustomError(parley, "NotMember");
  });

  it("inbox is readable with eth_call only, in order, with paging", async () => {
    const { parley, alice, bob, carol } = await loadFixture(deployOpened);
    await parley.connect(alice).sendMessage("bob", 1, "0x01", { value: POSTAGE });
    await parley.connect(carol).sendMessage("bob", 2, "0x" + "ab".repeat(300), { value: POSTAGE });
    await parley.connect(alice).requestPayment("bob", ZERO, E("0.01"), HOUR, "0x77", { value: POSTAGE });
    expect(await parley.inboxLength(bob.address)).to.equal(3n);
    expect(await parley.mailCount()).to.equal(3n);
    const all = await parley.getMail(bob.address, 0, 100);
    expect(all.map((m) => [m.from, m.kind, m.refId, m.data])).to.deep.equal([
      [alice.address, 1n, 0n, "0x01"],
      [carol.address, 2n, 0n, "0x" + "ab".repeat(300)],
      [alice.address, 20n, 1n, "0x77"],
    ]);
    expect(all[0].time).to.be.greaterThan(0n);
    expect((await parley.getMail(bob.address, 1, 1)).length).to.equal(1);
    expect((await parley.getMail(bob.address, 2, 50))[0].kind).to.equal(20n);
    expect((await parley.getMail(bob.address, 3, 5)).length).to.equal(0);
    expect((await parley.getMail(alice.address, 0, 5)).length).to.equal(0);
  });

  it("postage 0 opens the inbox to strangers (quota still applies)", async () => {
    const { parley, alice, bob } = await loadFixture(deployOpened);
    await parley.connect(bob).setPostage(0);
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa")).to.emit(parley, "Mail");
    expect((await parley.reach(alice.address, "bob")).quotaLeft).to.equal(19n);
  });
});

describe("payment requests", () => {
  it("BNB request: payer pays payee directly, stamp is released to the payer", async () => {
    const { parley, alice, bob, carol } = await loadFixture(deployOpened);
    await expect(parley.connect(alice).requestPayment("bob", ZERO, E("0.01"), HOUR, "0x", { value: POSTAGE }))
      .to.emit(parley, "RequestCreated").withArgs(1n, alice.address, bob.address, ZERO, E("0.01"), (v) => v > 0n);
    await expect(parley.connect(carol).payRequest(1, { value: E("0.01") })).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(parley.connect(bob).payRequest(1, { value: E("0.02") })).to.be.revertedWithCustomError(parley, "BadParams");
    const tx = parley.connect(bob).payRequest(1, { value: E("0.01") });
    await expect(tx).to.changeEtherBalances([alice, bob, parley], [E("0.01"), -E("0.01") + POSTAGE, -POSTAGE]);
    await expect(tx).to.emit(parley, "RequestClosed").withArgs(1n, 2);
    await expect(tx).to.emit(parley, "Mail").withArgs(alice.address, bob.address, 21, 0n, 1n, "0x");
    expect(await parley.dealsDone(alice.address)).to.equal(1n);
    expect(await parley.dealsDone(bob.address)).to.equal(1n);
    await expect(parley.connect(bob).payRequest(1, { value: E("0.01") })).to.be.revertedWithCustomError(parley, "NotOpen");
  });

  it("token request needs an exact approval and no BNB", async () => {
    const { parley, usdt, alice, bob } = await loadFixture(deployOpened);
    await parley.connect(alice).requestPayment("bob", usdt.target, E("20"), HOUR, "0x1234", { value: POSTAGE });
    await expect(parley.connect(bob).payRequest(1, { value: 1n })).to.be.revertedWithCustomError(parley, "UnexpectedValue");
    await expect(parley.connect(bob).payRequest(1)).to.be.reverted; // no allowance
    await usdt.connect(bob).approve(parley.target, E("20"));
    await expect(parley.connect(bob).payRequest(1)).to.changeTokenBalances(usdt, [alice, bob, parley], [E("20"), -E("20"), 0n]);
    expect(await usdt.allowance(bob.address, parley.target)).to.equal(0n);
  });

  it("decline, cancel, expiry, caps", async () => {
    const { parley, usdt, alice, bob } = await loadFixture(deployOpened);
    const a = parley.connect(alice), b = parley.connect(bob);
    await a.requestPayment("bob", ZERO, E("0.01"), HOUR, "0x", { value: POSTAGE }); // 1
    await expect(a.declineRequest(1)).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(b.declineRequest(1)).to.emit(parley, "RequestClosed").withArgs(1n, 3);
    await expect(b.payRequest(1, { value: E("0.01") })).to.be.revertedWithCustomError(parley, "NotOpen");
    await a.requestPayment("bob", ZERO, E("0.01"), HOUR, "0x", { value: POSTAGE }); // 2
    await expect(b.cancelRequest(2)).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(a.cancelRequest(2)).to.emit(parley, "RequestClosed").withArgs(2n, 4);
    await a.requestPayment("bob", ZERO, E("0.01"), HOUR, "0x", { value: POSTAGE }); // 3
    await time.increase(HOUR + 1);
    await expect(b.payRequest(3, { value: E("0.01") })).to.be.revertedWithCustomError(parley, "Expired");
    await expect(a.requestPayment("bob", ZERO, E("2"), HOUR, "0x", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(a.requestPayment("bob", usdt.target, E("501"), HOUR, "0x", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(a.requestPayment("bob", ZERO, 0, HOUR, "0x", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "BadParams");
  });
});

describe("offers", () => {
  it("named offer BNB -> token settles atomically", async () => {
    const { parley, usdt, alice, bob, carol } = await loadFixture(deployOpened);
    const o = offer({ toHandle: "bob", giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60"), stamp: POSTAGE });
    await expect(parley.connect(alice).createOffer(o, { value: E("0.1") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(parley.connect(alice).createOffer(o, { value: E("0.1") + POSTAGE }))
      .to.emit(parley, "OfferCreated").withArgs(1n, alice.address, bob.address, ZERO, E("0.1"), usdt.target, E("60"), (v) => v > 0n, 0n);
    await expect(parley.connect(carol).acceptOffer(1, E("60"))).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(parley.connect(bob).acceptOffer(1, E("59"))).to.be.revertedWithCustomError(parley, "Underpaid");
    await usdt.connect(bob).approve(parley.target, E("60"));
    const tx = parley.connect(bob).acceptOffer(1, E("60"));
    await expect(tx).to.changeTokenBalances(usdt, [alice, bob, parley], [E("60"), -E("60"), 0n]);
    await expect(tx).to.changeEtherBalances([bob, parley], [E("0.1") + POSTAGE, -(E("0.1") + POSTAGE)]);
    await expect(tx).to.emit(parley, "OfferSettled").withArgs(1n, bob.address, E("0.1"), E("60"));
    expect((await parley.offers(1)).status).to.equal(2n);
    expect(await parley.dealsDone(alice.address)).to.equal(1n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
    await expect(parley.connect(bob).acceptOffer(1, E("60"))).to.be.revertedWithCustomError(parley, "NotOpen");
  });

  it("named offer token -> BNB", async () => {
    const { parley, usdt, alice, bob } = await loadFixture(deployOpened);
    await usdt.connect(alice).approve(parley.target, E("60"));
    await parley.connect(alice).createOffer(
      offer({ toHandle: "bob", giveToken: usdt.target, giveAmount: E("60"), wantAmount: E("0.1"), stamp: POSTAGE }), { value: POSTAGE });
    expect(await usdt.balanceOf(parley.target)).to.equal(E("60"));
    await expect(parley.connect(bob).acceptOffer(1, 0, { value: E("0.09") })).to.be.revertedWithCustomError(parley, "BadParams");
    const tx = parley.connect(bob).acceptOffer(1, 0, { value: E("0.1") });
    await expect(tx).to.changeEtherBalances([alice, bob], [E("0.1"), -E("0.1") + POSTAGE]);
    await expect(tx).to.changeTokenBalances(usdt, [bob, parley], [E("60"), -E("60")]);
  });

  it("token -> token, and public offers on the board", async () => {
    const { parley, usdt, cake, alice, bob, carol, dave, eve } = await loadFixture(deployOpened);
    await cake.connect(alice).approve(parley.target, E("1000"));
    await parley.connect(alice).createOffer(offer({ giveToken: cake.target, giveAmount: E("1000"), wantToken: usdt.target, wantAmount: E("210") }));
    expect((await parley.offers(1)).taker).to.equal(ZERO);
    await expect(parley.connect(alice).acceptOffer(1, E("210"))).to.be.revertedWithCustomError(parley, "SelfTarget");
    await expect(parley.connect(dave).acceptOffer(1, E("210"))).to.be.revertedWithCustomError(parley, "NotMember");
    await expect(parley.connect(eve).acceptOffer(1, E("210"))).to.be.revertedWithCustomError(parley, "NotMember");
    await parley.connect(alice).blockHandle("carol");
    await usdt.connect(carol).approve(parley.target, E("210"));
    await expect(parley.connect(carol).acceptOffer(1, E("210"))).to.be.revertedWithCustomError(parley, "Blocked");
    await usdt.connect(bob).approve(parley.target, E("210"));
    const tx = parley.connect(bob).acceptOffer(1, E("210"));
    await expect(tx).to.changeTokenBalances(cake, [bob, parley], [E("1000"), -E("1000")]);
    await expect(tx).to.changeTokenBalances(usdt, [alice, bob], [E("210"), -E("210")]);
    expect((await parley.offers(1)).status).to.equal(2n);
    // a public offer cannot carry a stamp, a reference or a memo
    await expect(parley.connect(alice).createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("1"), memo: "0x01" }), { value: E("0.1") }))
      .to.be.revertedWithCustomError(parley, "BadParams");
    await expect(parley.connect(alice).createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("1"), stamp: 1n }), { value: E("0.1") + 1n }))
      .to.be.revertedWithCustomError(parley, "BadParams");
  });

  it("decline, cancel, expiry all return the escrow to the maker", async () => {
    const { parley, usdt, alice, bob, carol } = await loadFixture(deployOpened);
    const mk = () => parley.connect(alice).createOffer(
      offer({ toHandle: "bob", giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60"), stamp: POSTAGE }), { value: E("0.1") + POSTAGE });
    await mk(); // 1
    await expect(parley.connect(carol).declineOffer(1)).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(parley.connect(bob).declineOffer(1)).to.changeEtherBalance(alice, E("0.1"));
    await expect(parley.connect(bob).declineOffer(1)).to.be.revertedWithCustomError(parley, "NotOpen");
    await mk(); // 2
    await expect(parley.connect(bob).cancelOffer(2)).to.be.revertedWithCustomError(parley, "NotYours");
    await expect(parley.connect(alice).cancelOffer(2)).to.changeEtherBalance(alice, E("0.1"));
    await mk(); // 3
    await time.increase(HOUR + 1);
    await usdt.connect(bob).approve(parley.target, E("60"));
    await expect(parley.connect(bob).acceptOffer(3, E("60"))).to.be.revertedWithCustomError(parley, "Expired");
    await expect(parley.connect(alice).cancelOffer(3)).to.changeEtherBalance(alice, E("0.1"));
    // three unanswered stamps remain and are reclaimable
    expect((await parley.stamps(bob.address, alice.address)).amount).to.equal(POSTAGE * 3n);
    await time.increase(72 * HOUR);
    await parley.connect(alice).reclaimStamp("bob");
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
  });

  it("counter-offer declines the original and opens the reverse offer in one call", async () => {
    const { parley, usdt, alice, bob, carol } = await loadFixture(deployOpened);
    await parley.connect(alice).createOffer(
      offer({ toHandle: "bob", giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60"), stamp: POSTAGE }), { value: E("0.1") + POSTAGE });
    await usdt.connect(bob).approve(parley.target, E("55"));
    // carol cannot counter an offer that is not hers; bob cannot counter toward a third party
    await usdt.connect(carol).approve(parley.target, E("55"));
    await expect(parley.connect(carol).createOffer(
      offer({ toHandle: "alice", giveToken: usdt.target, giveAmount: E("55"), wantAmount: E("0.1"), refOfferId: 1n, stamp: POSTAGE }), { value: POSTAGE }))
      .to.be.revertedWithCustomError(parley, "NotYours");
    await expect(parley.connect(bob).createOffer(
      offer({ toHandle: "carol", giveToken: usdt.target, giveAmount: E("55"), wantAmount: E("0.1"), refOfferId: 1n, stamp: POSTAGE }), { value: POSTAGE }))
      .to.be.revertedWithCustomError(parley, "NotYours");
    const tx = parley.connect(bob).createOffer(
      offer({ toHandle: "alice", giveToken: usdt.target, giveAmount: E("55"), wantAmount: E("0.1"), refOfferId: 1n }));
    await expect(tx).to.emit(parley, "OfferClosed").withArgs(1n, 3);
    await expect(tx).to.emit(parley, "OfferCreated").withArgs(2n, bob.address, alice.address, usdt.target, E("55"), ZERO, E("0.1"), (v) => v > 0n, 1n);
    await expect(tx).to.changeEtherBalances([alice, bob], [E("0.1"), POSTAGE]); // refund to alice, stamp released to bob
    await expect(parley.connect(alice).acceptOffer(2, 0, { value: E("0.1") })).to.changeTokenBalance(usdt, alice, E("55"));
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
    expect(await usdt.balanceOf(parley.target)).to.equal(0n);
  });

  it("fee-on-transfer tokens: escrow records what arrived; taker must cover the fee on the wanted side", async () => {
    const { parley, usdt, fee, alice, bob } = await loadFixture(deployOpened);
    await parley.connect(bob).allow("alice");
    await parley.connect(alice).allow("bob");
    await fee.connect(alice).approve(parley.target, E("100"));
    await parley.connect(alice).createOffer(offer({ toHandle: "bob", giveToken: fee.target, giveAmount: E("100"), wantToken: usdt.target, wantAmount: E("10") }));
    expect((await parley.offers(1)).giveAmount).to.equal(E("95"));
    await usdt.connect(bob).approve(parley.target, E("10"));
    await expect(parley.connect(bob).acceptOffer(1, E("10"))).to.changeTokenBalance(fee, bob, E("90.25"));
    expect(await fee.balanceOf(parley.target)).to.equal(0n);

    await usdt.connect(alice).approve(parley.target, E("10"));
    await parley.connect(alice).createOffer(offer({ toHandle: "bob", giveToken: usdt.target, giveAmount: E("10"), wantToken: fee.target, wantAmount: E("100") }));
    await fee.connect(bob).approve(parley.target, E("106"));
    await expect(parley.connect(bob).acceptOffer(2, E("100"))).to.be.revertedWithCustomError(parley, "Underpaid");
    await expect(parley.connect(bob).acceptOffer(2, E("106"))).to.changeTokenBalance(fee, alice, E("100.7"));
  });

  it("caps and parameter checks", async () => {
    const { parley, usdt, cake, alice } = await loadFixture(deployOpened);
    const p = parley.connect(alice);
    await expect(p.createOffer(offer({ giveAmount: E("2"), wantToken: usdt.target, wantAmount: E("1") }), { value: E("2") })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(p.createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("501") }), { value: E("0.1") })).to.be.revertedWithCustomError(parley, "OverCap");
    await expect(p.createOffer(offer({ giveAmount: E("0.1"), wantAmount: E("0.1") }), { value: E("0.1") })).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createOffer(offer({ giveAmount: 0n, wantToken: usdt.target, wantAmount: E("1") }))).to.be.revertedWithCustomError(parley, "BadParams");
    await expect(p.createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("1"), ttl: 60 }), { value: E("0.1") })).to.be.revertedWithCustomError(parley, "BadParams");
    await cake.connect(alice).approve(parley.target, E("50000"));
    await expect(p.createOffer(offer({ giveToken: cake.target, giveAmount: E("50000"), wantToken: usdt.target, wantAmount: E("100") }))).to.emit(parley, "OfferCreated"); // unlisted token: no cap
  });
});

describe("guardian", () => {
  it("pause stops new deposits only; every exit stays open", async () => {
    const { parley, usdt, guardian, alice, bob, carol } = await loadFixture(deployOpened);
    await parley.connect(alice).createPacket(2, HOUR, [], "", { value: E("0.002") });
    await parley.connect(alice).createOffer(
      offer({ toHandle: "bob", giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60"), stamp: POSTAGE }), { value: E("0.1") + POSTAGE });
    await parley.connect(alice).createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60") }), { value: E("0.1") });
    await parley.connect(alice).requestPayment("carol", ZERO, E("0.01"), HOUR, "0x", { value: POSTAGE });
    await parley.connect(alice).sendMessage("carol", 1, "0xaa", { value: POSTAGE });

    await expect(parley.connect(alice).setPaused(true)).to.be.revertedWithCustomError(parley, "NotGuardian");
    await expect(parley.connect(guardian).setPaused(true)).to.emit(parley, "PausedSet").withArgs(true);

    await expect(parley.connect(alice).createPacket(1, HOUR, [], "", { value: E("0.001") })).to.be.revertedWithCustomError(parley, "IsPaused");
    await expect(parley.connect(alice).sendMessage("bob", 1, "0xaa", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "IsPaused");
    await expect(parley.connect(alice).requestPayment("bob", ZERO, 1, HOUR, "0x", { value: POSTAGE })).to.be.revertedWithCustomError(parley, "IsPaused");
    await expect(parley.connect(alice).createOffer(offer({ giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("1") }), { value: E("0.1") })).to.be.revertedWithCustomError(parley, "IsPaused");
    await expect(parley.connect(bob).acceptOffer(1, E("60"))).to.be.revertedWithCustomError(parley, "IsPaused");
    await expect(parley.connect(carol).payRequest(1, { value: E("0.01") })).to.be.revertedWithCustomError(parley, "IsPaused");

    await expect(parley.connect(bob).claimPacket(1, KEY(0))).to.changeEtherBalance(bob, E("0.001"));
    await expect(parley.connect(bob).declineOffer(1)).to.changeEtherBalance(alice, E("0.1"));
    await expect(parley.connect(alice).cancelOffer(2)).to.changeEtherBalance(alice, E("0.1"));
    await expect(parley.connect(carol).declineRequest(1)).to.emit(parley, "RequestClosed");
    await time.increase(72 * HOUR + 1);
    await expect(parley.connect(alice).refundPacket(1)).to.changeEtherBalance(alice, E("0.001"));
    await expect(parley.connect(alice).reclaimStamp("bob")).to.changeEtherBalance(alice, POSTAGE);
    await expect(parley.connect(alice).reclaimStamp("carol")).to.changeEtherBalance(alice, POSTAGE * 2n);
    expect(await ethers.provider.getBalance(parley.target)).to.equal(0n);
  });
});

describe("failed pushes and reentrancy", () => {
  it("a receiver that rejects BNB is credited and can withdraw later", async () => {
    const { parley, registry, alice } = await loadFixture(deployOpened);
    const Picky = await ethers.getContractFactory("PickyWallet");
    const picky = await Picky.deploy();
    await registry.register("picky", picky.target);
    await parley.connect(alice).createPacket(2, HOUR, [], "", { value: E("0.002") });
    await expect(picky.claim(parley.target, 1)).to.emit(parley, "Owed").withArgs(picky.target, E("0.001"));
    expect(await parley.pending(picky.target)).to.equal(E("0.001"));
    await expect(picky.pull(parley.target)).to.be.revertedWith("withdraw failed");
    await picky.setAccept(true);
    await expect(picky.pull(parley.target)).to.changeEtherBalances([picky, parley], [E("0.001"), -E("0.001")]);
    await expect(picky.pull(parley.target)).to.be.revertedWithCustomError(parley, "NothingToDo");
  });

  it("a token that re-enters during transfer is stopped by the guard", async () => {
    const { parley, usdt, alice } = await loadFixture(deployOpened);
    const Re = await ethers.getContractFactory("ReentrantToken");
    const re = await Re.deploy();
    await re.mint(alice.address, E("10"));
    await re.connect(alice).approve(parley.target, E("10"));
    await re.arm(parley.target);
    await expect(parley.connect(alice).createOffer(offer({ giveToken: re.target, giveAmount: E("10"), wantToken: usdt.target, wantAmount: E("1") })))
      .to.be.revertedWithCustomError(parley, "ReentrancyGuardReentrantCall");
  });
});

describe("limits", () => {
  it("deployed bytecode fits under the 24,576-byte limit", async () => {
    const { parley } = await loadFixture(deploy);
    const size = (await ethers.provider.getCode(parley.target)).length / 2 - 1;
    console.log(`      deployed bytecode                  ${size} bytes`);
    expect(size).to.be.lessThan(24576);
  });

  it("a direct packet to 50 strangers is impossible (quota 20); to 50 contacts it fits in one transaction", async () => {
    const { parley, registry, alice } = await loadFixture(deployOpened);
    const signers = [];
    for (let i = 0; i < 50; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      await registry.register("m" + i, w.address);
      await alice.sendTransaction({ to: w.address, value: E("0.01") });
      await parley.connect(w).openMailbox(KEY(100 + i));
      await parley.connect(w).allow("alice"); // alice is a contact of everyone
      signers.push(w);
    }
    const names = signers.map((_, i) => "m" + i);
    const r = await (await parley.connect(alice).createPacket(0, HOUR, names, "x".repeat(280), { value: E("0.0002") * 50n })).wait();
    console.log(`      createPacket direct x50, 280B memo ${r.gasUsed}`);
    expect(r.gasUsed).to.be.lessThan(15_000_000n); // baw --gasLimit ceiling
    expect(await parley.inboxLength(signers[49].address)).to.equal(1n);
  });
});

describe("accounting invariant (randomized)", () => {
  it("contract BNB == packets + open BNB offers + stamps + pending, after every step", async () => {
    const f = await loadFixture(deployOpened);
    const { parley, usdt } = f;
    await parley.connect(f.eve).openMailbox(KEY(14));
    await parley.connect(f.frank).openMailbox(KEY(15));
    const actors = [f.alice, f.bob, f.carol, f.eve, f.frank];
    const names = ["alice", "bob", "carol", "eve", "frank"];
    for (const a of actors) await usdt.connect(a).approve(parley.target, E("1000"));
    let seed = 20261122;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const check = async (step) => {
      let sum = 0n;
      const pc = Number(await parley.packetCount());
      for (let i = 1; i <= pc; i++) sum += (await parley.packets(i)).remaining;
      const oc = Number(await parley.offerCount());
      let tokenEscrow = 0n;
      for (let i = 1; i <= oc; i++) {
        const o = await parley.offers(i);
        if (o.status === 1n) { if (o.giveToken === ZERO) sum += o.giveAmount; else tokenEscrow += o.giveAmount; }
      }
      for (const a of actors) {
        sum += await parley.pending(a.address);
        for (const b of actors) if (a !== b) sum += (await parley.stamps(a.address, b.address)).amount;
      }
      expect(await ethers.provider.getBalance(parley.target), `BNB at step ${step}`).to.equal(sum);
      expect(await usdt.balanceOf(parley.target), `USDT at step ${step}`).to.equal(tokenEscrow);
    };
    let ok = 0;
    for (let step = 0; step < 400; step++) {
      const i = rnd(5), j = (i + 1 + rnd(4)) % 5;
      const me = parley.connect(actors[i]);
      const stamp = (await parley.reach(actors[i].address, names[j])).postage;
      try {
        switch (rnd(14)) {
          case 0: await me.createPacket(1 + rnd(4), HOUR, [], "", { value: E("0.0012") }); break;
          case 1: await me.createPacket(0, HOUR, [names[j]], "", { value: E("0.0002") }); break;
          case 2: await me.claimPacket(1 + rnd(Number(await parley.packetCount()) || 1), KEY(0)); break;
          case 3: await me.refundPacket(1 + rnd(Number(await parley.packetCount()) || 1)); break;
          case 4: await me.sendMessage(names[j], 1, "0xaa", { value: stamp }); break;
          case 5: await me.reclaimStamp(names[j]); break;
          case 6: await me.createOffer(offer({ toHandle: names[j], giveAmount: E("0.01"), wantToken: usdt.target, wantAmount: E("5"), stamp }), { value: E("0.01") + stamp }); break;
          case 7: await me.createOffer(offer({ giveToken: usdt.target, giveAmount: E("5"), wantAmount: E("0.01") })); break;
          case 8: { const id = 1 + rnd(Number(await parley.offerCount()) || 1); const o = await parley.offers(id);
                    await me.acceptOffer(id, o.wantAmount, { value: o.wantToken === ZERO ? o.wantAmount : 0n }); break; }
          case 9: await me.cancelOffer(1 + rnd(Number(await parley.offerCount()) || 1)); break;
          case 10: await me.declineOffer(1 + rnd(Number(await parley.offerCount()) || 1)); break;
          case 11: await me.requestPayment(names[j], ZERO, E("0.002"), HOUR, "0x", { value: stamp }); break;
          case 12: await me.payRequest(1 + rnd(Number(await parley.requestCount()) || 1), { value: E("0.002") }); break;
          case 13: if (rnd(3) === 0) await time.increase(rnd(2) ? HOUR + 1 : 73 * HOUR); else await me.allow(names[j]); break;
        }
        ok++;
      } catch (e) { /* reverts are expected; state must be unchanged */ }
      await check(step);
    }
    console.log(`      400 random steps, ${ok} succeeded, invariant held after each`);
    expect(ok).to.be.greaterThan(120);
  });
});

describe("gas report (for the docs)", () => {
  it("prints gas used by the main calls", async () => {
    const { parley, usdt, alice, bob, eve } = await loadFixture(deployOpened);
    const g = async (label, txp) => { const r = await (await txp).wait(); console.log(`      ${label.padEnd(34)} ${r.gasUsed}`); };
    await g("openMailbox", parley.connect(eve).openMailbox(KEY(14)));
    await g("createPacket public x10", parley.connect(alice).createPacket(10, HOUR, [], "gm", { value: E("0.01") }));
    await g("claimPacket (member)", parley.connect(bob).claimPacket(1, KEY(0)));
    await g("createPacket direct x3", parley.connect(alice).createPacket(0, HOUR, ["bob", "carol", "eve"], "hi", { value: E("0.003") }));
    await g("sendMessage first contact 200B", parley.connect(alice).sendMessage("eve", 1, "0x" + "ab".repeat(200), { value: POSTAGE }));
    await g("sendMessage reply 200B", parley.connect(eve).sendMessage("alice", 1, "0x" + "ab".repeat(200)));
    await g("sendMessage 1024B (max)", parley.connect(eve).sendMessage("alice", 1, "0x" + "ab".repeat(1024)));
    await g("requestPayment (stamped)", parley.connect(alice).requestPayment("bob", ZERO, E("0.01"), HOUR, "0x" + "ab".repeat(100), { value: POSTAGE }));
    await g("payRequest BNB", parley.connect(bob).payRequest(1, { value: E("0.01") }));
    await g("createOffer BNB->token named", parley.connect(alice).createOffer(offer({ toHandle: "bob", giveAmount: E("0.1"), wantToken: usdt.target, wantAmount: E("60") }), { value: E("0.1") }));
    await g("createOffer token->BNB public", (async () => { await usdt.connect(alice).approve(parley.target, E("60")); return parley.connect(alice).createOffer(offer({ giveToken: usdt.target, giveAmount: E("60"), wantAmount: E("0.1") })); })());
    await g("cancelOffer (token refund)", parley.connect(alice).cancelOffer(2));
    await g("refund/allow: allow()", parley.connect(bob).allow("eve"));
    await usdt.connect(bob).approve(parley.target, E("60"));
    await g("acceptOffer (pay token)", parley.connect(bob).acceptOffer(1, E("60")));
  });
});
