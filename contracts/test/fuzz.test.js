const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const E=ethers.parseEther,Z=ethers.ZeroAddress,key=n=>ethers.zeroPadValue(ethers.toBeHex(n),32);
const suite=process.env.PARLEY_LONG_FUZZ==="1"?describe:describe.skip;
suite("spec 11.2 multi-seed 5000-step accounting",function(){
  this.timeout(1800000);
  for(const initial of [20261122,7331,4294967291]){
    it(`seed ${initial}: conservation after every operation`,async()=>{
      const actors=(await ethers.getSigners()).slice(0,5),names=["alice","bob","carol","eve","frank"];
      const registry=await(await ethers.getContractFactory("MockRegistry")).deploy();
      const token=await(await ethers.getContractFactory("MockToken")).deploy("USDT");
      const p=await(await ethers.getContractFactory("Parley")).deploy(registry.target,actors[0].address,E("0.0003"),E("0.03"),1,[Z,token.target],[E("0.5"),E("300")]);
      for(let i=0;i<5;i++){
        await registry.register(names[i],actors[i].address);await token.mint(actors[i].address,E("10000"));
        await p.connect(actors[i]).openMailbox(key(i+1));await token.connect(actors[i]).approve(p.target,E("10000"));
      }
      let seed=initial>>>0,expectedBNB=0n,expectedToken=0n,ok=0,tokenPayments=0;
      const rnd=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed%n;};
      const packets=new Map(),offers=new Map();let requests=0;
      function account(receipt){
        for(const log of receipt.logs){
          let e;try{e=p.interface.parseLog(log);}catch{continue;}if(!e)continue;
          const a=e.args;
          switch(e.name){
            case "PacketCreated":expectedBNB+=a.perShare*a.shares;packets.set(Number(a.id),a.perShare*a.shares);break;
            case "PacketClaimed":expectedBNB-=a.amount;packets.set(Number(a.id),packets.get(Number(a.id))-a.amount);break;
            case "PacketRefunded":expectedBNB-=a.amount;packets.set(Number(a.id),0n);break;
            case "OfferCreated":
              offers.set(Number(a.id),{token:a.giveToken,amount:a.giveAmount,open:true});
              if(a.giveToken===Z)expectedBNB+=a.giveAmount;else expectedToken+=a.giveAmount;
              break;
            case "OfferSettled":
            case "OfferClosed":{
              const o=offers.get(Number(a.id));if(!o.open)throw new Error("double exit");
              o.open=false;if(o.token===Z)expectedBNB-=o.amount;else expectedToken-=o.amount;break;
            }
            case "StampPosted":expectedBNB+=a.amount;break;
            case "StampReleased":
            case "StampReclaimed":expectedBNB-=a.amount;break;
            case "Owed":expectedBNB+=a.amount;break;
            case "Withdrawn":expectedBNB-=a.amount;break;
            case "RequestCreated":requests=Number(a.id);break;
          }
        }
      }
      const params=patch=>({toHandle:"",giveToken:Z,giveAmount:E("0.001"),wantToken:token.target,wantAmount:E("1"),ttl:600,stamp:0,refOfferId:0,memo:"0x",...patch});
      for(let step=0;step<5000;step++){
        const i=rnd(5),j=(i+1+rnd(4))%5,me=p.connect(actors[i]);
        const stamp=(await p.reach(actors[i].address,names[j])).postage;
        try{
          let tx,payment;
          switch(rnd(16)){
            case 0:tx=await me.createPacket(2,600,[],"",{value:E("0.0002")});break;
            case 1:tx=await me.createPacket(0,604800,[names[j]],"",{value:E("0.0001")});break;
            case 2:tx=await me.claimPacket(1+rnd(packets.size||1),key(0));break;
            case 3:tx=await me.refundPacket(1+rnd(packets.size||1));break;
            case 4:tx=await me.sendMessage(names[j],1,"0xaa",{value:stamp});break;
            case 5:tx=await me.reclaimStamp(names[j]);break;
            case 6:tx=await me.createOffer(params({toHandle:names[j],stamp}),{value:E("0.001")+stamp});break;
            case 7:tx=await me.createOffer(params({giveToken:token.target,giveAmount:E("1"),wantToken:Z,wantAmount:E("0.001")}));break;
            case 8:{const id=1+rnd(offers.size||1),o=await p.offers(id);tx=await me.acceptOffer(id,o.wantAmount,{value:o.wantToken===Z?o.wantAmount:0n});break;}
            case 9:tx=await me.cancelOffer(1+rnd(offers.size||1));break;
            case 10:tx=await me.declineOffer(1+rnd(offers.size||1));break;
            case 11:{
              const native=rnd(2)===0;
              tx=await me.requestPayment(names[j],native?Z:token.target,native?E("0.0001"):E("1"),600,"0x",{value:stamp});
              break;
            }
            case 12:{
              const id=requests&&rnd(2)?requests:1+rnd(requests||1),r=await p.requests(id);
              if(r.token!==Z)payment={payee:r.payee,amount:r.amount,
                before:await token.balanceOf(r.payee),payerBefore:await token.balanceOf(actors[i].address)};
              tx=await me.payRequest(id,{value:r.token===Z?r.amount:0n});break;
            }
            case 13:tx=await me.allow(names[j]);break;
            case 14:tx=await me.blockHandle(names[j]);break;
            case 15:if(rnd(2))tx=await me.unblockHandle(names[j]);else await time.increase(86401);break;
          }
          if(tx){
            account(await tx.wait());
            if(payment){
              expect(await token.balanceOf(payment.payee)).to.equal(payment.before+payment.amount);
              expect(await token.balanceOf(actors[i].address)).to.equal(payment.payerBefore-payment.amount);
              tokenPayments++;
            }
          }
          ok++;
        }catch(e){
          if(!/revert|CALL_EXCEPTION/i.test(e.message))throw e;
        }
        expect(await ethers.provider.getBalance(p.target),`BNB seed ${initial}, step ${step}`).to.equal(expectedBNB);
        expect(await token.balanceOf(p.target),`USDT seed ${initial}, step ${step}`).to.equal(expectedToken);
        if(step%1000===999){
          let bnb=0n,usd=0n;
          for(let id=1;id<=packets.size;id++)bnb+=(await p.packets(id)).remaining;
          for(let id=1;id<=offers.size;id++){
            const o=await p.offers(id);if(o.status===1n){if(o.giveToken===Z)bnb+=o.giveAmount;else usd+=o.giveAmount;}
          }
          for(const a of actors){
            bnb+=await p.pending(a.address);
            for(const b of actors)bnb+=(await p.stamps(a.address,b.address)).amount;
          }
          expect(bnb).to.equal(expectedBNB);expect(usd).to.equal(expectedToken);
        }
      }
      expect(ok).to.be.greaterThan(500);
      expect(tokenPayments).to.be.greaterThan(0);
      console.log(`      seed ${initial}: 5000 steps, ${ok} successful, ${tokenPayments} exact token-request payments, both assets conserved after every step`);
    });
  }
});
