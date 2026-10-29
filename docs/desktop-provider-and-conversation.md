# 桌面 Provider、双语与对话

本文说明当前源码的模块边界与行为约定。

## 代码入口

- `apps/desktop/web/src/app/App.tsx`：固定桌面运行时、内存会话生命周期、显式出站审阅。
- `settings/pages/ProviderSettings.tsx` / `ProviderSessionSetup.tsx`：通用配置管理与已实现传输的会话入口。
- `provider/runtime-availability.ts`：按实际实现核对服务商、模型、协议与端点，不能用“已配置”冒充可运行。
- `i18n/`：中英字典、类型化插值和仅保存语言偏好的 locale store。原始请求、命令、路径和模型正文不伪翻译。
- `runtime/safe-provider-session.ts`：会话凭证只在内存；产品使用 `openAccount`，不调用旧测试账本接口。
- `packages/runtime/src/provider/deepseek-session.ts`：已实现的有界 SSE 传输、脱敏、取消和逐次确认。`createDeepSeekAccountSession` 与旧验证活动策略分开，后者保留作历史测试用途。
- `packages/runtime/src/provider/conversation-history.ts`：最近 8 轮、12 KiB 的完整文本对边界；拒绝角色注入。
- `runtime/conversation-context.ts` 与 `stores/ui-store.ts`：会话分组、项目隔离、仅成功纯文本继承；工具和附件轮次不自动上传。
- `workspace/ConversationViewport.tsx` / `ConversationMarkdown.tsx`：用户/助手正文、原位增量渲染、折叠诊断和安全基础排版。
- `shell/TitleBar.tsx`：Tauri `deep` 拖动区域与明确排除的按钮；不另造重复拖动/双击处理。

## 保留的边界

目前真实传输仅支持 DeepSeek / `deepseek-flash`。产品没有固定累计费用门槛，费用由用户关注服务商账单。旧验证活动的 native journal 与策略源码仍可供测试，不是产品请求的必要条件；没有迁移、删除、重置或伪造历史记录。

模型正文、附件和工具结果不是执行授权。每次请求审阅实际序列化正文；历史只包含当前对话及项目中已经完成的同模型纯文本轮次。附件和工具执行轮次、未完成回复被排除。工具反馈需用户编辑/选择，再经独立请求确认，不会触发下一轮自动工具执行。

正文事件不按 chunk 创建新消息，也不在底部重复展示整段结果。短分片只在尾部可能形成凭证时暂留；完整凭证跨分片回显仍脱敏。失败/停止保留已显示文本和草稿，并禁止作为成功上下文。默认请求指令要求直接简洁作答，仍保留完整已返回正文。

历史聊天副本保持只读，不自动恢复为请求上下文或执行权限。当前真实 API、UE 集成、其他 Provider 和发布验收边界见 [README](../README.md)。
