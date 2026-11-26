const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { ethers, network } = require("hardhat");
const { getCompilersDir } = require("hardhat/internal/util/global-dir");
const { CompilerDownloader } = require("hardhat/internal/solidity/compiler/downloader");

const root = path.resolve(__dirname, "../..");
const evidenceFile = "docs/reports/registry-sourcify-2026-11-23.json";
const expectedHash = "2dc26d803dd4ba07785f12f9ba69dc2e6dc92bb6fed4ccbf502053f71298628e";
const hash = value => createHash("sha256").update(value).digest("hex");

async function main() {
  assert.equal(network.name, "hardhat", "Registry checks are local only");
  assert.ok(!process.env.FORK_RPC, "Use an isolated local network, not a fork");
  const raw = fs.readFileSync(path.join(root, evidenceFile));
  assert.equal(hash(raw), expectedHash, "Registry source evidence changed");
  const evidence = JSON.parse(raw);
  const rpcFile = "docs/reports/registry-rpc-2026-11-23.json";
  const rpcRaw = fs.readFileSync(path.join(root, rpcFile));
  const rpcHash = "6aba0357be6059ece01999a982591ca99ae4dc18b01acfd8a502d98062a0a977";
  assert.equal(hash(rpcRaw), rpcHash, "Pinned public RPC evidence changed");
  const rpc = JSON.parse(rpcRaw);
  assert.ok(rpc.every(r => !r.error));
  assert.equal(rpc.find(r => r.id === 1).result, "0x38");
  assert.equal(rpc.find(r => r.id === 2).result, evidence.runtimeBytecode.onchainBytecode);
  const block = rpc.find(r => r.id === 3).result;
  assert.equal(block.number, "0x80ea982");
  assert.equal(block.hash, "0x9fc4e9c6ab2db44930417959ffcc8a274d1cd760868c3b7ad428fa2b4d94dce7");
  assert.equal(evidence.chainId, "56");
  assert.equal(evidence.address.toLowerCase(), "0x60b9262456de011f7d15a54cdd8c48baaa8b022f");
  assert.equal(evidence.creationMatch, "exact_match");
  assert.equal(evidence.runtimeMatch, "exact_match");
  assert.equal(evidence.proxyResolution.isProxy, false);
  for (const [file, source] of Object.entries(evidence.sources))
    assert.equal(evidence.stdJsonInput.sources[file].content, source.content);
  const downloader = CompilerDownloader.getConcurrencySafeDownloader(
    CompilerDownloader.getCompilerPlatform(), await getCompilersDir());
  const compiler = await downloader.getCompiler("0.8.24");
  assert.ok(compiler && !compiler.isSolcJs, "Cached native solc 0.8.24 required; run npm run compile first");
  const version = spawnSync(compiler.compilerPath, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.ok(version.stdout.includes(evidence.compilation.compilerVersion));
  const input = structuredClone(evidence.stdJsonInput);
  input.settings.outputSelection = { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode"] } };
  const run = spawnSync(compiler.compilerPath, ["--standard-json"], {
    input: JSON.stringify(input), encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.deepEqual((output.errors || []).filter(e => e.severity === "error"), []);
  const compiled = output.contracts["src/HandleRegistry.sol"].HandleRegistry;
  assert.equal(`0x${compiled.evm.bytecode.object}`, evidence.creationBytecode.recompiledBytecode);
  assert.ok(evidence.creationBytecode.onchainBytecode.startsWith(`0x${compiled.evm.bytecode.object}`));
  assert.equal(`0x${compiled.evm.deployedBytecode.object}`, evidence.runtimeBytecode.recompiledBytecode);
  const normalized = Buffer.from(evidence.runtimeBytecode.onchainBytecode.slice(2), "hex");
  const localRuntime = Buffer.from(compiled.evm.deployedBytecode.object, "hex");
  assert.equal(normalized.length, localRuntime.length);
  // Only compiler-declared constructor immutables may differ at deployment.
  for (const slots of Object.values(compiled.evm.deployedBytecode.immutableReferences))
    for (const { start, length } of slots) localRuntime.copy(normalized, start, start, start + length);
  assert.deepEqual(normalized, localRuntime, "Runtime differs outside declared immutable slots");

  const [owner, holder, other, nextOwner] = await ethers.getSigners();
  const registry = await new ethers.ContractFactory(compiled.abi, compiled.evm.bytecode.object, owner)
    .deploy(owner.address, 1, 64, "https://example.invalid/", ".json");
  await registry.waitForDeployment();
  const checks = [];
  const check = async (name, action) => { await action(); checks.push(name); };
  const rejected = async (action, errorName) => {
    await assert.rejects(action, error => {
      const data = error.data?.data || error.data;
      return typeof data === "string" && registry.interface.parseError(data)?.name === errorName;
    });
  };
  await check("admin registration creates one permanent identity", async () => {
    await (await registry.adminRegister("parleyholder", holder.address)).wait();
    assert.equal(await registry.balanceOf(holder.address), 1n);
  });
  const id = BigInt(ethers.keccak256(ethers.toUtf8Bytes("parleyholder")));
  for (const [name, action] of [
    ["transferFrom", () => registry.connect(holder).transferFrom(holder.address, other.address, id)],
    ["safeTransferFrom", () => registry.connect(holder)["safeTransferFrom(address,address,uint256)"](
      holder.address, other.address, id)],
    ["safeTransferFrom with data", () => registry.connect(holder)["safeTransferFrom(address,address,uint256,bytes)"](
      holder.address, other.address, id, "0x")],
    ["approve", () => registry.connect(holder).approve(other.address, id)],
    ["setApprovalForAll", () => registry.connect(holder).setApprovalForAll(other.address, true)],
  ]) await check(`${name} rejects Soulbound`, () => rejected(action, "Soulbound"));
  await check("owner cannot mint over an existing handle", () =>
    rejected(() => registry.adminRegister("parleyholder", other.address), "HandleTaken"));
  await check("owner cannot assign a second handle to a holder", () =>
    rejected(() => registry.adminRegister("secondhandle", holder.address), "AddressHasHandle"));
  await check("non-owner cannot admin register", () =>
    rejected(() => registry.connect(other).adminRegister("outsider", other.address), "OwnableUnauthorizedAccount"));
  await check("admin settings and ownership changes preserve existing identity", async () => {
    await (await registry.setSigner(other.address)).wait();
    await (await registry.setLengthBounds(1, 2)).wait();
    await (await registry.setURIParts("", "")).wait();
    await (await registry.transferOwnership(nextOwner.address)).wait();
    await (await registry.connect(nextOwner).acceptOwnership()).wait();
    assert.equal(await registry.isValidHandle("parleyholder"), false);
    assert.equal(await registry.handleOf(holder.address), "parleyholder");
    assert.equal(await registry.ownerOfHandle("parleyholder"), holder.address);
    assert.equal(await registry.ownerOf(id), holder.address);
    assert.equal(await registry.balanceOf(holder.address), 1n);
  });
  const report = {
    checkedAt: new Date().toISOString(), status: "passed", environment: "isolated local Hardhat",
    source: "https://sourcify.dev/server/v2/contract/56/0x60b9262456de011f7d15a54cdd8c48baaa8b022f?fields=all",
    evidenceFile, evidenceSha256: expectedHash, compiler: evidence.compilation.compilerVersion,
    publicRpcEvidence: { file: rpcFile, sha256: rpcHash, endpoint: "https://bsc-dataseed.binance.org",
      block: Number(BigInt(block.number)), blockHash: block.hash, runtimeExactMatch: true },
    deployment: evidence.deployment, registry: evidence.address,
    runtimeKeccak256: ethers.keccak256(evidence.runtimeBytecode.onchainBytecode),
    creationPrefixRecompiled: true, runtimeMatchExceptConstructorImmutables: true, checks,
    limitations: [
      "Public RPC evidence is pinned to one block; it is not continuous monitoring or independent audit.",
      "Behavior checks use a local deployment of the verified source, not production state or real-token fork flows.",
      "Source-level admin/burn/upgrade reachability analysis still requires independent review.",
    ],
    mainnetBroadcast: false, independentAudit: "pending",
  };
  fs.writeFileSync(path.join(root, "docs/reports/registry-current.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Registry recompilation and ${checks.length} local lifecycle checks passed. No mainnet transactions.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
