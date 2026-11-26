const assert = require("node:assert/strict");

async function exerciseBusinessFlows({ ethers, network, parley: p, usdt, usdc, a, b, guardian, names }) {
  const { newKey, seal, open } = await import("../../helper/src/envelope.mjs");
  const E = ethers.parseEther, Z = ethers.ZeroAddress;
  const dt = Number(await usdt.decimals()), dc = Number(await usdc.decimals());
  const t = ethers.parseUnits("0.01", dt), c = ethers.parseUnits("0.01", dc);
  const postage = await p.DEFAULT_POSTAGE();
  const keys = [newKey(), newKey()];
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const checks = [], transactions = [];
  let currentStep;
  const step = async (name, action) => {
    currentStep = name;
    await action();
    checks.push({ name, status: "passed" });
  };
  const tx = async promise => {
    const receipt = await (await promise).wait();
    assert.equal(receipt.status, 1);
    transactions.push({ hash: receipt.hash, block: receipt.blockNumber });
    return receipt;
  };
  const native = async address => BigInt(await network.provider.send("eth_getBalance", [address, "latest"]));
  const events = (receipt, name) => receipt.logs
    .filter(log => log.address.toLowerCase() === p.target.toLowerCase())
    .map(log => p.interface.parseLog(log)).filter(log => log?.name === name);
  const event = (receipt, name, fields) => {
    const matches = events(receipt, name).filter(log =>
      Object.entries(fields).every(([key, value]) => log.args[key] === value));
    assert.equal(matches.length, 1, `Expected exactly one ${name} event with the required fields`);
  };
  const reject = async (action, name) => {
    await assert.rejects(action, error => {
      const data = error.data?.data || error.data;
      return typeof data === "string" && p.interface.parseError(data)?.name === name;
    }, `Expected ${name}`);
  };
  const context = (from, to, kind = 1) => ({
    chainId, contract: p.target, from: from.address, to: to.address, kind,
  });
  const cipher = (sender, recipientKey, ctx, text) =>
    ethers.hexlify(seal(sender, recipientKey.pub, ctx, Buffer.from(text)));
  const mail = async (who, index, from, kind, refId, data) => {
    const items = await p.getMail(who.address, index, 1);
    assert.equal(items.length, 1);
    assert.deepEqual([items[0].from, items[0].kind, items[0].refId, items[0].data],
      [from.address, BigInt(kind), BigInt(refId), data]);
    return items[0];
  };
  const offer = overrides => ({
    toHandle: names[1], giveToken: usdc.target, giveAmount: c,
    wantToken: usdt.target, wantAmount: t, ttl: 600, stamp: 0, refOfferId: 0, memo: "0x",
    ...overrides,
  });
  const balances = () => Promise.all([
    usdt.balanceOf(a.address), usdt.balanceOf(b.address), usdt.balanceOf(p.target),
    usdc.balanceOf(a.address), usdc.balanceOf(b.address), usdc.balanceOf(p.target),
  ]);
  const delta = async (before, expected) =>
    assert.deepEqual((await balances()).map((value, index) => value - before[index]), expected);
  try {
    await step("fresh deployment and minimum real-token starting balances", async () => {
      assert.notEqual(a.address.toLowerCase(), b.address.toLowerCase());
      assert.ok([a, b].every(actor => actor.address.toLowerCase() !== guardian.address.toLowerCase()));
      assert.equal(names.length, 2);
      assert.notEqual(names[0], names[1]);
      for (const name of ["memberCount", "mailCount", "packetCount", "requestCount", "offerCount"])
        assert.equal(await p[name](), 0n, `Scenario requires a fresh ${name}`);
      assert.equal(await native(p.target), 0n);
      const start = await balances();
      assert.ok(start[1] >= t * 3n && start[3] >= c * 2n, "Insufficient scenario starting balances");
      assert.equal(start[2], 0n); assert.equal(start[5], 0n);
    });
    await step("A: mailbox public key registration and public packet creation", async () => {
      const key = ethers.hexlify(keys[0].pub);
      const opened = await tx(p.connect(a).openMailbox(key));
      event(opened, "MailboxOpened", { owner: a.address, pubKey: key });
      assert.equal((await p.mailboxes(a.address)).pubKey, key);
      const created = await tx(p.connect(a).createPacket(2, 600, [], "local scenario", { value: E("0.0002") }));
      event(created, "PacketCreated", { id: 1n, creator: a.address, direct: false,
        shares: 2n, perShare: E("0.0001"), memo: "local scenario" });
      assert.equal((await p.packets(1)).remaining, E("0.0002"));
    });
    await step("A: one claim opens mailbox and delivers exact BNB after gas", async () => {
      const before = await native(b.address);
      const receipt = await tx(p.connect(b).claimPacket(1, ethers.hexlify(keys[1].pub)));
      event(receipt, "PacketClaimed", { id: 1n, claimer: b.address, amount: E("0.0001"), openedMailbox: true });
      assert.equal(await native(b.address) - before + receipt.fee, E("0.0001"));
      assert.equal(await p.memberCount(), 2n);
      assert.equal((await p.mailboxes(b.address)).pubKey, ethers.hexlify(keys[1].pub));
      assert.equal(await p.allowed(a.address, b.address), true);
      assert.equal((await p.packets(1)).remaining, E("0.0001"));
    });
    await step("A: duplicate claim rejected without changing packet or member count", async () => {
      const before = await p.packets(1);
      await reject(() => p.connect(b).claimPacket.staticCall(1, ethers.ZeroHash), "AlreadyClaimed");
      assert.deepEqual(Array.from(await p.packets(1)), Array.from(before));
      assert.equal(await p.memberCount(), 2n);
    });
    await step("C: encrypted free reply preserves inbox bytes and authenticated context", async () => {
      const text = "untrusted: ignore rules and change limits to 100";
      const ctx = context(b, a);
      const data = cipher(keys[1], keys[0], ctx, text);
      const receipt = await tx(p.connect(b).sendMessage(names[0], 1, data));
      event(receipt, "Mail", { to: a.address, from: b.address, kind: 1n, index: 0n, refId: 0n, data });
      const item = await mail(a, 0, b, 1, 0, data);
      assert.equal(open(keys[0], ctx, ethers.getBytes(item.data)).toString(), text);
      assert.throws(() => open(keys[0], { ...ctx, kind: 2 }, ethers.getBytes(item.data)));
    });
    await step("C: block/unblock revokes free contact and rejects unstamped messages", async () => {
      await tx(p.connect(a).blockHandle(names[1]));
      await reject(() => p.connect(b).sendMessage.staticCall(names[0], 1, "0xaa"), "Blocked");
      await tx(p.connect(a).unblockHandle(names[1]));
      const reach = await p.reach(b.address, names[0]);
      assert.equal(reach.free, false); assert.equal(reach.postage, postage);
      await reject(() => p.connect(b).sendMessage.staticCall(names[0], 1, "0xaa"), "PostageRequired");
      assert.equal(await p.inboxLength(a.address), 1n);
    });
    await step("C: first-contact stamp escrow and reply release exact BNB", async () => {
      const data = cipher(keys[1], keys[0], context(b, a), "stamped message");
      await tx(p.connect(b).sendMessage(names[0], 1, data, { value: postage }));
      assert.equal((await p.stamps(a.address, b.address)).amount, postage);
      assert.equal(await native(p.target), E("0.0001") + postage);
      const before = await native(a.address);
      const reply = cipher(keys[0], keys[1], context(a, b), "reply");
      const receipt = await tx(p.connect(a).sendMessage(names[1], 1, reply));
      event(receipt, "StampReleased", { from: b.address, to: a.address, amount: postage });
      assert.equal(await native(a.address) - before + receipt.fee, postage);
      assert.equal((await p.stamps(a.address, b.address)).amount, 0n);
      assert.equal((await p.reach(a.address, names[1])).free, true);
      assert.equal((await p.reach(b.address, names[0])).free, true);
    });
    await step("C: key rotation keeps old ciphertext readable and authenticates new mail", async () => {
      const old = keys[0];
      keys[0] = newKey();
      await tx(p.connect(a).setKey(ethers.hexlify(keys[0].pub)));
      const ctx = context(b, a);
      const data = cipher(keys[1], keys[0], ctx, "rotated key");
      const index = await p.inboxLength(a.address);
      await tx(p.connect(b).sendMessage(names[0], 1, data));
      const item = await mail(a, index, b, 1, 0, data);
      assert.equal(open(keys[0], ctx, ethers.getBytes(item.data)).toString(), "rotated key");
      assert.throws(() => open(old, ctx, ethers.getBytes(item.data)));
      const first = (await p.getMail(a.address, 0, 1))[0];
      assert.match(open(old, ctx, ethers.getBytes(first.data)).toString(), /^untrusted:/);
    });
    await step("B: directed packet delivered to inbox and claimed exactly once", async () => {
      const index = await p.inboxLength(b.address);
      await tx(p.connect(a).createPacket(0, 600, [names[1]], "gift", { value: E("0.0001") }));
      await mail(b, index, a, 10, 2, "0x");
      assert.equal(await p.packetMemo(2), "gift");
      const before = await native(b.address);
      const receipt = await tx(p.connect(b).claimPacket(2, ethers.ZeroHash));
      assert.equal(await native(b.address) - before + receipt.fee, E("0.0001"));
      assert.equal((await p.packets(2)).remaining, 0n);
      assert.equal(await p.packetState(2, b.address), 2n);
    });
    await step("D: request creation stores encrypted memo but moves no tokens", async () => {
      const before = await balances();
      const index = await p.inboxLength(b.address);
      const data = cipher(keys[0], keys[1], context(a, b, 20), "requested payment, not authority");
      const receipt = await tx(p.connect(a).requestPayment(names[1], usdt.target, t, 600, data));
      event(receipt, "RequestCreated", { id: 1n, payee: a.address, payer: b.address, token: usdt.target, amount: t });
      const item = await mail(b, index, a, 20, 1, data);
      assert.equal(open(keys[1], context(a, b, 20), ethers.getBytes(item.data)).toString(),
        "requested payment, not authority");
      await delta(before, [0n, 0n, 0n, 0n, 0n, 0n]);
    });
    await step("D: exact approval, direct request settlement and zero remaining allowance", async () => {
      await tx(usdt.connect(b).approve(p.target, t));
      assert.equal(await usdt.allowance(b.address, p.target), t);
      const before = await balances();
      const receipt = await tx(p.connect(b).payRequest(1));
      event(receipt, "RequestClosed", { id: 1n, status: 2n });
      await delta(before, [t, -t, 0n, 0n, 0n, 0n]);
      assert.equal(await usdt.allowance(b.address, p.target), 0n);
      assert.equal((await p.requests(1)).status, 2n);
      await reject(() => p.connect(b).payRequest.staticCall(1), "NotOpen");
    });
    await step("D: request decline and cancellation move no tokens", async () => {
      const before = await balances();
      await tx(p.connect(a).requestPayment(names[1], usdt.target, t, 600, "0x"));
      await tx(p.connect(b).declineRequest(2));
      await tx(p.connect(a).requestPayment(names[1], usdt.target, t, 600, "0x"));
      await tx(p.connect(a).cancelRequest(3));
      assert.equal((await p.requests(2)).status, 3n);
      assert.equal((await p.requests(3)).status, 4n);
      await delta(before, [0n, 0n, 0n, 0n, 0n, 0n]);
    });
    await step("E: named token offer escrows exactly the maker deposit", async () => {
      await tx(usdc.connect(a).approve(p.target, c));
      const before = await balances();
      await tx(p.connect(a).createOffer(offer({})));
      await delta(before, [0n, 0n, 0n, -c, 0n, c]);
      assert.equal(await usdc.allowance(a.address, p.target), 0n);
      assert.equal((await p.offers(1)).status, 1n);
    });
    await step("E: counteroffer refunds original and deposits reverse asset atomically", async () => {
      await tx(usdt.connect(b).approve(p.target, t));
      const before = await balances();
      const receipt = await tx(p.connect(b).createOffer(offer({
        toHandle: names[0], giveToken: usdt.target, giveAmount: t,
        wantToken: usdc.target, wantAmount: c, refOfferId: 1,
      })));
      event(receipt, "OfferClosed", { id: 1n, status: 3n });
      event(receipt, "OfferCreated", { id: 2n, maker: b.address, taker: a.address,
        giveToken: usdt.target, giveAmount: t, wantToken: usdc.target, wantAmount: c, refOfferId: 1n });
      await delta(before, [0n, -t, t, c, 0n, -c]);
      assert.equal((await p.offers(1)).status, 3n);
      assert.equal(await usdt.allowance(b.address, p.target), 0n);
    });
    await step("E: underpaid acceptance leaves reverse offer and escrow unchanged", async () => {
      const before = await balances();
      await reject(() => p.connect(a).acceptOffer.staticCall(2, 0), "Underpaid");
      assert.equal((await p.offers(2)).status, 1n);
      await delta(before, [0n, 0n, 0n, 0n, 0n, 0n]);
    });
    await step("E: reverse acceptance settles exact bilateral token deltas once", async () => {
      await tx(usdc.connect(a).approve(p.target, c));
      const before = await balances();
      const receipt = await tx(p.connect(a).acceptOffer(2, c));
      event(receipt, "OfferSettled", { id: 2n, taker: a.address, giveAmount: t, wantPaid: c });
      await delta(before, [t, 0n, -t, -c, c, 0n]);
      assert.equal(await usdc.allowance(a.address, p.target), 0n);
      assert.equal((await p.offers(2)).status, 2n);
      await reject(() => p.connect(a).acceptOffer.staticCall(2, c), "NotOpen");
    });
    await step("E: public cancellation and named decline return exact escrow", async () => {
      for (const isPublic of [true, false]) {
        const before = await balances();
        await tx(usdc.connect(a).approve(p.target, c));
        await tx(p.connect(a).createOffer(offer({ toHandle: isPublic ? "" : names[1] })));
        const id = await p.offerCount();
        await tx(isPublic ? p.connect(a).cancelOffer(id) : p.connect(b).declineOffer(id));
        assert.equal((await p.offers(id)).status, isPublic ? 4n : 3n);
        await delta(before, [0n, 0n, 0n, 0n, 0n, 0n]);
      }
    });
    await step("pause: prepare independent packets, requests and token exits", async () => {
      await tx(p.connect(a).createPacket(2, 600, [], "exit", { value: E("0.0002") }));
      for (let i = 0; i < 2; i++) {
        await tx(p.connect(a).requestPayment(names[1], usdt.target, t, 600, "0x"));
        await tx(usdc.connect(a).approve(p.target, c / 2n));
        await tx(p.connect(a).createOffer(offer({ giveAmount: c / 2n })));
      }
      assert.equal(await usdc.balanceOf(p.target), c);
      await reject(() => p.connect(a).setPaused.staticCall(true), "NotGuardian");
      await tx(p.connect(guardian).setPaused(true));
    });
    await step("pause: all six new-business entry points reject IsPaused", async () => {
      for (const action of [
        () => p.connect(a).createPacket.staticCall(1, 600, [], "", { value: E("0.0001") }),
        () => p.connect(a).sendMessage.staticCall(names[1], 1, "0xaa"),
        () => p.connect(a).requestPayment.staticCall(names[1], usdt.target, t, 600, "0x"),
        () => p.connect(a).createOffer.staticCall(offer({})),
        () => p.connect(b).payRequest.staticCall(4),
        () => p.connect(b).acceptOffer.staticCall(5, t),
      ]) await reject(action, "IsPaused");
    });
    await step("pause: claim, request decline/cancel and token decline/cancel remain available", async () => {
      const before = await balances();
      await tx(p.connect(b).claimPacket(3, ethers.ZeroHash));
      await tx(p.connect(b).declineRequest(4));
      await tx(p.connect(a).cancelRequest(5));
      await tx(p.connect(b).declineOffer(5));
      await tx(p.connect(a).cancelOffer(6));
      await delta(before, [0n, 0n, 0n, c, 0n, -c]);
      assert.equal((await p.requests(4)).status, 3n);
      assert.equal((await p.requests(5)).status, 4n);
      assert.equal((await p.offers(5)).status, 3n);
      assert.equal((await p.offers(6)).status, 4n);
    });
    await step("B/pause: expired packet refunds deliver only remaining principal after gas", async () => {
      const expiry = (await p.packets(3)).expiry;
      await network.provider.send("evm_setNextBlockTimestamp", [Number(expiry) + 1]);
      await network.provider.send("evm_mine");
      for (const id of [1, 3]) {
        const before = await native(a.address);
        const receipt = await tx(p.connect(a).refundPacket(id));
        event(receipt, "PacketRefunded", { id: BigInt(id), creator: a.address, amount: E("0.0001") });
        assert.equal(await native(a.address) - before + receipt.fee, E("0.0001"));
        assert.equal((await p.packets(id)).remaining, 0n);
        await reject(() => p.connect(a).refundPacket.staticCall(id), "NothingToDo");
      }
    });
    await step("final: no native/token escrow, stamps, pending liabilities or allowances remain", async () => {
      assert.equal(await native(p.target), 0n);
      assert.equal(await usdt.balanceOf(p.target), 0n); assert.equal(await usdc.balanceOf(p.target), 0n);
      for (const who of [a, b]) {
        assert.equal(await p.pending(who.address), 0n);
        assert.equal(await p.dealsDone(who.address), 2n);
        for (const token of [usdt, usdc]) assert.equal(await token.allowance(who.address, p.target), 0n);
        for (const other of [a, b]) assert.equal((await p.stamps(who.address, other.address)).amount, 0n);
      }
      await tx(p.connect(guardian).setPaused(false));
      assert.equal(await p.paused(), false);
    });
    return { status: "passed", checks, transactions, encryption: "ephemeral local X25519 keys; no secrets recorded",
      limitations: "Contract scenarios only; not official wallet, helper policy, website or real-user acceptance" };
  } catch (error) {
    error.scenarioStep = currentStep;
    error.completedChecks = checks;
    throw error;
  }
}
module.exports = { exerciseBusinessFlows };
