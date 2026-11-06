# 会话管理入口交接（2026-11-01，P2 修复版，含 S4 容量协议）

本交接是**静态源码交付**。本会话没有运行构建、类型检查、测试、应用、UE、真实 API、安装或生产数据库操作。未删除任何文件或会话数据。以下新增测试是待中央通过串行保护器执行的源码，不是通过记录；未生成 EXE。

已实读 `evidence/independent-plan-and-guard-review-20261101/review.md`，以及现有 RunStore、SQLite 包装、schema v2、run-store/history 命令、NativeHistoryAccess 和当前历史搜索。当前工作树及 E: 祖先未发现 AGENTS.md；链接主仓库 G:/UAgent 未发现 AGENTS.md，`.agents` 未枚举到技能文件。

## 新增文件和边界

- `apps/desktop/src-tauri/src/local_run_store/session_catalog.rs`：同一 RunStore 的目录投影、字段级条件更新、事务内有界文本前缀读取/分支。
- `apps/desktop/src-tauri/src/local_run_store/session_catalog_control.rs`：VM/期限策略与原生取消标志。
- `apps/desktop/src-tauri/src/local_run_store/sqlite_session_catalog.rs`：由 SQLite 连接所有者声明的 RAII 执行保护 leaf。
- `apps/desktop/src-tauri/src/session_catalog_commands.rs`：接受中央 `&RunStore` 的纯命令处理函数，无 Store opener 和独立 writer。
- `apps/desktop/src-tauri/src/session_catalog_commands_tests.rs`：11 个原生合成测试；fixture 使用显式 E:/G: 路径并保留，不含清理删除。
- `apps/desktop/src-tauri/src/session_catalog_registry_tests.rs`：3 个纯内存注册表回归，复用生产 begin/cancel/finish/make_room，分别覆盖第 257 个 key、取消记录老化及满表既有请求取消；不使用数据库、文件或等待。
- `apps/desktop/web/src/runtime/native-session-catalog.ts`：四个 IPC 的输入和输出核对、纯数据类型。
- `apps/desktop/web/src/runtime/native-session-catalog.test.ts`：13 个离线边界测试。
- `apps/desktop/web/src/workspace/SessionCatalogPanel.tsx`、`.css`、`.test.tsx`：目录、详情、操作表单、搜索跳转、继续准备与 9 个局部组件测试。
- 本文档。

没有改 App.tsx、lib.rs、ConfigSettings.tsx、Cargo、guard/caller、RunHistoryPanel、ui-store、schema.rs、local_run_store/mod.rs、sqlite.rs 或项目记忆文件。没有 reset/clean，没有打开用户会话数据库。

必要存储接点是新的 `local_run_store/session_catalog.rs` 及执行保护 leaf。现有公开 sessions 方法不提供按 ID 读取/字节预检，现有 branch_session 在事务中整段 SELECT。leaf 复用当前 RunStore/db、insert_session、branch 身份哈希与 origin/parent 规则，把预算预检和正文复制放到同一受限 BEGIN IMMEDIATE 内。修改字段使用条件 SQL，保留 native-origin 限制并检测同字段冲突；不再回写不相关字段。没有新数据库、表、迁移或连接。旧 branch_session/update_session 原样保留；此入口使用有界、条件更新变体。

## 中央接入：三个模块声明和五个命令包装

在 `local_run_store/mod.rs` 模块声明区添加：

```rust
pub(crate) mod session_catalog;
```

**本次修复新增必需接点**：由存储所有者在 `local_run_store/sqlite.rs` 模块声明区加入，作者未改中央文件：

```rust
#[path = "sqlite_session_catalog.rs"]
mod session_catalog_budget;
```

`session_catalog_control.rs` 已由 session_catalog.rs 声明，无需另改 mod.rs。若 sqlite.rs 没有声明新 leaf，调用 `Db::with_session_catalog_budget` 将无法编译；不能漏接该安全前提。

在 lib.rs 与 local_run_store 相同的 Windows cfg 边界添加：

```rust
#[cfg(windows)]
pub(crate) mod session_catalog_commands;
```

然后由中央已有的受管 Store/owner 包装五个 Tauri 命令。**本作者没有发明未提供的 managed opener，也没有退回 app_profile + RunStore::open 的第二 writer。** 外层包装的名称、输入、返回与内层调用固定如下：

