# 下一阶段当前状态与历史记录

## 当前状态 r14 与 2026-11-06 未发布构建修复切片（America/Phoenix）

本节依据正式根目录 `E:\Codex\UAgent` 的 r14 基线及 2026-11-06 构建修复进展，对照 2026-10-29 设计的 T01–T24。首轮构建修复源码已随 `da9e071` 同步 GitHub，尚未发布新版本。MVP16–18 尚未全部完成；只读调查、完整记录及多项 UE 执行入口已有实现，三条主工作流、独立任务宿主和 Windows Beta 仍待收口。

11 月 6 日构建修复切片将在线临时 DeepSeek 建议扩为 1–8 个已批准读取的 Source 文件，并补齐所选 Build.cs 的构建级/对象文件链接诊断。定向测试、类型检查、前端及原生构建通过；真实桌面预览在隔离 UE 5.8.4 fixture 中完成 C2065 代码错误和 HTTP 模块依赖错误两轮验收，均经过真实 DeepSeek、外发审阅、采纳草稿、diff/原生写入批准及重建批准，最终重建 exit 0。Lab 每次输入 2 个文件、输出并写入 1 个文件；这两轮合计 2 次模型请求、2 次写入、2 次重建，每条链使用 1/3 次重建，无自动执行。随后在用户空 Blueprint 工程 Test01 的独立副本中新增受控 `.cpp`/`.h` 模块，先后完成手工草稿和真实 DeepSeek 建议的同批 2 文件原生写入及单独批准重建 exit 0，原工程未改。模型链在更正临时密钥后用单次请求生成两文件各一行的修改，保留 CRLF，用到 1/3 次重建。独立的手工草稿三轮上限验收随后通过：零模型调用，诊断数 4→3→2→1，最终仍 exit 6，第三次后界面停止且无第四次重建。预算与重建限制未变；真实既有游戏源码、运行语义、其他失败恢复路径和完整 Beta 仍待验收。完整 applied 写入后重建失败的跨重启恢复已单独通过，未自动重建。详细证据、产物和限制见[在线修复建议范围](t22-online-repair-suggestion-20261104.md)。

当前开放 DeepSeek API 与官方 Codex app-server。原方案中的 Responses / Anthropic 已主动归档，应记为路线差异；不计为当前可用协议，也不直接列为待重新开放的功能。已保存的 DeepSeek 密钥由 Windows 凭据管理器保护，其会话仍限讨论。[Provider 范围](desktop-provider-and-conversation.md)

| 工作包 | 当前已实现或已有证据 | 剩余开发或验收 |
| --- | --- | --- |
| T01–T03 基线、协议与模型 | 统一工具/运行/事件契约、DeepSeek 工具适配、Codex 文本和只读工具路径已有；r14 普通 Codex 会话及双成员调查真实通过。 | 原定两协议路线已改变；当前模型错误、用量、长会话及 DeepSeek 工具往返仍需按实际路径补验。 |
| T04–T05 工具与持续任务 | 文件/索引、已加载 Blueprint 和直接资产引用工具已接；只读调查支持预算、暂停、继续、取消及持久化。Codex 当前只暴露文件 list/find/read。 | 通用修改/验证任务、计划编辑、跳步、中途补充、任务级连续授权；将 UE 语义工具接入当前模型调查。 |
| T06–T08 记录、记忆与会话 | SQLite 全文/检查点/迁移、会话搜索/改名/归档/分支/继续、本地事实/决策/待办管理已接。 | 当前活跃模型的项目记忆外发、带来源的长历史摘要、容量/备份/完整导出入口及当前版本迁移/重启验收。 |
| T09–T10 构建与修复 | 固定目标构建、诊断、最多 8 个已有 Source 文件批次审阅/写入、在线建议逐文件查看后一次采纳到草稿、本地提案导入、最多 3 次逐轮批准重建已接。隔离 UE 5.8.4 Lab 的 C2065 与 HTTP 依赖两类故障通过真实 DeepSeek 和产品审批链，各写入 1 文件并重建 exit 0。Test01 空 Blueprint 工程副本的新增受控模块完成手工草稿及真实 DeepSeek 建议的同批 `.cpp`/`.h` 两文件原生写入和单独重建 exit 0，模型链用到 1/3 次重建；手工草稿三次批准写入/失败重建后停止的实机上限验收，以及双文件预览后外部修改导致整批拒绝写入的保护均已通过。 | 目标驱动闭环、更完整文件/profile 范围；现有请求/输出预算下的大文件限制；真实既有游戏源码中的关联修复与运行语义，以及未覆盖的失败恢复路径。本轮构建取消、受控停顿下部分写入与同会话恢复见[专项验收](build-repair-failure-recovery-20261106.md)；三轮上限验收最终构建仍失败。 |
| T11–T12 UE 语义与插件 | 普通可信项目受管只读启动、已加载 Blueprint 结构、直接资产引用查询及 v2 能力检查已有；UE 5.8.4 v1/v2 和场景 2.4.0 编译有记录。 | 符号/正文与跨域关系检索、资产类型/标签、地图/选择工具接线、冷 Blueprint 准备，以及当前插件加载/真实调用验收。 |
| T13 拾取物 Blueprint | 隔离 Lab 模板已有审批启动、编译预览、创建/编译/保存；旧版本 Lab 有行为证据。 | 普通项目批准目录、受支持组件/变量/有限图修改、测试地图放置、当前版本 PIE/Automation 行为与可视验收。 |
| T14 场景批次 | 普通可信项目可审阅 1–20 项、自定义名称/变换、同运行查询/取消/续接和保存新地图；2.4.0 已编译。 | 自选项目网格/材质和目标目录/地图；当前版本真实 20 项及完成 7 项后中断续 13 项；跨重启另待 T17–T18。 |
| T15–T16 验证与审阅 | 源码差异、批次审批、逐文件结果、历史产物与部分恢复 UI 已有；Lab 的编译/行为结果按原版本保留。 | 当前真实对象的统一验证、Blueprint/资产语义差异及三条主流程结果交付。 |
| T17–T19 宿主、恢复与资源 | 应用级 Rust Host、共享队列、效果屏障已接；新格式且已结束的同步源码修复支持重新批准的跨重启逆向恢复，独立子进程/SQLite/合成文件验证通过。本轮历史事件读取窄修复通过 19 项测试及集成类型检查；完整 applied 记录无 barrier 的恢复准入修复通过 9 项原生进程/SQLite 测试。更新版 web/native 两步构建 exit 0，写入/构建历史详情及附件入口已实机验证；重新信任 Test01 副本后，完整 applied 写入后重建失败的跨重启恢复写入已通过，未自动重建。 普通构建取消、受控停顿下部分写入/同会话恢复和未落结果进程退出阻断另已验证，见[专项范围](build-repair-failure-recovery-20261106.md)。 | 桌面部分写入跨重启及其他崩溃窗口仍待验。独立 TypeScript sidecar、界面重订阅、通用任务及 UE 对象跨重启续跑和独立进程互斥仍未完成。 |
| T20–T21 协作与角色模型 | Codex 双成员独立调查/汇总真实通过；动态委派、成员职责/模型配置已有源码。Anthropic 保留为归档实现。 | 动态/混合模型真实闭环、协作与单 Agent 的效果对照、协作重启恢复；归档协议不计当前交付。 |
| T22 四个工作流 | 工程调查、构建修复、隔离 Blueprint 模板、场景批次均有桌面入口；构建修复的两类故障已在隔离 Lab 完成真实模型与产品审批链，Test01 受控模块完成手工草稿和真实模型建议的双文件原生写入及重建。 | 构建修复保留真实既有 C++ 工程、长源码及其他失败恢复验收；Blueprint 和场景仍需完成原方案要求的工程产物与当前版本实际验证。 |
| T23–T24 桌面 Beta | r14 开发版本、配置/会话入口、脱敏诊断导出及 UE 5.8.4 兼容说明已有。 | 首用流程、安装包与签名状态、干净 Windows 安装/升级/数据迁移、独立项目副本和完整 Beta 验收。 |

### 11 月 6 日构建修复实机证据与下一步

前两轮均在隔离 UE 5.8.4 Lab 的真实桌面中完成。C2065 建议把 `.cpp` 中的未知标识符替换为 `1`；HTTP 依赖建议在 `Build.cs` 中补入 `HTTP`。每轮读取 2 个文件，模型只提出 1 个文件的修改；用户逐步审阅并批准，没有自动写入或自动重建。

| 场景 | 失败构建 run | 原生写入 run | 重建 run / 结果 |
| --- | --- | --- | --- |
| C2065 代码错误 | `a5db535f20252e4fe88f786c79d573fb` | `45aa06fca7dc07e6c8ebb7f4ef3eb5ef` | `e2b09472e40a2568e70d3f2316c4ab50` / exit 0 |
| HTTP 模块依赖错误 | `ef0f2b3dd6d1a792e3454b7249715a96` | `25eca253108c4c7e168b68b492a88629` | `27ad898e566b78cff89402e5e3b498a9` / exit 0 |
| Test01 受控模块，手工草稿双文件修复 | `4b379fba8f02496cb88e8155f8159b8a` | `486b19d5bb44b2870898b073013fffb6`，2 文件均 applied | `56bf93cb4e7e3ce5385b4e2be26029c5` / exit 0 |
| Test01 受控模块，真实 DeepSeek 双文件修复 | `e2cde551a0e7bf57bfc570167a632e69` | `7f678c2c31eae3549e78e3e3265349e7`，2 文件均 applied | `45ab510b34dd24286662da650779f06f` / succeeded，exit 0，1/3 |

