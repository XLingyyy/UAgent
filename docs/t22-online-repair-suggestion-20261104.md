# T22 在线修复建议源码接线

## 当前未发布源码切片（2026-11-06 America/Phoenix）

首个本机 UE 5.8.4 隔离工程 UAgentBuildLab 已通过两个真实桌面修复场景：C2065 代码错误、HTTP 缺依赖链接错误。每次均先批准读取两个文件，再审阅固定 DeepSeek 端点、模型、完整外发正文和费用估算；模型各提出一个文件的修改。随后分别采纳、审阅原生单行差异、批准写入，再单独批准重建。该工程共完成 2 次真实模型请求、2 次原生写入、2 次成功重建；每条修复链均在第 1 / 3 次重建成功。

| 真实场景 | 模型提案与原生写入 | 构建结果 |
| --- | --- | --- |
| C2065 未声明标识符 | 两文件输入；仅修改 `CompileProbe.cpp`，将故意注入的未声明标识符替换为 `1`，保留 HTTP 调用。 | 原生失败 6 → 批准写入 → 单独批准重建 0。 |
| LNK2019 / LNK1120 缺少 HTTP 依赖 | 两文件输入；外发诊断包含 `objectFile=CompileProbe.cpp.obj`，模型仅在 `UAgentBuildLab.Build.cs` 补充 HTTP 依赖。 | 原生失败 6 → 批准写入 → 单独批准重建 0。 |

两次原始构建/重建结果均为 `treeStopped=true`、`outputComplete=true`、`outputTruncated=false`；原生写入结果为 `applied`，写入及重建 effect 均为 `verifiedCompleted`，无取消或人工对账标记。SQLite、原始结果附件与修复链已独立核对；模型请求和审批操作由真实 UI 观察记录。两次界面费用估算分别为 0.020224 CNY、0.020164 CNY，实际账单费用未核实。

**后续 Test01 验收：手工草稿与真实模型的双文件写入、重建分别通过。** 用户指定的 `G:\UnrealEngine\Test01` 是空 Blueprint 工程，没有 Source 或资产文件。仅复制工程描述、Config 和 Content 到 `.local-dev/temp/test01-build-repair-acceptance-20261106/project`，在副本新增受控 Test01 模块及 Editor target；独立 UBT 基线完成 7 个步骤、exit 0，原工程未改。随后注入 `RepairProbe.h` 的 `40 → 4O` 和 `RepairProbe.cpp` 的 `BaseValue → BasValue`；首轮真实原生失败运行 `4b379fba8f02496cb88e8155f8159b8a` 的原始结果含 `C3688`、`C2065`，另有 `C2338`。

Test01 旧版的前两次在线尝试均已显式审阅并批准，但界面只返回“无有效建议”，未得到可采纳提案。现有记录无法区分 transport 失败与提案解析拒绝，也不能确认实际发送或账单；两次界面估算各为 0.020082 CNY。该阶段记录为 `modelApprovedAttempts=2`、`modelAcceptedProposals=0`。随后补充固定安全错误分类：响应截断、非法 JSON、提案校验、会话失效及白名单 Provider 错误；不显示原始异常或任意响应正文。helper 21 项、建议 UI 22 项共 43 项通过，集成类型检查、Vite 和原生构建均通过。诊断版真实复验在外发批准后明确返回 `auth_missing`，该生产路径对应 HTTP 401/403；这不能追溯证明旧版两次失败的原因。

旧版两次失败后，采用手工审阅的本地草稿，纠正 cpp / h 两处字符，完整审阅原生差异（包含 textarea 的 CRLF → LF 变化）后一次批准双文件写入。写入运行 `486b19d5bb44b2870898b073013fffb6` 两项均为 `applied`，原生备份存在；单独批准的重建 `56bf93cb4e7e3ce5385b4e2be26029c5` 为 exit 0、输出完整且未截断，修复链第 1 / 3 次成功。提案来源明确为 `manually reviewed local drafts`。证据在 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-two-file-summary.json`；本次不计为已有游戏源码修复，也未验证运行时返回 42。

更正临时密钥后，针对新的失败构建 `e2cde551a0e7bf57bfc570167a632e69`，单次显式批准的真实模型请求成功给出两文件提案：`RepairProbe.cpp` 的 `BasValue → BaseValue`、`RepairProbe.h` 的 `4O → 40`。独立存储核对确认两文件持久化差异各仅一字符、CRLF 不变。用户采纳并审阅差异后，写入运行 `7f678c2c31eae3549e78e3e3265349e7` 的两项均为 `applied`；单独批准的重建 `45ab510b34dd24286662da650779f06f` 已由真实 UI 及原始回执确认 `succeeded`、exit 0，`treeStopped=true`、`outputComplete=true`、`outputTruncated=false`。写入与重建均为 `verifiedCompleted` / `settled`，无取消或对账标记。界面费用估算为 0.020082 CNY，实际账单未知。已生成独立核对摘要 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-model-two-file-summary.json`。该链与此前手工草稿链分别记录，不合并提案来源；没有自动重试、写入或重建。

