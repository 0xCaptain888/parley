import { createPublicClient, http, fallback, encodeFunctionData, parseAbi, decodeEventLog } from 'viem';
import abi from './abi.json' with { type: 'json' };
import { input, fail, decodeFailure } from './errors.mjs';
import { address } from './normalize.mjs';

export { abi };
export const registryAbi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function handleOf(address) view returns (string)',
  'function ownerOfHandle(string) view returns (address)',
]);
export const tokenAbi = parseAbi([
  'function symbol() view returns (string)', 'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'event Approval(address indexed owner,address indexed spender,uint256 value)',
]);
export function makeChain(config, rpc) {
  input(config.contract, '尚未配置已部署合约，请先完成部署和构建。');
  address(config.contract); address(config.registry);
  const urls = rpc ? [rpc] : config.rpcs;
  for (const u of urls) input(/^https?:\/\//.test(u), 'RPC 地址应为 HTTP(S)。');
  const chain = {
    id: config.chainId, name: config.chainId === 56 ? 'BSC' : 'Local development',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: { default: { http: urls } },
    contracts: config.multicall ? { multicall3: { address: config.multicall } } : undefined,
  };
  const client = createPublicClient({ chain, transport: fallback(urls.map(u => http(u, { retryCount: 0, timeout: 7000 })), { retryCount: 0 }) });
  const read = (name, args = []) => client.readContract({ address: config.contract, abi, functionName: name, args });
  const registry = (name, args) => client.readContract({ address: config.registry, abi: registryAbi, functionName: name, args });
  const token = (a, name, args = []) => client.readContract({ address: a, abi: tokenAbi, functionName: name, args });
  async function batch(calls) {
    const requests = calls.map(c => ({ address: c.address || config.contract, abi: c.abi || abi, functionName: c.name, args: c.args || [] }));
    if (config.multicall) {
      try {
        const values = await client.multicall({ contracts: requests, allowFailure: false });
        return values;
      } catch { /* Local deployments and some RPCs lack Multicall3; storage reads remain usable. */ }
    }
    const values = [];
    for (let i = 0; i < requests.length; i += 20)
      values.push(...await Promise.all(requests.slice(i, i + 20).map(r => client.readContract(r))));
    return values;
  }
  return {
    client, read, registry, token, batch, config,
    async verify() {
      let id, code;
      try { [id, code] = await Promise.all([client.getChainId(), client.getCode({ address: config.contract })]); }
      catch { fail('RPC_UNAVAILABLE', 'RPC 无法连接，请用 --rpc 指定可用节点。'); }
      input(id === config.chainId, 'RPC 返回了错误的链 ID。');
      input(code && code !== '0x', '该链上配置的合约地址没有代码。');
      input((await read('REGISTRY')).toLowerCase() === config.registry.toLowerCase(), '合约注册表与构建配置不一致。');
    },
    async simulate(call, from) {
      try { await client.call({ account: from, to: call.to, data: call.data, value: BigInt(call.value), blockTag: 'latest' }); }
      catch (e) { throw decodeFailure(e, abi); }
    },
    async now() { return Number((await client.getBlock()).timestamp); },
    async name(a) {
      const h = await registry('handleOf', [a]);
      return /^[a-z0-9]{1,64}$/.test(h) ? `${h}.ai` : '(未登记名字)';
    },
    events(receipt) {
      return receipt.logs.filter(l => l.address.toLowerCase() === config.contract.toLowerCase()).map(l => {
        try { return { ...decodeEventLog({ abi, data: l.data, topics: l.topics }), logIndex: l.logIndex }; } catch { return null; }
      }).filter(Boolean);
    },
  };
}
export function calldata(name, args) { return encodeFunctionData({ abi, functionName: name, args }); }
export const packet = x => Object.fromEntries(['creator', 'expiry', 'shares', 'claimed', 'direct', 'perShare', 'remaining'].map((k, i) => [k, x[i]]));
export const request = x => Object.fromEntries(['payee', 'expiry', 'status', 'payer', 'token', 'amount'].map((k, i) => [k, x[i]]));
export const offer = x => Object.fromEntries(['maker', 'expiry', 'status', 'taker', 'giveToken', 'wantToken', 'giveAmount', 'wantAmount'].map((k, i) => [k, x[i]]));
export const mailbox = x => Object.fromEntries(['pubKey', 'openedAt', 'quotaDay', 'quotaUsed', 'postageSet', 'postage'].map((k, i) => [k, x[i]]));
