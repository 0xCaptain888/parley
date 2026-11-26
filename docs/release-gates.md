# 发布验收与真实钱包阻断项

2026-11-23 本地修订：TOKEN-REQUEST-01 已在本地源码修复，完整回归与新扫描通过了证据完整性核对，但扫描仍有 45 项告警，独立审计仍 pending。现有试验合约不可升级、不含修复；下表 4 项通过仅覆盖旧试验，不是新字节码或正式发布验收。新版验证、扫描和本地复核分别通过 `docs/reports/verification-current.json`、`slither-current.json`、`security-review-current.json` 定位；详见 [验证流程](verification-workflow.md) 与 [安全告警分诊](security-triage-2026-11-23.md)。本轮未执行钱包操作、真实签名或部署。

依据开发文档第 11、12、16、17 章。当前只是本地开发交付，不是允许主网发布的结论。不得把本文档勾选成已通过来绕过实测。

增量记录（2026-11-22，Asia/Shanghai）：用户已逐笔授权并成功部署一份 BSC 试验合约，详情见 [试验部署](trial-deployment-2026-11-22.json)。本页以下“未授权/未执行”措辞描述初始本地开发阶段，不适用于这笔后来获授权的试验部署。正式发布未获授权，11 项业务验收未因此通过；部署交易的实际发送方、Gas 付款和代码匹配证据见 [部署回执](reports/deployment-execution-2026-11-22.json)。

## 第 16 章的 11 项

真实记录填写在 `config/release-evidence.json`，每项都必须附证据和核查时间。不记录私钥、会话、配对码或完整的钱包设置响应。

| 项 | 必须实测 | 通过证据 | 当前 |
| --- | --- | --- | --- |
| 1 | 新合约是否获币安风控放行 | openMailbox 官方 preview；若 351803，先验证源码再重试，仍失败走官方渠道 | 2026-11-22 22:17:10 已通过该试验合约的官方预览；[证据](reports/mailbox-preview-2026-11-22.json) |
| 2 | 实际交易发起者是否持有 Agent ID | 真实 openMailbox 回执、注册表资格；NotAgentId 则重评架构 | 2026-11-22 22:20:41 已成功，发送方在回执区块持有 Agent ID；[证据](reports/mailbox-execution-2026-11-22.json) |
| 3 | 无金额、带 BNB、approve 的 App 确认规则 | 各类 requireConfirmation 和实际批准流程，不保存会话 | 部分观测：openMailbox 与带 BNB 的 createPacket 均无需额外 App 订单即广播；approve 未测，整项仍 pending |
| 4 | 开发者模式余额及每日上限 | 只记录必要限额数值；默认本地限额不得高于实测限制 | 已观测钱包设置；实际约束验证及最终参数对齐未完成，仍 pending |
| 5 | gas 实际由谁支付 | 回执与余额变化核对 | 已通过：openMailbox 发送钱包的余额扣减精确等于回执手续费；[证据](reports/mailbox-execution-2026-11-22.json)，仅覆盖已观测调用 |
| 6 | payable BNB 调用是否成功 | 最小公开红包的真实回执 | 2026-11-22 22:37:40 已成功创建 0.0001 BNB 红包 #1，本金、事件、状态及费用已核对；[证据](reports/packet-execution-2026-11-22.json) |
| 7 | 精确 USDT approve 是否放行 | 官方预览及独立批准后的回执 | 未运行 |
| 8 | 长密文 calldata 能否经 CLI 通过 | 947 字节明文信封测试与官方调用；常规文本仍限 500 字节 | 未运行 |
| 9 | 干净机器通过公网 ZIP 安装 Skill | 实际 HTTPS 地址、下载哈希及安装日志 | 未运行 |
| 10 | 实际提交表单的全部字段 | 人工记录字段、地址数量限制与必填附件 | 未运行 |
| 11 | 点对点交换的真实需求 | 获同意的需求访谈摘要，不制造用户或成交 | 未运行 |

**1、2、6 任一失败立即停止发布并重新评估，不通过修改交易参数绕过风控。** 用户没有授权本次开发进行真实部署、签名、转账或发布，因此没有执行上述动作。

