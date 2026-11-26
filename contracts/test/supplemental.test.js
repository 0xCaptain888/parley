const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const E = ethers.parseEther, Z = ethers.ZeroAddress;
const key = n => ethers.zeroPadValue(ethers.toBeHex(n),32);
async function fixture(){
  const [alice,bob,carol,guardian] = await ethers.getSigners();
  const registry=await (await ethers.getContractFactory("MockRegistry")).deploy();
  const token=await (await ethers.getContractFactory("MockToken")).deploy("USDT");
  for(const [i,s] of [alice,bob,carol].entries()){
    await registry.register(["alice","bob","carol"][i],s.address);
    await token.mint(s.address,E("1000"));
  }
  const parley=await (await ethers.getContractFactory("Parley")).deploy(registry.target,guardian.address,E("0.0003"),E("0.03"),E("0.000001"),[Z,token.target],[E("0.5"),E("300")]);
  await parley.connect(alice).openMailbox(key(1));
  await parley.connect(bob).openMailbox(key(2));
  const offer=p=>({toHandle:"",giveToken:Z,giveAmount:E("0.001"),wantToken:token.target,wantAmount:E("1"),ttl:600,stamp:0,refOfferId:0,memo:"0x",...p});
  return {alice,bob,carol,guardian,registry,token,parley,offer};
}
describe("spec 11.2 supplemental boundaries",()=>{
  it("accepts both TTL endpoints, 500 shares, 280-byte greeting and 1024-byte ciphertext",async()=>{
    const {parley,alice,bob,offer}=await loadFixture(fixture);
    await expect(parley.createPacket(500,600,[],"x".repeat(280),{value:E("0.0005")})).to.emit(parley,"PacketCreated");
    await expect(parley.createPacket(1,604800,[],"",{value:E("0.0001")})).to.emit(parley,"PacketCreated");
    await parley.connect(bob).setPostage(0);
    await expect(parley.sendMessage("bob",1,"0x"+"ab".repeat(1024))).to.emit(parley,"Mail");
    await expect(parley.requestPayment("bob",Z,1n,600,"0x")).to.emit(parley,"RequestCreated");
    await expect(parley.requestPayment("bob",Z,1n,604800,"0x")).to.emit(parley,"RequestCreated");
    await expect(parley.createOffer(offer({ttl:600}),{value:E("0.001")})).to.emit(parley,"OfferCreated");
    await expect(parley.createOffer(offer({ttl:604800}),{value:E("0.001")})).to.emit(parley,"OfferCreated");
    expect((await parley.packets(1)).shares).to.equal(500n);
    expect(await parley.packetMemo(1)).to.equal("x".repeat(280));
  });
  it("reach covers unknown, registered unopened, stranger, free, blocked, quota and reset",async()=>{
    const {parley,alice,bob,carol}=await loadFixture(fixture);
    expect((await parley.reach(alice.address,"missing")).registered).to.equal(false);
    let r=await parley.reach(alice.address,"carol");
    expect(r.registered).to.equal(true);expect(r.hasMailbox).to.equal(false);
    r=await parley.reach(alice.address,"bob");
    expect(r.hasMailbox).to.equal(true);expect(r.free).to.equal(false);
    expect(r.postage).to.equal(E("0.0003"));expect(r.pubKey).to.equal(key(2));expect(r.quotaLeft).to.equal(20n);
    await parley.connect(bob).allow("alice");
    expect((await parley.reach(alice.address,"bob")).free).to.equal(true);
    await parley.connect(bob).blockHandle("alice");
    r=await parley.reach(alice.address,"bob");expect(r.isBlocked).to.equal(true);expect(r.free).to.equal(false);
    await parley.connect(bob).unblockHandle("alice");await parley.connect(bob).setPostage(0);
    for(let i=0;i<20;i++)await parley.sendMessage("bob",1,"0xaa");
    expect((await parley.reach(alice.address,"bob")).quotaLeft).to.equal(0n);
    await time.increase(86400);
    expect((await parley.reach(alice.address,"bob")).quotaLeft).to.equal(20n);
  });
  it("message/request/offer stamps accumulate with original timer, then release once",async()=>{
    const {parley,alice,bob,offer}=await loadFixture(fixture);
    await parley.sendMessage("bob",1,"0xaa",{value:E("0.0003")});
    const first=(await parley.stamps(bob.address,alice.address)).sentAt;
    await time.increase(10);
    await parley.requestPayment("bob",Z,1,600,"0x",{value:E("0.0003")});
    await parley.createOffer(offer({toHandle:"bob",stamp:E("0.0003")}),{value:E("0.0013")});
    const s=await parley.stamps(bob.address,alice.address);
    expect(s.sentAt).to.equal(first);expect(s.amount).to.equal(E("0.0009"));
    await expect(parley.connect(bob).sendMessage("alice",1,"0xbb"))
      .to.emit(parley,"StampReleased").withArgs(alice.address,bob.address,E("0.0009"));
    expect((await parley.stamps(bob.address,alice.address)).amount).to.equal(0n);
    await expect(parley.connect(bob).sendMessage("alice",1,"0xcc")).not.to.emit(parley,"StampReleased");
  });
  it("SafeERC20 accepts no-return tokens for deposit, settlement and refund",async()=>{
    const {parley,alice,bob,token,offer}=await loadFixture(fixture);
    const nr=await (await ethers.getContractFactory("NoReturnToken")).deploy();
    await nr.mint(alice.address,E("10"));await nr.mint(bob.address,E("10"));
    await nr.approve(parley.target,E("2"));
    await parley.createOffer(offer({giveToken:nr.target,giveAmount:E("2")}));
    await token.connect(bob).approve(parley.target,E("1"));
    await parley.connect(bob).acceptOffer(1,E("1"));
    expect(await nr.balanceOf(bob.address)).to.equal(E("12"));
    await nr.approve(parley.target,E("1"));
    await parley.createOffer(offer({giveToken:nr.target,giveAmount:E("1")}));
    await parley.cancelOffer(2);expect(await nr.balanceOf(parley.target)).to.equal(0);
  });
  it("blacklisted escrow is isolated; other offers remain usable",async()=>{
    const {parley,alice,bob,token,offer}=await loadFixture(fixture);
    const bad=await (await ethers.getContractFactory("BlacklistToken")).deploy();
    await bad.mint(alice.address,E("10"));await bad.approve(parley.target,E("1"));
    await parley.createOffer(offer({giveToken:bad.target,giveAmount:E("1")}));
    await bad.deny(alice.address,true);await bad.deny(bob.address,true);
    await expect(parley.cancelOffer(1)).to.be.revertedWith("blacklisted");
    await token.connect(bob).approve(parley.target,E("2"));
    await expect(parley.connect(bob).acceptOffer(1,E("1"))).to.be.revertedWith("blacklisted");
    expect((await parley.offers(1)).status).to.equal(1n);
    await parley.createOffer(offer({}),{value:E("0.001")});
    await expect(parley.connect(bob).acceptOffer(2,E("1"))).to.emit(parley,"OfferSettled");
    expect((await parley.offers(2)).status).to.equal(2n);
  });
});
describe("spec 11.2 complete event fields",()=>{
  it("emits every field for identity, contact, mail, stamp and packet events",async()=>{
    const {parley,alice,bob,carol,guardian}=await loadFixture(fixture);
    await expect(parley.connect(carol).openMailbox(key(3))).to.emit(parley,"MailboxOpened").withArgs(carol.address,key(3));
    await expect(parley.setKey(key(4))).to.emit(parley,"KeyChanged").withArgs(alice.address,key(4));
    await expect(parley.setPostage(1)).to.emit(parley,"PostageSet").withArgs(alice.address,1);
    await expect(parley.blockHandle("bob")).to.emit(parley,"ContactSet").withArgs(alice.address,bob.address,false,true);
    await expect(parley.unblockHandle("bob")).to.emit(parley,"ContactSet").withArgs(alice.address,bob.address,false,false);
    await expect(parley.sendMessage("bob",1,"0xab",{value:E("0.0003")}))
      .to.emit(parley,"Mail").withArgs(bob.address,alice.address,1,0,0,"0xab")
      .and.to.emit(parley,"StampPosted").withArgs(alice.address,bob.address,E("0.0003"));
    await expect(parley.connect(bob).allow("alice")).to.emit(parley,"ContactSet").withArgs(bob.address,alice.address,true,false)
      .and.to.emit(parley,"StampReleased").withArgs(alice.address,bob.address,E("0.0003"));
    await parley.sendMessage("carol",1,"0xac",{value:E("0.0003")});
    await time.increase(259201);
    await expect(parley.reclaimStamp("carol")).to.emit(parley,"StampReclaimed").withArgs(alice.address,carol.address,E("0.0003"));
    const now=await time.latest();await time.setNextBlockTimestamp(now+1);
    await expect(parley.createPacket(2,600,[],"gm",{value:E("0.0002")}))
      .to.emit(parley,"PacketCreated").withArgs(1,alice.address,false,2,E("0.0001"),now+601,"gm");
    await expect(parley.connect(bob).claimPacket(1,key(0))).to.emit(parley,"PacketClaimed").withArgs(1,bob.address,E("0.0001"),false);
    await time.increase(601);
    await expect(parley.refundPacket(1)).to.emit(parley,"PacketRefunded").withArgs(1,alice.address,E("0.0001"));
    await expect(parley.connect(guardian).setPaused(true)).to.emit(parley,"PausedSet").withArgs(true);
  });
  it("emits every request, offer, failed-push and withdrawal field",async()=>{
    const {parley,alice,bob,registry,token,offer}=await loadFixture(fixture);
    await parley.connect(bob).allow("alice");
    const now=await time.latest();await time.setNextBlockTimestamp(now+1);
    await expect(parley.requestPayment("bob",Z,E("0.0001"),600,"0x"))
      .to.emit(parley,"RequestCreated").withArgs(1,alice.address,bob.address,Z,E("0.0001"),now+601);
    await expect(parley.connect(bob).payRequest(1,{value:E("0.0001")})).to.emit(parley,"RequestClosed").withArgs(1,2);
    const t=await time.latest();await time.setNextBlockTimestamp(t+1);
    await expect(parley.createOffer(offer({toHandle:"bob"}),{value:E("0.001")}))
      .to.emit(parley,"OfferCreated").withArgs(1,alice.address,bob.address,Z,E("0.001"),token.target,E("1"),t+601,0);
    await token.connect(bob).approve(parley.target,E("1"));
    await expect(parley.connect(bob).acceptOffer(1,E("1"))).to.emit(parley,"OfferSettled").withArgs(1,bob.address,E("0.001"),E("1"));
    await parley.createOffer(offer({}),{value:E("0.001")});
    await expect(parley.cancelOffer(2)).to.emit(parley,"OfferClosed").withArgs(2,4);
    const picky=await (await ethers.getContractFactory("PickyWallet")).deploy();
    await registry.register("picky",picky.target);
    await parley.createPacket(1,600,[],"",{value:E("0.0001")});
    await expect(picky.claim(parley.target,1)).to.emit(parley,"Owed").withArgs(picky.target,E("0.0001"));
    await picky.setAccept(true);
    await expect(picky.pull(parley.target)).to.emit(parley,"Withdrawn").withArgs(picky.target,E("0.0001"));
  });
});
