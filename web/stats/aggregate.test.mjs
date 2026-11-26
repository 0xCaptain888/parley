import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from './aggregate.mjs';
const config={contract:'local',excluded:['team']};
const e=(eventName,args,tx,block=1,logIndex=0,timestamp=1795449500)=>({eventName,args,transactionHash:tx,blockNumber:block,logIndex,timestamp});
test('same-transaction mailbox+claim is one action, with exclusions and replay dedup',()=>{
  const events=[e('PacketCreated',{creator:'team',id:1},'t'),
    e('MailboxOpened',{owner:'alice'},'a',2,0),
    e('PacketClaimed',{id:1,claimer:'alice',amount:'1',openedMailbox:true},'a',2,1),
    e('MailboxOpened',{owner:'team'},'t2',3)];
  const s=aggregate([...events,...events],config,4,100);
  assert.equal(s.members,1);assert.equal(s.packets.claims,1);
  assert.equal(s.retention.secondAction,0);assert.equal(s.packets.bnb,'1');assert.equal(s.packets.created,0);
});
test('later replies, bilateral pairs and second actions have precise denominators',()=>{
  const events=[e('PacketCreated',{creator:'team',id:1},'t'),
    e('MailboxOpened',{owner:'alice'},'a',2),
    e('PacketClaimed',{id:1,claimer:'alice',amount:'10',openedMailbox:true},'a',2,1),
    e('MailboxOpened',{owner:'bob'},'b',3),
    e('Mail',{from:'alice',to:'team',kind:1},'r',4),
    e('Mail',{from:'alice',to:'bob',kind:1},'x',5),
    e('Mail',{from:'bob',to:'alice',kind:1},'y',6)];
  const s=aggregate(events,config,6,100);
  assert.equal(s.retention.secondAction,1);assert.equal(s.retention.repliedAfterClaim,1);
  assert.equal(s.pairs,1);assert.equal(s.mail.text,3);
});
test('paid requests and settled offers, daily dates in Asia/Shanghai',()=>{
  const s=aggregate([e('RequestCreated',{id:1,payee:'alice',payer:'bob'},'a'),
    e('RequestClosed',{id:1,status:2},'b',2),
    e('OfferCreated',{id:1,maker:'alice',taker:'0x'+'0'.repeat(40)},'c',3),
    e('OfferSettled',{id:1,taker:'bob'},'d',4)],config,5,100);
  assert.equal(s.requests.paid,1);assert.equal(s.offers.settled,1);assert.equal(s.offers.publicCreated,1);
  assert.equal(s.daily[0].date,new Date(1795449500*1000+8*3600000).toISOString().slice(0,10));
});
