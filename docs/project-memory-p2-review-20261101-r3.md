# 项目记忆 r3：M3/M4 静态修复与中央接线

依据 evidence/independent-plan-and-guard-review-20261101/project-memory-r2-review.md。此轮只修改项目记忆专属源码/测试源码和文档，未修改中央文件或会话管理作者文件，未执行SQL、测试、类型检查、构建、应用或API，未删除文件。P1的整批发送屏障、真实owner与启用顺序仍归中央，不在本模块完成度内。

## M3：真正约束正在执行的SQL

- project_memory.rs 新增不序列化的 MemoryExecution<'a>，借用原 managed worker 的 &AtomicBool 与 Instant deadline；本模块将截止点收紧为 min(owner deadline, now+250ms)，VM指令上限250000。renderer输入不包含这些控制值。
- 四个 project_memory_commands 函数现要求 (store, input, cancelled, deadline)。不得复制当前flag值或新建一个永不取消的AtomicBool来满足签名；必须转发同一 with_store worker 实参。
- 新 sqlite_project_memory_budget.rs 是 sqlite.rs 的child，复用既有SQLite RAII/progress设计，但使用可借用真实worker取消flag的控制对象。每100 VM指令复核；busy回调在最多25次、每次1ms的累计等待前后复核取消/截止点，且不放宽较小的既有busy_timeout；SQL value长度上限64KiB且不放宽更严格旧值。C回调只走不分配错误对象的stop_reason路径。
- create/update 的整个工作只安装一组预算和一层事务。更新内读取记录使用私有不嵌套的helper。错误/取消/VM预算用尽先卸下中断回调，再让事务COMMIT/ROLLBACK收尾，避免取消回调中断ROLLBACK。完成后检查autocommit；无法确认回滚返回 projectMemoryRollback，中央owner必须在原worker隔离该连接，不能继续派发或跨线程关闭它。
- 正常/失败/unwind后RAII释放statement关联、回调和连接租约，并恢复先前length/busy配置。这是源码设计和测试断言，不是本次运行成功证据；物理磁盘IO/fsync的硬时限仍须OS保护器与真实owner控制，不夸称250ms能原子抢占所有OS IO。
- 分页改为 project_id=? 和 project_id=? AND id>? 两条固定SQL，移除可空cursor的OR。复合主键与排序形成明确范围查询形状；未执行EXPLAIN，未声称已测具体查询计划。LIMIT约束输出，VM/deadline/progress另外约束执行量，二者不混称。

- 此处读取的是native worker取消源。renderer的AbortSignal只改变本地等待状态，并不自动证明该native flag已置位；应用退出/owner撤销/请求取消如何传到同一flag，由真实owner负责并需动态验收。

### 不覆盖别的SQLite handler

SQLite没有可获取/恢复任意旧progress回调的公开getter，因此不能“保存旧回调指针”或假装同连接可叠装。新child提供连接/worker局部的 !Send ScopedSqlBudgetLease。中央补丁让 history_search、runtime_host_scan、session_catalog 的现有guard与新memory guard都先取得它，再一直持有至handler/settings恢复后；同连接嵌套立即busy，不触碰外层回调。该租约只是handler所有权，不是数据库/项目/执行授权。

**必须合入全部installer租约改动，不能只include新child。** 本作者没有改另外三位所有者的文件；该强制集成点在下面补丁内，新增跨feature嵌套测试会揭示漏合。中央仍须禁止未登记的持久自定义busy/progress安装器绕过这份共同约定。

## M4：只有确实增加采用项才占用基础上下文