| 外层 Tauri 命令名 | `input` 类型 | 返回类型 | 持有中央受管 Store 时的准确调用 |
| --- | --- | --- | --- |
| `list_native_session_catalog` | `session_catalog_commands::ListInput` | `ListResult` | `session_catalog_commands::list(store, &input)` |
| `update_native_session_catalog` | `UpdateInput` | `MutationResult` | `session_catalog_commands::update(store, &input)` |
| `branch_native_session_catalog` | `BranchInput` | `MutationResult` | `session_catalog_commands::branch(store, &input, now_ms)` |
| `read_native_session_catalog` | `ReadInput` | `ReadResult` | `session_catalog_commands::read(store, &input)` |
| `cancel_native_session_catalog` | `CancelInput` | `CancelResult` | `session_catalog_commands::cancel(&input)`，不获取 Store，不排入 Store 串行队列 |

`store: &RunStore` 必须来自同一个中央 owner/lease 所管理的连接生命周期；不要把裸 SQLite 连接跨线程搬移。四个 Store 操作已经在纯 handler 内安装一个统一 SQLite 预算，update/branch/read 由它管理 BEGIN IMMEDIATE；外层不要再包 SQLite transaction。中央须独占该连接且确认没有其他特性的 progress handler 正在生效，不能把本预算嵌套到历史搜索等另一个 handler 内。连接 guard 会拒绝自身嵌套；SQLite 没有读取旧 handler 的 API，因此不能假称可恢复未知回调。

写操作需 writer fence/lease；read_prefix 也需要允许该事务的受管 worker。cancel 包装必须直接调用纯 `cancel`，不等待该 worker/owner 锁；否则正在扫描时取消永远无法到达。返回 StoreError 原样通过 IPC。`now_ms` 由 native 系统时钟生成。将五个实际包装函数登记至 `generate_handler!`。中央 Store opener/ownership 尚未存在时保持显式不可用，不标动态完成。

IPC 一律 `{ input: { schemaVersion: 1, requestId, ... } }`，native 输入使用 deny_unknown_fields。这是尚未发布的 v1 合同修正：**四个旧输入现在都必需 requestId，输出回显 requestId；update 旧 title+archived 输入已移除。** TS 调用者可省略 requestId，port 会生成；需要取消的调用者必须自己持有明确 ID。面板已经为目录和本地操作生成独立 ID，取消/Back/项目切换/unmount 会请求对应取消。

- list：`projectId, includeArchived, offset, limit`，limit 1..50、offset 0..1,000,000，结果含原生 projectId、session 描述与 hasMore。目录按创建时间/ID 倒序，不读取正文；超大旧标题明确拒绝，不静默截断。
- update：`projectId, sessionId, patch`。patch 只能是 `{kind:"rename", title, expectedTitle}` 或 `{kind:"setArchived", archived, expectedArchived}`。名称 1..1024 UTF-8 bytes，不含控制字符；expectedTitle 允许既有空标题但最多 1024 bytes。仅更新指定字段，并在同一事务 SQL WHERE 中核对该字段旧值；不匹配返回 `conflict`，不会覆盖其他窗口同字段修改。归档不发送名称，重命名不发送 archived，因此交错修改不同字段可以保留双方结果。历史文本副本仍不可原地修改。
- branch：`projectId, sessionId, throughOrdinal, newSessionId, title`。0 创建空分支；正数必须是实际存在的消息序号。复制所选前缀完整正文、原 ordinal、role、时间和 origin，父 ID 指向源会话；新会话 origin 为 native，不复制 run/checkpoint/tool execution/artifact/approval/scope。分支编号已存在则明确 alreadyExists，事务不产生第二次复制。
- read：`projectId, sessionId, throughOrdinal`，结果新增 **prefixMessageCount**。同一事务先读取至多 513 行按 ordinal 索引排序的 `(ordinal, length(CAST(body AS BLOB)))`，超过 512 条/单条 256 KiB/总计 1 MiB 即拒绝，然后读取正文并核对加载条数与独立前缀条数完全相等。TS 同样核对精确条数；through 等于 lastOrdinal 时还核对前缀数等于会话总数。允许合法稀疏 ordinal，不以连续序号代替完整性证明。结果 requiresFreshAuthorization=true，没有部分成功或截断正文。
- cancel：`projectId, requestId`，无路径/Store/权限对象，返回 `cancellationRequested`。内存注册表最多 256 项，**Active 与已接受的 CancelRequested 均不可因容量或时间驱逐**；600 秒过期及容量回收只适用于已返回的 Finished。满表且没有 Finished 可回收时，新的取消/新的 Store 请求都返回明确 `busy` 错误，说明未接受；不插入、不返回已接受 Ack，也不释放既有取消义务。同 key 的既有请求仍可取消、既有待启动取消仍可被对应请求取回。该请求随后进入 Permit 时沿用原 AtomicBool=true，SQL 启动前拒绝；只有这次原请求已拒绝/完成、Permit Drop 标记 Finished 后，其槽位才可回收。重复待启动取消保留同一义务。

