# 普通项目 Blueprint 模板与 PIE 验收（2026-11-06）

当前契约为 `2.3.0-pickup-blueprint-template`，模板为 `actor.pickup.blueprint.v2`。在 Test01 独立副本中完成实际桌面审批、创建、编译、保存、同会话结构回查、独立进程重载及真实 PIE 行为测试。原工程 `G:\UnrealEngine\Test01` 未修改；本轮模型调用为 0。

## 实现范围

固定原生父类仍为 `/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2`。在原有继承组件及类型化默认值之外，新建 Blueprint 自有内容：

- `PickupEffectAnchor`：SceneComponent，挂到原生 `PickupRoot`，相对位置 `(0, 0, 50)` 厘米。
- `bPickupEventReceived`：bool 成员变量，默认 false。
- `PickupCollectedGraph`：原生 `ReceiveCollected` 事件覆盖连接到将该变量设为 true 的节点。

原生拾取成功后触发事件。预览和创建均编译 Blueprint，并检查实际 SCS、成员变量、节点、连线和默认值；宿主要求 `blueprintTemplateVerified=true`。任意组件、任意图编辑、已有资产修改仍未开放。旧模板与未验证结构不能进入新契约的写入路径。

原生创建确认框改为显示项目、精确目标、模板、参数及语义变更摘要，完整结构保留在工作流审阅页，避免长 JSON 把确认按钮推到屏幕外。

## 实际验收

| 环节 | 结果 |
| --- | --- |
| 桌面创建 | operation `1257b7d4-adcc-45fd-9ec0-afc7357b1d3e`；创建 `/Game/Gameplay/Pickups/BP_BlueprintTemplateV2`，资产 37,022 字节；回执 applied、编译 up_to_date、结构验证 true。 |
| 同会话只读回查 | 读取到自有 SCS 组件、bool 成员及事件图；读取前后包均不脏，磁盘资产存在。 |
| 独立进程重载 | `UAgent.Pickup.BlueprintTemplate` 从已保存资产重新加载，验证组件附件、变量默认值、图结构、事件执行及实例与默认对象隔离；1 succeeded、0 failed。 |
| 真实 PIE | 独立验收地图 `/Game/Gameplay/Pickups/L_BlueprintTemplateV2Validation` 中，范围外拒绝、进入范围显示配置提示、离开范围隐藏、F 键不拾取、E 键仅拾取一次；新增 Blueprint 事件图执行，重复拾取拒绝。 |
| 运行状态隔离 | PIE 结束已观察，Blueprint 和地图在 PIE 前后磁盘内容保持，运行状态未保存回资产。 |

PIE 使用开发测试模块中明确授权的独立副本入口及实际已批准计划。该入口只创建一张新的验收地图，不覆盖已有地图，不能代表产品已提供通用测试地图/PIE 工作流。输入送入真实 PlayerController 输入栈并驱动 PlayerTick；未覆盖实体键盘和窗口焦点。NullRHI 下验证真实 TextRender 的可见性与文本状态，未验证最终画面像素或字体外观。

## 验证与证据

- Runtime 拾取模板定向测试：30 passed。
- Rust `--lib ue_pickup` 定向测试：23 passed。
- UE 5.8.4 插件、Vite 和正常原生预览构建均 exit 0。
- 瞬态 Blueprint 自动化最终 1 succeeded、0 failed；保存资产独立重载自动化另 1 succeeded、0 failed；真实 PIE 报告 `passed=true`。

本地证据根为 `.local-dev/temp/test01-pickup-acceptance-20261106/`，不纳入 GitHub：`live-blueprint-v2-results.json`、`blueprint-reload/index.json`、`blueprint-automation-r3/index.json`、`blueprint-pie-command.json`、`blueprint-pie-result.json`、`blueprint-pie-validation.log`。

自动化开发中曾因重复初始化 CreateWorld 已初始化的世界触发断言，随后因未调用 InitializeActorsForPlay 导致事件不执行；按本机 UE 源码与引擎现有测试用法修正后通过。早期失败日志保留，不计作成功。之前 2.2 原生父类模板的三次现场尝试仍见[历史验收](pickup-approved-project-20261106.md)。

此结果覆盖固定 Blueprint 模板的自有组件、变量、有限事件图及行为。可自选蓝图结构、已有资产修改、面向用户的通用验证入口、可视验收和完整三条工作流交付继续按路线图推进。
