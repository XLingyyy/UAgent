# 项目记忆 r4：M5 panic 与回滚失败叠加

依据 evidence/independent-plan-and-guard-review-20261101/project-memory-r3-review.md。本作者仅静态修改项目记忆预算leaf、测试源码及本文/交接说明；没有运行SQL、测试、类型检查、构建、应用或API，没有删除文件或修改中央文件。

## 最小源码修复

with_project_memory_budget 现在用内部 catch_unwind 包住 work/transaction，外层Guard仍存活。若work panic，既有事务的 Rollback::Drop 先完成；之后才由同一个原始worker执行以下步骤：

1. 解除中断回调和busy等待，防止取消/VM预算再次打断清理。
2. 检查 sqlite3_get_autocommit；若仍有活动事务，只重试一次 ROLLBACK，并核实成功及autocommit。
3. 确认结束后，正常错误仍保留预算错误归因；原始panic通过 resume_unwind 继续交给原调用方。没有将panic伪装成成功。
4. 不能确认（包括补充清理本身panic）时，先调用原Db持有的 ConnectionLease.quarantine，再返回 projectMemoryRollback。该动作发生在预算租约/连接gate释放之前，也在原始及清理panic payload可能被销毁之前。外层即使把返回消息改成unavailable/outcomeUnknown，也不会撤销这个单向隔离标志。

这修复了r3“panic直接跳过末尾确认”的控制流。正常错误、取消、VM/busy限额和M4上下文选择保持原行为。适用可解栈panic；进程abort与不能抢占的OS IO仍由原worker/进程保护与恢复机制处理，不能据此声称运行时全部验证通过。

## 最小故障注入测试源码

sqlite_project_memory_budget_tests.rs新增：

panic_with_initial_rollback_failure_retries_and_confirms_before_connection_reuse

用内存SQLite，先做一条部分UPDATE，再panic；cfg(test)专用authorizer只拒绝第一次ROLLBACK，迫使旧事务guard的首次清理失败。源码断言：

- 确有一次拒绝，合计两次ROLLBACK尝试；
- 外层保留原panic，未返回成功；
- statement已释放、autocommit为1、原busy/length已恢复；
- 数据仍为before，并可在新预算操作中重读。

该反例在r3会绕过重试/确认，不能满足这些断言。此处没有注入生产DB，没有文件清理，没有安装生产authorizer。永久回滚失败的生产分支直接在原连接lease上单向quarantine；本测试选择复核要求允许的“原worker重试并确认后才可复用”路径，未为了测试而重置全局隔离标志。

累计50项测试源码（SQL预算8项，其余42项）；本作者运行数0。

## 中央接点

**本轮无需新增中央补丁。** 当前只读快照已有以下API/保证，本模块直接使用，没有另造可被renderer控制的隔离对象：

- Db拥有原ConnectionLease，ConnectionLease.quarantine设置原database_owner的单向AtomicBool；
- available、ConnectionLease.check、普通Db.prepare和native owner的is_current检查同一隔离状态；
- 中央已有projectMemoryRollback处理，并另有panic/Drop隔离兜底；这些中央改动由中央作者负责，本作者未编辑，也不计作本模块新实现；
- ROLLBACK允许在撤销之后于原worker执行，连接仍由原线程关闭。不得将现有quarantine API换成no-op或跨线程close。

r3的SQLite共同handler租约、实际cancel/deadline与contextPlan接线要求继续有效；r3补丁是历史合入材料，不要对已接入且继续修改的中央文件盲目重放。

P1整批发送屏障仍归中央。r4只修M5，不提供native outbound seal或恢复准入，也不把中央owner入口/源码存在计作动态验收。

最终文件hash及相对r3差异见 project-memory-static-manifest-20261101-r4.json；r1/r2/r3清单原样保留。
