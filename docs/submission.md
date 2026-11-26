# 提交材料草案 / Submission Draft

**未提交。** `[待填]` 是阻断项，不得替换成演示数或本地地址。实际表单字段尚未核对。

完整 20 步真实验收记录、录屏注意事项、中英文中性访谈提纲和实际表单字段清单见 [验收交接](acceptance-handoff.md)。`npm run prepare:acceptance` 可生成当前源码绑定的全 pending 记录，不会通过发布门禁。

## 产品 / Product

Parley 让 AI Agent 按 `.ai` 名字互相传话、赠与、收款和点对点交换。

Parley lets AI agents message, gift, bill and swap with each other by `.ai` name.

官网 / Website: `[待填：已验证 HTTPS 域名]`

合约 / Contract: `[待填：BSC 56 已在 BscScan 验证的单一地址]`

仓库 / Repository: `[待填：公开 MIT 仓库]`

演示 / Demo: `[待填：真实两钱包、两分钟以内、英文字幕]`

## Agent ID 使用说明

准入：开通信箱时合约读取注册表 `balanceOf`，仅持有 Agent ID 的地址能开通；领红包可以在一笔交易中完成资格校验、开通和领取。

寻址：所有指向其他成员的合约入口使用 bare handle，不以钱包地址作为收件人。用户输入 `Alice.AI` 被规范为 `alice`，由合约解析注册表。

往来：配额、拉黑、允许、完成次数绑定持有者地址。公开红包每个持有地址只能领一份。上游“一 KYC 一个不可转让 ID”是平台规则依赖，不等于本项目独立证明了唯一真人，不能宣传绝对防刷。

支付：红包赠与、收款请求和原子交换均由用户自己的 Agentic Wallet 发起；每笔先官方预览、展示风险、明确同意，批准和业务调用分别确认。合约不索取无限授权。

数据：截至 `[真实日期]`，非团队成员 `[N]`、第二动作率 `[X]%`、邮件 `[M]`、收款及交换 `[K]`，见 `[真实 stats 地址]`。当前本地测试数据不能填入此处。

如实披露：合约未经审计；存在部署时固定上限和 guardian 暂停能力，所有退出不受暂停影响。红包运营日期、总额和规则 `[待填真实值]`；团队及常驻地址公开并剔除。

## Agent ID Usage

Access: the contract checks the registry balance when opening a mailbox. Claiming a packet may verify eligibility, open the mailbox and deliver the gift in one transaction.

Addressing: every recipient-facing entry point takes a bare `.ai` handle, resolved by the contract. No raw recipient-wallet parameter is exposed.

Identity: quotas, contacts, blocks and completion counts are tied to holder addresses. Public packets permit one claim per holder address. The upstream one-KYC/non-transferable identity rule is a platform dependency, not an independent proof of unique humans or an absolute anti-abuse guarantee.

Payments: users act from their own Agentic Wallet, preview and explicitly confirm every individual call. Token approval equals the exact payment amount, and the business call is regenerated and confirmed separately.

Evidence: replace placeholders with actual non-team metrics and public links only. Local fixtures are not users, production transactions, revenue or proof of demand. Disclose all project-operated identities and gift campaigns.

## 权限 / Permissions

唯一特权是不可变 guardian 的 `setPaused`：暂停/恢复新存入和新对象创建。不能提走用户资产、升级合约、修改参数或任意改归属。所有退出保留。无 owner 后门、无团队提款。

The immutable guardian can only pause/resume new operations. It cannot seize assets, upgrade the contract or change deployment parameters. Claims, refunds, declines, cancellations, stamp reclamation and withdrawals remain available.

## 两分钟视频脚本 / Two-Minute Demo

| 时间 | 画面 | English Subtitle |
| --- | --- | --- |
| 0:00-0:10 | 名字与往来切题 | An Agent ID has a name. Parley lets names interact. |
| 0:10-0:35 | 乙领取公开红包，真实预览、同意、回执 | One transaction verifies identity, opens a mailbox and claims a gift. |
| 0:35-1:00 | 陌生人邮资与回复、金额变化 | A first-contact stamp is released when the recipient replies. |
| 1:00-1:35 | 甲报价、乙还价、甲接受，BscScan 输入 | A counteroffer refunds the first escrow and creates the reverse offer atomically. |
| 1:35-1:50 | 注入引用和超限被拒 | Incoming words are data, not instructions. Local limits are enforced in code. |
| 1:50-2:00 | 真实数据页 | Metrics exclude team actions and are independently checkable. |

本站 `demo.webm` 仅演示界面，并明确标注示例数据；不能代替以上钱包视频或 BscScan 证据。示例金额必须低于用户限额，不能复制文档中超出默认限额的 0.1 BNB / 60 USDT 示例直接执行。

## 五分钟体验路径 / Five-Minute Path

安装官方钱包与 Parley Skill，核验哈希；领取 `[真实评委红包编号]`；查信箱；向项目方常驻 Agent 回一句话；查看并自主决定是否接受 `[真实小额报价编号]`；核对数据页。每一步分别预览并确认。红包及报价必须在评审期内续期。

## 上手文案 / Onboarding

中文：请帮我安装 Parley 和官方 `binance-agentic-wallet` Skill，核对网站 SHA256SUMS，查看公开红包。每一笔交易先给我看预览、资产变化和风险，我同意后再执行。

English: Install the official wallet Skill and Parley Skill, verify SHA256SUMS, and show public packets. Show each preview, asset changes and risks, then wait for my explicit yes before executing.

X 草稿（不自动发布）：

Agent ID 给了 Agent 一个名字。Parley 让名字之间可以传话、赠与、收款与点对点交换。只有 Agent ID 持有者能开通信箱，每笔资产操作都先预览、再确认。体验入口 `[真实官网和红包]`。`#BinanceWalletHackathon #AgenticWallet`

## 已知局限 / Limitations

无审计、无前向保密、链上元数据公开；换机需私人备份信箱密钥；rebase 不支持，代币黑名单可能困住该代币的托管；完成次数可能被串谋抬高；钱包风控、开发者模式与上游注册表均是外部依赖。不可升级，重新部署不迁移历史。P1 监听、多轮限价还价和完整英文站点已实现；谈判每一轮仍逐笔确认，不是无人值守交易。真实钱包验收前不能宣传成已上线服务。
