# 项目记忆与上下文解释：中央接入交付

> r4最新M5修复见 project-memory-panic-review-20261101-r4.md：panic之后同worker重试/确认回滚，不能确认则在lease释放及panic payload销毁前直接隔离原连接。当前中央已有所需ConnectionLease API，本轮无需新中央补丁。累计50项测试源码，本作者运行0项。以下r1/r2/r3材料保留为历史，冲突以r4说明为准。

> r3最新接线与独立审查M3/M4修复见 project-memory-p2-review-20261101-r3.md。原生四个handler现在必须转发真实cancelled/deadline；SQLite child及共同handler租约需中央合入。上下文默认不预留，中央应传baseContext并采用返回contextPlan。具体补丁为 project-memory-r3-central-integration.patch（check退出0，未应用）。以下r1/r2接线记录保留为历史，冲突以r3为准。总计49项测试源码，本作者运行0项。

此交付是实际新增源码及离线测试源码，所有动态检查均未执行。本作者没有修改 lib.rs、App.tsx、ConfigSettings.tsx、Cargo、guard、共享 RunStore 声明/迁移、run-coordinator、agent-loop 或会话管理作者文件；没有删除文件、用户数据、访问 Key、联网调用 API 或运行应用。现有 9017 EXE 不含本模块。

## 已有源码与行为

- packages/runtime/src/project-memory/contract.ts：严格数据契约，facts/decisions/todos、来源版本及时间、原会话/模型/用户来源、用户确认、pending/valid/stale/retired、revision、私有/可分享、关键约束和分享路径。拒绝额外的 authority/config 字段。
- selection.ts：复用 RunContextSources 和 isRunPathAllowed。只选择当前项目、已确认、有效、非私有且全部路径满足当前 read/share 范围的记忆。事实缺来源、来源变化、模型推测未确认、超预算均有 omitted 原因；原始文字不会截断成伪事实。关键约束优先，按整个最终 messages JSON 的 UTF-8 字节计费。
- budget.ts：调用原 prepareRunContext，并优先为记忆预留最多 1/3（上限4096字节）。无法保留原强制约束/最新工具组时退回原预算选择；30条消息已满时仅省略最早的可选历史对来留位，并重新生成相同索引语义的Context map，不破坏工具往返、不改档案。
- createProjectMemoryContext(port,sources)：原生分页读取；单次最多250条，超出会明确 catalogTruncated，不伪称全部已考虑。提供发送前逐条重读内容/revision及源stamp的函数，并在等待后复核授权到期；检测到变化即拒绝。真正调用与跨多条记录的最终派发屏障依赖中央，尚不能宣称生产旧请求已被全面阻止。源变化通过同一 Port 的 expectedRevision/markStale 写入，冲突不覆盖新修订。
- local_run_store/project_memory.rs：现有 RunStore 连接上的 SQLite leaf，包含 V3 表定义、分页、创建、修订 CAS、确认、来源失效、停用；不另开数据库、不创建新 writer。新/编辑记录只能 pending；事实无来源不能确认，retired 不能复活。原会话/消息来源在同项目中核验。每条正文8192字节、8来源、8路径、整个payload24576字节，分页最多50，查询额外一条形成keyset cursor。
- project_memory_commands.rs：四个纯数据处理函数，要求中央传入已受保护的 &RunStore。不自行开放 Tauri command；本模块不强制执行 managed writer fence，必须由中央持有同一owner/fence，当前实际接入状态以中央证据为准。
- web/runtime/native-project-memory.ts：严格 IPC 输入/回包解析，原生成功回复才算保存；无 localStorage/内存假持久化。取消后已派发写入报告 outcome_unknown，不能声称撤回。来源捕获只读取现有 trusted project 的元数据，绝不赋予出站权限。
- ProjectMemoryPanel.tsx/CSS：中英文创建、编辑、确认、停用、分页、错误与来源失效显示，以及实际任务选择 used/omitted 解释。私有为默认值。刷新或切换不恢复权限；过期异步响应丢弃。创建请求在结果不明时保留同一ID，避免第二次创建。

## 中央接线要求（本模块作者未执行；以中央实际接入为准）

1. 审阅并合并 project-memory-central-merge-20261101.patch 的三个最小声明/迁移变更。不要更换既有 run-store-v2 目录；这是同一数据库的v2→v3事务迁移。旧程序会按现有 newerSchema 保护拒绝读取新版本，不能混跑旧/new writers。补丁仅供中央合入；首次交付快照的 git apply --check 退出0，本作者未实际应用。
2. lib.rs 声明 project_memory_commands，并在既有 managed writer fence/store opener 内注册下面四个 Tauri IPC。输入类型及返回类型均在模块中。不能把旧的独立 RunStore::open(app_root) 套过来绕过 fence：

   - list_project_memories(MemoryListInput) → MemoryPage
   - get_project_memory(MemoryGetInput) → ProjectMemory
   - create_project_memory(MemoryCreateInput) → ProjectMemory
   - update_project_memory(MemoryUpdateInput) → ProjectMemory

   在 with_managed_store 闭包里调用同名纯函数即可。所有创建/更新/迁移必须归同一个管理者。项目行必须由中央依据原生已注册项目身份先登记；本模块不接受 renderer 的任意 root，不会为了让 FK 通过而伪造项目。未知项目明确失败。