Test01 原工程没有 `Source`，`Content` 中也没有文件；受控 `.cpp`/`.h` 模块仅加入独立副本，原工程未改。手工草稿链通过后，更正临时密钥的一次真实 DeepSeek 请求生成双文件建议：各改一行（`BasValue`→`BaseValue`、`4O`→`40`），CRLF 保持；经过外发、提案、差异审阅和分别批准写入/重建，最终 succeeded、exit 0。界面估算 0.020082 CNY，实际账单未知。本地摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-model-two-file-summary.json`，未随仓库发布。

诊断版此前已将服务器 HTTP 401/403 鉴权拒绝显示为 `auth_missing`，更正密钥后请求成功；更早两次泛化失败的根因无法追溯，不能反向归为同一原因。安全错误分类的 43 项定向测试、类型检查、Vite 和原生构建已通过。手工链及两次 Lab 单文件模型成功记录保留。

原生修复测试脚本已改为复用现有 Cargo 模块图，限定 `ue_build_repair::tests` 执行，结果为 24 passed、0 failed。

三轮批准上限已另行完成真实桌面验收：使用手工草稿、零模型调用，完成 3 次原生写入及分别批准的重建，诊断数由 4→3→2→1；第三次重建仍 exit 6，界面强制停止，未发生第四次重建。存储核对确认 3 次写入及 3 次构建均 settled、effect 为 `verifiedCompleted`；该状态表示执行及结果已核实，不表示编译成功。本地摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-round-limit-summary.json`。此项确认轮次限制及停止行为，不计为最终修复成功或连续三轮模型建议。

