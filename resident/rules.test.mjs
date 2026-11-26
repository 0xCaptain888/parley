import test from 'node:test';
import assert from 'node:assert/strict';
import { safePreview, withinBudget, acceptableOffer, proposals } from './rules.mjs';
const config={dailyBNB:'0.01',perTxBNB:'0.002',perTxUSD:'2',pricesUpdatedAt:100000,
  pricesUSD:{BNB:'600',USDT:'1',USDC:'1'},welcome:'hello',giftEach:'0.0001',
  publicPacket:{total:'0.002',shares:20},boardOffer:{give:'0.0001',giveToken:'BNB',want:'0.06',wantToken:'USDT'}};
test('official previews fail closed on missing fields, risk or authority changes',()=>{
  const p={success:true,data:{requestId:'r',expiresAt:Date.now()+60000,parsedTx:{},
    risks:{riskDetails:[],riskBehaviors:[],addresses:{}},simulationResult:{simulationCode:'000000000',authorityChanges:[]}}};
  assert.equal(safePreview(p),true);
  for(const mutate of [
    q=>delete q.data.risks,q=>delete q.data.parsedTx,q=>q.data.risks.riskDetails.push({title:'risk'}),
    q=>q.data.simulationResult.authorityChanges.push({}),q=>q.success=false,
    q=>q.data.risks.addresses.a={riskLevel:1},q=>q.data.simulationResult.simulationCode='failed',
  ]){const q=structuredClone(p);mutate(q);assert.equal(safePreview(q),false);}
});
test('budgets include queued items but never block a zero-value reply',()=>{
  assert.equal(withinBudget(config,[{createdAt:100000,status:'queued',bnb:'9000000000000000'}],2000000000000000n,100001),false);
  assert.equal(withinBudget(config,[{createdAt:100000,status:'queued',bnb:'11000000000000000'}],0n,100001),true);
  assert.equal(withinBudget(config,[],2000000000000001n,100001),false);
});
test('resident quote prices use integer math, freshness, 3% and small amount caps',()=>{
  const o={expiresAt:110000,give:{symbol:'BNB',raw:'100000000000000',decimals:18,listed:true},
    want:{symbol:'USDT',raw:'60000000000000000',decimals:18,listed:true}};
  assert.equal(acceptableOffer(o,config,100001),true);
  assert.equal(acceptableOffer(o,{...config,pricesUpdatedAt:null},100001),false);
  assert.equal(acceptableOffer(o,config,200000),false);
  assert.equal(acceptableOffer({...o,want:{...o.want,raw:'100000000000000000'}},config,100001),false);
  assert.equal(acceptableOffer({...o,give:{...o.give,listed:false}},config,100001),false);
  assert.equal(acceptableOffer({...o,give:{...o.give,raw:'10000000000000000'},want:{...o.want,raw:'6000000000000000000'}},config,100001),false);
});
test('welcomes/gifts dedupe, all requests decline, and expired board can be renewed',()=>{
  const state={handled:[],welcomed:[],gifted:[],publicDate:null,boardOpen:false,boardId:9};
  const p=proposals([{index:0,from:'alice.ai',kind:'text',request:{id:2,status:1}}],state,config,100001);
  assert.ok(p.some(q=>q.key==='welcome:alice'));assert.ok(p.some(q=>q.args.join(' ')==='request decline 2'));
  assert.ok(p.some(q=>q.key==='board:9'));
  const next=proposals([{index:1,from:'alice.ai',kind:'text'}],{...state,welcomed:['alice'],gifted:['alice']},config,100001);
  assert.equal(next.filter(q=>q.index!==undefined).length,0);
});