- prepareMemoryBudgetedRunContext 默认返回完整 prepareRunContext 结果，不因 projectMemory 选项存在就预留字节或删除旧历史对。只有 reserveForMemory:true 才执行已有的预留算法；中央不得在读目录前传true。
- ProjectMemoryContextPort.prepare 可接收 baseContext:{records,goalMessageIndex}。模块先冻结原始输入，使用完整上下文检查目录/私有/待确认/事实来源/出站范围/来源有效性。
- 只有某项通过上述筛选、单纯因budget省略时，才用原始记录尝试预留；只有新尝试实际增加采用的id/revision，才保留预留。否则重新按完整上下文选择并返回原完整基础plan。空目录、全private/pending/越范围/缺来源/stale，或条目即使预留仍无法容纳时，都不会牺牲历史。
- 已能在完整上下文中放入的全部记忆直接采用，不为了无收益的预留削减历史。
- 返回的 contextPlan 是最终基础上下文plan（不把插入记忆伪装成原始历史索引）。中央必须采用它，重算并重新验证 selectedSources，后续beforeSend也使用这份来源集合。memory.plan.usedBytes仍是最终上下文messages数组JSON的UTF-8字节，不是整个HTTP包的字节。
- 老调用者未提供baseContext时保留输入的完整messages，只在现有余量内选记忆，不隐式删历史。要获得“有效记忆优先于可选旧历史”的能力，中央必须传原始记录/goalMessageIndex并采用返回plan。
- “目录成功读取但无采用项”可以完整回收预留；“owner/SQL/来源检查失败”仍拒绝，不能把错误当空目录，也不能在body批准后悄悄删记忆重发。

## 需中央合入的具体源码接点

docs/project-memory-r3-central-integration.patch 已针对读到的中央快照生成，git apply --check退出0，**未应用**。中央/其他作者若继续改同文件，需要按语义合并，保留未知修改：

1. sqlite.rs include sqlite_project_memory_budget.rs。
2. history_search/runtime_host_scan/session_catalog三个预算guard共用上述连接租约，拒绝嵌套覆盖。
3. lib.rs四个with_store闭包从 |store,_,_| 改为 |store,cancelled,deadline|，调用 commands::method(store,input,cancelled,deadline)。旧两参调用现在会编译失败，不能将它算已接入。
4. RunCoordinator.prepare传 baseContext:{records:this.messages,goalMessageIndex:this.goalMessageIndex}；采用 memory.contextPlan??context.plan，重算selectedSources并await原validateContextSources。补丁保留中央现有的真实transport memory_dispatch_fence_required拦截，不替换P1屏障。

本模块新SQL入口与这四类接线共同完成M3的静态调用链；未合补丁、未做动态验收之前不能标“P2完整验收通过”。

## 为中央P1提供的接口条件（不是本模块已实现）

- 权威批次需至少绑定：当前物理store/owner代次、project/root代次、run/conversation、Provider/credential代次、当前read/share授权代次和到期点、所选id/revision向量与来源stamp、**实际已批准不可变HTTP body的hash**。只有renderer传来的vector/Boolean/plan不能生成授权。
- 在同一原生受管worker的一次一致性读取中核实批次；所有合法memory writer在首次可见更改前撤销旧seal/推进代次，并阻止写入未决期间新seal读取半旧状态。事务回滚可以保守作废seal，后续新任务重新读取。
- 批次seal必须是原生owner掌握的短命、不可持久化执行对象。最终consume须在批准、来源核对、账本/预算reserve等全部await之后，与不可变字节交给transport的交接点由同一小型gate保护；不能只再循环get一次，也不能在全局mutex内跨await持有文件或网络IO。
- beforeSend之后再await budget reserve仍会重开窗口。本模块仍是逐条复核，没有seal/dispatch receipt；中央现有真实provider拦截应保留至真正sender消费屏障。
- owner未安装时，原生能力应明确报告未启用记忆，沿原有无记忆调查路径继续；已经启用或准备/批准过记忆后owner丢失必须拒绝。不得用renderer状态、伪owner、独立RunStore::open或吞错来补齐。
- 外部文件在最后一次原始身份/metadata检查后变化的限制必须单列；记忆revision屏障不等于冻结所有外部文件。证明范围应有核验时间点，而不是“永远最新”。

## 本次新增回归测试源码

- budget.test.ts原2项外新增5项：默认不预留；空/private/pending/越范围/缺来源/stale完整保留；条目过大无收益时回收；实际增加采用项才预留；已可容纳时不削减。
- project_memory_tests.rs原4项外新增1项：32条合成记忆、极小VM预算，分页中断不返回半页，随后同连接可读取。
- sqlite_project_memory_budget_tests.rs新增7项：极小VM预算中断后回滚/恢复、执行中取消、预先到期、panic回滚、同feature嵌套、跨feature共用lease（需中央补丁）、busy回调读取真实flag/deadline。均为内存SQLite合成数据，无真实用户库、无删除。

当前合计49项测试源码；本作者执行数仍为0。最终哈希与相对r2差异见 project-memory-static-manifest-20261101-r3.json，r1/r2清单保持原样供审阅。
