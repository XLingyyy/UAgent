## 当前更新（2026-11-04）：当前会话的部分失败可重新批准恢复

原生批量修复发生部分失败后，如果结果与备份已落账、原执行已结束、没有 unknown 文件结果，且原可信窗口会话仍有效，现在可点击“准备已写入文件的恢复差异”，重新审阅后“请求批准恢复一次”。原生确认显示精确路径与前后哈希；恢复会新建备份与结果记录，不自动重建。文件被外部修改会阻止覆盖。

复用原回调实际结束后产生的不可序列化 SettledOperationProof，不根据保存状态猜测停止。新恢复操作通过现有 SQLite 事务、RuntimeHost、取消与文件写入机制。仅在精确反向计划下对原效果及原运行的 needsReconciliation 摘要作本次准入例外，其他屏障仍阻挡；原部分失败屏障不删除。因此文件恢复完成不代表原历史已完成核对，也不表示后续构建已解锁。

范围限制：仅当前未过期会话；关闭窗口、重启、过期、未知写入或证明丢失后仍只读核对。恢复本身部分失败或未知时不自动重试。新增 7 项原生合成 SQLite/文件/宿主检查、4 项模拟 IPC 界面测试、类型检查、生产 cargo check --lib（82 条警告）及差异复核通过。初次测试失败与修复经过保留；没有真实桌面、真实项目或跨重启恢复验收，冻结 EXE 未重建。

证据：`../../evidence/t18-live-approved-restore-20261104-r1/actual-result.json`。下方是历史状态，旧“恢复写入未接通”结论由本节的有限范围交付更新。

---

## 当前更新（2026-11-04）：恢复记录阶段与反向差异预览；恢复写入仍未完成

历史恢复核对现在显示原执行的持久派发阶段，并可展开只读恢复差异。只有保存结果确认 applied、当前文件对象和内容仍匹配写后状态的文件才出现反向候选；恢复内容来自已校验的写前备份。预览没有写入按钮，不授予恢复权限。

原生停止证明仍有具体缺口：InCallback 或无匹配 barrier 不能证明旧执行停止，当前持久 owner 也没有可重新核验的原 OS 进程身份。Settled 记录了回调返回，但尚未接成限定原操作的恢复事务证明与准入；现有退休接口仍要求原生不可序列化 SettledOperationProof。因此本轮没有清除 barrier、伪造证明或接入恢复写入。

验证：5 项原生合成检查、6 项界面/模拟 IPC 测试、类型检查、生产 cargo check --lib（82 条警告）、限定差异检查和独立差异复核通过；4 个验证 Job 已独立确认退出。不含真实应用重启、桌面操作或恢复写入验收，冻结 EXE 未重建。证据：`../../evidence/t18-recovery-restore-preview-20261104-r1/actual-result.json`。

以下为历史交付记录。

---

## 当前更新（2026-11-04）：重启后的文件/备份只读核对已接通，恢复写入仍缺前置

历史修复记录现有“只读核对当前文件”入口。用户重新选择并信任原项目后，原生按历史备份派生精确文件范围，校验原根对象、备份计划/内容哈希及结果绑定，然后检查当前文件身份和内容。结果区分修改前、计划修改后、对象更换、外部内容变化和无法读取；缺失结果不会推断成功。此入口不需要保留原 RepairSession，因此支持重新启动后重新建立信任的核对流程。

已验证：4 项原生合成文件检查（释放旧会话、重新打开根句柄）、4 项组件/模拟 IPC 检查、集成类型检查、生产 cargo check --lib 和最终差异复核。诊断引用绑定遗漏已小修并定向复验。未实际重启应用或验真实桌面。证据：`../../evidence/t18-repair-restart-inspection-20261104-r1/actual-result.json`。

**用户明确批准后的恢复写入尚未完成。** 当前 catalog 退休原效果要求不可序列化的原 SettledOperationProof；文件内容匹配不足以证明原执行停止，也不能清除 partial/unknown 阻塞。下一步需实现原生限定原操作的恢复停止证明/准入，再接新恢复差异、批准及备份落账。界面明确显示此缺口，不创建虚假恢复权限，不覆盖文件。

---

## 当前更新（2026-11-04）：多文件手工修复批次已接生产流程

