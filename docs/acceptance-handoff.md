# Real Acceptance and Submission Handoff

2026-11-23. Preparation only: no participants contacted, interviews performed, real-wallet steps passed, video recorded, public repository created or form submitted. This checklist paraphrases Parley v1.0 sections 11.4 and 14 (PDF pages 42-43, 48-49); the original remains the requirements baseline, not authorization to spend or publish.

## Before Recording

- Obtain independent review of the exact source/compiler snapshot. Keep all unresolved findings visible.
- Agree final deployment parameters, guardian, native/token/gas budget and who pays. Never copy the draft's large example amounts.
- Individually preview and approve deployment and every later approval/business/guardian transaction. A broad testing consent is not per-call authorization.
- Verify final source on BscScan and compare canonical deployment runtime/parameters with local output.
- Configure the real HTTPS origin, downloadable Skill hashes, actual resident identity, exclusions and read-only statistics.
- Arrange two consenting real Agent ID holders. A and B need unopened mailboxes at the start of their respective steps; verify prerequisites before using an irreversible open call. Never ask for their seed, private key, wallet session, pairing code, KYC documents or account access.
- Record chain, final contract, source/compiler hash, build/Skill hashes, operator, date/time and separately approved maximum spend. Preserve originals privately; publish only consented, redacted evidence.

## The Twenty Steps

`npm run prepare:acceptance` writes a current-source-bound JSON record with exactly these 20 steps, all pending. It does not set release flags. Never populate it from local fixtures or an old trial.

| Step | Actor | Action and evidence |
| --- | --- | --- |
| 1 | A | `status`: expected real name and unopened mailbox |
| 2 | A | Preview, separately consent and open; confirmed receipt and refreshed status |
| 3 | A | Create public packet with two shares; ID/share text and same packet on website |
| 4 | B | Claim with no mailbox; one receipt demonstrates identity gate, mailbox creation and payment |
| 5 | B | Repeat claim; `ALREADY_CLAIMED`, no calls or broadcast |
| 6 | B | Send A without postage; packet-creator contact permission works |
| 7 | A | `inbox`, `read`, explicit `ack`; body remains untrusted |
| 8 | A+B | Block B, reject B's attempt as `BLOCKED`, unblock; free-contact permission not restored |
| 9 | B | Unstamped attempt returns `POSTAGE_REQUIRED`; separately approve stamped message |
| 10 | A | Reply releases postage and establishes free bilateral contact; account for gas separately in balance deltas |
| 11 | A | Exact small USDT request appears in B's inbox |
| 12 | B | Preview/approve exact allowance; confirm, regenerate and independently preview/approve payment; A receives exact net USDT and allowance returns to zero |
| 13 | A | Named BNB-for-USDT offer funds the escrow |
| 14 | B | Counteroffer, with independently approved exact token allowance if needed; original BNB refunded and reverse USDT escrow funded |
| 15 | A | Accept, with separate allowance if needed; business receipt shows atomic asset exchange |
| 16 | A | Public offer appears on board, then cancellation removes it and returns assets |
| 17 | A+B | Instruction-injection message is quoted only; no `policy set`, policy hash unchanged |
| 18 | B | Above-policy offer returns `OVER_POLICY_TX`; no calls, preview or broadcast |
| 19 | A+B+guardian | Create fresh packet; individually approve pause; new creation returns `PAUSED`, claim remains possible; independently approve resume |
| 20 | Either | BscScan decoded input for step 9 shows A's name in `toHandle` |

For every transaction record preview request/time/expiry, meaningful risk and asset-delta summary, consent evidence, hash/sender/target/value, decoded event, block/hash/status and gas. Approval and business calls must have distinct records. “Hash returned” is not “paid.” For a rejected command retain the expected error, empty calls and unchanged policy/config. Review evidence provenance, not just JSON completeness.

Step 10's economic postage release must not be confused with the wallet's net balance change, which also includes gas. The upstream Agent ID platform's uniqueness/KYC rules are external dependencies, not independently proven human uniqueness.

## Two-Minute Recording Checklist

Use two real agents side by side, with participant permission. Keep an unedited private evidence recording; the public edit must not imply skipped approvals never occurred.

