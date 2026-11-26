import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { currentBuild } from './build-info.mjs';
import { deploymentExpectations } from './deployment-evidence.mjs';
import { keccak256 } from 'viem';
import { sha256, sourceSnapshot } from './evidence.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const req=createRequire(path.join(root,'contracts/package.json'));
const { ethers }=req('ethers');
const deploymentFile=process.argv[2];
if(!deploymentFile)throw new Error('Usage: node scripts/export-verification.mjs <deployment.json>');
const deployment=JSON.parse(fs.readFileSync(path.resolve(deploymentFile),'utf8'));
if(!Array.isArray(deployment.constructorArgs)||deployment.constructorArgs.length!==7)throw new Error('Exact seven constructor arguments required.');
const b=currentBuild(root);
const expected=deploymentExpectations(b,deployment);
const out=path.join(root,'docs/verification');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'standard-input.json'),JSON.stringify(b.input,null,2)+'\n');
fs.writeFileSync(path.join(out,'constructor-arguments.txt'),ethers.AbiCoder.defaultAbiCoder().encode(
  ['address','address','uint64','uint64','uint128','address[]','uint256[]'],deployment.constructorArgs).slice(2)+'\n');
fs.writeFileSync(path.join(out,'metadata.json'),JSON.stringify({
  contract:'contracts/Parley.sol:Parley',compiler:b.solcLongVersion,
  optimizer:b.input.settings.optimizer,evmVersion:b.input.settings.evmVersion,
  address:deployment.address,block:deployment.block,sourceVerified:false,
  snapshotSha256:sourceSnapshot(root).sha256,compilerBuildSha256:sha256(JSON.stringify(b)),
  expectedRuntimeKeccak256:keccak256(expected.runtime),
  expectedCreationInputKeccak256:keccak256(expected.creationInput),deploymentApproved:false,
},null,2)+'\n');
console.log('Generated BscScan standard input and exact constructor encoding. No submission was made.');
