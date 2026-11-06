# 构建修复失败恢复验收（2026-11-06）

本轮确认了普通预览的构建取消、带受控停顿的真实桌面部分写入与同会话恢复，以及结果未落账时进程退出后的阻断。此前完整写入后重建失败的跨重启逆向恢复也已通过。各项范围分别记录，不表示整个失败恢复、断电恢复或通用任务续跑已经完成。

验收使用 UE 5.8.4 和 Test01 独立副本中的受控 C++ 模块。原 Test01 是无 Source、Content 无文件的 Blueprint 工程，原工程未改。本轮失败恢复使用手工草稿，模型请求为 0；模型修复成功链保留在[在线建议验收](t22-online-repair-suggestion-20261104.md)。

## 已确认场景

| 场景与环境 | 运行记录 | 已确认结果 |
| --- | --- | --- |
| 普通本地预览：真实 UI 取消正在执行的构建 | `c2ecd578b355a4c8a9b0eb1698bb193a` | `cancelled` / `cancel_requested`，exit 为 null，8157 ms；进程树停止、输出完整且未截断，派发阶段 settled。UBA 已开始 4 个动作，未记录完成的编译/链接动作。没有后续自动构建或修复。 |
| 本地插桩预览：首文件写入后暂停 10 秒，通过 UI 取消 | 前置构建 `fc5e013dcee036a5a9ca37aa97f0807e`；部分写入 `c066d6e02730449f981e2167315f5db9` | 整批 before 备份包含 CPP 和 H；结果 `partial`，CPP `applied`、H `not_started`。CPP 的 CRLF→LF 属于已审阅批准的草稿差异。原运行 `needsReconciliation`，副作用 `resultUnknown` / `executionUnknown`，派发阶段 settled；未重建。 |
| 同一插桩会话：重新审阅 CPP 逆向差异并单独原生批准 | 恢复 `823a288618a4c46c9d83aa756646800d` | 仅 CPP 恢复，结果 `succeeded` / `applied`、`verifiedCompleted` / `settled`，生成新 before/result。完整恢复 before 等于原写入 after，恢复 after 等于原写入 before；文本第 5 行 `BaseValue`→`BasValue`，LF 6→CRLF 6。H 未写入，两文件最终字节均等于原故障快照，未自动构建。 |
| 此前普通预览：完整 applied 写入后重建失败，退出应用后重新批准恢复 | 原写入 `1b2e6c6670877e3a8ae32f16901b7b1d`；失败重建 `c0460708e6d34aefcf05be5e78f115f8`；恢复 `2a59575b5c64b26ae512551e5be53a3c` | 原进程身份与退出已核对；新会话重新信任项目、审阅并批准精确逆向。只恢复 CPP 一行，LF 保持、H 未变；恢复 `applied` / `verifiedCompleted` / `settled`，没有自动重建。 |

普通构建取消的 `treeStopped=true` 由原生 Job 活跃进程数归零后确认；独立 Win32 查询也确认根 PID 39204 已不存在。存储结果未包含独立的 `hostSettled` IPC 字段，能够独立核实的是 settled 派发阶段与已停止进程树。账本 `cancelRequested` 字段仍为 false；实际取消由原生 `cancelled` / `cancel_requested` 回执和 UI 观察确认。`verifiedCompleted` 在此表示执行终态已确认，不代表构建成功或未产生中间产物。

部分写入验收明确使用了本地专用二进制：复用写入后的测试时序点，在首个文件成功后暂停 10 秒，给实际 UI 取消保留确定窗口。停顿属于验收插桩；审批、取消、文件写入、备份和 SQLite 落账均通过实际应用完成。该结果不记作未插桩发行版的部分写入验收。临时停顿源码已还原，未纳入正式补丁。

恢复前 CPP/H 的字节证据采用主线程在确认恢复前保存的 `partial-before-restore.cpp` / `.h`，再独立与原生备份和回执比较；独立直接读取现场文件时，恢复已经执行，因此没有把恢复后的文件冒充恢复前取证。恢复后的两文件则由独立读取与 `partial-fault.cpp` / `.h` 完整字节比较确认。