这是有界的失败关闭协议：未能和实际队列工作配对的取消会持续占槽，而不会在后台悄悄失效；大量这种义务可能导致新操作返回 busy，保持 256 项上限。将来中央可用入队前 Queued lease/明确队列结束证明改善活性，但本模块没有凭空假定队列期限或自动释放已承诺取消。协议作用于当前原生进程中的请求生命周期，不把 requestId 描述当执行权限。已完成请求的取消返回 false。真实 SQLite 回调仍读取原 AtomicBool，过晚的取消可能已跨过提交点，面板继续提示“可能已保存”并刷新核对。UI 不得把 `cancel` IPC 的拒绝/错误当成已接受取消。

四个 Store 操作共用 250,000 VM 指令、250 ms 检查期限（每 100 指令检查取消/期限，Rust 元数据/复制循环每行另作期限/取消检查）、25 ms 锁等待与 SQLite 单值长度上限 300 KiB；已有更小长度上限会保留，不提升 owner 的值。目录消息计数也只扫描最多 10,001 条索引元数据；超过 10,000 的会话返回明确 catalogCapacity，不能把截断计数展示成精确值。整个目录及 latestRun 查询仍受同一 VM/期限预算约束。通过原生控制流报 catalogBudget/catalogDeadline/catalogCancelled；不使用前端超时宣告 SQL 停止。

RAII 在所有语句 finalized 后移除自己的 progress handler、恢复原 busy_timeout/SQL length，并释放自身 handler 注册。写事务内有一个更内层 Drop，在错误/展开时先解除中断回调，再交还已有 transaction 的 ROLLBACK；成功时先解除回调再 COMMIT。这样取消标志不会反过来打断回滚并遗留写锁。COMMIT/ROLLBACK 仍保留 25 ms busy timeout，完成后才恢复旧值。请通过新增小 VM 合成测试验证该顺序，而非据静态源码算通过。

## 中央接入：前端面板与继续准备

导入：

```tsx
import { SessionCatalogPanel } from "../workspace/SessionCatalogPanel";
import type { NativeSessionContinuation } from "../runtime/native-session-catalog";
```

在已有受控面板/抽屉挂载（Modal 的焦点、Escape 与 inert 处理继续由外壳负责）：

```tsx
<SessionCatalogPanel
  projectId={persistedArchiveProjectId}
  onClose={closeSessionPanel}
  onContinue={prepareFreshTaskFromSession}
  continuationDisabled={taskBusy}
/>
```

这里 `persistedArchiveProjectId` 必须是实际保存的 archive ID。普通聊天可能使用 `chat:project:...`，不能盲目拿逻辑 activeProjectId 代替；中央可从现有 native history 描述选择项目。没有项目时面板会显示选项目提示。

`prepareFreshTaskFromSession(request: NativeSessionContinuation, isCurrent: () => boolean)` 是中央产品接点，不能直接调用现有 `continueSaved(archive, share)`，也不能伪造 NativeRunArchive/coordinatorState。请求含 session 描述、用户主动勾选的 shareContext、按需读取的完整 messages 和 requiresFreshAuthorization=true。默认不共享旧正文；不会调用 read。需要共享时，仅在有界 read 完成且当前项目/面板仍有效后回调。新分支没有 latestRunId 是正常状态，不能为它捏造旧 Run。

准确接线规则：

