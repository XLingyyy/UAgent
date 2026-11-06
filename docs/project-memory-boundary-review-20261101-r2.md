# 项目记忆静态边界复核 r2（2026-11-01）

状态：已修正专属源码；没有执行测试、类型检查、构建、应用或真实请求。测试源码现为36项，动态通过数仍为0。本作者没有编辑中央入口、共享 schema/mod、runtime 根导出、会话管理、Cargo 或保护器，也没有删除文件或用户数据。

## 有证据的问题与变更

| 文件/位置 | r1 的具体触发条件 | r2 改动 |
| --- | --- | --- |
| ProjectMemoryPanel.tsx 的表单与 save/edit/mutate/confirm | A 草稿留在 React state，项目切到 B 的首个 commit 先发生、passive effect 尚未清空；异步 capture 回来时自定义 Port 还可能忽略 AbortSignal | 以 projectId+port 绑定 viewOwner，首个新项目 commit 隐藏旧表单；写入口和来源 capture 等待后重新检查归属/取消，阻止旧草稿发到另一项目；回包项目身份再次核对 |
| selection.ts 的 check/beforeSend | 只在 beforeSend 开始检查到期，await get/validate 期间可能到期 | 每次检查同时验证 AbortSignal、live lease 和安全整数 expiresAt；每次异步等待后与最终返回前复核，到期点用 >= 拒绝 |
| native-project-memory.ts 的 list 与 context 分页 | 页内顺序或 afterId 回退未充分拒绝，可能静默跳过记录；UTF-16 顺序与 SQLite 非 BMP ID 顺序不同 | 共用 Unicode scalar 比较器，拒绝页内重复/倒序、游标回退、非满页却声称还有下一页；ID 拒绝孤立 surrogate，与 Rust UTF-8 ID 对齐 |
| selection.ts/budget.ts | 空记忆目录时31条基础消息未显式拒绝；预算辅助函数可接受非有限/超范围值 | 即使无记忆也限制30条基础消息；预算检查安全整数1..24576；保留最终消息数组 JSON 的 UTF-8 逐字节计算 |
| budget.ts 的消息位置预留 | 即使字节足够，基础上下文已30条时记忆仍会被旧历史挤掉 | 仅移除最早可选历史对，保留原始记录索引、关键约束和工具组，重算Context map及解释；补充2项测试源码 |
| native-project-memory.ts 的 create/replace 回包 | 同id/revision的错误正文或 visibility 回包仍可能被当作此次保存成功 | 比对完整已提交内容字段，包括正文、可见范围、分享路径、来源、origin、readAt，未匹配不报成功 |
| selection.ts 的外项目 omitted | 正文未发送，但 omitted 可能带另一项目的id/revision；重复条目也可能绕过红化 | 外项目一律用通用占位 id、revision 0 说明原因，不在本项目解释中暴露外项目标识 |
| 模块注释与接线说明 | “发送前复核会阻止所有竞争”容易被误读为整个产品已具备保证 | 明确本模块是逐条复核函数与CAS存储leaf，不提供中央owner/fence或最终派发原子性；未接入的保证保持待完成 |
| 原生 retired/markStale 测试 | 原有测试未直接断言停用后的正文/来源仍可重读、与CAS失效竞争的保留 | 新增测试源码：旧expectedRevision不能覆盖新编辑；stale与retired保留正文/来源；目录仍有同一条记录 |

上述修改均有对应测试源码，但此处仅报告静态实现，不能据此写“动态验收通过”。

## 模块自身能提供的边界

