# T17–T19 原生宿主基础交接（2026-10-31）

本切片已静态实现，尚未运行编译、类型检查或用例；未修改生产中央入口。不能据此把 T17 独立 sidecar、T18 跨重启恢复或 T19 跨进程互斥标为完成。当前可交给集成人的是一个应用级原生服务、窄 IPC 和同一套前端适配接口。

任务边界：只写本切片新文件；未改 lib.rs、App.tsx、local_run_store/mod.rs、RunHistoryPanel.tsx、语言入口或 package/workspace 配置。未启动应用、构建、测试、安装、UE、真实 API；未读凭证、生产 DB、旧 EXE，未变更系统设置或发布。

## 文件

工作树绝对根：`E:/Codex/UAgent/2026-10-29/worktrees/credential-vault`。

- `apps/desktop/src-tauri/src/runtime_host_service.rs`：原生 owner、队列、pending 工作登记、断连与原 owner 观察协议。
- `apps/desktop/src-tauri/src/runtime_host_commands.rs`：六个 Tauri 命令，原生 worker 处理。
- `apps/desktop/src-tauri/src/runtime_host_service_tests.rs`：13 个未执行的有限合成协议用例。
- `apps/desktop/web/src/runtime/runtime-host-contract.ts`：与 Rust 字段/状态对应的 DTO 和响应解析。
- `apps/desktop/web/src/runtime/shared-runtime-host-queue.ts`：单例适配器，复用已有 `RunScopeLease`；没有创建第二个 JS RunResourceQueue。
- 本文：接线、验证建议与未完成项。

## 服务与状态语义

`RuntimeHostService` 的 clone 共享同一 `Arc<Mutex<Inner>>`。整个 Tauri 应用只管理一个服务实例，全部窗口和 run 都通过它申请模型槽/资源。全应用最多三个受管原生模型 transport；不是远程模型服务端的计算配额。owner 最多 128，含保留任务的 job 最多 256。结束记录五分钟后在后续准入时清理；未知任务没有 TTL 强清。

`connect(window.label(), identity)` 由 Tauri 注入真实窗口标签，native 生成 host generation、owner ID、ticket/execution correlation。完整 run/scope/project/root/conversation/provider/model 描述不可改；它们是相关性数据，不是执行权限。原生发送器仍须校验真实当前 run scope、root、provider 配置/凭证版本和各自准确批准。不得把任何 DTO 反序列化成这些权限。

owner lease 固定 15 秒；前端每五秒检查原 `RunScopeLease.isCurrent()` 并发心跳。原生 monitor 每 250ms 检查到期/队列及执行期限，线程栈 256KiB。显式断连、窗口销毁、owner 到期、host close 都撤销新派发，并把取消请求送到原 guard 的 `Arc<AtomicBool>`。前端失败不会自动续连、恢复旧 scope 或重发动作。

| phase | 含义 | 资源/模型槽 |
| --- | --- | --- |
| queued | 排队；包括 monitor / 恢复目录尚不可用 | 未占用 |
| admitted | 已原子占用，尚未发出 native work guard | 占用 |
| handoff_pending | 原生 pending 登记已提交，worker 可尚未被 poll | 占用 |
| running | 原 guard 通过最后一次检查并开始真实工作 | 占用 |
| retained | 取消/断连/超时/回调不明或外部停稳未知 | 保留 |
| finished | 原 guard 确认未开始，或真实回调已结且执行停稳 | 释放；保留描述 |

`callbackSettled`、`executionObservation`、`holdsResources` 分开。模型 job 的 `holdsResources` 包括模型槽，因此 resources 数组为空时它也可能为 true。已完成或取消的 UI Promise 不能写入 callbackSettled 或 quiescent；没有对应 IPC。

外部操作必须使用原生 `NativeResourceBinding::from_verified_root`，持有实际 TrustedRootHandle 和其 volume/file ID；额外 engine/editor 资源 key 由原生适配器规范化选择。整项目、同物理 root 以及相同共享 key 保守互斥，较老冲突 waiter 不被插队。界面不能提交任意资源 claim。真正停稳后释放本队列持有的 root handle；描述保留供查询。

## 中央原生接线（集成人执行，本切片没有应用）