部分写入恢复完成后，应用通过窗口关闭退出；PID 25724 的 Win32 等待结果为 signaled。重新打开 SQLite 的只读连接仍读到原运行 `needsReconciliation` / `resultUnknown` / `executionUnknown` / settled，以及恢复运行 `succeeded` / `verifiedCompleted` / settled。这确认记录持久化；本次恢复发生在退出之前，不增加“部分写入跨重启恢复”的桌面验收结论。

## 未落结果时退出的定向测试

新增 Rust 测试复用现有 `cfg(test)` 首文件后中断辅助函数，在首文件已写入、before 备份已落账后，且尚未执行 `settle_owned_operation` 或保存结果时，让真实子进程以 73 退出。父进程等待实际退出后重开同一 SQLite，确认：

- A 文件为 after，B 文件为 before；before 附件存在，result 附件不存在。
- 原效果仍为 `MayHaveBeenSent`，gate 为 `InCallback`，barrier 原因为 `HandoffUnsettled`。
- 只读检查报告 `matches_after` / `matches_before`，两项均为 `unrecorded`，没有已确认 applied 的恢复候选。
- 即使原进程已结束，历史恢复仍拒绝；直接重发返回 `freshApprovalRequired`，复扫后 barrier 继续保留。

这是一项真实子进程骤退、合成源文件和 SQLite 的确定性故障测试；没有通过桌面 UI 触发，也没有模拟硬件掉电。源码见 [Host 恢复测试](../apps/desktop/src-tauri/src/runtime_host_operation_admission_tests.rs)、[原生只读检查](../apps/desktop/src-tauri/src/ue_repair_recovery.rs)与[持久化准入](../apps/desktop/src-tauri/src/local_run_store/effect_reconciliation.rs)。

## 验证与产物状态

- 取消终态修复相关 7 项定向测试通过：已确认的 cancelled 回执保留取消终态；文档、项目根、Host 收尾和结果落账条件保持，取消不会重新开放修复或重建权限。
- 新增缺结果进程退出测试 1 项、既有同会话恢复边界 7 项、既有跨进程恢复 2 项通过。这些是各次定向执行结果，与早先 9 项恢复测试有重叠，不累计成新的独立用例总数。
- 去除时序插桩后的正常原生 EXE 与恢复提示文案的 web build 均已构建成功，exit 0；该文案已纳入新的正常预览 EXE。
- 本地证据位于 `.local-dev/temp/test01-build-repair-acceptance-20261106/`，不随 GitHub 发布：`live-cancel-build-summary.json`、`live-partial-cancel-before-restore-summary.json`、`live-partial-cancel-restore-summary.json`、`live-restart-restore-summary.json`；插桩构建与准备记录为 `partial-instrumented-build.json`、`partial-fixture-preparation.json`。

## 权限边界与后续顺序

部分写入的原 barrier 在逆向成功后仍保留为 `resultUnknown` / `executionUnknown` / settled。新恢复操作的 `verifiedCompleted` 仅确认这次逆向写入，不自动解锁原任务或其他未知效果，也不触发构建、重试、模型请求或旧任务续跑。恢复后重新引入的受控错误不计作编译修复或功能验证成功。

尚未覆盖：未插桩桌面写入中的稳定取消时序、桌面部分写入跨重启恢复、其他崩溃窗口、断电、通用任务和 UE 对象跨重启续跑、真实既有游戏源码与运行语义。现有 32 KiB 完整请求 / 1024 输出 token 限制下的长源码实际拒绝与缩小范围后修复也仍待验；既有游戏源码验收需要另一个含 C++ 源码的项目。

下一阶段按既定顺序推进：普通项目交互 Blueprint → 场景批次 → 通用任务与独立 Host 恢复 → 数据、协作与 Windows Beta。详见[当前状态](next-phase-current-status-20261030.md)与[路线图](mvp-roadmap.md)。