截至 2026-11-22 22:39:07，第 1、2、5、6 项已通过，其他 7 项仍待验证。openMailbox 和最小 BNB 红包均已实际成功，三个关键项第 1、2、6 项全部通过，但不等于正式发布获准。累计实际手续费 `0.00040092919077782 BNB`，红包本金 `0.0001 BNB`，试验预算剩余 `0.00049907080922218 BNB`；未退款，无其他交易授权。红包 #1 到期时间为北京时间 2026-11-22 22:47:40，只有未领余额才能另行逐笔确认取回。此前“本次开发未授权/未执行”仅描述初始阶段，不否定后来逐笔授权的试验部署、开通信箱与创建测试红包。

## 其他发布阻断项

- 独立人工安全复核、Slither 告警处置；测试不是审计。现在还要求 schema-2 的全部告警与额外观察逐项处置、评审者、证据哈希及当前编译器/扫描/完整回归绑定，不能只改审计完成标记；见 [独立复核交接](independent-review.md)。
- 真实注册表、真实 USDT/USDC 的本地分叉已在历史快照通过 22 项共享检查与 47 笔本地业务交易，不再列作从未执行。当前快照是否有效必须由 `config/release-evidence.json.forkTest` 的绑定检查确认，每次源码快照变化均须重跑。脚本：`contracts/scripts/fork-check.js`；要求 `FORK_RPC`、固定 `FORK_BLOCK` 及两个不同非零 `FORK_ACTORS`，B 至少持有 0.03 USDT、A 至少持有 0.02 USDC。只在本地 impersonate，不需任何钱包私钥，也不代表真实钱包或完整 BSC 共识验收。
- 正式主网部署及 BscScan 源码验证、部署后只读核对。仅 Sourcify 不替代 BscScan。
- 两个真实 Agent ID 走完第 11.4 节的 20 步；注入内容不能触发改限额或转账。
- 域名/产品名查重，HTTPS 托管和 `/skill/` 文件直下，检查真实 content-type 与哈希。
- 常驻 Agent 身份、团队剔除名单、每日预算、小额限额、参考价及值守人员明确。
- 正式两分钟钱包演示、英文材料及提交字段匹配。

## 团队决策

| 决策 | 当前 |
| --- | --- |
| 产品名和域名 | Parley 暂名，域名未决定、未购买 |
| guardian | 未决定；建议多签或硬件钱包，部署后不可换 |
| 五项部署限额及邮资 | 参考脚本有示例；必须按当日价格和钱包实测重新决定 |
| 常驻 Agent ID / 每日预算 | 未配置，示例参考价不能当行情使用 |
| 红包总预算和实际运营人员 | 未决定 |
| MIT | 已按参考源码许可添加，团队发布前确认权利归属 |
| P1 多轮谈判和完整英文站点 | 已实现并做本地测试；是否正式启用由团队决定，不替代真实钱包验收 |

## 部署记录和验证

外部网络部署脚本增加了显式保护，默认拒绝。仅在用户逐项授权后，操作人员才可以设置 `PARLEY_DEPLOY_CONFIRM=deploy:bsc`，并明确设置全部部署参数。私钥只从部署工具需要的环境变量读，绝不写入文件或聊天。

保留部署脚本 JSON 输出为 `docs/deployment.json`，包含真实 chainId、address、block、构造参数和 gas。生成验证输入：

```sh
node scripts/export-verification.mjs docs/deployment.json
node scripts/post-deploy.mjs docs/deployment.json
```

生成输入不表示已验证。BscScan 选 Solidity Standard JSON Input，`v0.8.24+commit.e11b9ed9`、optimizer 200、Paris，合约名 `contracts/Parley.sol:Parley`；必须出现已验证源码页面。核对 REGISTRY、GUARDIAN、DEFAULT_POSTAGE、MAX_POSTAGE、MIN_SHARE、三种 cap、paused=false、memberCount=0。

最后同步 `config/build.json` 中地址、区块、域名、常驻名字和剔除名单；运行构建，下载核验，填写真实证据，再运行 `npm run check:release`。

## English

As of 2026-11-22 22:39:07 Asia/Shanghai, the individually authorized trial deployment, nonpayable openMailbox and 0.0001 BNB public packet succeeded. Checks 1, 2, 5 and 6 have historical trial evidence; the remaining seven checks are pending. All three critical checks (1, 2, 6) passed within that trial scope only. No claim, refund, token approval, production publication or additional transaction was authorized by the packet confirmation. A real-registry/token local fork has since passed 22 checks and 47 local business transactions; freshness must be checked against the current snapshot. Independent per-finding review, BscScan verification and the complete two-real-ID acceptance remain blockers. Trial transactions and passing local tests do not establish production readiness.
