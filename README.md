# UAgent

面向 Unreal Engine 工作流的本地桌面 Agent 工作台，使用 React、TypeScript 和 Tauri。

**当前集成版本：r14。** 仅开放 **DeepSeek API** 与 **官方 Codex app-server**。Claude / Anthropic、OpenAI Responses 为归档实现，保留源码和历史记录，不开放新建或发送。r14 是本地迭代标识，包版本仍为 `0.0.1`。

Local desktop workspace for model conversations and explicitly approved Unreal Engine workflows. The r14 source integrates DeepSeek and official Codex app-server. Real Windows UI acceptance covered ordinary Codex conversation and a two-agent read-only investigation with a persisted final summary. Other provider routes remain archived.

- [r14 发布说明与验收边界](docs/releases/r14.md)
- [模型连接、会话与审批](docs/desktop-provider-and-conversation.md)
- [开发与构建指南](docs/development.md)
- [UE 5.8.4 兼容性](docs/ue584-compatibility.md)

## r14 更新

- 协作成员和工作流配置移入独立侧栏，输入区保持稳定；Codex 官方会话按需打开，设置往返保留会话和草稿。
- 修复只读工具的 `limit=200/100` 导致整组调查失败的问题。只对未发生读取的 `limit` 范围错误反馈 `1–25` 约束，允许有界纠正；父任务和成员共享纠错上限，越权和路径拒绝继续阻断。
- 检查点时间以上一次成功提交的时间为下界，避免仅追加工具回复时出现时间倒退和归档失败。
- 原生归档接受主 Agent 的 `synthesizer` 读取归属，仅动态分工模式接受 `planner`；未知角色和未配置成员仍被拒绝。

## 当前能力

- 默认中文，可即时切换 English，重启保留语言与非敏感模型配置。
- DeepSeek 使用官方端点和 `deepseek-flash`。配置服务商不等于真实连接验证成功。
- Codex 使用本机官方 `codex.exe` / app-server 和用户已有 ChatGPT 登录。普通会话、独立成员调查、主 Agent 汇总已接入；动态分工和混合成员配置已有源码，但不包含在 r14 真实模型验收结论中。
- Codex 主 Agent 与成员可调用明确批准范围内的 UAgent 只读工具，每次原生 turn 计一次请求。每次发送和每份原样工具结果分别确认，不自动注入项目记忆。
- DeepSeek 同一对话最多继承最近 8 轮、12 KiB 的已完成纯文本；新对话和项目隔离。附件、工具执行及失败/取消轮次不自动成为下一轮上下文。
- 助手正文原位流式更新，运行详情独立查看。停止保留部分回复和草稿，失败不伪装为成功或自动重发。
- 本地 SQLite 保存对话、运行、工具和协作结果；历史查询、结果查看和恢复入口不恢复旧凭证、审批或执行权限。

## 已接入模块及边界

源码接线、功能入口和真实端到端验收分别记录，不能相互替代。

| 模块 | 当前边界 |
| --- | --- |
| [UE 构建、修复、语义/Blueprint 读取、拾取物与场景](docs/ue-build-integration.md) | 已注册相应原生命令与界面入口。仍须限定项目、原生审批和资源归属；不代表 r14 全部真实 UE 写入、回滚和项目生命周期验收。 |
| [操作审阅](apps/desktop/web/src/operation-review/README.md) | 历史只读审阅已挂载，展示保存的参数和结果，不恢复审批，也不证明当前外部效果。 |
| [效果核对与恢复](docs/effect-reconciliation.md) | 原生恢复目录、启动屏障和观察入口已有接线；不自动恢复权限、重发操作或证明外部执行结束。 |
| [资源调度](packages/runtime/src/run/resource-queue/README.md) | 已接入同一应用进程多窗口共享的原生 host 调度。跨独立进程互斥和断电恢复不在 r14 验收范围。 |
| [项目记忆](docs/project-memory-approved-snapshot.md) | 项目记忆存储与审阅已有集成；所链接的快照外发记录属于已归档 Responses 路径，不代表当前 Codex/DeepSeek 可用外发能力。Codex 调查不自动注入记忆。 |
| Claude / Responses | 归档实现与历史记录保留，当前产品入口关闭。 |