**三轮批准上限 live 验收已通过。** Test01 受控模块从初始构建 `dfc3046ab4c1b7a41514bece466bc895` 的 4 个 C2065 开始，沿同一 chain 完成 3 次手工草稿写入和 3 次分别批准的重建，未声明符号数依次为 4 → 3 → 2 → 1。最后一次重建 `c0460708e6d34aefcf05be5e78f115f8` 仍为 exit 6，状态 `round_limit`、计数 3/3；UI 停止提供继续修复/重建入口，存储中没有同链第 4 次重建。本场景模型请求为 0，首轮手工草稿的 CRLF → LF 已纳入完整差异审阅。独立存储核对摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-round-limit-summary.json`；它验证逐轮批准和次数上限，不计为模型三轮修复成功。

双文件写前冲突场景已由 UI 与独立存储核对确认：写入运行 `d4d0ecbe4060e890d32b471bdb3ac920` 返回 `conflict` / `repair_source_changed_since_preview`，cpp 为 `not_started`、h 为 `conflict`，效果为 `verifiedNotOccurred` / `settled`；没有写前备份或 `recoveryRecord`，该链仅有初始构建。两文件均保持冲突前 cpp / 外部编辑后 h 的快照字节，整批停止且未继续重建。摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-conflict-summary.json`。该场景验证写前冲突阻止整批写入，未发生部分写入，不计为恢复成功。

