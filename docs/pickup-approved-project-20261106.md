# 普通项目拾取物 Blueprint：2.2.0 实现与验收边界

截至 2026-11-06，`2.2.0-pickup-approved-project` 已在 Test01 的普通项目受控副本完成真实桌面与 UE 5.8.4 验收：批准启动、临时编译预览、独立批准创建/编译/保存、同会话只读回查及停止受管编辑器均通过。目标是已有批准目录内的单个固定原生父类 Blueprint。该结果不代表 T13 全部完成、重新启动后重载或 PIE 行为已验收。

## 已接入范围

- 用户选择项目根下实际 `.uproject`、已有 `/Game/...` 目标目录和一个精确 Blueprint 名称。当前项目文件名及目录段仅支持英文字母、数字和下划线。目标目录不会自动创建；启动所需的 `Saved/UAgentPickupT13` 目录也须已存在。
- 合约范围为 `approved_project_directory`，`writeRoot` 必须等于批准目标的父目录，`allowedTarget` 为该单个资产，`allowedMap` 为空。`productionSupported` 仅声明能力，连接可用及效果执行仍须符合批准范围。
- 模板创建 `/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2` 的子类，配置既定拾取物参数。流程为批准启动计划 → 独立批准启动受管 UE → 准备并编译临时预览 → 审阅并独立批准精确资产创建/编译/保存。
- 该切片不写地图，不覆盖既有磁盘资产或已加载同名包，不开放任意父类、组件、K2 图脚本或工具参数。

## 批准与文件边界

Host 在批准前绑定实际 `.uproject` 及项目根身份，固定目标目录和审批目录句柄，启动及效果执行时复核项目、文档授权、期限和目录身份。每次操作排他创建 `Saved/UAgentPickupT13/host-approved-<operationId>.json`；旧审批文件保留，后续操作使用新文件。

插件核对实际项目文件、根身份、操作 ID、规范化计划及精确写入目录，逐级固定 Content 下的已有目录。prepare、preview、apply 使用原生持有的独立一次性许可，apply 另绑定已审阅预览。改变项目或输入会撤销旧操作；在途批准迟到返回仍停止原项目/操作。最终目标继续使用相对固定目录的 `FILE_CREATE` 排他写入，结果不确定时不自动重试。

实现入口：[桌面工作流](../apps/desktop/web/src/composer/BlueprintTemplateWorkflow.tsx)、[运行时合约](../packages/runtime/src/ue-pickup-template-v2.ts)、[原生启动计划](../apps/desktop/src-tauri/src/ue_pickup_launch.rs)、[原生审批与效果命令](../apps/desktop/src-tauri/src/ue_pickup_launch_commands.rs)、[受管编辑器启动](../apps/desktop/src-tauri/src/ue_editor_process.rs)、[插件执行链](../integrations/unreal/UAgentAssetToolsV2/Source/UAgentPickupToolsV2/Private/UAgentPickupToolsV2.cpp)。

## 三次现场尝试与修复

验收使用从 `G:\UnrealEngine\Test01` 复制的 `.uproject` 和 Config，加装插件并准备已有目标目录；副本没有隔离 Lab 标记，原工程未修改。

| 操作 ID | 实际结果 |
| --- | --- |
| `cc038602-a3af-49b2-92b6-8afabceccbbe` | 启动计划已批准，UE 启动失败。日志中的实际 Fatal 为 canonical DDC 路径超出引擎限制；同时发现项目参数后置问题。未进入资产创建。 |
| `e8650155-5f56-42d7-b49b-10718d0d3a74` | 启动与临时预览通过；批准 apply 后，`BP_AcceptancePickup` 已在内存创建/编译，但暂存文件移动遇 Windows 错误码 32，磁盘保存失败。持久回执 `failed_editor_only`，目标文件不存在；同会话只读查询为已加载、`up_to_date`、dirty，结束编辑器后未重试。 |
| `73697054-91ea-485d-94e4-4cdafda29645` | 使用新操作及新目标 `BP_AcceptancePickupFixed`，完整批准链成功。持久回执 `applied`，文件 25,427 bytes，`savedPackages` 仅含该精确目标；同会话只读回查通过，随后结束编辑器，editor/guardian 均已独立确认停止。 |