当前 UE 目标为 **5.8.4 / CL 58902052**，兼容 CL / module BuildId 为 **55116800**。旧版 5.8.1/5.8.2 的记录只代表历史证据，详见[当前兼容性说明](docs/ue584-compatibility.md)。

## 连接与使用

### Codex

1. 在官方 Codex 客户端完成登录，确认本机可用的官方 `codex.exe`。
2. 在 UAgent 打开“Codex 官方会话”，按界面读取官方模型目录、选择实际可用模型并配置会话。
3. 输入消息并完成该次原生请求确认；成功结果应显示完成并归档。
4. 需要项目调查时，选定可信项目及只读/外发范围，再打开协作配置。普通双 Agent 独立调查不要求开启动态分工。

每次发送和工具结果外发均保留确认。模型输出不能扩大批准范围或授予文件、终端、UE 写入权限。

### DeepSeek

1. 在设置 → 模型服务中配置受支持的 DeepSeek 服务与模型。
2. 用户主动保存的 API 密钥由当前 Windows 用户的凭据管理器保护；界面只显示固定遮罩。
3. 普通聊天按“发送”授权该次完整请求，无需再次确认。调查的额外外发和工具操作仍保留独立审阅。
4. 新对话使用新的请求意图；历史中的工具结果不会自动上传。

停止、切换项目/模型或退出会撤销临时会话，不删除用户已保存的密钥。密钥不写入 SQLite、日志或 Git。产品没有固定累计费用门槛，费用以服务商账单为准；Codex 内部模型调用、Token 和费用未知时不编造估算。见[凭证存储契约](docs/provider-credential-storage.md)。

## 开发与构建

需要 Node.js 20+、pnpm 9+。当前原生验证平台是 Windows，另需 Rust、C++ 构建工具及 WebView2。浏览器预览不具备原生 IPC、Codex 和系统凭据能力。

```sh
pnpm install --frozen-lockfile
pnpm --filter @uagent/desktop web:dev
pnpm --filter @uagent/desktop tauri:dev
pnpm --filter @uagent/desktop web:build
pnpm --filter @uagent/desktop tauri:build --debug --no-bundle
```

构建位置以日志为准，`CARGO_TARGET_DIR` 会影响原生产物目录。默认 `frontendDist` 是 `apps/desktop/web/dist`。普通分发不要启用 `VITE_UAGENT_ENABLE_FIXTURES=1` 或 `VITE_UAGENT_ACCEPTANCE_UI=1`。

此次同步的是源码与文档，未发布 GitHub Release、公共 EXE、签名或安装包。本地 r14 开发构建和历史产物不等于公开下载版本。

## 验证与未完成项

既有 r14 真实验收使用官方 app-server `0.166.0` / `gpt-6.1-sol`：

- 普通会话返回 `37×43=1591` 和 `UAGENT-R14-OK`，完成事件确认，正文归档。
- 双 Agent 独立调查限定 `Source`、`Config` 只读。成员分别完成 3 次、2 次读取，主 Agent 追加第 6 次读取后完成汇总；共 3 次模型请求，父任务与成员均成功，官方线程回到 idle。
- 原修复记录有 84 个前端/runtime 定向测试、3 个原生定向测试通过；前端类型检查/Vite 构建及 r14 原生构建已有记录。
- 本次发布准备另跑 4 个相关测试文件，共 31 项通过，集成 TypeScript 检查通过。没有运行全仓回归或新增真实模型请求。

未完成的验收包括动态分工真实闭环、混合成员组合、全部 UE 写入/回滚、鉴权和计费异常全覆盖、跨进程/断电恢复，以及签名安装和全产品验收。详见 [r14 验收记录](docs/releases/r14.md)。