失败构建 → 原生批准读取最多 8 个已有 Source 文件（每行一个路径）→ 逐文件手工编辑/差异审阅 → 批次原生批准写入 → 全部成功、落账及收尾后另行批准重建。未编辑文件不写入。模型建议/本地响应导入仍限单文件，不扩大外发范围。

复用已有 RepairSession、RuntimeHost、SQLite 准入和整批 before 备份。原生从已读快照派生所有 before/hash/identity；审批展示全部目标及前后哈希，renderer 不提供 shell、工程根或 before 权威。全部目标写前冲突检查通过后才开始任何文件写入。

部分失败显示逐文件 applied/not_started/conflict/unknown、修改前备份 SHA-256 与已落账历史 run ID，并停止重建/重试。已有引擎层恢复原语不等于生产恢复：跨重启载入备份、未知效果核对、外部编辑冲突及新恢复事务准入仍未接通，本次没有新增自动恢复写入。

4 项原生合成文件测试、13 项相关组件/模拟 IPC 测试、集成类型检查、生产 cargo check --lib 及差异独审通过。首次新增测试读取 Serialize-only DTO 的编译失败已保留，修正测试读取方式后通过。证据：`../../evidence/t10-source-batch-repair-20261104-r1/actual-result.json`。未操作真实用户工程、调用模型或重建冻结 EXE，真实桌面/UE 尚未验。

下方旧状态按时间保留；“多文件未接”的历史表述不代表此切片之后的源码状态。

---

## 当前状态更新（2026-11-04）：在线建议接线与差异定位已完成源码集成

用户已明确授权开发单文件 DeepSeek 修复建议。当前代码已接入原生批准读取后的单文件及匹配报错，发送前必须确认正文和按用户核实单价计算的费用估算；开发仅用模拟响应验证，未真实发送。参见 [在线建议当前交付](t22-online-repair-suggestion-20261104.md)。下方“等待开发授权/接线被拒”的段落仅是先前历史记录，不再代表当前阻塞。

T16 现在在原生修复精确预览及已保存修复历史中显示原/新行号、精确替换块和 CRLF/LF/CR/无末尾换行标记。多个编辑会合并成一个替换块，可能包含未改中间行；不宣称最小差异或语义差异。完整前后源码保留，写入与重建审批未改变。5 项差异组件检查、3 项相关审批/历史回归及集成类型检查通过；证据：`../../evidence/t16-source-change-review-20261104-r1/actual-result.json`。

当前剩余重点：多文件生产批次与冲突/部分失败处理、完整工作流及真实 UE/桌面验收。此切片没有重建冻结 QA EXE；桌面工具不可用单独列为验收阻塞，不阻止其他开发。未调用外部模型、发送源码、修改真实用户工程或运行真实构建。

---

## 2026-11-04 更新：模型响应本地导入已接通，在线建议接线被审批阻止

距离在线自动提出修复建议，关键缺口是现有 ProviderAdapter 分析请求与当前原生文件快照的连接。现有已保存凭据及 Responses 会话只允许讨论，不能伪装普通聊天绕过。拟复用临时 DeepSeek 工具反馈通道的源码变更被自动审批拒绝：新增向 DeepSeek 发送项目源码和诊断的持久出站能力缺少用户针对该目的地与数据范围的明确授权。拒绝命令未执行；随后只读确认预期目录和文件不存在。没有重试或绕过，没有新增任何 Provider/网络请求代码。

已完成独立本地切片：原生批准读取一个源码文件后，界面可粘贴已有模型响应 JSON。复用现有修复协调器的封闭结构、路径和文本校验，仅接受当前文件的一个 path/after 替换；拒绝新路径、多文件、命令、批准字段、二进制内容及无变化响应。用户显式采用后，仅填入替换编辑框并清除旧差异/审阅勾选；仍须重新准备精确差异，单独批准写入及重建。该入口不调用模型、不外发源码。

验证：9 项合成局部测试、当前前端 TypeScript 检查和只读差异独审通过；两个验证 Job 已清空。没有真实模型、用户工程修改、真实构建或 UI 实机验收；未重建 EXE。证据：`../../evidence/t22-model-repair-local-20261104-r1/actual-result.json`。

