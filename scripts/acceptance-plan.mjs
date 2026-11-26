export const acceptanceSteps = [
  ['A', 'read-only', 'Check name and unopened mailbox', '显示甲的名字且信箱未开通', 'status'],
  ['A', 'transaction', 'Open mailbox after individual preview and consent', '确认回执及已开通信箱', 'open'],
  ['A', 'transaction', 'Create a public packet with two shares', '返回编号和分享文案，网站显示同一红包', 'packet create'],
  ['B', 'transaction', 'Claim while B has no mailbox', '同一交易开通信箱并到账', 'packet claim'],
  ['B', 'rejection', 'Attempt the same claim again', 'ALREADY_CLAIMED，不产生调用', 'packet claim'],
  ['B', 'transaction', 'Send A a message without postage', '领取者可免邮资联系红包创建者', 'send'],
  ['A', 'read-only', 'Read and explicitly acknowledge mail', '正文仅位于 untrusted，显式 ack 后推进游标', 'inbox/read/ack'],
  ['A+B', 'mixed', 'Block B, verify blocked send, then unblock', 'BLOCKED；解除拉黑不恢复免邮资', 'contact block/unblock'],
  ['B', 'mixed', 'Reject unstamped first contact, then send with postage', 'POSTAGE_REQUIRED；逐笔批准带邮资调用后成功', 'send --with-postage'],
  ['A', 'transaction', 'Reply and release accumulated postage', '核对邮资释放与双方免邮资联系，余额变化单独扣除 gas', 'send'],
  ['A', 'transaction', 'Create an exact small USDT payment request', '乙信箱出现同一收款请求', 'request create'],
  ['B', 'transactions', 'Approve exact USDT amount, then separately regenerate and pay', '甲净收款准确，业务完成后 allowance=0', 'request pay'],
  ['A', 'transaction', 'Offer BNB for USDT to B', '甲 BNB 存入托管且事件/余额匹配', 'offer create'],
  ['B', 'transactions', 'Counteroffer with exact token approval if required', '原 BNB 退回甲，新 USDT 存入托管', 'offer counter'],
  ['A', 'transactions', 'Accept the counteroffer with separate approval if required', '双方资产在一笔业务交易中原子交换', 'offer accept'],
  ['A', 'transactions', 'Create a public offer and cancel it', '挂单出现后撤回消失，资产退回', 'offer create/cancel'],
  ['A+B', 'mixed', 'Send an instruction-injection message as untrusted content', '乙仅引用展示，不运行 policy set；本地限额不变', 'send/read'],
  ['B', 'rejection', 'Attempt an offer above local policy', 'OVER_POLICY_TX，不产生调用', 'offer create'],
  ['A+B+guardian', 'transactions', 'Create packet, pause, reject new packet, permit claim, then resume', '暂停拒绝新建但领取成功；guardian 每次操作分别批准', 'packet/setPaused'],
  ['either', 'read-only', 'Inspect step 9 input in verified BscScan contract UI', 'toHandle 为甲的名字，不是收件地址参数', 'BscScan decoded input'],
];

export function acceptancePlan(snapshotSha256, deployment) {
  return { schemaVersion: 1, source: 'Parley v1.0 section 11.4, PDF pages 42-43',
    snapshotSha256, deployment, environment: 'FINAL MAINNET ACCEPTANCE REQUIRED', status: 'pending',
    participants: { A: { handle: null, wallet: null, consentEvidence: null },
      B: { handle: null, wallet: null, consentEvidence: null }, guardian: { wallet: null } },
    prerequisites: { independentReview: 'pending', verifiedFinalDeployment: 'pending',
      officialWalletChecks: 'pending', actualHttpsOrigin: null, budgetApproval: null },
    steps: acceptanceSteps.map(([actor, kind, action, expected, command], i) => ({
      id: i + 1, actor, kind, action, expected, command, status: 'pending',
      performedAt: null, verifiedBy: null, evidence: [], transactions: [],
    })),
    evidenceRequirements: {
      transaction: ['Exact call preview and risk/simulation summary', 'Separate human consent for each approval/business call',
        'Transaction hash, chain, sender, target, block/hash, status and decoded event', 'Asset deltas and gas accounted separately'],
      rejection: ['Input and expected error', 'No calls produced', 'Policy/config unchanged'],
      privacy: ['No keys, wallet sessions, pairing codes or private message bodies',
        'Obtain consent for screenshots, names, addresses and quotations before publication'],
    },
    note: 'A completed-looking template is not evidence. Local fixtures, old trial contracts and fork actors cannot fill these steps.',
    productionRelease: false };
}