启动修复有两项：实际命令先放 `.uproject`，再追加作用域参数；pickup DDC 缩短为当前 evidence 根下的 `ddc`，创建、guardian 校验和保留清理统一推导，canonical 路径 UTF-16 长度达到 119 时在启动前拒绝。其他 phase 路径及全局 UE 配置未改。

保存修复保留所有目录固定句柄及最终排他写入，采用 `SAVE_Async` 将暂存包写入目标 stage，并调用 `UPackage::WaitForAsyncFileWrites()` 后才读取、检查大小和记录 hash，避开 UE 临时文件 Move 与目录共享约束的冲突。暂存读取失败、空文件或超过 64 MiB 时在最终创建前记录 `failed_editor_only`。UE 异步底层写入仍可能 Fatal；这种中断须按未知结果处理，不能承诺所有 I/O 失败均能返回该状态。原生确认尚未完成时的 UI 文案也已修正为“正在审阅或执行创建请求”，不提前显示创建已请求。

## 通过范围与证据

第三次操作在启动计划批准前已独立记录目标不存在；预览 `copySaved:false`、`compileStatus:up_to_date`、无诊断。独立批准 apply 后，仅生成 `/Game/Gameplay/Pickups/BP_AcceptancePickupFixed`，持久回执与 UI 所见磁盘 hash 一致。回查为 `up_to_date`、`dirtyBefore:false`、`dirtyAfter:false`，磁盘存在且大小一致；这是同会话已加载对象的只读观察。查询的 `declared_blueprint_graphs_and_scs_only` 范围不包含原生继承组件，其组件/变量空数组不能解释为完整对象没有组件。

本地证据根为 `.local-dev/temp/test01-pickup-acceptance-20261106/`：`live-fixed-target-before-approval.json`、`live-create-save-summary.json` 记录成功链及独立停止核验；前两次失败保留于 `startup-failure-cc038602/`、`live-create-attempt-e8650155-summary.json` 和 `live-stop-e8650155-summary.json`。旧名 `live-preapply-files.json` 已明确纠正为第二次 apply 失败后的观察，不用作创建前基线。记录不包含审批许可值，不随仓库发布。

| 验证 | 结果与限制 |
| --- | --- |
| Runtime 合约 | 29 项通过。 |
| 桌面 UI | 21 项通过；最终批准等待文案复验 3 项为其中子集，不另累加。 |
| 原生 pickup | 23 项不同测试通过：首轮 22 项通过，修正 junction 测试夹具后单独补测剩余 1 项。 |
| 受管启动修复 | 2 项命令/DDC 定向测试及 4 项既有清理测试通过。 |
| 集成与桌面构建 | 当前集成类型检查通过；最终 `web-approval-status-build.log`、`native-approval-status-build.log` 均 exit 0。 |
| UE 插件 | UE 5.8.4，首次 33 个动作/6 个模块编译通过；最终保存修复增量 4 个动作 exit 0，模块 BuildId `55116800`。本轮真实加载/创建保存见上述现场链；新增 Automation 仅编译，尚未执行。 |

原生单测记录另在 `.local-dev/temp/pickup-approved-project-20261106/native-test-result.json`。构建日志和测试夹具记录各自保留编译/测试当时的边界，后续现场证据独立记录。

## 仍未覆盖

T13 的自有 SCS 组件、成员变量及受限图修改尚未接入；当前行为由固定原生父类提供。测试地图放置、T15 的 PIE/Automation、进入范围及交互反馈、可视验收仍待独立实现或验证。尚未验证本资产重启后的重载、未知 UE 对象效果恢复或普通复杂项目广泛兼容；不将本次单资产成功推广为完整交互 Blueprint 或整个 T13 完成。

旧 Lab 合约与证据见[模板历史记录](ue-pickup-template-v2.md)。总体剩余范围见[当前状态](next-phase-current-status-20261030.md)和[集成入口](ue-build-integration.md)。