后续在线接线需要用户明确授权开发“在每次外发内容和预算确认后，将当前已批准读取的单文件源码及选中诊断发送至 DeepSeek 生成建议”的能力；本轮没有获得该具体授权。实际写入和重建继续各自批准。

## 2026-11-04 更新：单文件手工修复与分别批准重建已接源码

入口：内置工作流 → 构建修复 → 准备目标命令 → 原生批准一次构建。仅当这次真实原生构建失败、进程结束且结果完整落账，才显示“单文件手工修复”。用户选择一个现有 `Source` 文件，原生确认读取范围；手工输入完整替换内容，审阅完整修改前后内容和精确计划 SHA-256，勾选审阅后再次原生确认写入。写入完成、备份及结果落账并确认租约收尾后，才开放独立的原生重建批准。

原生续接保存原失败构建、根身份、配置计划及原可信文档，约 10 分钟过期；关闭面板按原 selection/session 精确释放，迟到响应补偿释放。写入单独通过 RuntimeHost/SQLite 一次性操作准入，先保存修改前内容与历史引用，再复核对象身份/内容并修改。取消、原文件变化、配置变化或权限失效会失败关闭；部分/未知结果不开放重建。重建复用固定 UBT 执行入口，并在执行期间持有已修改文件的内容/身份保护。

本次局部验证：8 项 jsdom/合成 IPC 组件测试、2 项原生生存检查、1 项真实合成文件与 SQLite/RuntimeHost 集成测试通过；生产前端类型检查及最终 `cargo check --lib` 通过；差异独审发现的闲置句柄释放和 StrictMode 误释放已修复并复核。原有 38 项未重跑，无全量测试、真实工程构建或模型调用。未重建 EXE；真实窗口审批、桌面 UI、真实 UE 编译仍未实机验收。证据：`../../evidence/t22-single-file-repair-20261104-r1/actual-result.json`。

这是一条手工单文件垂直切片，不能标成完整自动构建修复：自动提案/模型、多文件循环、未知写入恢复、真实 UE 重建验证仍不在本次已验范围。下方旧日期说明保留为历史，当前状态以本节为准。

## 2026-11-04 更新：失败构建诊断入口（部分交付）

一次构建返回后，可点击“分析本次构建结果”，查看真实原生结果中解析出的错误码、阶段、文件与行号。入口与现有 BuildRepairCoordinator 共用失败可诊断条件；输出不完整、进程未确认结束、结果未保存时明确阻断。日志路径只显示，不构成文件读取或修改权限。

本次没有接通原生 RepairSession 或修改文件的生产路径。完整 T22 仍缺：保留并核对原始失败构建身份，取得原生项目写入租约，绑定已批准的精确文件范围，持久化修改前备份，明确差异审阅与一次性写入批准，修改后独立批准构建并保持输入身份。不能拿已经释放的构建租约或前端 DTO 代替这些条件。

验证：新增组件 8 项通过；针对受影响协调器的已有合成回归 2 项通过（其余 63 项未运行）；生产前端类型检查通过；一次只读差异独审通过。全部为合成/静态验证，没有真实工程、模型调用或真实桌面 UI 验收，未重建 EXE。原有 38 项未重复运行。证据：`../../evidence/t22-failed-build-diagnosis-20261104-r1/actual-result.json`。

> Current update (2026-11-04): manual, explicitly approved single-build entry is now connected in source. See the latest section below. Earlier preflight/slice sections are historical records, not the current implementation boundary. Full automatic build repair remains incomplete.

# T22 current delivery — 2026-11-03

T22 remains **partially delivered**. The original four templates are project investigation, build repair, interactive Blueprint and scene batch. Build preparation is not completed build repair. Current source is ahead of the frozen QA r2 executable, which was not rebuilt or run.

| Template | Current product connection | Verification and remaining work |
|---|---|---|
| Project investigation | Selectable entry creates an investigation task through the existing task/scope/read-only capability chain. | 17 focused entry/integration tests and type checks passed using synthetic IPC/provider responses; real desktop/provider flow remains unverified. |
| Build repair | Selectable entry parses pasted logs locally and opens the existing native command-preview panel. Log origin is explicitly unverified; no build is executed. | 11 focused preparation/entry tests and type checks passed. Actual build, approved source repair, retry and verification are not connected. |
| Interactive Blueprint | No completed selectable production workflow. | Existing plugin/modules are not template acceptance. |
| Scene batch | No completed selectable production workflow. | V2 compilation is not scene execution or template acceptance. |

