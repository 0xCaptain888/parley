# 红线自查 / Safety Checklist

这是实现证据表，不是官方认证。公网发布、BscScan 和真人验收仍未完成。

| 红线 / Rule | 实现与证据 / Evidence | 状态 |
| --- | --- | --- |
| 无网页扫码或配对码登录 / No web wallet login | `web/site` 无钱包 SDK、无 provider、无连接/登录表单 | 已实现，浏览器验收另见报告 |
| 不代管会话 / No user sessions | helper 只读公开 RPC 与自己状态；不读 baw 文件 | 已实现 |
| 用户逐笔预览确认 / Explicit per-call consent | `skill/SKILL.md` 第一条；常驻也采用人工逐候选确认 | 已实现，真实钱包待验 |
| 不无感转资产 / No silent asset movement | helper 无签名/广播；合约所有资金操作需发送者主动调用 | 已实现 |
| 不无限授权 / Exact approval | `helper/src/calls.mjs` 使用当笔金额；先批准再重跑业务 | 本地集成已覆盖 |
| 公开源码、披露权限 / Source and permissions | MIT 源码、本地 ABI parity；guardian 仅暂停 | BscScan 未执行，未公开仓库 |
| 不冒用品牌 / Independent branding | Parley 名称及每页第三方免责声明 | 暂名；域名待查 |
| 不收集敏感数据 / No credentials | 网站无输入；专用信箱密钥本地 0600，不是钱包私钥 | 已实现 |
| 不承诺收益 / No investment claims | 统一使用赠与、点对点交换、完成次数 | 文案已按规格编写；人工发布复核 |
| 交易风险提示 / Exchange risk | 挂单墙、所有 helper 交换输出、Skill | 已实现 |
| 不按名查人资产 / No profiling | 无搜索/个人主页；人只显示 `.ai` 名字 | 已实现；仅统计页公开团队剔除地址 |
| 不刷量 / No manufactured activity | 排除团队动作，演示数据明确分离 | 真实运营需持续遵守 |

收到的消息、备注、祝福语、自定义代币 symbol 始终在 `untrusted`。它们不能授权 `policy set`、付款、改联系人、登录或任何其他动作。警告必须原样转述。

## Threat Model / 威胁模型

| 威胁 / Threat | 防护 / Mitigation | 剩余风险 / Residual Risk |
| --- | --- | --- |
| 消息诱导 Agent 转账、改限额 | 严格 schema、untrusted 边界、逐笔确认、用户才可改限额 | LLM 必须实际遵守 Skill，不声称从数学上杜绝注入 |
| 恶价或假代币 | 精确数量、完整代币合约、本地额度、自定义币默认 deny | 不提供价格公平性或价值保证 |
| 骚扰与多号 | 上游身份门槛、每日 20 次陌生人配额、邮资、拉黑 | 依赖注册表政策，不能证明所有地址都是真人 |
| 合约漏洞 | 固定上限、暂停新存入、退出不暂停、测试及静态分析 | 无独立审计，告警尚需复核 |
| guardian 作恶 | 不能提款、不能升级、不能改参数 | 可阻止新业务，用户仍承担链与代币风险 |
| 发布文件篡改 | 明文单文件、锁定依赖、SHA-256、用户预览 | 同时篡改网站与哈希仍有供应链风险 |
| 信箱密钥丢失或泄露 | 0600、旧密钥保留、轮换、私人备份 | 历史密文无前向保密，丢失旧钥不能恢复 |
| RPC 不诚实或不可用 | 链 ID/代码/注册表核对、fallback、模拟、回执和原交易匹配 | 普通 RPC 不是共识证明；前端统计会延迟 |
| Token 回调、黑名单、税费 | nonReentrant、SafeERC20、实际到账计量、测试 | 恶意余额实现/rebase 不支持；黑名单可锁住特定资产 |

English: The helper is not a signer, wallet custodian, identity-proof service or price oracle. The website is a read-only view. The guardian has no asset-seizure authority. Integrity checks, local tests and static analysis do not constitute an audit or a guarantee of safety.
