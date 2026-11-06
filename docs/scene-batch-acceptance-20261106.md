# 普通项目场景批次验收（2026-11-06）

使用 UE 5.8.4、场景契约 `2.4.0-scene-batch-current-run` 和 Test01 独立副本。原工程 `G:\UnrealEngine\Test01` 未修改。本轮模型调用为 0。真实协议的完整 20 项、取消 7 项后续接 13 项，以及桌面宿主的完整 20 项创建与保存均已通过。

## 已复现并修正的问题

1. 桌面确认框直接打印 20 个对象的完整 JSON，按钮落在屏幕外。改为项目、精确目标、操作编号、数量及操作效果摘要；完整参数仍由工作流展示和审阅。紧凑确认框已实机检查。
2. `Execution` 直接比较 JSON Value，UE 返回整数形式的 `0`、`1` 与 Rust 计划中的 `0.0`、`1.0` 不等，导致实际相同计划被拒绝。真实发现响应确认根身份、run 和计划数值均匹配。改为反序列化到已有严格计划类型后精确比较，额外字段和数值改变仍拒绝。
3. 受管编辑器采用项目默认启动设置，在该工程中加载引擎 OpenWorld。准备工具返回 `current_world_structure_unsupported_no_unload`，查询仍为 0/20、not_started。场景专用启动命令现将 `/Engine/Maps/Entry` 放到项目路径后的地图参数位置；脏包和复杂世界拒绝规则保留。

前两次桌面尝试的 operation 分别为 `52d57fdb-b257-4357-96f7-b15f32ecd934` 和 `306722f8-825f-45ab-b619-9212a1bf0fdd`，均未放置对象，不算成功。每次结束旧编辑器后归档原批准文件，以新计划重新批准；未重发旧写操作。

## 真实协议验收

使用独立启动的真实编辑器与 MCP，固定普通引擎地图作为起点，同一受控副本中新建两张地图。完整读取并检查插件实际回执中的对象名称、身份、网格、材质与变换。

| 情形 | 实际结果 |
| --- | --- |
| 完整批次 | `/Game/UAgentBuildLab/Scene_T14/L_ProtocolFull20`；prepared → running → completed 20 → saved 20；20 个 actorGuid 唯一，目标文件存在，包不脏。 |
| 中断与续接 | `/Game/UAgentBuildLab/Scene_T14/L_ProtocolResume20`；在第 7 项后受控暂停，cancel → cancelled 7，查询后 resume → completed 20 → saved 20。前 7 个 actorGuid 和 objectPath 保持，剩余 13 项此前均 not_started，最终无重复身份。 |

第 7 项暂停使用既有私有批准文件中的 `pauseAfterItem:7` 测试控制。该字段不由模型或桌面计划输入提供。取消和续接走实际插件工具及一次性用途许可；属于确定性协议验收，未计作实体鼠标在普通发行版中恰好第 7 项时取消。取消保留已放置对象，不进行回滚；续接仅适用于同一编辑器与当前运行。

协议验收进程 PID 22648 正常退出，exit 0。本地证据为 `.local-dev/temp/t14-20261106/protocol-104912/`：`result.json`、`capabilities.json`、逐步回执、`launch.json`、`exit.json` 和 `Editor.log`，不随仓库发布。更早测试脚本漏填 `projectFile`，插件拒绝启用的失败记录保留在 `protocol-104740/`。

## 定向检查与范围

桌面最终 operation 为 `92878143-c2f0-4e93-a64e-24655578b00c`，目标 `/Game/UAgentBuildLab/Scene_T14/L_SceneDesktop20`。实际流程经过新计划审阅、原生批准、受管启动、准备批准、放置批准、逐对象查询和单独保存批准；原生回执依次为 prepared 0、running 0、completed 20、saved 20。最终 20 个 actorGuid 唯一，磁盘文件 38,736 字节，UI 显示“新地图保存已确认 · 20/20 · saved”。本地摘要为 `.local-dev/temp/t14-20261106/desktop-full20-summary.json`，原始回执位于副本的 `Saved/UAgentSceneT14/receipt-*.json`。保存后关闭预览，释放本次受管编辑器。

场景 Rust 定向测试 21 passed，包含整数表示回归和实际数值变化拒绝；固定普通地图启动命令另 1 passed。正常原生预览构建 exit 0。

当前支持固定 Engine Cube/Sphere/Cylinder、基础材质及固定目录内的新普通地图。项目自选网格/材质、其他目标目录、已有地图修改、World Partition 批次、跨重启恢复与完整 Beta 仍未由本轮交付。