1. `lib.rs` 增加 `mod runtime_host_service; mod runtime_host_commands;`。如果 trusted_root_handle 原本未声明，按现有模块接线注册一次，不重复实现。
2. 在 `Builder::setup` 只创建一次 `RuntimeHostService::new()?`；调用一次 `host.start_monitor()?`，把返回的 `RuntimeHostMonitor` 保存在应用 managed state，并 manage 同一个 host。不要把 monitor 局部变量丢在 setup 结尾，Drop 会主动关闭准入。管理失败/monitor 启动失败要返回错误，不降级成无监视模式。
3. 加入以下 invoke handler：
   - `runtime_host_commands::connect_runtime_host_owner`
   - `runtime_host_commands::heartbeat_runtime_host_owner`
   - `runtime_host_commands::get_runtime_host_status`
   - `runtime_host_commands::disconnect_runtime_host_owner`
   - `runtime_host_commands::enqueue_runtime_host_model_job`
   - `runtime_host_commands::cancel_runtime_host_job`
4. 在现有 native `WindowEvent::Destroyed` 分支，取得 managed host 后调用 `disconnect_window(window.label())`。在 renderer 替换前显式撤销旧 owner；应用退出调用 `host.close()`。不要通过 renderer 提供窗口标签。
5. 在 T18 完整扫描后安装一次 `Arc<dyn RecoveryCatalog>`；它只查预加载内存状态，不能在队列锁里执行 SQLite/I/O 或回调 host。只有扫描全部相关项目、每页 pending catalog、正确 dispatch fence 且相关资源无未解屏障时，才返回 Ready。部分/损坏/旧 schema/无法确认全部页面必须 Unknown。没有安装目录时默认 recovery_pending；monitor 不存在时默认 monitor_unavailable；不存在自动“空目录”适配器。
6. 原生模型/UE 发送器接收 ticket 时，校验它确实对应本次真实 run、provider/model、step、physical root、批准与请求；校验失败不得派发。注册/心跳本身不代替此检查。

关键原生 API：

```rust
host.enqueue_model(window_label, ModelJobInput { /* owner + finite times */ })
host.enqueue_operation(window_label, NativeOperationInput { /* native root + original observer */ })
let mut registration = host.register_pending(window_label, &ticket)?;
// Above must occur BEFORE a Future/thread/channel item can own pending work.
// Move registration into the actual native worker; do not finish it on Future creation.
registration.begin()?; // final owner/deadline/root/recovery check; sender's own approvals still required
let cancel = registration.cancellation();
// actual existing sender/executor runs and fully consumes its owned callback/stream
registration.finish(actual_callback_succeeded)?;
// External operation remains retained until original observer confirms quiescent:
host.reconcile(&ticket)?;
```

`register_pending` 和 `begin` 都重新检查恢复屏障。路径 I/O 仅在锁外保留原 root pin 后执行；begin 回锁重取时间并重查 owner/执行期限/cancel/屏障才提交 Running。普通 monitor/refresh 不触发路径 I/O，真实 root revoke 边界须调用 native-only `host.invalidate_root(rootObjectId)` 请求取消。guard 不能 clone/反序列化；重复 claim 拒绝。真实工作未开始的原 guard 可消费 `finish_not_started()`；取消后 `begin` 若能证明这个唯一 guard 尚未开始，也关闭为未开始。已开始后不能用它强清。guard drop、panic、丢弃 unpolled Future、未记录真实 callback 结束均留下 unknown / callback unsettled；外部 observer 即使声称 quiet 也不能越过 unsettled。

## T18 顺序与观察边界

先为同一原生 ticket/executionId 建立 intent、完整 OperationOwner/physical root/claims，再依照 T18 的 prepare / mark_may_have_been_sent / dispatch_once。dispatch_once 的 `FnOnce -> ()` 回调只有在所有 pending work 已在本服务登记且真实 worker 已接受该 guard 时才能返回。调度失败必须保留原 guard，只有独占 guard 确认从未派发时才 finish_not_started；不能因为 spawn 返回错误而强清已经丢失的任务。

T18 的同步 handoff callback 返回与实际工作 callback 结束不是同一事件。T18 settlement、原生 queue registration 和 worker settlement 必须分别记录。不能写 `dispatch_once(... |_| { async { ... }; })` 然后把创建 Future 当作交接完成。

`ReadOnlyExecutionObserver` 捕获原 adapter/原 owner，查询包括 pending work 的完整原生执行。它只可查受管 execution 状态；如果还需访问用户目标或 Editor，则必须在既有原生授权边界内检查当前新鲜只读权限，缺失返回 unknown，不恢复旧权限。PID 不存在、transport 关闭、进程退出码或文件散列相等不单独构成原 owner 的停稳/效果归因。