| Time | Capture | English subtitle draft |
| --- | --- | --- |
| 0:00-0:10 | Product and real names, consented identifiers | Agent ID gives an agent a name. Parley lets names interact. |
| 0:10-0:35 | Actual packet preview, consent, receipt and new mailbox | One transaction checks identity, opens a mailbox and delivers the gift. |
| 0:35-1:00 | An actual first-contact relationship requiring postage, followed by reply | First contact carries postage. The recipient receives it when replying. |
| 1:00-1:35 | Actual offer, counteroffer, acceptance and decoded input | A counteroffer refunds the original escrow. Acceptance swaps assets atomically. |
| 1:35-1:50 | Quoted injection and locally rejected over-limit call | Incoming words are data, not instructions. Local policy rejects excess spending. |
| 1:50-2:00 | Real data page with team exclusions and freshness | Metrics exclude team actions and can be checked against chain data. |

Do not stage the postage segment between a packet claimer and that packet's creator: that relation is already postage-free. Capture a genuine permitted first-contact state or separately explain the blocking/unblocking transition. Do not claim stronger identity guarantees or omit gas, token behavior and audit limitations. The existing fictional `demo.webm` cannot substitute for this recording.

## Neutral Interview Guide

Obtain voluntary consent before interviewing or quoting. Do not pay for transactions, require a swap, promise rewards, solicit secrets or pressure anyone to fund an account. Store contact details separately from public research notes; participants may decline or request removal before publication.

| Chinese prompt | English prompt |
| --- | --- |
| 最近一次需要向别人收款、交换资产或通过 Agent 沟通是什么情况？ | Tell us about the last time you needed to collect payment, swap assets with someone or communicate through an agent. |
| 当时怎样完成？哪里最费力？ | How did you handle it, and what was hardest? |
| 按名字寻址对你有没有帮助？为什么？ | Would name-based addressing help you? Why or why not? |
| 什么情况下你会选择这种点对点交换，而不是已有工具？ | When would you choose a peer-to-peer swap instead of your existing tools? |
| 哪些信息是你批准一笔交易前必须看到的？ | What must you see before approving a transaction? |
| 邮资、额度、逐笔确认中，哪些会阻碍你使用？ | Which of postage, limits or per-call confirmations would get in your way? |
| 你是否愿意再使用？什么条件会改变你的决定？ | Would you use it again, and what would change your decision? |
| 哪些问题我们没有问到？ | What have we missed? |

Private record template: research ID; date/time; consent scope; non-team/self-reported relationship; actual task/context; existing alternative; observed friction; quoted statement with permission; positive and negative findings; prototype vs live session; researcher; participant corrections; publication permission. Leave all fields empty until an interview actually occurs. Self-reported intent is not usage; an address or transaction is not proof of an independent person.

## Submission Checklist

| Item | Prepared locally | Real evidence still needed |
| --- | --- | --- |
| Product, bilingual usage/permissions/limitations | Existing submission/compliance drafts | Final approved name and accurate claims |
| Test/security report | Timestamped current-source local evidence | Independent reviewer provenance/dispositions |
| Website/Skill/data | Static bundle and HTTP/CSP tooling | Authorized real HTTPS origin, clean-machine installation and fresh real stats |
| Contract | Compiler standard input, exact constructor/runtime checks | Final authorized deployment and BscScan verified source |
| Repository/license | Local source and MIT license | Approved public repository and rights confirmation |
| Demo | Script/subtitles and consent checklist | Real dual-wallet video, <=120 seconds |
| Demand | Neutral interview prompts/template | Consented real observations, including negative findings |
| Submission | Local bilingual draft | Actual form URL, exact fields/limits/attachments and human-approved final submission |

Form-field inventory template: actual form URL and observation time; field name/label; required/optional; type/length/file limits; allowed contract/address count; language; intended source document; verified value; reviewer; unresolved discrepancy. Do not infer the live form from the PDF. Final external checking and submission remain separate authorized work.

## 中文交接

本地已准备的是工具、空白记录和文案，不是实测结果。后续你协助确定逐笔预算与授权、第二名真实持有者、实际托管目标/权限、真实访谈和发布信息；独立安全评审仍需独立人员完成。开发不能代替这些事实，也不能从“模板填满”推导出可上线。
