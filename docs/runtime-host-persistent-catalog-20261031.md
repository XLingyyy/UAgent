# T18 原生持久目录与宿主 P2 修复交接（2026-10-31）

本轮只有静态源码实现和读取复核，未构建、测试、安装、启动应用、运行 SQLite 查询或读取任何生产数据库/真实凭证。没有修改中央入口、local_run_store/mod.rs、既有 effect_reconciliation.rs 或其他人的文件。源码不等于编译通过或跨重启验收。

## 实际新增/修改

根目录：`E:/Codex/UAgent/2026-10-29/worktrees/credential-vault`。

- 新增 `apps/desktop/src-tauri/src/local_run_store/runtime_host_catalog_reader.rs`：既有 RunStore 同一连接上的真实只读扫描实现。
- 新增 `apps/desktop/src-tauri/src/runtime_host_recovery_catalog.rs`：将真实扫描结果转换成原生 RecoveryCatalog；未知屏障只增不减。
- 修改本切片独有 `runtime_host_service.rs`：修复全局锁内路径 I/O 和 begin 使用 I/O 前时间的两处 P2。
- 修改本切片 `runtime_host_service_tests.rs`：追加第 13 个未运行用例，覆盖慢根校验时 heartbeat/deadline 可进入，以及 I/O 返回后的到期复查。
- 同步 `docs/runtime-host-foundation-20261031.md`。六个现有命令、前端 DTO 和调用接口没有改变。

## 只读扫描为何没有复用 pending()

现有 `EffectJournal::pending` 只返回 Prepared / blocks_conflicting_admission 的记录，不能让启动目录核查全部 verified 记录的 fence；`open_effect_journal` 会建表并生成 volatile journal nonce，也不适合作为只读扫描入口。

新方法为：

```rust
RunStore::read_runtime_host_recovery_snapshot(
    &self,
    cancelled: &AtomicBool,
) -> local_run_store::Result<DurableRecoverySnapshot>
```

它只在原生已打开的同一个 RunStore 上执行 SELECT / PRAGMA 读取和 BEGIN DEFERRED / COMMIT / 出错 ROLLBACK。没有第二个数据库实现、建表、迁移、路径重开、effect mutation、ticket fence、callback settlement、审批或凭证恢复。

扫描在一个一致的 SQLite read snapshot 内完成：所有 project ID、全表 effect_intents（包括 verified 行）、对应 dispatch gate、最新 journal event 和最新 dispatch event、孤立 gate/event 检查，然后检查所有 run/tool_call/changeset 的未决状态。复用原 T18 decode_row 的 checksum、intent/owner/root/plan/revision 校验和 gate_for 的原 fence 校验；额外检查最新事件与当前 record/gate 一致。不会把 `inCallback`、Prepared/Open、手工核查、ResultUnknown 或旧 running/needsReconciliation/inFlight/unknown 当作已停止。

不从 Project.root / intent.rootRef 打开任何项目路径，不把持久行构造成 CurrentRun、RecoveryReadScope、DispatchTicket 或 Native RegisteredExecution。只返回原 owner、physical root ID、resource key、revision、digest、状态等描述；不返回 tool arguments、target bodies 或可恢复权限。

有界读取：每页 16 行；project 最多 4096；各扫描表最多 4096 行；单 intent/event payload 最多 256KiB；intent 累计 payload 16MiB；扫描检查期限两秒并接受取消。超页/超量/超时、schema 缺失/部分/v1/未来版、损坏、busy、缺 gate/event、未知状态全部使扫描不完整，准入保持 unknown。分页沿全表有序范围直至确认末页，不能用空过滤页作结束证据。

SQLite 单次读取/锁等待仍依赖既有驱动；两秒检查无法抢占一个已经阻塞的 SQLite 调用。本轮没有改 sqlite.rs 的五秒 busy_timeout；实际扫描必须留在现有有界 native worker 及 OS 资源守护范围。

## RecoveryCatalog 行为

```rust
let catalog = Arc::new(PersistentRecoveryCatalog::new());
let report = catalog.scan_existing_store(&existing_native_store, &cancelled)?;
host.install_recovery_catalog(catalog.clone())?;
```

这不是 always-Ready 目录。默认 `new()` 没有 native writer fence：真实匹配的持久不明工作返回 Blocked，其他准入返回 Unknown。扫描真实为空也不能证明当前所有 writer/其他连接已受管。

`CurrentLedgerFence` 仅定义了后续原生接入端口，本轮没有实现或安装一个声称成功的 port。真实实现须持有并证明准确数据库/写入者的原生所有权，校验 stamp.matches_store_instance 与原 store 的关联，涵盖所有连接，在任何不安全写入可发布前使旧 epoch 失效，且在宿主 mutex 内只能做非阻塞状态检查。hash/data_version/total_changes 或调用方 Boolean 不是这种证明。stamp 的原连接比较摘要不序列化；也不能替代物理 DB 所有权。

