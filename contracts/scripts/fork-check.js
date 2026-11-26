const path=require("path");
const {ethers,network}=require("hardhat");
const assert=require("node:assert/strict");
const {forkInputs}=require("./fork-inputs");
const {exerciseBusinessFlows}=require("./business-flows");
async function run(report){
  report.phase="local fork guard";
  if(network.name!=="hardhat"||!process.env.FORK_RPC)throw new Error("Fork checks require a LOCAL Hardhat fork via FORK_RPC; never run on bsc.");
  const {actors,block}=forkInputs(process.env);
  report.phase="public fixed-block prerequisites";
  const {inspectFork}=await import("../../scripts/fork-preflight.mjs");
  const {createPublicClient,http}=await import("viem");
  const client=createPublicClient({transport:http(process.env.FORK_RPC,{retryCount:0,timeout:15000})});
  report.preflight=await inspectFork(client,{actors,block});
  assert.equal(report.preflight.status,"passed","Real fixed-block prerequisites must pass");
  report.phase="local fork initialization";
  assert.ok(actors.every(a=>ethers.isAddress(a)),"Invalid address checksum");
  const metadata=await network.provider.send("hardhat_metadata");
  assert.equal(metadata.forkedNetwork?.chainId,56,"Fork source must be BSC mainnet");
  assert.equal(metadata.forkedNetwork.forkBlockNumber,block,"Fork block differs from requested block");
  const sourceBlock=await ethers.provider.getBlock(block);
  assert.equal(sourceBlock.hash,metadata.forkedNetwork.forkBlockHash);
  assert.ok(sourceBlock.timestamp>=1777343400,"Local Osaka profile requires a post-Osaka BSC block");
  // Execute against a new local block, not an invented BSC hardfork history.
  await network.provider.send("evm_mine");
  const registry=await ethers.getContractAt([
    "function balanceOf(address) view returns(uint256)","function handleOf(address) view returns(string)",
    "function ownerOfHandle(string) view returns(address)"],"0x60b9262456de011f7d15a54cdd8c48baaa8b022f");
  const names=await Promise.all(actors.map(a=>registry.handleOf(a)));
  assert.deepEqual(names,report.preflight.handles);
  if(names.some(h=>!/^[a-z0-9]{1,64}$/.test(h)))throw new Error("Both actors must have registered bare handles");
  assert.notEqual(names[0],names[1],"Actors must have distinct handles");
  for(let i=0;i<2;i++){
    assert.ok(await registry.balanceOf(actors[i])>0n);
    assert.equal((await registry.ownerOfHandle(names[i])).toLowerCase(),actors[i].toLowerCase());
  }
  const erc=["function balanceOf(address) view returns(uint256)","function decimals() view returns(uint8)",
    "function approve(address,uint256) returns(bool)","function allowance(address,address) view returns(uint256)"];
  const usdt=await ethers.getContractAt(erc,"0x55d398326f99059fF775485246999027B3197955");
  const usdc=await ethers.getContractAt(erc,"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
  const dt=Number(await usdt.decimals()),dc=Number(await usdc.decimals());
  const t=ethers.parseUnits("0.01",dt),c=ethers.parseUnits("0.01",dc),E=ethers.parseEther,Z=ethers.ZeroAddress;
  if(await usdt.balanceOf(actors[1])<t*3n||await usdc.balanceOf(actors[0])<c*2n)
    throw new Error("Actors need actual small token balances on the fork. No token storage or balances were patched.");
  const codeHashes={};
  for(const [name,address] of [["registry",registry.target],["usdt",usdt.target],["usdc",usdc.target]]){
    const code=await ethers.provider.getCode(address,block);
    assert.notEqual(code,"0x",`${name} has no code at fork block`);
    codeHashes[name]={address,keccak256:ethers.keccak256(code)};
  }
  assert.deepEqual(codeHashes,report.preflight.codeHashes);
  report.phase="local impersonation and deployment";
  for(const actor of actors){
    await network.provider.send("hardhat_impersonateAccount",[actor]);
    await network.provider.send("hardhat_setBalance",[actor,ethers.toBeHex(E("10"))]);
  }
  const [a,b]=await Promise.all(actors.map(x=>ethers.getSigner(x)));
  const [guardian]=await ethers.getSigners();
  assert.ok(actors.every(x=>x.toLowerCase()!==guardian.address.toLowerCase()),"Guardian must differ from actors");
  const p=await(await ethers.getContractFactory("Parley")).deploy(registry.target,guardian.address,E("0.0003"),E("0.03"),1,
    [Z,usdt.target,usdc.target],[E("0.5"),ethers.parseUnits("300",dt),ethers.parseUnits("300",dc)]);
  await p.waitForDeployment();
  const deployed=await p.deploymentTransaction().wait();
  report.deployment={address:p.target,transactionHash:deployed.hash,block:deployed.blockNumber,
    runtimeKeccak256:ethers.keccak256(await ethers.provider.getCode(p.target))};
  report.phase="shared contract business scenarios";
  let scenario;
  try{
    scenario=await exerciseBusinessFlows({ethers,network,parley:p,usdt,usdc,a,b,guardian,names});
  }catch(error){
    report.scenarioStep=error.scenarioStep;
    report.checks=error.completedChecks;
    throw error;
  }finally{
    for(const actor of actors)await network.provider.send("hardhat_stopImpersonatingAccount",[actor]);
  }
  report.phase="canonical source block recheck";
  const canonical=await client.getBlock({blockNumber:BigInt(block)});
  assert.equal(canonical.hash,sourceBlock.hash,"Source block changed during execution");
  const artifact=await require("hardhat").artifacts.readArtifact("Parley");
  Object.assign(report,{environment:"local Hardhat fork, real registry/USDT/USDC; native balances locally funded",
    checkedAt:new Date().toISOString(),status:"passed",sourceChainId:56,forkBlock:block,
    forkBlockHash:sourceBlock.hash,localEndBlock:Number(await ethers.provider.getBlockNumber()),
    canonicalEndBlockHash:canonical.hash,
    codeHashes,actors,tokenDecimals:{usdt:dt,usdc:dc},
    localEvm:"Ethereum Osaka approximation; not BSC consensus replay",
    parleyCreationCodeKeccak256:ethers.keccak256(artifact.bytecode),
    checks:scenario.checks,transactions:scenario.transactions,encryption:scenario.encryption,
    limitations:scenario.limitations,
    fullAcceptanceChecklist:"pending; this script covers only the checks listed",
    mainnetBroadcast:false});
  report.phase="completed";
}
async function main(){
  const {recordForkRun}=await import("../../scripts/fork-evidence.mjs");
  const {report,pointer}=await recordForkRun(path.resolve(__dirname,"../.."),run);
  console.log(JSON.stringify({report:pointer.report,status:report.status,phase:report.phase,
    completedChecks:report.checks?.length||0,mainnetBroadcast:false},null,2));
  if(report.status!=="passed")process.exitCode=1;
}
main().catch(()=>{
  console.error("Fork check failed. Run npm run check:fork for credential-safe prerequisite diagnostics. No mainnet transaction was sent.");
  process.exitCode=1;
});
