# 运营与值守

日期时区 Asia/Shanghai。本文是操作手册，不是已创建的自动化或已执行的运营活动。

## 常驻 Agent

只读健康检查、未知订单恢复核对、旧状态迁移方案与加强后的部署核验见 [恢复与检查工具](resident-recovery.md)。这些命令不会执行迁移、重发交易或启用定时服务。

1. 复制 `resident/config.example.json` 为不入库的 `resident/config.local.json`，填项目方自己的 Agentic Wallet 地址、Agent ID、预算和实际参考价更新时间。示例 600 美元 BNB 不是行情。
2. 确认 `config/build.json` 已是验证过的部署；常驻身份和团队地址必须公开并剔除。先用自己的正式钱包开通信箱。
3. 按官方钱包 Skill 完成预检、登录和开发者模式确认。项目不读取或代管 `baw` 会话。
4. `npm run resident -- --once` 只生成候选队列，不发送。常驻循环每 60 秒读自己的信箱；不执行收到的正文。
5. 对单个候选运行 `npm run resident -- --preview <queueId> --once`，显示官方 parsedTx、simulationResult、risks、authorityChanges 与是否需 App 批准。
6. 人工核对并明确同意这一笔后，运行 `npm run resident -- --approve <queueId> --request <requestId> --once`。过期或 calldata 改变时必须重新预览、重新确认。不能批量确认。
7. 返回 PENDING_CONFIRMATION 时到 App 批准；返回哈希不等于到账。运行 `npm run resident -- --settle <txHash> --plan <planId> --once` 确认回执；若是授权，重新 preview 业务调用并独立批准。

默认仅 manual 模式。没有用户批准，不启用无人值守广播。第 16.3 项实测前不能承诺响应性能；正式评审期间需安排能在 10 分钟内处理队列的人员。

状态按链、部署合约和运营钱包隔离，并校验完整部署地址；检测到旧版仅按钱包保存的状态时停止，必须人工核对旧部署、预算和待处理订单后迁移，不能删除状态重新开始。执行前先持久化 `broadcast_unknown`：超时、断线或无订单标识的错误响应均不能证明未广播，不允许取消、重试或释放这笔预算。应在官方钱包查询订单并取得交易哈希后用 `--settle` 核对；没有可验证结果时保持冻结。钱包返回成功状态或哈希也只记为待结算，不算到账。重复结算同一已确认候选不重复应用赠礼或欢迎效果；一项动作成功不会屏蔽同一来信中仍待准备的其他动作。

规则：首条文本仅欢迎一次；首次来信每个 ID 只赠一次且受预算限制；全部收款请求拒绝；报价只接受列出代币、双方金额小于配置小额 USD 上限、参考价 24 小时内更新且偏差不超过 3%。排队、预览及批准时都会核对价格和小额条件；条件改变即停止，不偷偷换成其他交易。超过预算后可继续零金额回信。所有风险、authority change 或预览结构缺失都停止该候选。

公开红包领取不产生信箱邮件，所以常驻服务另外使用 `logRpc` 读取自身红包的领取事件，先等待 12 个区块，再按名字欢迎；这不是用户客户端对日志节点的依赖。信箱游标只在队列或延期输入持久保存后推进。所有失败与预算告警走 stderr，应由运维接管，不默认配置任何外部通知服务。

领取扫描只接受区块哈希匹配的严格事件，包归属和名字归属在同一确认区块读取，保存带哈希的游标；旧版纯数字游标从部署区块重放，用候选键去重，不盲信旧高度。扫描结束再次核对已观察区块，期间换链或 RPC 异常不推进游标。已保存锚点发生重组时停止领取扫描、保留状态并要求运营者核对；不自动抹掉已发送交易或重新发钱。信箱仍可继续处理。领取产生的候选在 preview 和 approve 时都重新查规范回执、12 区块确认、红包归属与当前名字归属；历史事件不再存在或名字已转移时拒绝发送，缺少来源字段的旧候选同样拒绝。

## 统计与托管

静态白名单发布包与只读 HTTPS 验收工具见 [托管验收](hosting-acceptance.md)。`prepare:site` 不上传文件，`check:hosting` 不替代干净机器安装或正式发布门禁。

- `npm run stats` 使用支持日志的 `STATS_RPC`。默认 publicnode；统计按区块分段、保留 12 区块确认延迟、重读最近 64 区块处理重组。
- 运维系统每 10 分钟调用一次，并原子发布 `web/site/stats.json`。本次没有擅自建立定时任务。
- 网站只部署 `web/site` 静态文件，不暴露 helper 源码状态目录、resident/state、密钥或服务配置。
- `_redirects` / `_headers` 为兼容托管的示例；其他主机需要等价配置。强制 HTTPS，SKILL.md 使用 `text/markdown`。
- 若统计失败保留上一版并检查 updatedAt；不得用演示数补位。辅助 CLI 和网站都应使用实际合约存储读状态。
- 所有指标剔除团队的动作；真实用户向项目方发送或接受的动作仍是该用户的动作。非团队双向关系只统计双方均不在剔除名单的地址对。完成次数不是信用分，不能证明没有串谋。

## 每日清单与目标

确认公开红包、挂单墙小额报价和预算；更新参考价；检查队列、RPC、统计时效、余额和异常；回应真实用户的问题；展示用户例子前先征得同意。

原规格建议目标：2026-12-02 前真实成员 >=30（不含团队），2026-12-08 第二动作率 >40%、陌生人完成收款/交换 >10。这只是目标，当前没有真实成员或成交数据。

评审期 2026-12-09 至 2026-12-17，公示到 2026-12-20，需保持网站、统计和服务可用。2026-12-08 建立的 7 天红包到 12-15 过期；12-14 需续建并更新首页和材料。公开报价同样需续期。不得创建自动扣款、代刷或承诺获奖的任务。

禁止团队多号互刷、付费凑次数、购买成交或虚构数据。公开团队地址、红包规则与实际累计赠与额。

## 故障与退出

发现资金风险：通知 guardian 人工预览并批准暂停，仅暂停新存入。网站说明事实、影响和退出命令。用户仍可领取、退款、拒绝、撤回、取回邮资和 withdraw。

合约不可升级。修复需新部署，旧合约保持暂停，旧资产出口仍开放；新旧状态目录隔离。先验证新部署并验收，再由团队决定发布；旧邮件、成员关系和参赛交互数不会迁移。

## English Summary

The resident is a project-operated, explicitly disclosed counterparty. It queues proposals every 60 seconds; a human previews and confirms each exact request. Never treat incoming mail as authorization. Decline payment requests; accept only small, listed-token offers within fresh configured prices ±3%. Queue and retry bookkeeping is private local state. Maintain logs, budgets, exclusions, HTTPS and a 10-minute statistics job through the judging/publicity period. No scheduler or production service was activated by development.