Evidence: `../../../evidence/workflow-investigation-20261103-r1/actual-result.json` and `../../../evidence/workflow-build-preparation-20261103-r1/actual-result.json`. These are focused local results, not full T22 acceptance.

## Concrete build-repair execution gaps

- `apps/desktop/src-tauri/src/lib.rs` declares `ue_build_process` only under `cfg(all(windows, test))`; production IPC registers build preview/release, not build execution. `ue_build_repair` has no production module declaration. Preview storage intentionally exposes no executable plan retrieval. A displayed command or pasted log cannot authorize execution or become an owned build result.
- Existing `ue_build_process.rs::execute_ue_build` already implements revalidation, held inputs, exact process ownership and settlement; it requires a separately consumed one-use host approval. These helpers need a narrow production host connection, not replacement with a new executor.
- Existing `ue_build_repair.rs::RepairSession` implements snapshots, preview, approved apply, held build inputs and recovery/restore preparation. `packages/runtime/src/ue-build-repair.ts::BuildRepairCoordinator` has no production adapter for its native ports and requires an actual owned initial build result. A fixture proposal callback is not a production repair proposer.
- RuntimeHost admission/resource registration already exists. A UE worker still needs to consume its native operation ticket and retain ownership through actual process settlement. Full writer-fence/cross-send integration remains incomplete; this does not mean RuntimeHost is absent.
- The product still needs persisted build intent/results and repair checkpoints, trusted-window cancel/close handling, exact diff approval, separate rebuild approval and bounded retry/recovery integration. Unknown process/result states must remain unknown.

## Minimal next implementation

First connect one explicitly approved native build for a fixed project/profile/target through the existing trusted document/root and RuntimeHost resource admission. Resolve and revalidate native inputs; do not accept arbitrary argv or treat a preview DTO as authority. Persist the real result and settle cancellation/close with the owned process tree. Validate this single-build lifecycle with focused isolated tests before adding source writes.

Then connect the real failed-build receipt to existing diagnostics, owned snapshots, a reviewed exact proposal, one-use native apply approval, separate rebuild approval and bounded coordinator recovery. This is a proposed next step only: this task did not add IPC permissions, enable automatic edits/retries or change production dispatch. No additional preview-only template is counted as closing the execution requirement.

## Single-build wiring preflight correction (2026-11-03)

The next implementation is not only IPC wiring. Production installs `PersistentRecoveryCatalog::new()` without a `CurrentLedgerFence`. Even a complete empty scan returns Unknown: RuntimeHost keeps an operation queued as `recovery_unknown`, and both `register_pending` and `begin` require positive admission. No production UE-specific transaction-admission path was found.

The existing `EffectJournal::mark_may_have_been_sent` and `dispatch_once` already supply durable one-use handoff; they do not establish RuntimeHost admission. The existing physical-transaction admission is specifically bound to `MemoryExecution`, native model creation and model jobs with empty resource claims, so it cannot serve as a UE launch permit.

The immediate prerequisite is a narrow operation-specific connection between the existing physical transaction, persistent effect handoff and RuntimeHost UE ownership, including exclusion of its exact current intent while retaining other unresolved barriers. This needs implementation and focused boundary validation before an executable approval UI can be delivered. An always-Ready catalog, cached scan, renderer approval or ledger ticket alone must not substitute for this connection.

The preflight made no execution IPC/UI change and ran no user-project build or synthetic execution test. Independent read-only review confirmed the blocker. Evidence: `../../../evidence/t22-native-build-wiring-preflight-20261103-r1/actual-result.json`. T22 build repair remains partial; there is no new approved-build user entry yet.

## Implemented operation-admission slice (2026-11-03)