3. RunCoordinatorOptions 新增 projectMemory?: ProjectMemoryContextPort（从 project-memory/index.js 导入）。drive 中：

   - 存在 projectMemory 时用 prepareMemoryBudgetedRunContext 取得基础 context；无记忆配置保留原 prepareRunContext。
   - 基础来源 validateContextSources 后，await options.projectMemory?.prepare({run,messages:context.messages,signal:this.controller.signal,isCurrent:()=>this.options.lease.isCurrent()})。
   - request.messages 使用返回的 memory.messages；未配置时仍用 context.messages。不要写进 this.messages 原始记录，避免下轮把记忆误当成用户历史或打乱 tool 对应关系。
   - 现有 beforeSend 中先 await memory?.beforeSend()，再复核原 selectedSources，并 this.check(false)。不能仅在 renderer 展示或 model_started 前核验一次。
   - preparation、beforeSend 的 project_memory_* 错误按 context_stale/context_unavailable 进入暂停；不能吞错后继续发送旧body。现有 preSendFailure 逻辑也应覆盖记忆错误。
   - 用 onMemorySelection?(plan,run) 回调把 plan 交给 UI；该回调仅描述本次准备的选择，不能冒称 transport 已成功。若使用 model_started.payload 存档，需同步扩展 native-run-store.ts 与原生命令的严格事件白名单；现有白名单会丢弃新增字段。不要把无法持久化的字段直接塞进 RunContextPlan 来逃过校验。memory.plan.usedBytes 是完整最终请求messages字节；基础 RunContextPlan 保留自身的原始记录索引和字节语义。

4. InvestigationRuntimeOptions 添加同类型 projectMemory 和 onMemorySelection，并在 agent-loop-runtime.ts 创建 RunCoordinator 的现有位置原样传递；web DesktopRuntimeAdapter 的 configureInvestigation 已透传配置，无需另造任务执行器。
5. ui-store.ts 原 createProjectContextSources(projectAdapter) 调用附近创建共享 port：
   createNativeProjectMemory()；createNativeProjectMemoryContext(projectAdapter, port)。
   将 context 配进 configureInvestigation 的 projectMemory；把 onMemorySelection 关联到当前任务/项目的展示状态，项目变化清除旧选择。不得从档案重建 lease 或把 project memory 当做授权来源。
6. App 挂 ProjectMemoryPanel，传真实 activeProjectId、同一 port、createProjectMemorySourceCapture(projectAdapter)、当前源/index generation，以及该项目当前任务的 selection。用户确认来源只需 trusted project 的元数据捕获；若传 sources/scope，则必须是新的 live task scope。scope 不是历史恢复出来的值。挂载入口/数据获取由中央负责，不能将 native 未注册时的错误标成功。

## 最小离线验收源码（未运行）

- runtime selection.test.ts：14项，A/B及出站隔离、模型推测待确认、来源选择/发送前变化、revision/retire冲突、关键约束/中文UTF-8预算、切换/取消、数据契约边界。
- runtime budget.test.ts：2项，30条消息占满时为记忆保留一条消息位置且保留原始记录索引，以及关键约束必须使用完整预算时的回退。
- runtime coordinator-memory.test.ts：2项，直接驱动真实 RunCoordinator、假 ProviderAdapter 捕获 messages；验证当前有效记忆确实注入，stale/越范围正文不进入请求，并在审批等待期间源变化时 transport 零调用。需要中央接入才能通过；本次未动态核查中央接入状态；若缺少实际接线，这两项会揭示缺口，不能记录假通过。
- web native-project-memory.test.ts：7项，命令/expectedRevision、跨项目和authority回包、游标/修订、取消结果不明、无假持久化。
- web ProjectMemoryPanel.test.tsx：7项，来源失效、保存失败、切换丢弃旧响应、编辑仅发送内容字段。
- native project_memory_tests.rs：4项，同项目持久状态/跨项目与CAS、来源必需与分页、合成旧v2迁移及关闭重开读取。设置 UAGENT_MEMORY_TEST_ROOT 为中央允许的 E:/G: 合成夹具根目录；夹具只创建保留，不含清理删除。迁移夹具是 V1 项目结构加 v2 user_version 与代表性 checkpoints 旧行，未伪称生产档案或完整旧v2镜像。

合计36项测试源码，动态通过数为0。中央仅需把本模块、实际 coordinator 接线及一次受保护 smoke 串行运行；不要求新增全仓负载。还需真实 IPC/界面操作、迁移后重启与请求捕获验收，才能把 T07 标成闭环。文档、源码和局部测试均不能代替新集成 EXE 与原方案完整验收。


r2边界复核、具体差异与尚未实现的owner/fence/整批发送保证，见 project-memory-boundary-review-20261101-r2.md。最新文件哈希见 project-memory-static-manifest-20261101-r2.json；原manifest保留为r1历史证据。