安装真实 fence 后仍须完整、未过期的扫描，且无相关屏障，才能 Ready；当前没有 fence，生产默认保持 unknown。不能把测试 fixture 实现接入生产。跨进程/跨数据库独占及 writer epoch 尚未验收。

`scan_existing_store` 保留之前所有未知 barrier；第二次扫描为空、旧行变 verified、callback 消失、取消或用户确认都不能移除已发现的屏障。身份/digest 改变、revision 倒退、容量超限使状态 unknown，旧屏障继续保留。没有 clear、release、mark-done、恢复旧授权或修改 SQLite 的方法。

旧非 T18 未决工作没有物理/共享资源 footprint 证明：同 project 返回 Blocked，其他项目也不能据此推断独立；返回 Unknown。T18 记录若缺 resource claim，也不推断其他资源独立。普通 T18 barrier 按 project、physical root 或共享 resource key 匹配。

这是一套保守启动目录。当前 host 新 intent 与其原生 live execution registry 的关联、自身 intent 不能把自身 dispatch 阻塞的 admission 设计，以及效果未知但原生已停稳后的写入屏障发布，仍需在受管 writer/executor 接线时完成；不能通过全量频繁扫描然后自动放行模拟完成。

## main 所需最小声明补丁（本轮没有应用）

根据 main 当前内容去重后，只补这些声明；无需暴露 RunStore.db 或其他私有方法。

```diff
--- a/apps/desktop/src-tauri/src/local_run_store/mod.rs
+++ b/apps/desktop/src-tauri/src/local_run_store/mod.rs
@@
 mod sqlite;
+pub mod effect_reconciliation;
```

在既有 `effect_reconciliation.rs` 中添加子模块声明，必须是它的子模块，以复用当前私有 validator/gate 逻辑：

```diff
--- a/apps/desktop/src-tauri/src/local_run_store/effect_reconciliation.rs
+++ b/apps/desktop/src-tauri/src/local_run_store/effect_reconciliation.rs
@@
+#[path = "runtime_host_catalog_reader.rs"]
+pub(crate) mod runtime_host_catalog_reader;
```

原生中央声明：

```rust
#[cfg(windows)]
mod runtime_host_recovery_catalog;
```

native worker 从已选定的 app-data profile 得到既有 RunStore，再 scan_existing_store；不要因为缺 T18 schema 而在扫描里自动 open_effect_journal 建空表。`report()` 是只读 native 元数据接口，main 可按当前权限接入展示，界面不能传回“完成”数据或 fence。既有 RuntimeHost 六命令与 TS contract 不必改。

## 两处 P2 的实际修复

- enqueue 的 root validation 在拿全局 mutex 前完成。monitor/refresh 与 register_pending 不再重开/遍历真实路径；普通 heartbeat/cancel/status 不会被它们的 root 文件系统校验占住全局锁。
- begin 先在锁内取得原 pending reservation 和准确 root pin，然后释放锁做 root validation。回锁取新的 Instant，重新检查 owner、执行 deadline、cancel、recovery barrier 和当前 phase 后才能 Running。期间取消/到期保持原任务归属；原独占 guard 能证明尚未开始时关闭为 not_started，不能清理已开始工作。
- 保留原 root pin，并新增 native-only `host.invalidate_root(root_object_id)`，供真实 root revoke 边界发送取消通知。它是元数据通知，无路径 I/O、权限恢复、进程终止或 force-release。main 应在原根租约失效边界调用；没有新增 IPC handler 或改变中央命令签名。

第 13 个用例源码使用两个有限合成线程和有超时的 channel：根校验未返回时另一线程执行 heartbeat 并设置已过期 deadline，随后释放校验，要求 begin 拒绝 Running。该用例没有执行；本轮不能声称 P2 已经动态验证。

## 待验证与边界

由集成人在既有 E/G scratch、全局串行、OS 硬内存上限、超时下运行：先只编译已注册这几个子模块的轻量 native harness，复用 serde/serde_json/sha2/getrandom 缓存；然后过滤 `runtime_host_service::tests`（13 个），单测试线程。再增加真实临时 SQLite fixture 覆盖缺 schema、v1、空 v2、未知跨页、最新 gate/event 缺失、inCallback、旧 legacy unknown、损坏、取消/预算和第二次空扫描不清屏障。

没有执行任何这些验证；没有读取真实 DB、UE 或 API；没有跨进程/host kill/断电恢复证据。数据库 native writer fence、正向生产准入及 current-run 自身 intent 的接线仍未完成。默认 unknown 是明确保留的缺口，不是已完成生产恢复。

本执行会话累计工作轮已过首段交接的约 28 轮；本轮完整交接后，下一段新增工作请轮换新执行会话，避免长线程继续扩展。
