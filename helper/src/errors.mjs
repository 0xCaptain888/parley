import { decodeErrorResult } from 'viem';

export class ParleyError extends Error {
  constructor(code, reason, hint, usage = false) {
    super(reason);
    Object.assign(this, { code, reason, hint, usage });
  }
}
export function fail(code, reason, hint) { throw new ParleyError(code, reason, hint); }
export function input(condition, reason) {
  if (!condition) throw new ParleyError('BAD_INPUT', reason, undefined, true);
}
const names = {
  NotAgentId: ['NO_AGENT_ID', '这个钱包还没有 Agent ID。请在币安 App 的钱包首页领取。'],
  NotMember: ['NO_MAILBOX', '你还没有开通信箱。'],
  AlreadyMember: ['ALREADY_OPEN', '信箱已经开通过了。'],
  BadKey: ['BAD_KEY', '信箱公钥无效。'],
  UnknownHandle: ['UNKNOWN_HANDLE', '没有这个名字的 Agent ID。'],
  SelfTarget: ['SELF_TARGET', '不能对自己操作。'],
  RecipientNoMailbox: ['RECIPIENT_NO_MAILBOX', '对方还没开通信箱。可以先发定向红包。'],
  Blocked: ['BLOCKED', '对方拒收你的消息。'],
  PostageRequired: ['POSTAGE_REQUIRED', '第一次联系对方需要附邮资。'],
  UnexpectedValue: ['UNEXPECTED_VALUE', '这一步不需要附带 BNB。'],
  QuotaExceeded: ['QUOTA_EXCEEDED', '今天主动联系陌生人的次数已用完。'],
  TooLong: ['TOO_LONG', '内容太长或为空。'],
  BadParams: ['BAD_PARAMS', '参数不合法。'],
  OverCap: ['OVER_CAP', '超过合约单笔上限。'],
  NotFound: ['NOT_FOUND', '没有这个编号。'],
  NotOpen: ['NOT_OPEN', '它已经结束了。'],
  Expired: ['EXPIRED', '已过期。'],
  NotExpired: ['NOT_EXPIRED', '还没到可以操作的时间。'],
  NotYours: ['NOT_YOURS', '这不是发给你的，或者不是你创建的。'],
  NotEligible: ['NOT_ELIGIBLE', '这个定向红包的名单里没有你。'],
  AlreadyClaimed: ['ALREADY_CLAIMED', '你已经领过了。'],
  Empty: ['EMPTY', '红包已被领完。'],
  NothingToDo: ['NOTHING_TO_DO', '没有可以取回的金额。'],
  Underpaid: ['UNDERPAID', '收款人实际到账不足，支付已回滚。收款请求不支持带转账税导致的不足到账；仅交换报价可用 --pay 指定更大的支付数量。'],
  IsPaused: ['PAUSED', '合约已暂停新的存入，已有资金仍可取回。'],
  NotGuardian: ['NOT_GUARDIAN', '仅 guardian 可以进行这个操作。'],
  ReentrancyGuardReentrantCall: ['TOKEN_UNSAFE', '这个代币的行为异常，已拒绝。'],
  SafeERC20FailedOperation: ['TOKEN_TRANSFER_FAILED', '代币转账失败。'],
};
export function decodeFailure(error, abi) {
  if (error instanceof ParleyError) return error;
  const seen = new Set();
  function find(e) {
    if (!e || typeof e !== 'object' || seen.has(e)) return;
    seen.add(e);
    for (const value of [e.data, e.data?.data, e.cause, e.error]) {
      if (typeof value === 'string' && /^0x[0-9a-f]{8,}$/i.test(value)) return value;
      const nested = find(value);
      if (nested) return nested;
    }
  }
  const raw = find(error);
  if (raw) {
    try {
      const decoded = decodeErrorResult({ abi, data: raw });
      const [code, reason] = names[decoded.errorName] || ['UNKNOWN_REVERT', decoded.errorName];
      return new ParleyError(code, reason, decoded.errorName === 'PostageRequired'
        ? `需要 ${decoded.args[0]} wei；请先征得用户同意再加 --with-postage。` : undefined);
    } catch { /* Preserve undecodable RPC errors without inferring a cause. */ }
  }
  const reason = error.shortMessage || error.message || String(error);
  if (/insufficient funds|insufficient balance/i.test(reason)) return new ParleyError('INSUFFICIENT_BALANCE', '余额不足。');
  if (/HttpRequestError|TimeoutError|SocketClosedError|WebSocketRequestError/.test(error.name)
    || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|HTTP request failed|timed out/i.test(reason))
    return new ParleyError('RPC_UNAVAILABLE', 'RPC 无法连接，请用 --rpc 指定可用节点。');
  return new ParleyError('UNKNOWN_REVERT', reason);
}