reconcile 在队列锁外观察，只允许一个并发原 owner observation，传入一秒 deadline；超时返回被丢为 unknown，observer panic 被隔离。observer 自身必须使用有界 I/O。不能靠本接口抢占阻塞原生调用；阻塞时仍保留任务/资源。只有真实 callbackSettled 且原 observer 给出新鲜 quiescent 才释放外部 lane；效果是否完成另由 T18 判断，其恢复写屏障仍可阻止后续任务。

## 前端接线

在应用 bootstrap 解析一次 `getSharedRuntimeHostQueue()`，把同一对象和同一已存在 RunScopeLease 交给所有协调器。组件不构造 queue，也不在普通 unmount 时 dispose 全局服务。

`await shared.connect(lease)` 返回一个 owner；`reserveModel` 只产生有界排队 ticket。`waitForAdmission(signal)` 返回 admitted 状态后，把 `ticket.nativeRef` 与真实请求一起交给已经接入上述原生 guard 的发送器。禁止在 guard 尚未接入的旧 sender 上套一层 UI reservation 后宣称生产调度已完成。前端没有“execute callback 后自行 release”的接口。

host snapshot 提供 connected、recoveryCatalogInstalled、monitorActive、全部本 owner job 和 pending/retained/unknown 详情，以及不泄露其他窗口身份的 host-wide pendingExecutions / unknownExecutions 计数；UI 应保留未知状态。IPC 失败、generation 改变、旧 ticket 查不到均报错，不推断已完成；不自动重试写操作或把旧 lease 接回新宿主。

## 最小验证建议（本切片没有执行）

由集成人在现有 OS 硬内存上限、超时、全局串行保护下运行。不要并发启动下列命令或省略 E/G 环境设置；scratch、缓存、日志和 target 全部留在 E/G。

第一步只编译 scratch harness，引用本工作树 `runtime_host_service.rs` 和 `trusted_root_handle.rs`，依赖只需缓存中的 serde(derive)、serde_json、getrandom 0.2.17；避免引入整个 Tauri/UI/UE。scratch lib 以绝对 `#[path = "E:/.../src/<module>.rs"]` 声明两个模块。不要改变生产 Cargo.toml/workspace。

在该 scratch Cargo.toml 已由集成人生成后，守护器 payload 的最小命令为：

```powershell
cargo test --offline --manifest-path <E:/unique-scratch/Cargo.toml> --lib runtime_host_service::tests -- --test-threads=1
```

将 `CARGO_BUILD_JOBS=1`，只执行本测试过滤器。13 个用例源码覆盖：默认阻塞、window/generation 绑定、跨窗口三槽共享、unpolled registration 丢失、pending 可见性、开始前取消、断连保留、原生 callback 与 external quiet 分离、observer 无法越过 unsettled、执行期限、两次恢复屏障检查、拒绝夹带权限字段。全为合成协议；没有线程 monitor 或真实执行验收。

第二步才在同一串行 guard 中做前端定点类型检查，至少包含两个新 TS 文件及其真实 import。若采用现有完整 web tsconfig，必须记录这是更宽范围并遵守集成人已有资源预算。本切片不提供测试已通过的数字。

第三步是隔离 native IPC 接线验收：同一 host 两窗口、同 root 两 owner、断连时未开始/已开始、callback 已回而 observer unknown、目录 pending/损坏、旧 generation ticket。再为一个真实受保护 adapter 验证 pending 注册与 T18 fence。不得先用真实 API、用户 DB、UE 或旧 EXE 填补这些证据。

## 尚未完成

- 中央 mod/handler/state/lifecycle、App/coordinator/native sender ticket 消费均由集成人接线；本切片没有激活。
- `RecoveryCatalog` 是生产接入接口，没有替代 T18 扫描器；默认阻塞是刻意保守行为，不能用 always-Ready fixture 接到生产。
- 没有实现具体 UE/构建 observer 或生产效果 observer；原实现若不能证明原 owner + pending + native execution quiescent，继续 unknown。
- 当前 registry 是单个 desktop native 进程内的共享内存；独立 sidecar、第二个 desktop 进程间锁、host crash/power loss 持久登记/接管、跨重启自动恢复尚未完成。
- 编译/类型/13 用例及 native IPC 均待集成人在受保护条件下验证；没有真实 API/UE/生产恢复结论。

首段交接约 28 工作轮；后续续派已超过此计数，下一次扩项请使用新执行会话。结束时将完整路径与上述缺口交给集成人，不把静态实现计为产品验收。