1. 核对 `isCurrent()`、当前任务 busy 状态和当前用户选择，关闭旧 provider session；在自己的每个 await 后再次核对 `isCurrent()`，过期则停止准备。
2. 重新建立当前项目身份与来源校验，只创建新的草稿/任务，重新走既有出站范围与所需授权；不自动发送或执行。
3. 对存在 latestRunId 的原会话，可用已有 `createNativeRunHistory().snapshot(projectId, latestRunId)` 核对未知外部效果与原 Run 状态，再走既有安全准备。不能把目录描述当 canContinueNativeHistory 的替代品。
4. 对分支的原始 messages，按既有 envelope 规则提取为历史上下文数据，保留来源。不得把历史 system/developer/tool 文本当新授权或可运行工具计划。该原始记录本身不包含可复用的 scope/Key/execution token。
5. `onOpenArchive` 可选，类型是现有 NativeHistorySearchSelection；搜索按钮已直接复用 RunHistorySearch，核验和只读审阅由既有组件完成。无需改 RunHistoryPanel 或重新实现搜索。

面板具有同步 in-flight 锁，防 React 更新前的重复点击；branch 草稿重试保留同一 newSessionId，但每次 IPC 使用新 requestId。Cancel/Back 请求真实原生取消并使异步结果/继续回调失效，不声称已提交事务已回滚。有效目录刷新会按 ID 同步详情；被过滤、移出页或刷新失败则清除旧详情，加载期间也禁止继续编辑旧详情。conflict 会关闭旧表单并刷新。项目/port 切换丢弃旧响应。React unmount 后不写状态。

## 中央局部验收清单（尚未执行）

- 前端只运行这两个测试文件，共 22 个 `it`；原生为 `local_run_store::session_catalog::tests` 下 11 项及 **`session_catalog_commands::registry_tests` 下 3 项**，共 14 项原生、总计 36 项测试源码，全部仍未执行。中央若用过滤器应包含两个 namespace（`session_catalog` 子串可覆盖两者），不能只运行 local_run_store 子树而漏掉取消容量回归。使用既有串行保护器，保留 RAM/commit 地板和 Job 限额，不并行重跑全仓。
- 原生 fixture 要先设置 `UAGENT_SESSION_CATALOG_TEST_ROOT` 为已存在、专用于合成证据的 E:/G: 目录。每个测试创建唯一目录且保留，不执行 remove/delete。
- 原生覆盖：A/B 隔离、改名/归档与重新打开、历史副本只读、正文及 origin/parent 前缀保真、重复/未知请求、空前缀、逐条/总字节及条数预算、分页与完整读取。
- 前端边界覆盖：严格输入/输出身份、分页、跨项目与历史 origin、分支父项/前缀、完整 Unicode/NUL 正文、预算和部分响应拒绝、可变调用参数与 native 不可用。
- 面板覆盖：重复保存一次、归档筛选、失败提示与稳定分支编号、历史只读、切换项目丢弃旧响应、取消后不误称回滚、完整上下文只交新任务准备、Back 丢弃迟到读取。
- P2 新增具体回归：native 两种交错字段更新保留不相关字段、同字段陈旧值 conflict；稀疏前缀独立条数；小 VM 中断后分支/事务回滚、同连接可查可写、busy timeout/SQL length 与 handler 恢复；取消中断后同连接写入成功；派发前取消与零期限不启动复制。前端补尾项独存/缺中项/伪造条数拒绝，合法稀疏及全会话精确条数通过，取消作用域核验。面板补 Cancel 后 native 成功再刷新后归档保留新名称，以及 conflict 后同步详情/关闭旧表单。
- S4 精确回归：先接受 R 的启动前取消，再补齐 256 项，第 257 个不同取消及新工作均明确 busy；R 原 flag 不变，真正取回时 CatalogControl 拒绝执行。仅当该次工作已拒绝并 finish 后，Finished 槽可供新请求使用。另以注入的逻辑时间推进 601 秒，证明待启动取消不老化丢失而 Finished 可以过期；满表情况下既有 Active 的取消仍可接受，Finished 的取消返回 false。三个测试只操作局部 HashMap，不污染全局注册表。
- 加两个新增生产入口到中央现有窄类型检查清单：`src/runtime/native-session-catalog.ts` 和 `src/workspace/SessionCatalogPanel.tsx`（被实际 App import 后也会自然进入图）。不需要改 runtime/package 或安装依赖。
- 真实 UI/IPC：选择实际保存项目，改名、归档/筛出、分支后重启重读；原会话名称/正文独立；超预算拒绝无部分分支；Back 后迟到结果不触发继续；继续前项目/来源/出站核对及新授权仍有效。

因此当前可标“会话管理实现及离线局部测试源码已交付，待中央接线与受限动态验收”；不能标“新 EXE、重启保留或真实 UI 已通过”。
