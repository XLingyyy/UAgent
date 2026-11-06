# 目标驱动的有限源码变更：2026-11-06

本切片在后台文件调查中增加可选的源码提案。用户给出目标，真实模型读取源码并提出修改；原生层生成精确差异。调查完成后单独审阅、原生批准并写入，随后可通过现有 UE 构建入口验证。无需先制造失败构建或借用编译诊断。

## 当前流程与范围

1. 选择已信任项目和临时 DeepSeek 会话，在「后台文件调查」启用「生成源码修改提案」。原生确认仍绑定本次读取、外发范围、4 次模型请求、8 次工具调用和 2 分钟期限。
2. 模型须先完整读取每个目标文件，再调用 `project_propose_source_change`。参数为 `edits: [{path, oldText, newText}]`，每个文件一个精确、唯一的文本替换；空匹配、缺失匹配、重复或重叠匹配均拒绝。
3. 原生层在再次打开文件前核对它曾在本任务范围内完整读取，再验证来源证据、完整内容与文件身份，从原生快照派生完整修改后内容。提案只暂存在应用内，不写项目文件。
4. 仅成功结束且原生操作已返回的任务可以申请写入。界面展示差异和可展开的完整前后内容；原生确认绑定同一计划摘要和文件列表。提案从准备起有效 10 分钟，取出后单次使用，取消批准或失败不重放旧授权。
5. 写入使用新任务来源 `task {runId, scopeId, planVersion}`，复用原有源码事务的身份固定、整批预检、持久化 before 备份、逐文件回执和原生效果日志。无需伪造 `diagnostic`。旧构建修复记录继续使用原 `diagnostic` 字段，未增加空 `task` 字段。
6. 写入通过独立的任务级存储授权和共享原生调度进入，资源为原项目的 `file-write`；与同项目构建互斥。文件写入前后的存储、根目录和宿主有效性继续核对。模型结束、文件 applied 和构建成功是三个分别记录的结果。

支持范围仍有限：已有 `Source/` 下的 `.cpp`、`.h`、`.hpp`、`.Build.cs`，最多 8 个文件，最终替换文件内容合计最多 4096 字节。当前后台读取每次受 8192 字节工具回执预算限制，原始文本最多 1115 字节、80 行；截断文件不能生成提案。未开放新建、删除、任意目录写入、Shell 或自动构建重试。暂停修改要求会清除旧提案，原任务预算和期限保持不变。

方案参考了 [Anthropic 文本编辑工具的唯一精确替换约定](https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool)，未引入其协议或依赖。原生文件身份与共享策略沿用现有实现，与 [Windows 文件打开和共享约束](https://learn.microsoft.com/en-us/windows/desktop/FileIO/creating-and-opening-files)一致。源码文件不属于 SQLite 的数据库事务，因此保留独立 before 备份及效果核对，不把 [SQLite 原子提交](https://www.sqlite.org/atomiccommit.html)扩大为任意文件写入的原子性保证。

## 本轮验证

- 原生源码事务 26 项通过，包含新任务来源绑定、备份/逆向恢复核心和旧构建预览序列化兼容；已有冲突、部分写入、取消、来源变更及恢复测试继续通过。
- 原生源码写入调度 1 项通过：必须经过持久化交接，同项目构建不能绕过写入占用。
- 唯一替换 2 项通过：精确小改动保持 CRLF，空、缺失、重复和重叠匹配均拒绝。
- 后台面板及源码审阅 UI 4 项通过：先审阅，再以原生摘要请求写入；未确认结果不显示成功或构建通过。
- 当前应用入口类型检查、前端与原生构建通过。全仓库未重复测试。

## 真实 DeepSeek 与 UE 5.8.4 验收

项目为既有 Test01 独立副本，原 `G:/UnrealEngine/Test01` 未修改。副本的受控模块预先含两处错误：头文件 `4O` 和 CPP 的 `BasValue`。

| 阶段 | 运行 ID | 结果 |
| --- | --- | --- |
| 模型读取及提案 | `run-a8b5a7596359b973941f499934c4e6c1` | succeeded，3 次模型请求、2 次读取、1 次提案调用 |
| 单独批准写入 | `b2c4b2510d71673b262274ef7e97ad68` | 两文件 applied，before 备份及回执已存；effect `verifiedCompleted`，dispatch `settled` |
| 单独批准构建 | `a7d4daa9b5f7881087021b77a7c7bd05` | Test01Editor / Win64 / Development，succeeded、exit 0；effect `verifiedCompleted`，dispatch `settled` |

磁盘字节核对确认：生成提案后两文件仍未变化；批准后只出现 `4O`→`40` 和 `BasValue`→`BaseValue`，CRLF 与其他字节保持。模型最终答复明确说明提案尚未写入、尚未构建；写入 UI 也分别显示尚未执行构建验证。

首轮 `run-43614aeadf30b2740421a4c54a23d0b9` 使用整文件替换参数，模型提交了局部片段，被 `source_proposal_requires_complete_read` 拒绝，没有写入。保留该失败证据，随后将接口明确改为唯一文本替换。它不计为成功验收。

本地证据：`.local-dev/temp/host-task-acceptance-20261106/live-source-change-summary.json`、`live-source-change-before.json`、`live-source-change-first-rejection.json`。不随仓库发布模型内容和本地运行数据。

## 新任务来源的跨重启恢复

`native.source-change.v1` 已接入现有历史恢复入口。重新信任原项目后，原生层核对持久化执行结束、原进程已退出、备份与当前文件，生成精确逆向差异；重新审阅并批准后创建独立恢复运行。恢复保留 `task` 来源和原 `file-write` 资源，不伪造构建诊断或要求不存在的 UBT 资源。旧构建修复继续保留原适配器与资源。

先通过真实子进程复现旧入口拒绝新适配器的 `staleOwner`，再修复。29 项相关原生准入测试通过，包含新来源完整及部分写入的跨进程恢复、旧来源兼容、唯一恢复预留、外部修改、取消、其他未决效果，以及结果未落盘时保持阻止。原生产品构建通过。

桌面重启后恢复写入 `b2c4b2510d71673b262274ef7e97ad68`，新恢复运行 **`87756905c336a5e0a6135abc7e7773f9`** 为 succeeded，两个文件均 applied，effect `verifiedCompleted`、dispatch `settled`。磁盘字节与原 before 内容完全相同，包括 CRLF；新 before 备份和结果附件已持久化，没有模型请求、自动重建或旧授权重放。本地证据为 `.local-dev/temp/host-task-acceptance-20261106/live-source-restart-restore-summary.json`。

桌面本次覆盖完整写入后的恢复；新来源部分写入由真实子进程和合成文件测试覆盖，不扩大为未插桩桌面部分写入或断电恢复已验收。

## 尚未覆盖

这条有限流程不代表通用执行任务全部完成。既有调查入口迁移、Host 内目标驱动构建/失败重试、长文件、运行语义验证仍需继续。未批准提案仅在当前应用内保留，重启后须重新调查；新 `native.source-change.v1` 已写入记录支持上述重新批准的跨重启恢复；未结束或缺少持久结果的记录保持阻止。UE 对象跨重启续跑、数据能力、协作闭环及 Windows Beta 继续按当前状态表推进。
