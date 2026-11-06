# 桌面 Provider、双语与对话

## 当前入口：r14

当前只开放 **DeepSeek API** 和 **官方 Codex app-server**。Responses / Claude 为归档实现，保留源码与历史会话，不开放新建、选择或发送。旧 `normal r5` 和早期“源码切片未打包”的说明只适用于当时产物，当前以 [r14 验收记录](releases/r14.md) 为准。

### Codex 普通会话

使用本机官方 `codex.exe` / app-server 及用户已有 ChatGPT 登录，不要求 DeepSeek API 密钥。先通过界面读取官方模型目录、选择可用模型并配置会话，再发送请求。每次原生 turn 保留正文确认和批准后的范围复核。

普通会话完成以官方终态事件和归档结果为准，不能仅凭收到文本判定成功。r14 已通过真实 Windows 界面验证普通会话完整返回并存档。

### 只读协作调查

协作设置位于独立侧栏，不再挤占输入框。选择 Codex 作为主 Agent 与最终汇总，成员可沿用主模型，也可独立配置受支持的 Codex / DeepSeek。沿用模型只复用配置；每位 Codex 成员仍有独立工作目录、进程与线程。分工和汇总使用主线程，SQLite 保存项目、运行与角色关联。

Codex 主 Agent 和成员可在已批准范围内使用 UAgent 只读项目工具。读取范围与外发范围分别审阅，每次发送和每份原样工具结果分别确认。结果和成员报告均作为不可信数据，不能扩权。当前不自动检索或注入项目记忆，也不开放模型请求的额外工具/权限授权。官方只读配置不是操作系统级全局文件或网络沙箱保证。

每个原生 turn 占一次共享请求额度；其内部模型调用、Token 和费用未知时保留未知状态。较大的编码后上下文超过现有入口限制会停止，不静默截断。成员配置为当前界面会话状态，持久记录可读，但跨重启自动继续协作未开放。

- **独立调查**：r14 真实验收通过。两位成员分别完成报告，主 Agent 追加只读工具调用后完整汇总，全部归档。
- **动态分工**：已有源码接线，主 Agent 先分配任务再汇总，但未完成 r14 真实模型验收。
- **混合成员**：配置及运行时接线存在，r14 真实验收结论不覆盖所有 Codex / DeepSeek 组合。

### DeepSeek API

当前运行入口限定官方端点和 `deepseek-flash`。用户主动保存的密钥由 Windows 凭据管理器保护，前端仅持临时句柄与固定遮罩；停止或切换会话不删除保存的密钥。

普通 DeepSeek 聊天按“发送”授权该次完整序列化请求，不再弹出第二次确认。此规则不替代 Codex 原生 turn 确认，也不替代调查的额外结果外发审阅或工具审批。

同一会话自动继承最近最多 8 轮、12 KiB 的已完成纯文本对。不同会话/项目隔离，附件、工具执行以及失败/取消轮次不自动上传。完整正文与中断片段的本地存档边界见[讨论历史契约](deepseek-discussion-history.md)。

## r14 修复

1. 只读 list/find 工具的 `limit` 要求 `1–25`。仅对此类未实际读取的参数错误返回约束和有界纠正机会；父任务与成员共享最多两次反馈，后续超限停止。权限、路径和其他拒绝继续阻断。
2. 前端检查点提交时间取最近成功 ACK 时间及当前运行/事件时间的最大值，不再因无新事件的工具回复而倒退。失败 ACK 不推进游标。
3. 原生协作归档接受 `synthesizer`，仅动态分工允许 `planner`；未配置成员、未知角色和重复调用仍被拒绝。

## 代码入口

- `apps/desktop/web/src/workspace/CodexConversation.tsx`：官方普通会话、模型选择、流式与归档界面。
- `apps/desktop/web/src/runtime/codex-member-session.ts`：官方协作成员、主线程及只读工具适配。
- `apps/desktop/src-tauri/src/codex_bridge.rs` / `codex_commands.rs`：本机 app-server 协议与原生命令。
- `apps/desktop/web/src/provider/runtime-availability.ts`：当前产品 API 可用性门禁，配置不等于可运行。
- `apps/desktop/web/src/runtime/safe-provider-session.ts`：已保存 DeepSeek 密钥的原生消费与临时会话。
- `packages/runtime/src/run/run-coordinator.ts` / `tool-registry.ts`：协作、预算、工具范围及失败处理。
- `apps/desktop/web/src/runtime/native-run-store.ts` 与原生 `run_store_commands.rs`：检查点与角色归属校验。
- `apps/desktop/web/src/i18n/`：中英字典和语言偏好；不伪翻译原始正文、命令、模型和路径。

## 共同边界

产品没有固定累计费用门槛，费用由用户关注服务商账单。密钥不得进入请求事件快照、配置、日志或 Git；保存的密钥与历史正文分开。模型正文、附件、工具结果和历史均不是执行授权。

正文持续更新同一消息，不重复创建 chunk 消息。停止保留已显示内容与草稿；失败、不完整或取消状态不可充当已完成上下文。历史不会自动恢复旧审批、原生会话句柄或执行权限。

## 归档实现

`packages/runtime/src/provider/anthropic/`、`anthropic-protocol.ts` 和原生 Anthropic/Responses 代码保留用于历史兼容和研究。其协议测试或旧实现说明不代表当前产品入口开放，不能根据这些记录启用 Claude 或 Responses。当前门禁由 `activeApiProvider`、原生请求边界及相关归档测试约束。

## 验证依据

r14 既有真实验收覆盖普通 Codex 会话和双 Agent 独立只读调查，包含实际原生确认、工具结果传回及最终归档。此前模拟 IPC、合成 SSE 和 SQLite 测试仍是局部证据，不扩展为所有模式实测。完整测试数量、发布准备检查和未覆盖项见 [r14](releases/r14.md)。