- UI 新增默认 private；create/replace 无论 origin 是 user/model/session 都只能生成 pending。对模型推测没有自动确认或自动提升。
- visibility=project 仅表示可参与选择，不代表分享授权。条目的全部 sharePaths 与 sourceRefs 路径仍须同时满足当前 readPrefixes/sharePrefixes。空路径代表项目根，只能在全项目范围明确允许时通过。
- 私有内容在来源复核之前即排除，避免为了发送准备去检查无须发送的私有来源；任务外的 UI 元数据检查仍是本地读取。
- 来源引用与版本、用户确认、原会话来源均为描述性数据；本模块不保存或恢复 scope/rootRef/Key/执行票据。自由文本 body 也不是秘密检测器：用户主动填写的敏感正文仍需要私有/显式分享和当前出站授权，不能宣称已自动脱敏。
- SQLite BEGIN IMMEDIATE + expectedRevision 保护单条修改的丢失更新；duplicate ID 明确冲突。自动 markStale 只针对所见修订，冲突时保留新修订，不重试覆盖。
- 事实无来源不能被原生确认；来源缺失或版本变化在选择与发送前重新核对。发现变化会通过同一Port尝试CAS写入stale；IO/其他拒绝不会被吞掉后继续发送。
- retired 只更新已有行的 validity/revision/payload，保留停用时当前正文、来源与确认数据；无 SQL DELETE、文件删除、VACUUM 或清理流程。编辑会替换当前记忆内容，不提供旧记忆全文的版本档案；原会话/消息记录完全未改动。停用不提供数据擦除语义。

## 明确依赖中央的保证（本模块未实现/未动态核查）

1. 同一持久 store 的所有打开、迁移、普通档案提交、legacy import、memory create/update 都必须受同一个 managed writer owner/fence 约束。四个 pure handler 接受 &RunStore 本身不证明 fence 已持有；SQLite 的写事务也不等于 Runtime Host 生命周期隔离。中央未就绪时必须拒绝生产写入，不能临时独立 RunStore::open。
2. 中央注册IPC前验证当前桌面调用者、真实已登记项目与当前owner。create/replace/confirm 不能注册为模型可自行调用的工具。confirmation.kind=user 仅记录一次确认动作，不是人类意图或权限的密码学证明；pure handler 不核验UI手势。
3. prepare 的 isCurrent 必须重新核对真实授权的项目/root、会话/Provider/凭证代次与当前出站范围；不能是静态 true，也不能只比较 projectId。中央必须把 prepare 的 messages 用进真实请求，在批准后调用并等待 beforeSend，任何拒绝（包括原生 StoreError 对象）均阻止发送并进入暂停/不可用状态。
4. 逐条 get/validate 跨 await，不是整批记忆快照事务。A条检查通过后、B条检查等待中，A仍可能被另一个合法UI编辑或停用；最后一次检查与实际transport派发之间也仍有窗口。中央需把本次选中记忆的修订/项目代次绑定到最终发送的共享读屏障或等效派发核验，在完成该保证前不能声称“并发编辑后旧body绝不发送”。仅有每条SQL写锁不足以提供该保证。外部文件源在最后一次元数据检查后变化也不能由该leaf原子阻止。
5. UI sourceEpoch、原生source检查与模型transport应使用同一真实project/root代次；onMemorySelection只说明准备过的选择，不能冒称请求已发送。旧项目/旧任务回调应由中央自己的lease代次再次丢弃。
6. v2→v3 迁移、真实IPC、重启读取、实际请求捕获及writer-fence竞争仍需中央用现有OS Job保护器统一串行验收。本次不把源码存在或renderer显示计为这些保证完成。

## 测试源码与交付证据

现有文件：selection.test.ts 14项；budget.test.ts 2项；coordinator-memory.test.ts 2项；native-project-memory.test.ts 7项；ProjectMemoryPanel.test.tsx 7项；project_memory_tests.rs 4项。总计36项，全部未在本次运行。

首次交付清单 project-memory-static-manifest-20261101.json 保持原样，记录r1哈希，不再冒充当前哈希。新增 project-memory-static-manifest-20261101-r2.json 记录当前最终文件哈希、相对r1的改变及剩余中央保证。中央最小声明/迁移补丁未被本作者应用；首次交付时的 git apply --check 退出0是历史静态证据，不代替中央当前接入状态。
