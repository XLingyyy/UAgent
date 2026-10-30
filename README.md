# UAgent

面向 Unreal Engine 工作流的本地桌面 Agent 工作台，使用 React、TypeScript 和 Tauri。当前重点是清晰的模型对话、显式上下文分享，以及可单独审阅的工具操作。

Local desktop workspace for model conversations and explicitly approved Unreal Engine workflows. Windows ordinary chat supports the shipped DeepSeek Flash route and the official OpenAI Responses endpoint. Other provider configurations are not advertised as runnable integrations.

Read-only structured project investigation is available as an explicit task mode; see the [capability and scope contract](docs/bounded-investigation.md) for its current limits and validation boundaries.

## 当前能力

- 桌面界面默认中文，设置 → 通用可即时切换 English，重启保留语言偏好。
- 首页动态显示实际模型或未选择状态。设置 → 模型服务管理服务商、端点与模型列表，明确区分已配置、会话关闭、连接未验证及当前构建尚不可运行。
- 当前 Windows 普通对话支持 DeepSeek 官方端点的 `deepseek-flash` 和 OpenAI 官方 Responses 端点；Responses 此版要求精确模型快照 ID。其他服务商可保存配置，尚未接入的后端不会标成可运行。
- 同一对话继续追问时，按 user/assistant 顺序携带最近最多 8 轮已完成纯文本，最多 12 KiB；新对话和不同项目隔离。附件、工具执行及失败/取消的轮次不自动继承，普通聊天按“发送”发起该次完整请求；调查中的额外外发仍可审阅实际历史与正文。
- 助手正文在同一消息节点内连续流式更新，支持基础 Markdown 排版。运行详情独立查看，只展示状态、工具、用量及必要错误，不复制流式正文，也不抢占详情滚动位置；停止保留部分回复与草稿，失败不自动重试，也不伪装为成功上下文。
- DeepSeek 普通对话自动保存完整正文和中断片段到本机 SQLite；历史恢复只选择同项目、同模型的已完成纯文本，并重新开启临时会话。旧记录不恢复凭证、审批或工具权限。存储分段和容量边界见[讨论历史契约](docs/deepseek-discussion-history.md)。
- 本地项目索引、文件/资源引用、日志与工具入口继续保留各自的信任、能力和审批边界。模型提案不等于执行授权。

## 开发分支模块状态

下列源码已合入，但“未注册”表示尚未接入主 App、生产 IPC、权限或启动恢复流程，不能作为可用产品功能验收。

| 模块 | 当前边界 |
| --- | --- |
| [UE T09–T14（含 T10）](docs/ue-build-integration.md) | 构建、修复、语义读取、拾取物和场景批次模块均未注册；既有隔离 Lab 证据不代表主线生产接线完成。 |
| [T16 操作审阅](apps/desktop/web/src/operation-review/README.md) | 未挂载的审阅 UI，批准默认禁用。语义 adapter 只展示 T13 创建预览，不是完整 Blueprint 图差异。 |
| [T18 效果核对](docs/effect-reconciliation.md) | 未注册的持久日志与交接屏障；不自动迁移旧扩展，不代表生产恢复或外部执行已结束。 |
| [T19 资源队列](packages/runtime/src/run/resource-queue/README.md) | 未注册的单进程共享实例；最多三个本地模型槽，尚未提供原生资源认证或跨进程互斥。 |
| [Anthropic Messages](packages/runtime/src/provider/anthropic/README.md) | 未注册的协议模块；没有生产原生传输、UI 或真实账号验收。 |
| [Responses 桌面对话](docs/responses-official-connection.md) | Windows 普通对话已开放 OpenAI 官方端点与本机临时密钥；调查仍仅隔离 fixture。真实 API 和外部 TLS 结果待用户验收。 |

代码合入与生产激活分开。历史不恢复旧会话、审批或可复用的发送意图；用户明确保存的服务密钥可在新对话中用于新请求，调查外发与工具审批仍独立。

## 凭证、费用与审批

产品**没有固定 10 元累计费用门槛**，费用以服务商账单为准，由用户自行控制。旧测试活动的策略代码和账本可以保留作历史记录，产品会话不依赖其初始化、核价或额度预留。

Windows 桌面可将用户主动保存的 API 密钥交给当前 Windows 用户的凭据管理器保护；界面只保留固定遮罩，不从安全存储回显完整密钥。密钥按服务商代际、协议和规范端点隔离，不写入 SQLite、配置、存档或日志。停止、切换项目/模型、过期或退出会撤销临时会话，不删除已保存密钥。替换和删除先停用旧版本；系统清理失败时明确提示，旧版本不会自动复用。见[凭证存储契约](docs/provider-credential-storage.md)。

开启会话本身不发请求，也不代表连接验证成功。普通聊天按“发送”即授权该次完整请求，不再弹出第二次确认；该意图绑定实际端点、模型、会话、来源版本和序列化正文，只能使用一次。调查的模型轮转和额外文件外发仍保留请求审阅。改稿、切换会话/项目、撤销或停止会使旧发送意图与审批失效。文件、终端和 UE 操作仍需要独立、限定范围的审批与沙盒检查；没有自动重试或备用模型切换。

## 使用流程

1. 打开设置 → 模型服务 → 添加服务商，选择已接入的服务商类型，核对端点与模型后保存。
2. 在服务凭证中输入 API 密钥并点击保存；保存后显示固定遮罩。以后选择该服务商的模型即可发送普通对话，无需反复输入或逐次勾选授权。保存、选择模型和开启会话本身不发送模型请求。
3. 在工作台输入问题。简单文本对话不要求先注册 UE 项目；按“发送”开始该次请求，无需再次确认。
4. 在同一对话继续追问；“新对话”开始独立上下文。附件需重新选择，工具结果分享需另行选择和确认。

Windows 原生桌面将非敏感服务商/模型配置、语言、主题及项目偏好保存到本地 SQLite。端点或模型配置变化会使旧验证失效；已保存密钥另由系统凭据管理器保护，旧临时句柄、审批与发送意图不会恢复。历史仅显式选择已完成纯文本，新的发送仍创建新原生会话/请求；工具结果不会自动上传。

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

用户报告组合版的 DeepSeek 真实验收已通过；该结论来自用户操作。新增的凭证持久化与自动开户使用合成密钥、合成传输和隔离数据验证；开发过程不代用户调用真实 API。

尚未完成或不能据此宣称通过的项目：

- 当前源码的真实 API 多轮质量、鉴权异常和计费回归。
- 真实鼠标拖窗与双击验收；已修正拖动覆盖并通过锁定 Tauri 脚本测试，但当前自动化未提供原生鼠标工具。
- 当前源码的真实 UE 项目生命周期、写入与回滚整体验收，以及 Windows Snap。
- Responses 的真实 API / 外部 TLS 验收与生产调查、Anthropic 的生产传输，以及生产恢复接线、跨进程资源互斥和断电恢复。
- 发布签名、安装包和全产品验收。

模块边界与行为约定见 [桌面 Provider 与对话说明](docs/desktop-provider-and-conversation.md)，开发与构建见 [开发指南](docs/development.md)。