双文件预检冲突已通过真实桌面与存储核对：精确 preview 后外部修改第二个 `.h` 文件，写入 run `d4d0ecbe4060e890d32b471bdb3ac920` 返回 cpp `not_started`、h `conflict`，effect 为 `verifiedNotOccurred`、阶段 settled。字节核对确认 cpp 原内容及 h 外部修改均保留；没有 before 备份、恢复候选或后续重建。本地摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-conflict-summary.json`。该冲突场景只验证拒绝写入，没有恢复写入。

历史事件读取与完整 applied 记录无 barrier 的恢复准入已分别完成窄修复：前者 19 项测试及集成类型检查通过，后者 9 项真实进程退出/SQLite 原生测试通过。更新版 web/native 两步构建均 exit 0，已重新打开原配置；真实桌面中的写入与构建历史详情均可读取，附件入口正常。这些历史入口仍只读、不可续跑。用户重新信任 Test01 副本后，另经核对原进程已结束、准备精确逆向差异、重新审阅和原生批准，完成跨重启恢复写入。

恢复 run `2a59575b5c64b26ae512551e5be53a3c` 为 succeeded / applied，effect 为 `verifiedCompleted`、阶段 settled；原写入 `1b2e6c6670877e3a8ae32f16901b7b1d` 已完整 applied，其重建 `c0460708e6d34aefcf05be5e78f115f8` 失败。独立核对确认仅 cpp 第 5 行精确逆转：`0` 回到 `UAgentRound2`，before 等于原写入 after、after 等于原写入 before，验收时字节匹配，LF 保持，h 未变。原进程退出及新 host 身份已核实；恢复后未调用模型或触发构建，新恢复记录详情也可只读查看。本次恢复完成时源码保留 Round2/Round3 两个受控编译错误。本地摘要为 `.local-dev/temp/test01-build-repair-acceptance-20261106/live-restart-restore-summary.json`；此项仅确认完整写入后重建失败的跨重启恢复，不覆盖真实部分写入或取消中断恢复。

本轮又完成普通预览的真实构建取消，以及本地首文件后暂停 10 秒的插桩预览中，实际 UI 取消造成 CPP applied / H not_started、随后重新审阅并原生批准仅恢复 CPP。原 partial effect 仍为 `resultUnknown` / `executionUnknown` / settled，新恢复为 `verifiedCompleted` / settled，未自动重建。新增子进程 exit 73 验证缺失结果、未 settled 时继续只读阻断。详见[失败恢复验收范围](build-repair-failure-recovery-20261106.md)。

下一步按既定顺序推进：

1. 普通项目交互 Blueprint，再完成场景批次的实际加载、执行与中断续接。
2. 通用任务、独立 Host 和重启恢复。
3. 数据能力、协作闭环与 Windows Beta。

构建修复仍需另有包含 C++ 源码的项目验证既有游戏逻辑及运行语义，并覆盖长源码在 32 KiB / 1024 输出 token 限制下的拒绝与缩小范围后修复。受控停顿验收不扩大成未插桩桌面部分写入跨重启或断电恢复已完成。

### 当前证据与阅读入口

- [r14 真实验收与未覆盖项](releases/r14.md)：普通 Codex 会话、双成员调查的 3 次模型请求/6 次工具调用及持久化。
- [UE 当前集成范围](ue-build-integration.md)、[四工作流状态](t22-current-delivery-20261103.md)：区分已接入、历史 Lab 和当前待验。
- 三次批准重建链 (`2026-10-29/evidence/t22-repair-cycle-20261105-r1/actual-result.json`; 仅本地证据，未随仓库发布)、场景 2.4.0 编译 (`2026-10-29/evidence/t14-plugin-240-584-20261105-r1/actual-result.json`; 仅本地证据，未随仓库发布)：局部/编译结果，未覆盖当前真实 UE 工作流。
- 有限源码跨重启恢复 (`2026-10-29/evidence/t18-restart-claim-20261105-r1/delivery.json`; 仅本地证据，未随仓库发布)、[恢复范围](effect-reconciliation.md)：重新信任、核对原进程和文件并重新批准；不恢复旧权限，不自动重建或继续未完成任务。
- [项目记忆当前边界](project-memory-approved-snapshot.md)、[产品路线](mvp-roadmap.md)。

## 历史阶段记录

下文保留各阶段当时的实现、失败、验收和交接事实。历史段落中的“当前”“未接入”“未编译”、旧 Provider、路径及待办均限定在原日期；当前状态以本页上方摘要及其链接为准。

### 2026-11-04 T20：成员独立模型与临时会话接线

两个成员各有模型选择：沿用主模型，或选择现有配置中受支持的 DeepSeek Flash / OpenAI Responses 模型，并配置该成员独立的临时 API 会话。使用既有 createSafeProviderSession、openAccount/openResponses 和每运行 adapter，不新增模型协议，不放宽已保存凭据仅讨论的限制。界面展示实际 Provider/模型，未就绪成员禁止提交；清除、过期或配置变更使旧批准失效。临时密钥立即从输入框清空，不进入角色配置或存档。

子任务 scope 使用各自批准的 provider/model/endpoint，两个适配器均创建并校验成功后才启动并行；请求/工具总额度仍分配给两个成员，取消和失败统一停止，主模型负责最终汇总。模型身份随父/子存档保存，端点配置和密钥不保存；原生 SQLite 入口新增封闭模型身份描述校验。没有跨模型货币费用封顶承诺。

本轮 8 项不同的 TS/UI 局部用例、2 项生产核心真实 Windows SQLite 用例、类型检查和限定独审通过。模拟不同 Provider/模型并发、主模型汇总、暂停恢复、取消、单成员失败、缺失适配器、批准后改模型，以及现有 Responses 临时 profile 的配置/清除和界面密钥清空均已验证。6 个验证 Job 已独立确认不存在。模型请求全部模拟；Responses profile 开关采用模拟 native 回执，未执行真实双 Responses 请求、桌面或真实窗口 IPC。未重建 EXE，现有冻结候选不包含本轮功能。

来源限当前现有适配器判为可用的配置，不新增 Anthropic 或其他兼容服务支持；仍是两个固定槽位，可选职责，无动态委派。独立成员须临时会话，未开放保存凭据调查，档案不会恢复会话权限。证据：`../../evidence/t20-member-models-20261104-r1/actual-result.json`。下文为此前阶段记录。

## 2026-11-04 T20：可配置协作成员职责与关注点

调查输入框启用双 Agent 后，可分别配置两个成员为源码调查、风险复核、性能分析或测试分析，并填写最多 240 个 UTF-16 单元的关注点。范围批准页展示所选成员；任务配置与该次批准精确绑定，批准后变更会拒绝启动。两位成员分别只收到自己的职责与关注点，汇总接收双方配置与报告。实际复用既有双实例并行/串行回退、总预算、暂停取消和来源核对，配置同时保存到父/子会话记录，Rust 原生入口采用封闭字段校验。

本轮 7 项相关 TS/UI 局部测试、2 项真实 Windows SQLite 生产核心测试和当前应用类型检查通过；独审指出的 C1 控制字符契约差异已修复并回归。保留首次测试脱敏标记失败及类型导出遗漏失败记录。6 个自有验证 Job 独立确认不存在。真实模型、真实用户工程和桌面均未运行；未全量、删除或推送。

仍固定两个只读成员，同一已选模型；职责是分析侧重点，不授予执行测试、基准测试或写入能力。角色配置保存于本次草稿与任务档案，未增加跨会话用户模板管理；没有动态成员数量、混合模型或自动委派。上一 parallel-integrated-qa-20261104-r1 候选已包含并行及原生协作存档修复，但不包含本轮可配置成员；本轮未重建 EXE。证据：`../../evidence/t20-configurable-members-20261104-r1/actual-result.json`。下文为此前阶段记录。

## 2026-11-04 T20：两个只读角色真实并行接线已完成（局部模拟验证）

调查入口的双 Agent 选项现在在支持并发的临时 DeepSeek 账号会话上启动两个独立 RunCoordinator：消息、待执行工具、记录分别归属调查员与复核员。外发内容仍逐条审批，已批准的两个请求能够同时进行；同一内存任务身份最多两个在途请求，普通聊天和不同任务不得混入。未声明并发能力的 Provider 保持串行。未调用真实外部模型。

总模型请求与工具额度预先分给两个角色，并保留一次最终汇总请求；未用额度不跨角色动态调度。暂停传播给双方并在现有安全边界停止，取消同时撤销在途与待审请求。失败停止兄弟角色且不生成成功汇总；只有双方完成且来源仍有效才汇总。各角色独立存档并关联父任务；汇合前父记录只保留角色引用与计数，汇合后先加入完整消息再投影工具证据，避免工具后暂停破坏存档。现有会话内暂停恢复可用；跨进程重启不恢复执行权限。

本次共 15 项不同的局部测试通过：13 项并行/审批/会话/存档边界、1 项真实前端入口+合成 SSE+模拟 native IPC 垂直接线、1 项原单角色入口回归。类型检查和限定差异复核通过，5 个自有验证 Job 独立确认不存在。首轮错误原因显示测试失败已修复并保留；独审发现的工具后暂停存档问题已修复并增加真实 native-store 映射回归。未做真实 SQLite/Tauri 运行验收、真实模型质量/费用验收或桌面操作，未重建 EXE。

仍有限制：仅固定两个只读角色与同一所选模型；Responses/已保存凭据会话不因此开放并发，动态委派、多模型调度、写入协作和跨重启执行恢复未完成。超过分配额度的批量工具会暂停；保留现有会话/审批超时。当前冻结 QA EXE 不包含本次改动。证据：`../../evidence/t20-parallel-investigation-20261104-r1/actual-result.json`。下文为历史阶段记录。

## 2026-11-04 T20：协作共享预算保障（仍为串行）

调查阶段保留复核工具额度，两个工作阶段保留各自报告请求，最后保留一次汇总请求。达到额度后明确要求依据已有证据报告限制；报告截断后反复继续不能占用下一角色额度。审批界面说明分配规则，协作最低需两次工具、五次模型请求。模型批量工具超过阶段额度会暂停并保留待执行记录，不绕过额度；本次未实现超额批量的自动收束。

本轮 14 项不同的直接相关模拟测试通过（包括现有 UI/审批/存档接线），类型检查通过。保留首次 JSX 编译失败日志及修正证据；独审发现的截断续跑预算漏洞已补硬检查和回归。未调用外部模型、未操作真实用户工程、未重建 EXE、未做桌面验收。

真正并行尚未实现：DeepSeek session 限单在途请求，外发确认 gate 限单待审请求，RunCoordinator 共用待执行工具和可变消息状态。后续需隔离每角色状态、审批排队、共享预算原子预留及有序存档后才能并行，不能直接 Promise.all。证据：`../../evidence/t20-collaboration-budget-20261104-r1/actual-result.json`。

## 2026-11-04 T20：双 Agent 独立调查、复核与汇总已接通

调查模式新增“双 Agent 独立调查与复核，再汇总”选项。调查员与复核员分别通过现有只读工具取证，复核员不接收调查员的答案或工具记录；随后汇总角色比较两份报告与真实工具证据，给出一个最终回答。它是串行、同一选定模型的固定角色协作，不是动态委派或并行多模型平台。

复用既有 RunCoordinator、会话、读取授权、总预算、暂停取消与持久化。协作模式写入本次批准范围，每次外发仍确认精确内容；默认总计 6 次工具调用、最多 9 次模型请求，不按 Agent 重置预算。每位 Agent 必须完成实际只读工具才可结束；汇总不允许执行工具。报告、角色事件、工具唯一映射 ID 和原 provider ID（包括未执行调用）通过现有存储适配器落档。没有扩大写入或后台执行权限，生产记忆派发仍 false。

验证为 10 项新增局部检查加 1 项原单 Agent 入口回归，共 11 个不同测试；当前应用类型检查与差异复核通过。纵向检查使用真实协调器/UI/协议代码、合成 SSE 与模拟 native IPC，确认从勾选、范围批准、逐次外发批准、两次工具读取到汇总和存档；不等于真实 SQLite/Tauri 桌面、实际模型质量或费用对照。初次 2 项失败及修复证据保留。没有真实模型请求、真实用户工程操作、删除、推送、系统更改或 EXE 重建。

T20 仍未全部完成：动态拆分委派、并行任务调度、按角色选模型、跨重启协作执行恢复及真实实机/效果验收尚缺。证据：`../../evidence/t20-collaborative-investigation-20261104-r1/actual-result.json`。下方为此前阶段记录。

---

## 2026-11-04 当前源码盘点与本轮交付

本轮回到整体 T01–T24 方案，新增项目侧栏的“源码与项目文件”：对现有完整文件索引按相对路径/扩展名搜索、分页，再复用原生只读策略点选预览。搜索不扫描、不读取正文、不调用模型；正文仍遵循现有 4096 字节/80 行界限。截断、失败重试和项目/文件绑定明确展示，读取失败或迟到结果不串入旧正文。

主要现状：Provider 的 DeepSeek/Responses 路径已有接线，Anthropic 仍只到协议模块；历史会话归档、分支、续聊、搜索和只读内容查看已有生产代码；项目上下文/来源校验已有实现，但记忆生产派发仍为 false；构建修复已有逐次批准与当前会话有限恢复；RuntimeHost/事务准入不是零进度；UE 5.8.4 v1/V2 插件编译已记录，但语义读取与资产行为的生产闭环仍缺；完整多 Agent、四个完整工作流与 Windows Beta 实机验收未完成。不得沿用下方历史矩阵将已接入项写成未实现，也不得将局部检查等同整体验收。

本轮 7 项限定测试、当前应用类型检查、差异检查与只读复核通过；未做全量、未读真实工程、未调用模型、未重建 EXE，真实桌面操作未验。当前逐领域来源及结果见 `../../evidence/t07-indexed-source-browser-20261104-r1/current-major-status.json` 与 `actual-result.json`。下方内容按历史原样保留。

---

> 2026-11-04 T08: 会话管理已由“当前页名称筛选”改为本项目全部会话名称搜索；匹配后分页，归档开关保留查询，提交新查询回第一页，沿用取消和迟到隔离。按字面子串匹配（ASCII 字母不区分大小写，中文直接匹配，%/_ 非通配）。3 项原生合成 + 5 项前端局部检查、类型检查、生产 cargo check 及差异复核通过；EXE 未重建，真实 UI 未验。证据：`../../evidence/t08-session-title-search-20261104-r1/actual-result.json`。

> 2026-11-04 T08: [Saved build/repair artifacts are now viewable read-only in history source](history-artifact-view-20261104.md). Current binaries/UI remain unverified. Historical resource gates below are obsolete; current work uses no self-imposed memory caps.

> 2026-11-03 T22 update: see [current delivery and execution gaps](t22-current-delivery-20261103.md). Investigation is connected with focused synthetic integration validation; build preparation is partial and does not complete build repair. Historical matrices below are dated evidence.

> Current engine target (2026-11-03): UE **5.8.4 / CL 58902052**, compatible CL / module BuildId **55116800**. See [current compatibility and verification limits](ue584-compatibility.md). Any 5.8.1/5.8.2 results below are historical evidence, not validation of the current engine or a current release.

## 2026-10-31 UTC 历史状态与验收记录

**原方案MVP16–18／T01–T24尚未全部完成。固定9017凭证独立版已交用户做新saved-native普通聊天验收，44项离线测试通过；今日新增历史、宿主、UE预览和本地诊断已有接线及选定入口types通过，真实native核心已编译；固定EXE的22项宿主相关测试及另5项历史检索测试，分别取得整条保护命令退出0/严格清理通过。仍未取得新集成EXE、整个Tauri编译及三主流程验收。**

## 18:56 UTC 最后5项历史检索局部验收（优先于下文历史记录）

- 同一固定native测试EXE按 `local_run_store::sqlite::history_search::tests:: --test-threads=1` 仅执行一次，**5 passed / 0 failed / 94 filtered**。五项分别验证单条正文上限、累计正文上限、SQLite长度限制、progress中断和回调失败后的statement/progress释放，使用内存合成SQLite，不访问生产数据库。
- 测试进程退出0、公共保护命令退出0、controller退出75；原始根进程退出、线程/进程checked-close、自动终验和严格清理全部成立。结束后三个精确命名Job只读核查为空/不存在，无验证负载遗留。证据见[本次实际结果](../../../evidence/test-resource-guard-history128-static-20261031-r1/actual-outcome.json)。
- 进程/树硬上限128MiB，caller加整个家族预算544MiB；准入4.53125/8.53125GiB、运行4/8GiB底线、60秒和全局串行均保留。新准入不足时没有安装或启动；满足后才运行上述一次。旧512MiB profile与先前凭证44项、types和native22成功记录仍有效，旧Cargo残留失败保持原判。
- 两次固定过滤合计覆盖27个不同native测试，**剩余72个未被这两次选择**；不是全部99项或整个Tauri通过。历史检索真实IPC/UI、大档案、重启及T23动态隐私/下载仍未验。9017独立凭证EXE不含今日新功能。
- 源码包将保留35文件范围并更新本页、矩阵及本次原始证据。源码冻结不等于新集成EXE、三主流程或T01–T24全项完成。

## 18:45 UTC 固定native测试最终局部结果（优先于下文历史记录）

- **固定native EXE测试22项全部通过，整个受保护命令也通过**：进程退出0、保护器公共退出0、controller退出75、原始进程/线程句柄退出与checked-close成立，自动终验与严格清理通过；没有退出后残留。77项未选中测试不算通过。本次直接运行已经真实编译出的固定测试EXE，未重新运行Cargo。
- 独立 `direct-native128` profile/入口/spec/caller绑定唯一固定EXE、固定cwd及 `runtime_host --test-threads=1`；EXE 4,230,656字节、SHA256 `03ca47cdd9d1b474b5aa3ad378dcd7fca8bd5d78a5319b400c9d441f35f82ab6`。进程/树硬上限128MiB，整个家族加caller预算544MiB；准入4.53125/8.53125GiB，运行4/8GiB底线、60秒和严格退出标准不变。旧narrow-check512定义及旧types成功记录仍有效。
- 两次旧Cargo的测试输出通过但所属子进程残留导致整体失败，均保留原失败及cleanup0，未被本次结果改写。首次512MiB direct调用则在准入前停止，没有创建测试进程。
- 本次证据：[固定测试实际结果](../../../evidence/test-resource-guard-direct-native128-static-20261031-r2/actual-outcome.json)。它覆盖真实trusted root/RunStore/RuntimeHost/catalog核心及22项定向用例；不覆盖Tauri命令宏、真实provider/UE派发、应用重启、整个Tauri crate或产品新EXE。当前没有验证负载运行。
- **已取得的局部结果**：凭证离线44项、选定集成入口及依赖types、native核心编译和上述22项严格通过。**仍未完成**：新集成EXE、全应用编译、T01–T24完整集成验收、三主工作流和真实saved-native API/TLS验收。9017旧凭证EXE不包含本轮新功能。

## 18:26 UTC 实际局部验证结果（优先于后文较早记录）

- **集成入口类型检查通过**：固定 Node `--max-old-space-size=384`，只检查 `tsconfig.current-integration.json` 所选入口及生产依赖，含 App、历史检索/审阅、UE只读预览、队列、设置页与T23诊断导出。原始进程退出0、保护器公共退出0、自动复核及清理均通过，stdout/stderr为空。它不替代全前端与全部测试源文件的检查。
- **真实Rust核心编译成功，22项定向测试输出通过**：直接引用trusted root、RunStore、RuntimeHost service和recovery catalog真实源码的隔离harness；22 passed / 0 failed / 77 filtered，包含目录撤销、锁外IO、期限复核、旧steps扫描和SQLite取消/VM预算。它不包含Tauri command宏模块，不能代替整个应用编译。
- 上述native首次运行及关闭隔离harness调试符号后的新目录复验，Cargo均退出0、测试均22项通过；但两次都在根进程退出后观察到所属Job残留，**整个受保护命令均失败**（phase45/detail1），未放宽退出判定。原始残留映像未取证，不能将推测当作原因。两次原失败均保留，随后严格cleanup-only公共退出0并自动复核；没有活动验证命令遗留。
- 当前固定窄档为进程/树各512MiB、8进程、60秒；caller加整个家族928MiB，准入4.90625/8.90625GiB，运行中RAM/commit底线4/8GiB未改。types实际峰值509,931,520字节，最低RAM约4.489GiB。凭证多worker原档保持不变；进程/树配额归因类别仍未取得新版动态通过。
- 证据：[实际结果及原始日志哈希](../../../evidence/fixed-narrow512-runtime-20261031-r1/actual-outcome.json)。新集成EXE仍未生成，先前整个Tauri crate在512MiB进程硬上限内分配失败的事实保留。T01–T24全项未完成；9017凭证独立版与本轮新功能源码继续分别交付。

### 2026-10-31 历史 T01–T24 验收矩阵

本表已重新读取原授权方案第13–14页工作包、第3–4页主成果及第16–17页验收定义；不是重新全文阅读21页。原条目、优先级和依赖见[结构化矩阵](../../../evidence/next-phase-acceptance-20261031/T01-T24-matrix.json)，[选页原文证据](../../../evidence/next-phase-acceptance-20261031/original-plan-selected-pages.json)保留原来源。历史模块/Lab证据与当前集成二进制验收分列；**整份方案尚未完成，新集成EXE尚未产出**。

| 编号 | 原始工作包 | 依赖／优先级 | 当前实际状态 | 全项仍缺 |
| --- | --- | --- | --- | --- |
| T01 | 当前能力矩阵和固定小工程；核对当前构建的一条真实连接路径 | 基线／P0 | 已有能力矩阵与隔离Lab；9017凭证独立版可交用户验收 | 新集成构建未形成；当前saved-native真实连接未代验，固定工程代表路径未闭环 |
| T02 | Provider工具事件、TaskRun和ToolResult最小协议 | T01／P0 | 最小协议与既有受限任务链已实现，有历史局部证据 | 复用该协议；随新的集成构建核对真实工具事件，不另造弱权限协议 |
| T03 | DeepSeek工具调用、Responses真实适配器和用量状态 | T02／P0 | 普通聊天及Responses适配已有；凭证客户端/会话44项离线通过 | 两首波协议真实工具往返、取消/错误/用量完整链；真实API/TLS仍未验 |
| T04 | ToolRegistry与工具分发；文件、索引和只读UE入口 | T02／P0 | 文件/索引只读registry已接，UE v2有独立模块 | 真实UE只读入口、能力与版本/root/editor绑定未正式注册验收 |
| T05 | RunCoordinator、有界循环、暂停取消和任务范围授权 | T03 T04／P0 | 受限只读loop、范围及暂停取消/持久化已有 | 完整生产任务链的依赖动作、执行范围与真实工具结果驱动尚未整体收口 |
| T06 | SQLite完整记录、迁移、检查点和旧副本导入 | T02／P0 | 完整消息/检查点/迁移和旧副本接口已有历史native证据 | 新集成候选长消息/工具结果/迁移/重启可查可续最小验收；不把记录恢复当权限恢复 |
| T07 | 上下文预算、项目记忆、来源引用和增量失效 | T04 T06／P1 | 预算、来源和失效模块已有 | 事实/决策/待办记忆未完整产品化；A/B项目切换及源更新的实际引用/压缩约束验收 |
| T08 | 任务卡、完整配置保存、历史搜索和当前任务恢复显示 | T05 T06／P1 | 原配置/历史已有；消息搜索已中央接线，5项SQLite预算/释放局部测试严格通过 | 真实IPC/UI检索、大档案与新EXE未验；归档/分支UI及完整任务恢复显示仍缺 |
| T09 | UEBuildProfile、UBT或Build.bat适配与结构化诊断 | T02 T04／P0 | 构建模块与真实Lab已有；本轮固定目标只读预览已接线 | 预览不执行；生产owner/资源/批准/效果链及指定目标真实构建未开放 |
| T10 | 多文件ChangeSet、冲突检查和有限编译修复循环 | T05 T09／P0 | 已有审阅模块和真实单Build.cs修复Lab | 多文件生产批次、冲突与有限修复重试未闭环；需代码错误+模块依赖错误+内容冲突 |
| T11 | 资产引用与Blueprint结构读取，精确能力映射 | T04 T07／P0 | 有语义读取模块/Lab；availability候选不等于查询 | 真实只读v2查询和生产工具注册未验；不以旧v1六工具权限扩权 |
| T12 | UAgentAssetTools v2、原生适配及新能力协商 | T02 T11／P0 | 有v2插件/契约和固定UE版本Lab | 默认禁用；生产editor/root/session绑定、新能力协商、相邻版本兼容未完成 |
| T13 | 模板化Blueprint创建、属性与有限图修改、编译保存 | T05 T12／P0 | 固定拾取物真实资产/行为Lab已有 | 生产模板链、依赖缺失失败及真实编译/运行观察未接；不是通用图编辑 |
| T14 | 多资产计划、对象变换和指定普通地图保存 | T05 T12／P0 | Lab有20项、第7项中断后同Run续13项 | 生产批次/目标地图保存与逐对象回读未接；不能当跨进程或跨重启恢复 |
| T15 | PIE或Automation反馈、目标验证与结果产物 | T10 T13 T14／P0 | 对应Lab已有Automation/PIE结果 | 统一桌面实际对象验证路由未完成；NullRHI不替像素/物理输入/所有版本验收 |
| T16 | 变更审阅、语义差异、局部失败与恢复选项UI | T10 T13 T14／P1 | 本轮真实NativeRunArchive只读审阅已挂载，绑定reviewId/revision | 没有实时批准/执行入口；多文件/资产语义差异与局部恢复选项未完整接入 |
| T17 | 受管Runtime Host、IPC、界面重连及应用退出处理 | T05 T06／P0 | 单例原生service/monitor、6 IPC和同步生命周期撤销已接线/静态闭P2 | 完整Tauri／IPC编译未通过；真实sender消费ticket、sidecar/界面重连和跨进程实际退出验收未完成 |
| T18 | 未知效果核对器、跨重启续跑和外部修改检测 | T06 T12 T15／P0 | 真实scanner/adapter/helper已声明；保守catalog状态已安装，未知barrier保留 | scan worker未运行；native writer fence未实现，始终不能假Ready；跨重启真实效果核对未闭环 |
| T19 | 父子任务、并发额度、UE队列与资源互斥 | T05 T17／P0 | 共享renderer metadata adapter及原生owner/队列基础已接 | provider/UE真实worker票据消费和停稳释放未接；无全局跨进程/UE资源验收 |
| T20 | 调查与审阅Agent、成果归并及单Agent对照 | T07 T19／P1 | 基础Agent/trace模块存在 | 产品内受控协作、归并和同类单Agent对照未交付；开发并行线程不是产品能力 |
| T21 | Anthropic Messages适配与按职责选模型 | T03 T19／P1 | 独立协议模块有69项历史合成测试 | 未生产注册，无native/UI/官方真实传输与账号验收；配置选项不是接通 |
| T22 | 四个内置工作流模板、参数表和结果报告 | T10 T13 T14／P1 | 有workflow契约/mock；原文四模板名称已重新核对 | 工程调查、构建修复、交互Blueprint、场景批次均未作为完整生产模板/参数/报告随应用交付 |
| T23 | 首次连接引导、安装更新路径、兼容矩阵和诊断导出 | T08 T17／P1 | 本轮安全本地诊断导出已静态审阅并挂既有设置区；先预览后用户点击下载 | 动态导出/URL清理/无泄露未验；统计为renderer全内存样本；首用、安装更新、多版本/干净Windows仍未完整验 |
| T24 | Windows Beta候选集成与三条主工作流交付 | T01至T23／P0 | 固定9017凭证独立版可交用户；有可应用阶段源码包 | 新集成EXE未产出；三条主生产流程、独立项目副本与Windows安装退出体验未全交付 |

原文四个内置模板为**工程调查、构建修复、交互Blueprint、场景批次**，需要输入、能力依赖、允许范围、关键步骤、成功条件、参数表及结果报告，不以mock/契约替代随应用交付。

三条主验收分别为：**修复UE C++构建错误**（代码错误与模块依赖错误、同目标重构建）；**创建可交互Blueprint原型**（真实资产、编译、提示与交互行为、缺依赖情况）；**批量搭建并恢复测试场景**（20项、第7项附近中断核对续接、不重复、普通地图保存）。现有Lab只覆盖各自版本/范围，本轮尚无三条完整生产链通过证据。

本轮真实可交范围是固定9017凭证独立版及44项离线局部通过；T08/T16/T17–19/UE预览/T23新增源码接线仍须对应编译、局部运行及新构建。开发时的并行编码不计为T20产品协作。已核对的自有Job均为空，没有可释放的已知闲置资源；不触碰未知/用户程序。

## 17:34 UTC 最新实际结果与阻塞

- **凭证独立包已获独立复核允许交用户验收**：[UAgent.exe](../../../deliverables/UAgent-Credentials-9017-20261031/UAgent.exe)。staged和独立包README/状态/files均已更新。该文件仍是原9017构建的18,248,192字节、SHA256 `9BEED55413C878D7862FC2FF95F7BC8A11A931A496A848E7DB1FD7554A864C0B`，没有本次重建，不含今日扩项。可先交付此准确范围。
- r3范围类型检查在新鲜样本准入后实际执行一次，仍触及原256MiB V8堆上限，公开phase45/detail134，未通过；已严格cleanup-only公开0并自动终验。原全前端与本轮入口均未取得类型通过证据。
- native harness第一次实际调用在Cargo解析锁文件时失败（生成的CRCRLF），未进入Rust编译；已清理公开0。已修正为LF并静态TOML读回24包，依赖版本和闭包未变，原失败保留。
- 修正后尚未创建新的harness guard/编译进程：最新完整预算样本RAM4.9915GiB、commit15.6942GiB，RAM低于原含调用器5.03125GiB准入门槛。保持门槛，未重复负载。当前没有测试运行；详见[r3执行事实](../../../evidence/fixed-product-check-runtime-20261031-r3/outcome.json)。
- 集成新EXE尚未生成。较小harness即便后续通过，也不能替代完整Tauri/前端最终编译；全库既有失败峰值与资源预算须作为后续固定有界构建档的依据，系统4/8GiB底线不降低。T01–T24全项仍未完成。

## 当前交付点与r3执行状态

- 独立凭证版可用入口：[UAgent.exe](../../../deliverables/UAgent-Credentials-9017-20261031/UAgent.exe)，说明见同目录README.txt。它是固定9017旧构建，不含本轮扩项；新集成EXE仍未产出。
- r3较小范围已独立复核允许，提案与活动guard统一LF后原始SHA256为 `d5f786b51fbbc6a699f7171fbe7a2454ae1332732c758cc9b990db5626341c72`。第一次本轮入口tsc调用在调用器资源前检拒绝，没有创建guard或payload，不能记作类型检查失败；原512/640MiB、992MiB全家族与5.03125/9.03125GiB含调用器门槛保留。r3范围尚未取得编译通过，详情见[前检记录](../../../evidence/fixed-product-check-runtime-20261031-r3/types-preflight-refusal.json)。

## 17:23 UTC 凭证候选独立交付依据更新

- 已准备独立目录 [UAgent-Credentials-9017-20261031](../../../deliverables/UAgent-Credentials-9017-20261031/README.txt)，EXE为此前9017构建的原样复制，18,248,192字节，SHA256仍为 `9BEED55413C878D7862FC2FF95F7BC8A11A931A496A848E7DB1FD7554A864C0B`。本次未重建或运行该EXE，不含本轮history/host/UE扩项。
- 原始512份构建输入清单、rawSourceTreeSha `5219735ecc55964dbaf6b8ba369185dc51f298e3dae4b31909b217a5465d0b20`、sourceDirty:true及原独立复核文件均原样保留。7份凭证相关源码的当前原始字节与候选输入哈希相同；本次44项离线通过只补充该局部范围，不能替代EXE重新运行。
- 原9017的实际Windows自有条目保存/替换/删除、pending清理和原生合成发送证据已逐项对应。停止后复用和正常重启UI证据分别属于前驱5af9118/6334d81及不同EXE哈希，已明确列为历史沿革，**不移植成9017本轮重启通过**。没有读取或改变用户vault/生产数据库。
- 当前独立复核已允许将固定9017凭证版单独交用户做新saved-native普通聊天验收；staged及独立目录的README、状态、files哈希清单均已更新，EXE字节未变。真实saved-native API/TLS/账号与本轮9017窗口重启仍未验。完整[来源审计](../../../evidence/credential-9017-delivery-audit-20261031/audit.json)和包内native-evidence-index.json包含可核原路径。

## 17:16 UTC 产品局部验证实际更新

- 固定product-check guard经独立复核后安装，SHA256 `f87f2a21c20b54152130edf8a76bd87992a2e317a7f7a06827b17dd931b22434`。只允许本轮三条精确命令，OS单进程512MiB/负载树640MiB/8进程/60秒，全家族992MiB，含调用器准入RAM5.03125GiB/commit9.03125GiB，运行底线4/8GiB，挂起入Job、串行、watchdog及严格退出终验均保留。
- **凭证离线局部测试实际通过44项、2文件**：native-provider-credentials 39项，safe-provider-session 5项。公开退出0、原句柄退出与checked-close、完整收口及自动终验通过，真实API调用0。此范围不替代原生OS凭证矩阵、UI或真实账号验收。
- 全项目前端tsc实际触及原256MiB V8堆上限，公开phase45/detail134；峰值进程约413MiB。后续严格cleanup-only公开0并终验通过。全前端类型检查未通过，不改写成源码错误或成功。
- Rust第一次在调用器资源前检拒绝，未创建guard/编译进程。新鲜资源达标后仅新目录执行一次全库cargo check，rustc在512MiB硬进程上限内分配失败，公开phase45/detail101；峰值进程536862720字节、树617603072字节。后续cleanup-only公开0且终验通过。没有取得源码编译通过或新EXE。
- 为保持上限，已静态准备更小的当前入口TypeScript配置，以及直接引用本轮真实native核心源码、精确锁定24包依赖闭包的harness；只筛选runtime_host相关用例，不含整个Tauri应用。最新提案[product-r3](../../../evidence/test-resource-guard-fixed-product-check-static-20261031-r3/manifest.json)待独立复核、尚未安装执行。全部实际结果见[产品局部执行记录](../../../evidence/fixed-product-check-runtime-20261031-r1/outcome.json)。当前没有测试运行，配额/串行与新EXE仍未验收。

## 16:43 UTC 保护实际执行更新

- 独立复核通过的guard修复已实际执行：原 `fca9999c…` cleanup-only公开退出0并自动终验；原失败未改成功。调用器最初漏写既有attempt退出索引导致下一调用在创建负载前拒绝，已从真实原句柄退出回执补齐索引；拒绝及三个准确Job当前空态证据均保留，没有重跑恢复。
- 随后新token `96afa59a4fcc4dd0a2c0a8bb4dbae3fb` 仅运行一次固定micro-process。公开 `0x102D0009`，fixture退出9，实际原因为 `allocation_error_inconclusive / Win32 1455`。仍按原判据记为**不确定失败，配额验收未通过**；未把1455当作1816，也未改阈值或页文件。controller/result和observer/watchdog记录这次完整落盘，observer确认原controller退出与owned payload全空。
- 已对该新失败执行一次既有cleanup-only，公开退出0、自动终验通过，实际退出索引由原调用器完整写入。当前lease仍保留该失败，准入只依据对应清理证明；无测试在运行。详见[本轮实际结果](../../../evidence/test-resource-guard-recorder-validation-20261031-r1/outcome.json)。本修订总共4次public调用，只有1次真正配额fixture负载。
- tree/serial/timeout未运行；凭证补模拟、TS/Rust/UI和新EXE尚无新增通过证据。当前closer仍拒绝产品check/types/build，这个实现边界尚未解除；[最小验证命令](../../../evidence/central-integration-20261031/minimal-validation-plan.json)已准备但未执行。
- 另修正旧 `test-effect-reconciliation-native.ps1`：当前中央已正式声明T18模块，隔离脚本改为替换绝对路径声明，避免旧逻辑再追加同名模块造成编译错误。静态接口和源清单见[核对证据](../../../evidence/central-integration-20261031/static-interface-and-source-ledger.json)，未改新作者正在修复的service/tests/catalogreader。

## 中央接手第三批更新（2026-10-31，尚未编译/运行）

- 交接 stage2.json SHA256 已核对为 `20608C26BE402BDD485D5A513EE09DBA2D01F65CBD7E4250D80D928BED46239E`。
- 配额调用公开退出 `271384576 = 0x102D0000`，实际表示外层 `closure_exit_codes_failed`（phase45/detail0），不是审批拒绝码。原始 stdout/stderr 均为0字节，只有 launch 与 ready；没有足够证据还原具体 fixture error/Win32 allocation error，不能据推测记成限额验收通过。
- 已静态修复：外层遇意外退出先缓存失败并释放已退出原句柄，保留其他原 controller/observer 的记录机会；仍受原期限、资源底线和完整收口约束，三个原退出码全部匹配才可成功。仅对原 `fca9999c96dc4679bdf34bf79ad64253` 缺失记录事故提供四份原始 launch/input/源码身份/实际caller回执精确哈希兼容；恢复仍必须在全局串行锁内查询准确三个Job当前全空并完成受保护终验，不能把原任务改成成功。修复 SHA256 `2b1c83f1f432a960405dfaf3c542af7e562ee276bcdb22f44ed19247641a3d41`，见[修复证据](../../../evidence/test-resource-guard-failed-recorder-20261031-r1/manifest.json)。**独立复核待完成，未执行恢复或新测试。**
- T18 scanner/adapter 已加入真实中央模块树，安装唯一受管 `PersistentRecoveryCatalog`，默认未扫描且没有 native writer fence，始终保持 conservative Unknown。没有打开生产数据库，没有伪造空扫描，没有放行dispatch；真实扫描worker接线、writer fence及原生sender票据链仍待实现/验证。宿主作者锁外root校验与fresh-now修复已冻结，尚未跑13个局部用例。
- UE预览作者TTL/锁内IO修复的两个哈希已匹配；父线程转交的独立静态复核已关闭该P2。中央唯一monitor/manage/Exit shutdown已静态核对；动态TTL与UI仍待验。
- 本批只完成源码接线及 `git diff --check`。凭证合成补验、TS/Rust检查、新EXE和原方案T01–T24整体交付均没有新增通过证据。原9017候选不覆盖，新工件仍须独立目录；不得把上述静态工作标作本轮可运行交付。中央状态见[stage3](../../../evidence/central-integration-20261031/stage3.json)。

## 2026-10-31 实施更新

- 用户已批准必要的低资源局部保护检查及凭证模拟验收，并在重启后授权连续推进至 **2026-10-31 19:41:19 UTC**。已授权的常规步骤不再逐项询问；资源准入、安全边界和原始失败记录保持。
- 最小语法 compile 与正常 micro run02 已各一次通过，见 [最小检查结果](../../../evidence/test-resource-guard-minimal-checks-20261031/results.json)。10-30 对这两项的审批等待已经结束；不据此开放全量回归。
- 已审 early-exit guard 为 D5D775F6A27CE141B07205388B09751C0C53774B0366D9B5D4F0F2533E80654F。固定错误码只增加诊断，不更改限额、严格成功判据、73/74 负例合同或独占 gate。
- 新启动边界约 **15:33 UTC**，晚于先前无身份记录的失败调用；旧未知残留已由新内核边界清除，旧失败仍保留为失败。15:43 只读快照 RAM 4.481GiB / commit 余量15.958GiB；随后的单次新调用返回 **54/1：实时RAM准入拒绝**，发生在创建子阶段/负载之前，原外层句柄退出与checked-close已记录。未执行配额负载，未重复原token。
- 四类保护检查仍待完成。单任务门槛为 RAM4GiB+448MiB / commit8GiB+448MiB；串行组合为4GiB+640MiB /8GiB+640MiB。不降低阈值，不关闭用户程序，不连续尝试负载；预算不足期间继续静态产品实现。
- [独立凭证候选目录](../../../deliverables/UAgent-Saved-Credentials-20261031-staged)包含固定9017 EXE、来源身份、独立窄域评审及说明。EXE SHA256仍为9BEED55413C878D7862FC2FF95F7BC8A11A931A496A848E7DB1FD7554A864C0B，本轮未重建或运行；不包含今天尚未编译的生产接线，不把准备候选称为本轮新增验收通过。

| 切片 | 当前实际接线 | 验证与剩余边界 |
| --- | --- | --- |
| T08 本地历史搜索 | search_native_run_history 已加入lib.rs模块及IPC handler；RunHistoryPanel 已挂载搜索入口。搜索项目身份只取已核验档案descriptor.projectId，含实际chat:project:/chat:local身份；命中再核archive/revision/消息角色、时间和正文SHA后进入完整档案。 | 只读、字面分页、晚返回隔离，无续接或权限恢复；作者局部测试已写，中央接线尚未构建/运行。原生SQL扫描时间与大档案性能未验证；分支/归档UI仍未完成。 |
| T16 只读历史操作审阅 | 历史详情已挂载NativeOperationReview，接入真实已校验NativeRunArchive并绑定reviewId/revision。 | 仅显示保存时参数/结果；没有批准/执行props或入口，不证明当前外部效果已核对。完整实时操作审阅/一次性授权仍未完成。 |
| T17–T19 宿主/资源 | 原生owner服务、managed service/monitor、6 IPC与window/page/replacement/exit生命周期已中央接线；bootstrap解析单例metadata adapter。 | 恢复目录模块与保守state已接但未启动真实扫描；真实provider/UE工作者ticket消费未接；作者锁内IO/旧now修复已冻结，未运行，不声称sidecar/跨进程恢复或全局资源调度已验。 |
| UE 构建准备 | 固定目标只读预览已接入Windows模块、managed state、prepare/release IPC及UIProvider内App入口。 | 预览不会启动UE或构建，不替构建/PIE/Automation验收；实际执行、批准及持久效果链仍未开放。 |


### 中央第二批接线与验证阻塞

- T08有界搜索helper已声明于sqlite.rs。作者已修为逐行读取，单条正文64KiB、累计512KiB含lookahead，SQLite length128KiB、progress250k VM/250ms、busy50ms；超限整页失败。独立静态P2已关闭。250ms只是搜索协作预算，既有RunStore::open/初始化不等于整IPC硬超时；局部用例未运行。
- T17–T19已中央安装唯一RuntimeHostService及monitor、6 IPC、页面/窗口撤销、显式renderer替换等待撤销、实际退出close；App只解析单例metadata adapter。没有假alwaysReady目录，缺目录默认阻塞；真实sender的register_pending→begin→finish和T18恢复目录尚未接。作者root锁内IO及旧now修复已冻结，真实目录已声明并以未扫描状态安装；本项未运行，不代表sidecar/跨进程调度完成。
- UE预览已补唯一state.start_monitor、managed monitor及Exit shutdown。作者TTL/锁内IO静态修复已获独立关闭；动态TTL未验证，未标验收完成，执行/批准/构建/PIE仍未开放。T11只有availability-only候选，尚非资产查询，未添加新的blocked主入口。
- 16:09资源快照RAM5.169GiB/commit余量15.719GiB达标后，新目录进程配额调用创建了受保护原进程，返回诊断45（原进程退出码不符合约定）。缺最终result/watchdog记录，不能确定具体失败原因；后续检查已停，失败lease/token fca9999c96dc4679bdf34bf79ad64253保留。[精确3-job当前空态](../../../evidence/test-resource-guard-post-reboot-20261031-active/exact-owned-job-closeout.json)均为absent/error2，原root退出和checked-close已记录；不把原任务改成成功。
- 当前运行阻塞是失败记录者被提前撤销及缺失记录的cleanup-only兼容，资源不足不是这次45的归因。需有限修复并独立复核：在既有期限内保留原controller/observer失败记录，正常0/75/0成功条件不变；只清理恢复须绑定原launch、实际caller回执和精确当前3-job空态，不伪造原result/proof或绕过lease。

## 10-30 基线与历史证据（后续状态以上述更新为准）
## 依据与边界

- 原方案：UAgent_下一阶段功能与实施方案_20261029(1).docx，Library ID 为 libfile_84e9900998988191a1b6b81bdaa75344；正文日期 2026-10-29，基线 c6ccdfa。旧主线程已全文读取 21 页、1195 行；第 13–14 页 T01–T24 的[交接对照](../../../evidence/handoff-20261030-session-rotation.md)是本表需求依据。此前依据交接概括；本轮已重新读取DOCX选页，准确工作包/四模板/三主流程见本文新矩阵，不声称重新全文读取。
- 当前工作树 E:\Codex\UAgent\2026-10-29\worktrees\credential-vault；分支 codex/test-resource-guard-20261030；HEAD 为 9017eab0f5a12b7a42ee3b6c222fb74aefa6271e。HEAD 不包含未提交的守护器及辅助脚本修订。
- 源码模块、生产接线、已验收范围分别记录。模块合入不等于激活；合成、原生隔离和真实 Lab 不等于当前正式生产验收。历史证据只覆盖各自提交、EXE、配置和操作。
- 10-30曾因审批拒绝暂停最小compile/run02；10-31用户明确批准后两项已各一次通过。历史拒绝保留，不再作为当前阻塞；其他动作按最新明确范围及保护准入执行。
- 10-30状态核查当时只读源码/既有记录并写文档；10-31后续局部执行及接线以顶部更新和对应证据为准。未读取真实Key、生产DB或用户vault。

## 10-30保护和凭证证据快照

| 项目 | 已有证据 | 未完成 / 结论 |
| --- | --- | --- |
| 本次安全恢复 | [执行汇总 r2](../../../evidence/test-resource-guard-detached-static-20261030/attempt-execution-01-summary-r2.json)：attempt b7568980fa774548881c3c8ef0bb4ac9，公开 exit 0，单次调用，1.2180128 秒；独占实际退出回执与恢复/自动终验绑定一致。两域严格 observer-only、空 payload、原句柄实际退出及收口通过。 | **仅本次恢复通过。**原 run01 仍失败，旧 lease/证据保留；以后新 lease 准入仍须按协议重查当时空态。 |
| 启动模式 | [单行差异](../../../evidence/test-resource-guard-detached-static-20261030/source.diff)将 Native.spawn 的 0x08080404 改为 0x0008040C；suspended/Unicode/extended/stdio/Job/限额/成员标准保持。两域本次均未见额外成员。 | 历史 PID 2548、44728 映像未知，不能认定为 conhost 或已查明系统工具根因。 |
| 保护全项 | [guard](../scripts/test-resource-guard.py) SHA256 为 4D649B69DE305D7FE8F90BA7A23122EDD7FB6652CAA0C71DC7A90289B1DC5D37。本次最低剩余 RAM 5.6982 GiB、commit 14.3358 GiB；worker 记录峰值 18.5742 MiB，不是整个命令峰值。公开 closer 仅允许正常 micro 和固定 metadata 模式。 | compile/run02 未执行；进程/树分配拒绝、独立超时、控制器停顿/watchdog 异常、串行拒绝、breakaway、日志上限等未完整实测。声明 check/types/build profile 不等于可用或获准。五份 probes 仍[无条件暂停](../../../evidence/credential-vault-probe-static-revision-20261030/manifest.json)。 |
| 凭证实现 | [vault](../apps/desktop/src-tauri/src/credential_vault.rs)、[native 命令](../apps/desktop/src-tauri/src/provider_credential_commands.rs)、[client](../apps/desktop/web/src/runtime/native-provider-credentials.ts)、[设置 UI](../apps/desktop/web/src/settings/pages/ProviderSessionSetup.tsx)、[普通聊天接入](../apps/desktop/web/src/runtime/safe-provider-session.ts)：保存/替换/删除、损坏恢复、11 种合法状态、CAS 显式 cleanup 重试、pending 禁发、固定遮罩及按需开户已有。 | 保存凭证仅适用于已支持的 Windows 普通聊天，不自动开放调查、工具、任意端点或 UE；metadata token 不是发送授权。 |
| 凭证作者验收 | [9017 作者记录](../../../evidence/credential-vault-cleanup-20261030/delivery.json)：92 个前端局部用例、4 组 native 矩阵和 1 兼容用例、3 种隔离 native UI 组合、1 次合成 native 聊天。 | 仅历史记录，本次未重跑；不代表真实 API/TLS/账号或新保护验证通过。 |
| 独立结论与后续交接 | [9017 独立窄范围报告](../../../evidence/credential-vault-cleanup-independent-recheck/review.json)在 12:24:21 UTC 已明确关闭 cleanupPending P2，未发现该范围新增 P1/P2，允许交用户做新 saved-native 验收；[后续交接](../../../evidence/handoff-20261030-session-rotation.md)仍要求事故后保护和最小补验收口。 | 同时保留两项事实：历史独立结论有效；事故后的执行/交付 hold 未解除。不把历史结论抹掉，也不据此声称本轮已交付；不新造未关闭的产品 P2。 |
| 凭证候选 | [现有 EXE](../../../deliverables/UAgent-Saved-Credentials-Cleanup-20261030-r1/UAgent.exe)本次只读哈希仍为 9BEED55413C878D7862FC2FF95F7BC8A11A931A496A848E7DB1FD7554A864C0B。作者记录绑定 9017eab0、512 输入及 sourceTreeSha256 5219735ecc55964dbaf6b8ba369185dc51f298e3dae4b31909b217a5465d0b20。 | **候选存在不等于已交付。**严格原始字节 sourceDirty:true 保留，不能以 Git clean 或行尾归一化替代。本次未重新计算产品源清单、不重建、不运行。用户旧版真实 DeepSeek 通过只覆盖 883e5085…，不覆盖新增 saved-native 通道。 |

### 2026-10-30 历史 T01–T24 对照

| 编号 / 主题概括 | 当前源码模块 | 生产主链 | 已有验收证据及边界 | 剩余项 / 最小收口与依赖 |
| --- | --- | --- | --- | --- |
| T01 验收矩阵与隔离环境 | [运行契约](runtime-contract.md)、[验收文档](mvp15-acceptance.md)、既有隔离 Lab。 | 局部能力/矩阵已有，当前候选整体未收口。 | [native 调查记录](../../../evidence/mvp16/native-ipc/final-delivery.json)、凭证和恢复记录分别覆盖不同版本/范围。 | 先完成需求→源码字节→EXE→用例→证据→未验项核对；依赖保护放行、凭证交付，不补跑全量。 |
| T02 Run / Tool / Event / Checkpoint | [shared/run.ts](../packages/shared/src/run.ts)、[registry](../packages/runtime/src/run/tool-registry.ts)、[coordinator](../packages/runtime/src/run/run-coordinator.ts)。 | 受限只读调查已用；不是外部写效果恢复全协议。 | 既有 native 调查/SQLite 证据；本次仅核源码。 | 契约层已有。后续继续复用原身份、事件、检查点，端到端证据按生产切片补，不另建弱权限协议。 |
| T03 两协议与工具循环 | [compatible adapter](../packages/runtime/src/provider/openai-compatible-adapter.ts)、[Responses session](../packages/runtime/src/provider/responses/session.ts)、[safe session](../apps/desktop/web/src/runtime/safe-provider-session.ts)、[native 入口](../apps/desktop/src-tauri/src/lib.rs)。 | DeepSeek / OpenAI 官方 Responses 普通聊天已接；保存 key 仅普通聊天，不能等同生产调查开放。 | [Responses 候选](../../../evidence/responses-production-p2-20261030/delivery.json)、[DeepSeek 历史组合](../../../evidence/deepseek-desktop-integration-20261030/delivery.json)有合成 native/UI；旧版真实 DeepSeek 通过来自用户。 | 新 saved-native 用户验收、真实双协议工具往返/生产调查闭环待做。先交现有普通聊天凭证版。 |
| T04 工具 registry / 项目只读工具 | [project-read-tools](../apps/desktop/web/src/runtime/project-read-tools.ts)、[registry](../packages/runtime/src/run/tool-registry.ts)。 | 文件/索引只读已接；UE v2 未注册。 | 既有 native 调查；[UE 激活边界](ue-build-integration.md)。 | v2 按固定只读工具、当前根/来源和版本逐项注册，依赖 T12/受信宿主；旧 v1 exact-six 不授予 v2 权限。 |
| T05 计划与有界执行 | [coordinator](../packages/runtime/src/run/run-coordinator.ts)、[scope](../packages/runtime/src/run/run-scope.ts)、[调查契约](bounded-investigation.md)。 | 只读 loop、范围、暂停取消和持久化已有；完整计划编辑/跳步/写任务未完。 | 既有隔离 native 调查，不覆盖通用写任务。 | 先明确编辑/跳步使 scope/审批/检查点失效的规则，再接单个操作；依赖 T02/T06，副作用另依赖 T16/T18/T19。 |
| T06 SQLite 全文 / 检查点 / 续接 | [RunStore](../apps/desktop/src-tauri/src/local_run_store/mod.rs)、[native store](../apps/desktop/web/src/runtime/native-run-store.ts)、[continuation](../packages/runtime/src/run/run-continuation.ts)、[契约](local-run-store.md)。 | 全文、检查点、旧副本接口和显式续聊已接；记录恢复不恢复权限。 | native 调查的真实隔离 SQLite 重启/续接；DeepSeek 组合的完整正文/中断片段合成 native 重启。 | 外部效果跨重启续跑未接；依赖 T17/T18 原生观察与启动屏障，不能重放旧动作。 |
| T07 上下文 / 项目记忆 | [run-context](../packages/runtime/src/context/run-context.ts)、[sources](../apps/desktop/web/src/runtime/project-context-sources.ts)。 | 预算、确定性选择、来源失效已有；事实/决策/待办未完整产品化。 | 源码和既有受限调查，不能替长期记忆产品验收。 | 先一类可追溯事实的读/更正/失效与来源版本衔接，再扩决策/待办；模型总结不直接成为可信事实。 |
| T08 配置 / 历史工作台 | [原生设置](../apps/desktop/src-tauri/src/product_settings_store/mod.rs)、[设置 UI](../apps/desktop/web/src/settings/pages/ProviderSettings.tsx)、[历史 UI](../apps/desktop/web/src/workspace/RunHistoryPanel.tsx)、[App](../apps/desktop/web/src/app/App.tsx)。 | 非敏感配置、历史列表、显式续聊已有；10-31只读消息搜索已中央注册和挂载，运行验证待做；归档/分支UI未完。 | [设置重启证据](../../../evidence/t08-native-integration/final-delivery.json)、native 调查和 DeepSeek 组合。 | 凭证 UI 交付优先；之后先只读历史搜索，再显式分支/归档，权限与凭证不从历史复活。 |
| T09 UE 构建 | [native profile](../apps/desktop/src-tauri/src/ue_build_profile.rs)、[process](../apps/desktop/src-tauri/src/ue_build_process.rs)、[runtime](../packages/runtime/src/ue-build-profile.ts)。 | 已合模块，未接生产声明/IPC/registry/审批/资源/持久效果链。 | [真实构建 Lab](../../../experiments/ue-build-lab/Evidence/real-build-validation.json)：固定 Win64 Editor 成功→受控 C2065→修复后成功，树停止；仅 Lab adapter。 | 一个固定目标接 held-root、原生 owner、具体一次批准、T18 效果和 T19 观察；不能只注册命令就称生产完成。 |
| T10 诊断修复 | [native repair](../apps/desktop/src-tauri/src/ue_build_repair.rs)、[checked I/O](../apps/desktop/src-tauri/src/ue_build_repair_io.rs)、[runtime](../packages/runtime/src/ue-build-repair.ts)、[契约](ue-build-repair.md)。 | 已合模块，未接生产修复链。 | [HTTP repair Lab](../../../experiments/ue-build-lab/Evidence/t10-native-http-repair-final/validation-summary.json)：真实 Build.cs 缺依赖→精确修复→构建成功；mainIpcIntegrated / realRuntimeToIpcRouteVerified 均 false。 | 先一文件、一提案、diff/批准/回读/固定构建验证；依赖 T09/T16/T18/T19。多文件 fixture 不替生产验收。 |
| T11 UE 语义读取 | [native](../apps/desktop/src-tauri/src/ue_semantic_read.rs)、[runtime](../packages/runtime/src/ue-semantic-v2.ts)、[契约](ue-semantic-v2.md)。 | 模块/Lab 已有，未向生产工具注册。 | UE 集成索引记载审阅提交/只读版本，不等于正式桌面可用。 | 先一个确切只读 v2 查询，绑定 editor/root/session 与来源；依赖 T04/T12，不借 discovery 扩权。 |
| T12 UE v2 契约 / 插件 | [v2 插件](../integrations/unreal/UAgentAssetToolsV2)、[契约](ue-semantic-v2.md)、[集成边界](ue-build-integration.md)。 | 已有版本/发现/策略模块；插件默认禁用，生产宿主绑定/能力注册未完。 | 隔离验收用 UE 5.8.2 / CL 56702186；其他引擎/平台未验。 | 先 discovery/schema/版本/当前 editor 身份校验，再逐项只读/构建/写操作；不能套旧 v1 allowlist。 |
| T13 拾取物模板 | [native](../apps/desktop/src-tauri/src/ue_pickup_template.rs)、[runtime](../packages/runtime/src/ue-pickup-template-v2.ts)、[契约](ue-pickup-template-v2.md)。 | 已审模块/Lab，未接生产；不是通用 Blueprint 图编辑。 | [行为重验](../../../experiments/ue-build-lab/Evidence/pickup-v2-behavior-retry4/validation-summary.json)真实 Lab 已保存资产、PIE 模拟输入/Automation，passed=true；NullRHI 无像素/真实键盘验收。 | 固定 create-only 模板一次预览→批准→创建编译保存→查询/行为核对；依赖 T11/T12/T16/T18/T19。 |
| T14 场景批次 / 续接 | [native](../apps/desktop/src-tauri/src/ue_scene_batch.rs)、[runtime](../packages/runtime/src/ue-scene-batch-v2.ts)、[契约](ue-scene-batch-v2.md)。 | 当前 Run 模块已有，未接生产，不是跨进程恢复。 | [Lab 交付](../../../experiments/ue-build-lab/Evidence/scene-v2-session/delivery.json)：真实 20 项、完成 7 后取消/查询/续 13，保留前 7 身份/变换；生产/主 IPC 均未激活。 | 先当前 Run 固定批次、逐对象真实回执，保存另计；依赖 T12/T16/T18/T19，跨重启另依赖 T17/原生核对。 |
| T15 PIE / Automation 验证 | [插件及 Lab 测试模块](../integrations/unreal/UAgentAssetToolsV2)、[集成说明](ue-build-integration.md)。 | Lab 验证已有，统一桌面服务/正式生产路由未完。 | T13/T14 Lab 各覆盖自己的对象/版本，不覆盖真实可视桌面、物理输入、全部引擎或打包。 | 为单个生产操作提供当前对象绑定结果；缺证据标 unknown，不拿历史 Lab 结果自动通过新操作。 |
| T16 独立操作审阅 | [组件](../apps/desktop/web/src/operation-review/OperationReview.tsx)、[adapters](../apps/desktop/web/src/operation-review/adapters.ts)、[契约](../apps/desktop/web/src/operation-review/README.md)。 | 10-31真实历史档案只读审阅已挂载，绑定reviewId/revision；实时提案批准/执行未接入；T13仍非完整图diff。 | [合入记录](../../../evidence/t16-mainline-integration/delivery.json)：App/store/IPC/权限未激活；复用 7 组独立复核，不是生产操作验收。 | 最小只读挂载真实已校验 DTO、绑定 reviewId/revision；宿主确切一次性授权/结果回读到位前批准保持禁用。 |
| T17 runtime-host / sidecar | 当前只有 [desktop app](../apps/desktop/package.json)；[现有 bridge](../apps/desktop/src-tauri/src/mvp15d_runtime_bridge.rs)不等于完整独立宿主。 | 受管宿主、重连、生命周期/跨进程恢复未完成；本次生产入口未见 runtime-host app。 | 旧 bridge 生命周期证据只覆盖旧能力，无本项完整生产验收。 | 先任务→宿主 owner/生命周期接口及一种断连保守状态；可先静态接口稿，不能声称跨重启继续执行。 |
| T18 效果核对 / 启动屏障 | [effect_reconciliation](../apps/desktop/src-tauri/src/local_run_store/effect_reconciliation.rs)、[契约](effect-reconciliation.md)。 | 扩展日志/状态/屏障已合，未接生产 store/IPC/T19/启动恢复。 | [合入记录](../../../evidence/t18-mainline-integration/delivery.json)：v2；复用 37 作者用例及独立竞争/故障复核；隔离链接；跨进程/host kill/真实外部效果未验。 | 一种操作 intent→dispatch→原 owner 查询→quiet/unknown→新授权接手；callback 返回、PID 消失不是停稳，JSONL 不是完整 T18 备份。 |
| T19 资源队列 | [queue](../packages/runtime/src/run/resource-queue/resource-queue.ts)、[边界](../packages/runtime/src/run/resource-queue/README.md)。 | 未注册，单 JS 进程共享实例，最多 3 本地模型槽；无原生资源认证/跨进程互斥。 | [模块记录](../../../evidence/t19-resource-queue/delivery.json)：25 确定性用例；无真实 native IPC/UE/模型/跨进程调度。 | 一个宿主一个共享实例，复用 RunScopeLease；外部任务须原 owner 观察 quiescent 后释放。物理资源/重启依赖 T17/T18。 |
| T20 调查 / 审阅 Agent 协作 | [agent loop](../packages/runtime/src/agent-loop-runtime.ts)、[trace](../packages/shared/src/agent-trace.ts)。 | 有基础与 trace，产品内协作/对照未完整接入；开发线程评审不是产品功能。 | 旧 handoff 对照及当前模块边界；无完整生产验收。 | 同任务一次调查→只读审阅对照，标来源/分歧；复用 scope、上下文权限、记录，不新增自动外发权限。 |
| T21 Anthropic Messages | [session](../packages/runtime/src/provider/anthropic/session.ts)、[README](../packages/runtime/src/provider/anthropic/README.md)。 | 未注册协议模块，无生产 native/UI/官方传输；配置下拉不等于能运行。 | [模块记录](../../../evidence/t21-anthropic-messages/delivery.json)：69 合成用例，无真实账号/API/TLS/Tauri 验收。 | 后续按原方案接官方端点、原生凭证、精确请求与 capability；不扩代理/beta/server-tools，账号验收另行进行。 |
| T22 四个完整内置工作流 | [workflow 契约](../packages/shared/src/workflow.ts)、[mock runtime](../packages/runtime/src/mock-runtime.ts)。 | 基础场景/fixture 不是四条生产工作流，旧对照明确未交付。 | 沿用已全文读取原方案的 handoff；本轮已重读第14页四模板名称及第3–4页三主流程，准确名称/门槛见新矩阵。 | 对应生产链齐备后逐条对原文验收，不能用 demo/mock 勾完四项。 |
| T23 首用 / 安装更新 / 诊断兼容 | [App](../apps/desktop/web/src/app/App.tsx)、[设置](../apps/desktop/web/src/settings/pages/ProviderSettings.tsx)、[Tauri 配置](../apps/desktop/src-tauri/tauri.conf.json)。 | 首用/配置部分已有；本地候选 EXE 不等于完整安装更新/诊断兼容。 | 原生设置重启/候选仅覆盖对应能力，不覆盖签名安装包、更新、多机/版本兼容。 | 先现有 EXE 来源/范围/脱敏诊断/限制；安装更新另按原要求收口，不自行发布上传。 |
| T24 三主流程 / Windows Beta | 上述主链及 [README](../README.md)。 | UE、效果、队列等未注册，三主流程生产端到端 / Beta 未交付。 | 普通聊天 native、UE Lab、模块测试仅部分覆盖；无三主流程完整正式验收。 | 凭证优先，再生产主链，逐条对原文真实验收；单条不替其他两条，不补造流程名，不 push/发布。 |

## 优先顺序、依赖与最小切片

以下是按现有缺口提出的顺序，不新增产品范围，不等于获得运行/激活授权。

| 顺序 | 最小可审阅/交付结果 | 依赖与完成条件 |
| --- | --- | --- |
| P0 现在可做 | 核现有凭证候选的 production-input 原始字节清单、EXE、作者/独立结论及待验项，先判断现有候选是否足够，不默认重建。 | 只读文件，不运行 source-identity 工具、不读 vault；保留 raw-byte identity。 |
| P1 保护收口 | 按之后明确批准范围处理 compile / 正常 micro 及拟运行任务实际所需保护验证。 | 10-31 用户已授权剩余必要局部检查。当前等待失败lease清理修复的独立复核及受保护恢复；普通开发无需重复许可，仍不开放全量、真实Key/API或无界负载；不重试原事故输入/token。 |
| P2 现有凭证交付 | 补确实剩余的最小局部验收、独立结论，冻结正确源身份/候选/用户验收说明；已有候选够用就保留使用。 | P1 和对应执行授权；仅唯一自有合成条目/隔离数据。新的 saved-native 真实 API/TLS 仍待用户验收；正式交付未完成。 |
| P3 主链边界 | 对齐 T17 owner/生命周期、T18 效果交接、T19 资源与 T16 真实 DTO/批准责任，先交静态接口/接线稿。 | 一种操作、一套原身份、一个共享队列；缺原生停稳证明保持 unknown/未激活，不建另一套放行规则。 |
| P4 第一条受限 UE 链 | T12 固定发现/版本/宿主；T11 一个只读查询和 T09 一个固定构建目标分别闭环，T16 展示真实提案/回执。 | 各自 IPC/registry/精确批准/资源/效果完整后才激活/验收；只读发现不授权构建，固定构建不授权任意命令。 |
| P5 第一个修复闭环 | T10 单个 Build.cs 依赖：诊断→diff→具体批准→应用/回读→固定构建→持久结果。 | P4 + T16/T18/T19；不据此宣称多文件、未知效果或跨重启已完成。 |
| P6 其余原方案 | 逐项接 T13 create-only、T14 当前 Run 批次、T15 对象验证，再项目记忆/历史 UI、协作、Anthropic、四工作流、兼容与三主流程。 | 每项分别记录模块/接线/模拟/真实；跨进程依赖 T17/T18/T19 原生边界。现有操作审批、账号/API、发布限制不变。 |

## 不依赖现在运行测试就能开始的静态机会

1. **优先 P0 凭证交付核对。**只读候选生产输入清单、原始字节/元数据，区分 sourceDirty:true 与 Git clean；分别列出已关闭 P2、事故后保护 hold、补验和用户新通道验收。不运行生成/核验脚本，不接触 key。
2. **修正文档时点差异。**bounded-investigation.md 的部分早期描述仍将 Responses 整体写作未实现，应区分普通聊天已接与调查未激活；mvp-roadmap.md 按当前代码/真实交付校正，保留历史含义，不倒退已授权行为。
3. **T16 最小只读接线稿。**对真实 App/store 数据入口及 reviewId/revision DTO 做类型/调用点静态稿；缺真实来源先留受限 port，不把 fixture 放入 host UI。批准保持禁用，宿主负责精确操作/原生授权。
4. **T18/T19 单操作接口稿。**明确当前 owner→effect registration→native quiescent observation→队列释放顺序，复用 RunScopeLease/held-root；缺证明为 unknown。不注册执行 IPC、不迁移生产 DB、不启动宿主。
5. **此项是10-30早期历史记录，不是10-31当前状态。**当时只整理文档，尚未实施上述代码；10-31实际接线、执行结果与剩余项以上方更新及新矩阵为准。“可先写静态可审稿”不等于“不需验证即可交付”；未来代码激活、测试、构建仍须对应授权。

## 会话与交接

用户要求同一会话超过 30 轮换新会话继续。当前无可靠完整历史轮数接口，不猜数字；接近阈值由父线程提前安排交接，带本表、HEAD/未提交项、最近哈希、被拒动作与待答复状态。换会话不解除暂停，不重复已知失败动作。


## 2026-11-01 真实 Store 所有者接线与构建记录

中央已把会话和记忆 CRUD 接到真实原生队列，统一所有已有 SQLite 包装器的串行门和 owner 退出检查，固定原始数据库文件，并绑定本地窗口的新一代原生生命周期。记忆 r3 的 SQL 预算、共同 handler 租约和最终基础上下文计划已接线。原生 panic/回滚状态不明路径会隔离存储域。以上均为本轮源码实现，不能据此认定 UI 或原生编译验收通过。

r4 受保护前端构建完成 370 模块转换，分块阶段 Node 退出134；严格清理单独公开退出0并通过自动验证。原生构建未启动，没有新集成 EXE。r5 固定半空间提案仅供独立复核，未应用或执行，未降低系统底线或 OS cap。

普通对话保持原路径，生产记忆注入和最终整批派发屏障尚未启用，RuntimeHost 正向恢复准入仍未完成。原始下一阶段其他未完项继续保留，不能缩减为只差打包。当前详证见 `E:/Codex/UAgent/2026-10-29/evidence/managed-store-owner-20261101-r1/final-result-r2.json` 与 `docs/native-store-owner-integration-20261101.md`。


### r5 后续实际结果

r5新前端已在原OS上限内构建成功并完成严格绑定/收尾；原生构建在创建负载前被fresh RAM门槛拒绝，Rust未启动。会话S5原生请求生命周期已最小接线，记忆r4 panic/回滚修复已冻结核对；新增局部测试和编译harness均仍待动态验证。当前无新集成EXE，完整下一阶段与最终派发屏障仍未完成。最新证据：`E:/Codex/UAgent/2026-10-29/evidence/integrated-product-20261101-r5/central-actual-status.json`。