**历史逆向恢复已通过真实 UI 与独立存储核对。** 原写入运行 `1b2e6c6670877e3a8ae32f16901b7b1d` 已全部 `applied`，随后重建 `c0460708e6d34aefcf05be5e78f115f8` 失败。旧桌面进程 45808 已退出；新进程 45268 中，用户重新信任项目后，经重新审阅逆向差异和原生批准执行恢复，恢复运行 `2a59575b5c64b26ae512551e5be53a3c` 已显示 `applied`，记录为 `succeeded`、revision 2。本次只把 cpp 的 `BaseValue+0+0+0+UAgentRound3` 撤回为上一写入前的 `BaseValue+0+0+UAgentRound2+UAgentRound3`，LF 保持，没有自动重建，也不需要模型密钥。独立核对确认恢复为 `succeeded` / `applied`、`verifiedCompleted` / `settled`；旧 PID 45808 的创建时间匹配备份 `executionIdentity`，Win32 等待返回 0（signaled），新 PID 45268 属于不同 host。完整恢复 before 等于原写入 after，恢复 after 等于原写入 before；仅 cpp 第五行逆向一行，LF 6 → 6，恢复验收时 cpp 匹配恢复 after，h 未变，恢复后没有 native build。摘要已生成于 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-restart-restore-summary.json`。重开新恢复记录的详情也已在 UI 成功读取，仍为只读、不可续跑。这验证全部写入后重建失败的历史逆向恢复；本次恢复完成时仍包含两个受控编译错误，不计为编译修复或功能验证成功。

验收结束后，恢复后的 cpp 已另存为 `restart-restore-after.cpp`，受控副本源码恢复到此前已通过的基线。此整理与产品原生恢复分开记录于 `acceptance-fixture-cleanup.json`，未追加构建；原工程未改。

当前入口支持批准读取 1–8 个已有 Source 文件，发送这些文件及匹配诊断；选中 Build.cs 时，可包含构建级错误、对应模块的链接错误及无模块名的普通非 Unity `.obj` 链接错误。对象文件只记录 `objectFile` basename，不伪造源码位置；明确属于其他模块的 `Module.Other.*` 仍排除。不附加其他源码、附件或整份原始日志。保存凭据和 Responses 会话仍不开放此入口。

返回内容复用现有多文件提案解析器，仅接受已读范围内的有效修改；逐文件查看后，一次采纳到草稿。原生差异、写入和重建仍分别批准，没有自动写入或自动重试；最多 3 次重建以及取消、冲突、结果不明时停止的限制未变。32 KiB 完整请求与 1024 输出 token 上限未扩大；超量、截断、无变化、越界或含脱敏占位符的提案均拒绝。[DeepSeek 官方 Chat Completions 说明](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)指出，`finish_reason="length"` 可能表示输出或上下文超限并截断消息；本入口只接受完整 `stop` 响应，不自动续写或拼接。

### 验收中发现并修复的问题

- 临时会话原先仅在测试可达，生产 `ProviderSessionSetup` 只挂接 Saved 模式。此前“临时已配置”的判断误将保存密钥表单当作临时入口，现已补接“默认保存 / 仅本次”；保留已有保存密钥、不提取或删除、不自动回退，关闭失败时不切换，重开设置保留有效临时模式。恢复项目信任时同步 `nativeSource` 等就绪信息；用户已在新版实际确认 trusted / native。
- 修复前两次桌面原生运行在 UBA 初始化时发生 `NullReferenceException`，未进入 C++ 编译，作为排障历史保留。`.NET` 探针定位到 `env_clear` 白名单遗漏 `ProgramData`；补齐后仍清除凭据和编译器注入变量，真实子进程及产品原生构建均已验证。没有可解析错误时，在调用 Provider adapter 前返回固定提示，不显示原始异常。
- 修复非 Unity `.obj` 链接错误遗漏，以及通用脱敏误伤长 C++ 标识符；保留当前密钥和明确秘密字段遮罩。真实日志验证完成后，本次 HTTP 依赖场景也已通过产品内链路。
- 外发审阅改为原生 dialog，解决被构建模态框阻挡交互的问题。真实 Chromium 加载生产组件验证了队列 `approved-1` / `rejected-2` 及焦点返回；随后两次产品内模型请求均经实际外发审批。
- 三轮验收后，真实 UI 的原生写入和构建历史列表可见，打开详情却失败。根因是前端把原生回执事件按 coordinator envelope 校验；现仅对 `nativeBuildResult`、`nativeRepairBefore`、`nativeRepairResult` 增加固定结构及归档附件摘要匹配校验，恢复写入复用后两种事件。未知事件、协调器事件及历史继续执行的权限校验未放宽，原生记录保持只读。旧实现的 3 项回归先失败，修复后 19 项定向测试和集成类型检查通过；从现场 SQLite 提取的两条无源码元数据也通过生产解析器，`canContinue=false`。统一 web/native 构建均 exit 0，重开原 profile 后，原来失败的写入记录 `1b2e6c6670877e3a8ae32f16901b7b1d` 和构建记录 `c0460708e6d34aefcf05be5e78f115f8` 的详情均已在真实 UI 成功读取，附件入口正常；界面仍显示只读、无 coordinator 不可续跑。用户已重新信任并在历史入口批准逆向恢复，UI 显示 applied；该次恢复已通过独立存储核对，不需要模型密钥。

### 验证范围与剩余限制

| 范围 | 已确认结果 |
| --- | --- |
| 初轮多文件工作流 | 46 项通过：helper 17、修复操作组件 20、建议组件 9；后续排障验证另列，不合并计算。 |
| Provider / 脱敏、源码身份 | 分别 48 项、2 项定向验证通过。 |
| 临时会话入口 | 42 项定向测试及该版本构建通过，实际临时表单与用户配置已验证。 |
| 排障增量 | 修复建议及固定提示 28 项、恢复信任来源 3 项、外发审批 9 项、ProgramData 的 Rust 真实子进程 1 项通过。 |
| 前阶段预览构建 | 建议 UI 10 项测试、集成 TypeScript 检查、Vite、Cargo integrated / custom-protocol 原生构建四步均以 0 退出；该记录为首轮预览；新错误分类版本另见下行。 |
| 错误分类预览 | helper 21 + 建议 UI 22，共 43 项通过；集成类型检查、Vite、Cargo integrated / custom-protocol 构建均通过。真实复验明确报告一次 `auth_missing`（HTTP 401/403）；更正临时密钥后，单次批准请求完成模型双文件提案、写入与重建。旧版两次泛化失败仍无法追溯。 |
| 独立 UBT 前置验证 | 基线 0；C2065、HTTP 缺依赖均完成 6 → 0。原生 7 参数与修后白名单复现、1104 字节两文件 helper 的测试 adapter 探针也已通过；这些与上述真实产品链分别记录。 |
| 原生修复测试入口 | 复用生产 Cargo.toml，限定运行 `ue_build_repair::tests`，24 项原生定向测试通过；该结果不扩大真实模型验收范围。 |
| 原生历史恢复补丁 | 9 项定向测试通过：原进程已结束的全部写入恢复 1 项、既有部分写入重启恢复 1 项、边界检查 7 项。历史详情及全部写入后重建失败的逆向恢复已由真实 UI 确认，恢复存储回执已独立核对通过；真实部分写入恢复仍待验。 |

前两类模型验收覆盖两个文件作为输入、每次修改一个文件；Test01 副本的新增受控模块另已通过手工草稿和真实模型提案各一条双文件写入、重建链，以及零模型请求的三轮批准上限 live 验收。全部写入后重建失败的历史逆向恢复已通过 UI 与独立存储核对。原工程没有既有源码或资产，且未被修改；真实部分写入恢复、取消中断、已有游戏源码、运行时返回 42、模型连续三轮修复及 Beta 仍未验。真实复杂工程的广泛适用性及大文件完整替换限制仍待覆盖。UE 本地化中文诊断存在源端乱码（lossy），ASCII 错误码和路径可用于核对，中文显示问题尚未解决。

### 本地产物与记录

首轮源码、测试和文档已同步 GitHub `main`，提交 `da9e071`。预览仍仅在本机 `deliverables/UAgent-20261106-repair-preview/uagent.exe`，未正式发布或提供安装包。进程重启后仍需重新开启临时会话并信任项目。

本地证据根目录为 `.local-dev/temp/ue-build-repair-acceptance-20261106/`，不上传 GitHub。两条真实修复链的完整非敏感摘要在 `live-desktop/compiler-live-cycle-summary.json`、`live-desktop/http-live-cycle-summary.json`；修后首次编译回执在 `live-desktop/native-compiler-fixed-summary.json`，统一构建记录在 `live-desktop/acceptance-fixes-build.json`。

此前排障与独立验证记录保留在该目录：`fault-cases-result.json`、`helper-pre-fix-result.json`、`helper-post-fix-result.json`、`native-env-regression/result.json`、`common-appdata-probe/post-fix-result.json`、`native-env-fixed-helper-result.json`，以及 `live-desktop/` 下的 `native-build-summary.json`、`native-compiler-attempt-2-summary.json`、`native-env-fixed-direct-ubt-result.json`、`temporary-mode-build.json`、`temporary-mode-ui-smoke.json`。第二次尝试摘要沿用原计划文件名，实际记录 UBA 初始化失败。

## 历史单文件切片（2026-11-04）

以下保留当时的实现、测试与阻塞记录；单文件限制及“多文件批次未完成”等表述限定在该日期，当前范围以上节为准。

入口：已完成落账的失败构建 → 单文件修复 → 原生批准读取文件 → DeepSeek 单文件修复建议。临时 DeepSeek 会话可用；保存凭据和 Responses 会话不开放该入口。

填写并核实非缓存输入/输出价格（人民币/百万 token），再审阅实际外发正文及费用。日常账户会话按用户价格保守估算，明确不是扣费硬上限；旧验证预算会话保留原有 consent/ledger。仅发送当前文件和匹配项目错误，不附加其他文件或选中附件。价格未核实、会话变更、取消、无匹配报错均不能继续有效请求。

建议返回后必须明确采纳，随后准备原生精确差异、批准一次写入，再单独批准重建。保留既有 32 KiB 请求与 1024 输出 token 上限，截断或跨文件建议拒绝采纳。本轮没有真实外发、文件写入或构建。

9 项模拟协议 + 4 项组件检查、集成类型检查、差异复核通过。失败过程及独立自有 Job 清理记录见 ../../evidence/t22-model-repair-online-20261104-r1/actual-result.json。当前冻结只读 QA EXE 未重建、未包含此能力。

用户已经授权隔离候选启动与合成数据检查；当前缺少可调用的 Computer Use/node_repl，仍未启动或验收真实窗口。这是工具阻塞，不再是等待用户授权。完整自动修复、多文件批次及真实线上/桌面验收尚未完成。
