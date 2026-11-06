# 中央记忆屏障接线 r1：源码冻结与待验证边界

状态：中央源码已实施并冻结，尚未编译、运行测试、显示原生确认框或发送请求。生产记忆出站、非 fixture 调查和 RuntimeHost 恢复准入仍关闭。已有六项 Store/十九项故障成功证据属于此前冻结源码，不能代验本次修改。

## 本轮中央实施

- managed_run_store：work 不再在 apply 中回复。原 worker 消费并释放同一 RunStore/ConnectionLease 和 OperationScope 后才调用完成闭包；结果在原生私有槽中暂存。完成前后、异步接收恢复后都复核取消、截止时间、window/domain/owner。新增不可发送、不可克隆/序列化的 ReleasedStoreDomain 借用见证，专用 with_native_memory_admission 在真实释放后把 PendingMemoryPermit 提升成 ReadyMemoryPermit。
- SQL 预算：真实 COMMIT/rollback/autocommit 确认后，成功分支再次 execution.check。失败保留原失败。新增一个仅测试构建存在的确定性清理后取消钩子及原断言；不作为生产权限。
- 根重信任：begin_project_update 在同一 broker 锁内先设置 updating、换不可复用 Arc 代次并推进 checked u64 观察计数，再枚举并撤销 run/记忆授权。RAII guard 覆盖 lib.rs 实际根替换；末次登记检查同一代次、原 root Arc、窗口代次及原 profile。跨更新或 A→B→A 的迟到登记被拒绝。撤销时先释放 broker，再取得 session/monitor 锁，避免反向持锁。
- 活 read/share 授权：新增 native_responses_scope_authority.rs。只有实际本地 WebviewWindow 原文档 grant、当前 live 非保存凭据 profile、当前受信根及原生 MessageBox YES（默认 NO）才能记录授权；无 renderer true、fixture issuer、checkpoint/存档恢复。原生确认未实际调用。权限可先于 run；B 的 check_current 必须再绑定同一个已登记的非聊天 native run，没有它恒拒绝。真实 RuntimeHost 准入没有被模拟，旧 fixture-only 检查仍在。
- 同句柄元数据：trusted_root_handle 的 metadata_observation 从原文件句柄取得 std Metadata 和真正 BY_HANDLE_FILE_INFORMATION，保留独立完整 FileId128。project_source_versions::bound_file_metadata_version(&BoundReadFile) 复用原 metadata_version，不从 path_hint 重新打开、不截断128位身份。memory_source_path_allowed 复用原敏感路径策略。
- A 私有挂为 project_memory::dispatch；B 两模块私有挂为 native_responses_commands 子模块。未更改 A/B 作者源码。B 要求的 grant、metadata 和原 body Arc 接口均已提供。
- transport：新增 native_memory_admission.rs。preflight 与真实源复核在 SQL 外；A 的活 IMMEDIATE 闭包内核对完整原行 slice、当前全行、同一 grant/root/generation、prepared body Arc/SHA、approval/lease/session 并唯一消费批准，置 mayHaveBeenSent。原 transport 保留在原 sender；SQL worker 不调用网络。Pending 只有借用原 worker 释放见证并重新检查后才能变 Ready；Ready 只能消费一次，绑定原 preflight transport，使用原正文/凭据调用同一个发送实现。旧 dispatch 遇 memory marker/绑定请求拒绝，不可失败后 fallback。源码未被动态验证。

最终锁内只做受限内存/clock/atomic 比较。静态自查已移除 Weak<Run>::upgrade：最后一个 Run Arc 的析构可能触发 monitor 撤销，因此最终锁只读已绑定 session 身份、共享 alive Arc 和期限。真正的 run/registry/文件/SQL 检查在锁外；不得在 L 内改回 check_current 或调用可阻塞回调。

## 关键接口

- NativeMemoryReadShareGrant：project_id、run_id、conversation_id、read_prefixes、share_prefixes、max_context_bytes、root_handle、project_generation、root_generation；check_current 做锁外真实复核，check_liveness/is_bound_to 只做内存检查。构造与 attach_native_run 私有，NativeStoreWindowGrant 不接受 DTO。
- 新原生 IPC：authorize_native_project_memory_scope、revoke_native_project_memory_scope 已列入 handler。前者是独立的原生范围授权阶段，不是发送/恢复许可。native_memory_scope 需要完整已登记 run；pending_native_memory_scope 仅给未来新 run 注册过程内部使用，不能构造批次或发送。
- PreparedRequest::body_arc / attach_memory；approve 保存同一个 BoundMemoryRequest Arc。
- NativeSession::memory_preflight 返回 MemoryPreflight 和留在原线程的 MemoryTransport；admit_memory 接收 A::VerifiedMemoryBatch，返回不可克隆的 PendingMemoryPermit。
- ManagedRunStoreState::with_native_memory_admission 接收实际 Store 闭包，返回 ReadyMemoryPermit；其 send 消费原 MemoryTransport。

## 准确未完成项

1. C 的完整 select/prepare/approve/dispatch/cancel IPC DTO 及已有 native-responses-session/coordinator/UI 串接尚未实现。C 的 companion 不能仅因本轮新增几个 Rust 类型就启用。
2. 生产非 fixture native run 仍被 responses_investigation_fixture_only 拒绝。新的原生范围授权没有替代真实 RuntimeHost owner/ticket/恢复准入，也未调用 attach_native_run；因此当前没有任何真实 B 批次可通过完整 check_current。接下来的 live run builder 必须使用已批准原授权、原窗口/项目屏障及真实 host 准入，不能删掉 fixture guard 就声称闭环。
3. transport 的私有能力路径已写出，但现有 Responses sender worker 尚未选择它；普通发送路径保持原行为，记忆请求拒绝。需要中央真实 sender 在原 vault 外层内完成 preflight→专用 owner→原 transport 消费，并贯通真实 request cancellation/terminal 状态。不能把 Pending 交普通 IPC 或仅回复 scheduled 充当发送成功。
4. 本轮12个中央源文件及 A/B 挂载均未经 Rust 类型检查。新增中央7个测试源码未跑；A7组、B17项、C31项也不能相加为通过。需要当前字节独审后优先窄类型检查/真实目标测试，不能继续以增加静态模块代替验证。
5. 新完整 EXE、真实 UI、窗口/重启、真实 provider/TLS、永久 rollback 失败等仍未验。本轮没有启动负载；未添加/扩展 guard、资源 profile、降系统余量或删除文件。

## 验证与建议下一步

已执行 git diff --check（中央旧文件限定范围），退出0；Git仅提示两个原有 LF 文件将来可能按配置转 CRLF，未进行 Git 重写。此检查只证明补丁空白格式，不证明 Rust 语法/类型或行为。

下一步先独审本中央冻结清单和 A/B/C 已冻结接口，再创建真实生产模块的最小类型/行为执行包。旧局部 harness 的输入哈希已过期，不得直接重跑或复用旧“通过”结论。应明确 native transport 现在依赖真实 native broker/授权类型；不得通过 stub 被测 grant/owner 来冒称集成检查。若完整 Tauri 类型目标需要现有更高预算，fresh RAM/commit gate 不足就记为未启动，同时可验证 A 真 Store核心和 C 两个前端文件的独立真实范围，不把这些当整条 native 链通过。
