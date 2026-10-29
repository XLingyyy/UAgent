# UAgent

面向 Unreal Engine 工作流的本地桌面 Agent 工作台，使用 React、TypeScript 和 Tauri。当前重点是清晰的模型对话、显式上下文分享，以及可单独审阅的工具操作。

Local desktop workspace for model conversations and explicitly approved Unreal Engine workflows. The current live model transport implements **DeepSeek / `deepseek-flash` only**; other provider configurations are saved as configuration, not advertised as runnable integrations.

## 当前能力

- 桌面界面默认中文，设置 → 通用可即时切换 English，重启保留语言偏好。
- 首页动态显示实际模型或未选择状态。设置 → 模型服务管理服务商、端点与模型列表，明确区分已配置、会话关闭、连接未验证及当前构建尚不可运行。
- 当前真实传输只接入 DeepSeek 官方端点的 `deepseek-flash`。可以编辑其他服务商与模型配置，但尚未实现其真实调用，不能通过配置界面开启相应推理。
- 同一对话继续追问时，按 user/assistant 顺序携带最近最多 8 轮已完成纯文本，最多 12 KiB；新对话和不同项目隔离。附件、工具执行及失败/取消的轮次不自动继承，完整出站确认展示实际发送的历史与正文。
- 助手正文在同一消息节点内连续流式更新，支持基础 Markdown 排版。运行事件和诊断默认折叠；停止保留部分回复与草稿，失败不自动重试，也不伪装为成功上下文。
- 本地项目索引、文件/资源引用、日志与工具入口继续保留各自的信任、能力和审批边界。模型提案不等于执行授权。

## 凭证、费用与审批

产品**没有固定 10 元累计费用门槛**，费用以服务商账单为准，由用户自行控制。旧测试活动的策略代码和账本可以保留作历史记录，产品会话不依赖其初始化、核价或额度预留。

API 密钥由用户在本机为当前会话手动输入，只保存在内存，不自动读取环境密钥或旧聊天密钥，不写入配置、存档或日志。一小时过期、停止、切换项目/模型或退出会清除会话。

开启会话本身不发请求，也不代表连接验证成功。每次真实发送仍需单独确认端点、模型、项目和完整正文。改稿、切换会话/项目、撤销或停止会使旧确认失效。文件、终端和 UE 操作仍需要独立、限定范围的审批与沙盒检查；没有自动重试或备用模型切换。

## 使用流程

1. 打开设置 → 模型服务 → 添加服务商，选择已接入的服务商类型，核对端点与模型后保存。
2. 在连接状态中输入本次会话密钥，明确勾选授权并开启会话。
3. 在工作台输入问题。简单文本对话不要求先注册 UE 项目；发送前审阅完整请求，再确认一次。
4. 在同一对话继续追问；“新对话”开始独立上下文。附件需重新选择，工具结果分享需另行选择和确认。

服务商编辑器目前更新的是当前应用会话配置。现有“连接与安全 → 保存本机配置”可以显式保留已接入模型选择、主题和项目路径，恢复后仍需重新信任项目和开启模型会话。其他自定义服务商完整配置的持久化尚未实现。保存的聊天是脱敏文本副本，只读展示，不自动恢复为可发送上下文或执行权限。

## 从源码开发与构建

仓库使用 pnpm workspace。根据仓库 engines，需要 Node.js 20+、pnpm 9+。原生桌面还需要 Rust 工具链；Windows 构建需要 C++ 构建工具和 WebView2 运行时。

```sh
pnpm install --frozen-lockfile

# 浏览器前端预览；没有原生窗口/文件系统能力
pnpm --filter @uagent/desktop web:dev

# Tauri 原生桌面开发
pnpm --filter @uagent/desktop tauri:dev

# 仅构建前端
pnpm --filter @uagent/desktop web:build

# 构建未打包的调试版桌面程序
pnpm --filter @uagent/desktop tauri:build --debug --no-bundle
```

以 Tauri 构建日志输出的位置为准，`CARGO_TARGET_DIR` 会影响目标目录。默认配置使用本地相对 `frontendDist`。本轮没有发布公共 Release、签名安装包或公共 exe 下载；本机交付路径不能作为其他人的下载地址。

类型与本次对话相关的局部检查：

```sh
pnpm --filter @uagent/desktop typecheck
pnpm --dir apps/desktop exec vitest run web/src/runtime/conversation-flow.test.tsx web/src/runtime/provider-stream-ui.test.tsx web/src/runtime/outbound-review-ui.test.tsx web/src/runtime/workspace-persistence-ui.test.tsx web/src/i18n/core.test.ts web/src/shell/TitleBar.drag.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

普通构建默认关闭 fixture 与 acceptance 入口；不要将 `VITE_UAGENT_ENABLE_FIXTURES=1` 或 `VITE_UAGENT_ACCEPTANCE_UI=1` 用于对外分发。标题栏的部分脚本集成测试会使用本机 Cargo 缓存中与锁文件一致的 Tauri 源码；无缓存时该组会明确跳过，不会假报已验证原生拖动。

## 已验证与边界

用户反馈过一次基础真实模型请求能够返回；后续上下文、流式和标题栏修复使用离线合成传输验证，没有重新调用付费 API，也没有读取现有密钥。

最近完成 57 项必要局部检查，以及最终调试 exe 的两次原生启动、合成 SSE 多轮、审批正文一致、取消/失败/重试、语言切换与重启偏好、最大化/还原和正常退出。原测试账本保持不变。没有运行全量回归。

尚未完成或不能据此宣称通过的项目：

- 当前源码的真实 API 多轮质量、鉴权异常和计费回归。
- 真实鼠标拖窗与双击验收；已修正拖动覆盖并通过锁定 Tauri 脚本测试，但当前自动化未提供原生鼠标工具。
- 当前源码的真实 UE 项目生命周期、写入与回滚整体验收，以及 Windows Snap。
- 其他服务商/模型的真实后端、完整自定义配置持久化和可继续请求的聊天存档恢复。
- 发布签名、安装包和全产品验收。

实现与局部验证说明见 [桌面 Provider 与对话说明](docs/desktop-provider-and-conversation.md)。旧 MVP15D 与重建阶段的验收记录保留在 [历史 README](docs/history/mvp15-readme-20261026.md) 和 [重建记录](docs/rebuild-mvp15-20261026.md)，不能代替当前源码的新验收。
