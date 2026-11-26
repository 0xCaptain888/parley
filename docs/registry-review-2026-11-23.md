# Registry Lifecycle Review

Implementation-side review, not an independent audit. No wallet access, signature or mainnet transaction.

## Provenance

Registry: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`, chain 56.

Sourcify API: `https://sourcify.dev/server/v2/contract/56/0x60b9262456de011f7d15a54cdd8c48baaa8b022f?fields=all`.
Downloaded evidence: `reports/registry-sourcify-2026-11-23.json`, SHA256
`2dc26d803dd4ba07785f12f9ba69dc2e6dc92bb6fed4ccbf502053f71298628e`.
The service reports exact creation/runtime matches and non-proxy classification.
Source: `src/HandleRegistry.sol`, Solidity `0.8.24+commit.e11b9ed9`, optimizer 200, Paris.

Separate public RPC `https://bsc-dataseed.binance.org` returned chain ID 56 and identical runtime at block
135178626 (`0x80ea982`), hash `0x9fc4e9c6ab2db44930417959ffcc8a274d1cd760868c3b7ad428fa2b4d94dce7`.
Raw evidence: `reports/registry-rpc-2026-11-23.json`, SHA256
`6aba0357be6059ece01999a982591ca99ae4dc18b01acfd8a502d98062a0a977`.
This is a pinned observation, not continuous monitoring.

## Reproduction

Run `npm run test:registry` on an isolated local Hardhat network with no `FORK_RPC`.
The script uses cached native solc 0.8.24; it never downloads a compiler.
Downloaded source contents must equal compiler inputs.
Recompiled creation code must equal verified creation code and prefix deployment input.
Recompiled runtime must equal verified compiled runtime; deployed runtime may differ only at
locally compiled immutable-reference positions. No arbitrary opcode masking is allowed.
These checks do not independently reconstruct the original constructor execution.

The script locally deploys that source and checks ten cases: registration, all three ERC721 transfer
entry points, both approvals, duplicate handle/holder rejection, non-owner admin rejection, and identity
preservation across signer/length/URI/ownership changes. Output: `reports/registry-current.json`.
Full verification hashes both downloaded inputs and the checking script.

## Administrative Surface

- `register`: signed, caller-bound registration; handle and address must be unused.
- `adminRegister`: owner-only creation; cannot overwrite an existing identity.
- `_update`: rejects when token already has an owner. Inherited transfers and internal burn use it.
- `approve` and `setApprovalForAll`: always revert `Soulbound`.
- Owner may change signer, future registration length bounds and metadata URI.
- Owner may transfer ownership in two steps or renounce it; no existing ID mutation is exposed.
- No public burn, revoke, migration, delegatecall, selfdestruct or upgrade entry was found in reviewed source.

Owner/signer can influence future issuance, so membership is not proof of one human or wallet security.
Parley's cached-membership behavior remains unchanged. A synthetic revocable registry is not evidence
that this production registry can revoke IDs. Independent reachability/bytecode review remains pending;
none of the 45 Parley scanner findings is waived.

## Real-Token Local Fork Passed

`FORK_RPC=<archive endpoint> FORK_BLOCK=<positive decimal block> FORK_ACTORS=<holderA>,<holderB> npm run test:fork`

Requires two distinct nonzero public registered holders: B with at least 0.03 USDT and A with at least
0.02 USDC at that block. No private keys. The script checks BSC source metadata, pinned block/hash,
identities, real token decimals/balances and code hashes before testing flows.
Only native balances are locally funded; no token storage is patched. The report lists exact sampled
checks rather than claiming the entire A-E/acceptance checklist passed.
A local fork was subsequently initialized at block 135178626 through public RPC
`https://bsc-rpc.publicnode.com`. Registry identities and token reads succeeded; the run stopped before
deployment/flows because actor A had no USDC. It is not a completed real-token fork test.
Recent public registry mint events supplied real candidate addresses. Of the bounded samples (16 recent
and 20 earlier distinct holders), one met the USDT threshold, none met the USDC threshold.
Older history on this endpoint returned an explicit personal-token requirement; no attempt was made
to bypass it. This does not establish unrestricted archive availability.

After the user's separately confirmed swap, a new run at block **135185365** passed:
`btc123456` / `0xb550E4cc7271BdbC722427057003410AEC9fC2F4` had
1.003781395552640116 USDC and `liudoudou` / `0x0027d103a0fe819486314fff6c7933bb0a2013f2`
had 14.812031891816582835 USDT at that block. Both identities, deployed code and the block hash were checked.
The shared scenario completed 22 checks and 47 local business transactions, ending with zero native/token
escrow, pending liabilities, stamps and remaining allowances. Only local native balances were funded;
neither real-token storage nor balances were patched. No wallet session was accessed by this run.

`reports/fork-current.json` points to an immutable timestamped report with a SHA256 and source snapshot.
The runner checks prerequisites itself, binds the deployed creation/runtime code and local deployment
receipt, rereads the source block hash at completion, and rejects source drift. A failed attempt writes
a failed report and replaces the latest pointer without destroying prior reports or exposing raw RPC errors.
The production gate validates the explicitly recorded report's integrity, snapshot, completed checks,
transaction sequence and no-wallet/no-mainnet/no-token-patching flags. Test evidence does not authenticate
an independent reviewer and does not authorize publication.

## Read-Only Preflight

Use the same three environment variables with `npm run check:fork` before `npm run test:fork`.
Preflight only uses chain/block/code and view calls. It pins every state read to the selected block,
checks the reviewed registry code hash, both holder/handle mappings, token decimals and exact balances,
then rereads the block hash to detect a changed canonical block. Reports are timestamped and source-bound;
failed prerequisites remain failed in `reports/fork-preflight-current.json`.
RPC URLs, credentials and raw transport errors are not included in reports or diagnostics.
Preflight success does not prove that the local fork engine or all business flows work.

The initial fork exposed missing Hardhat BSC activation history. The runner now mines one
local block before contract reads and explicitly uses Ethereum Osaka EVM semantics. It does not
invent historical BSC activation block numbers. It only supports BSC blocks with timestamp at least
1777343400 (2026-04-28 02:30 UTC), corresponding to official BNB Chain client configuration
`BSCChainConfig.OsakaTime` in `bnb-chain/bsc`, `params/config.go`.
Official source consulted: `https://raw.githubusercontent.com/bnb-chain/bsc/master/params/config.go`.
This is an EVM approximation, not a reproduction of Parlia consensus, BSC-specific gas,
system-contract behavior, timestamp rules or wallet execution. Do not present it as full BSC equivalence.