The preceding preflight blocker now has an implemented native transaction bridge. `register_ue_operation_pending` reserves the exact original host/root/resources without launch authority. `dispatch_ue_once` reuses the durable one-use effect handoff; a fresh same-connection IMMEDIATE transaction scans the real ledger and admits only that exact current effect through the original catalog and host. The external callback is entered only after the claim COMMIT succeeds and final owner/cancellation/deadline checks pass. No global Ready state, model-admission substitution, restored approval or renderer execution IPC is introduced. Other sticky barriers remain.

Ten focused tests passed with real isolated SQLite, root handles and RuntimeHost, using a counter as the executor. They cover one-use tickets, observer settlement, competing reservations, cancellation/window disconnect/deadline, post-COMMIT lateness, stale owner/journal, other unresolved effects, second-connection cancellation and real deferred-constraint COMMIT failure. The original handoff COMMIT-failure regression also passed in a separate process. Actual desktop `cargo check --lib` passed. Independent review found the post-COMMIT deadline gap; it was fixed and its added test passed.

An attempted nine-test legacy handoff group did not pass: its old cross-thread fixture violates the current native SQLite ownership gate, then poisons the shared owner for later tests. The first attempt also lacked its required E: fixture environment variable. These failures are retained in evidence; the ownership protection was not weakened and the group is not claimed as passing.

Evidence: `../../../evidence/t22-operation-admission-20261103-r1/actual-result.json`. The unrelated Tauri window type in the focused harness is an always-deny compile stub; it is not used by the tested admission chain. The separate desktop type check uses the real production types.

Still not delivered: the explicit approval UI/IPC and native one-use exact-plan grant, trusted-document cancellation wiring to the UE process, managed-store release before long-running process work, native build result persistence/observation, and precise source repair/rebuild validation. The executor remains test-configured in desktop lib.rs. This is implemented backend admission, not a user-executable build workflow. No user project, model/provider, editor or game was run; no EXE was rebuilt. General catalog admission remains conservative, and memory dispatch remains false.

## Connected approved single-build entry (2026-11-04)

User path: Built-in workflows → Build repair → Prepare target command → prepare the project-bound Editor preview → Request native approval and build once. The native dialog displays the actual project, target, executable, arguments, working directory and fingerprint, defaults to No, and consumes this preview once even if declined. The renderer supplies only project ID, prepared ID and fingerprint, never a shell command, executable override or project-root authority. The original trusted document, native root, fingerprint and file bindings are rechecked.

A real native handoff claim remains InCallback across release of the managed SQLite owner, pending process scheduling and actual executor return. The existing owned Windows Job executor is now declared in the production crate. Window/document revocation and explicit cancellation reach its native liveness/start checks. Only after the actual process callback returns can a move-only, original-database-bound completion settle the claim and save its native receipt as an artifact plus a history event/checkpoint. A revoked document grants no new work; terminal-only completion can still save while the original store remains alive. A closed/unavailable store or abrupt app exit leaves uncertainty rather than inventing a saved result.

Fresh verified quiescent completion retires only its exact own catalog barrier (matching database, key, digest, owner, root and revision). Other effects and legacy barriers remain. General catalog admission is not globally enabled; production memory dispatch is still false. UI success requires exit 0, stopped tree, complete output, saved receipt and settled host. It shows cancellation as pending until a native result arrives, cancels on unmount/project change, and ignores late results.

Validation: 13 operation/claim/real-SQLite receipt tests, 9 existing handoff regressions, 2 native liveness tests without process creation, 14 frontend synthetic-IPC/component tests, current-integration TypeScript check and actual desktop cargo check --lib passed. The two old handoff fixtures now model multiple connections reentrantly on their real single owner thread; the production SQLite gate was not changed. This does not claim simultaneous cooperating writer execution. Prior failures and quota/connection interruptions are preserved in evidence. Independent review findings were fixed.

Evidence: `../../../evidence/t22-build-entry-20261103-r1/actual-result.json`. Tests use synthetic project data and controlled executor receipts, not actual UE execution. No real native confirmation dialog, user-project compilation, model/provider, editor/game, real desktop UI or app-exit interaction was run. The frozen QA EXE remains unchanged and does not contain this entry.

Still missing from full T22 build repair: automatic precise source proposal/apply approval, bounded repair retry and rebuild verification. The new entry is one manual approved build; it does not complete the full build-repair workflow.
