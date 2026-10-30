export const responsesMessages = {
 "responses.modelDocs":["查看官方模型与快照 ID","Official models and snapshot IDs"],
 "responses.modelMismatch":["响应的模型 ID 与配置不一致。本版要求精确快照 ID；别名正常解析为快照时可能不兼容。请按官方模型页的 Snapshots 修改设置后手动重试。","The response model ID differs from the configuration. This version requires an exact snapshot ID; normal alias resolution may be incompatible. Update the model ID using Snapshots on the official model page, then retry manually."],
 "responses.httpRequest":["请求或模型配置被拒绝（HTTP {status}）。请核对精确快照 ID、账号模型权限和推理档位后手动重试。","The request or model configuration was rejected (HTTP {status}). Check the exact snapshot ID, account model access and reasoning effort, then retry manually."],
 "responses.httpAuth":["鉴权失败（HTTP {status}）。请在设置重新输入有效密钥，并检查该模型的访问权限。未自动重试。","Authentication failed (HTTP {status}). Re-enter a valid key in settings and check access to this model. No automatic retry was sent."],
 "responses.httpLimit":["服务端限制了请求（HTTP {status}）。请检查账号额度或速率限制，稍后手动重试。","The service limited the request (HTTP {status}). Check account quota or rate limits, then retry manually later."],
 "responses.httpServer":["服务商暂不可用（HTTP {status}），请稍后手动重试。","The service is temporarily unavailable (HTTP {status}). Retry manually later."],
 "responses.freshChatAuthorization":["继续会创建新对话，需重新开启临时会话。按发送发起该次普通请求；不会恢复旧凭证或审批。","Continuing creates a new conversation and needs a fresh memory session. Send starts one ordinary request; old credentials and approvals are not restored."],
 "responses.continueChatHint":["已选择历史对话正文。请开启临时会话，输入新问题后发送。","Archived conversation text selected. Open a memory session, enter a new question and send."],
 "responses.shareArchivedText":["选择已完成的普通对话正文作为新对话上下文","Select completed conversation text as context for the new conversation"],
  "responses.prepareChatFixture":["准备 Responses 普通对话演示","Prepare Responses chat demo"],
  "responses.fixtureCredential": [
    "夹具凭证（不要输入真实 API 密钥）",
    "Fixture credential (do not enter a real API key)",
  ],
  "responses.opening": ["正在开启会话…", "Opening session…"],
  "responses.discussionUnavailable": [
    "此 Responses 会话仅支持调查工程，请切换任务模式。",
    "This Responses session supports project investigations only. Switch task mode.",
  ],
  "responses.nativeUnavailable": [
    "Responses 需在 Windows 桌面配置 OpenAI 官方地址 https://api.openai.com/v1；其他端点仅保存配置。",
    "Responses requires the Windows desktop and the official OpenAI API root https://api.openai.com/v1. Other endpoints are configuration only.",
  ],
  "responses.prepareFixture": ["准备 Responses 本地演示", "Prepare local Responses demo"],
  "responses.fixtureHelp": [
    "仅在隔离目录合成模型响应；项目读取、审批与存储使用真实原生接口。准备后，请信任并扫描演示项目。",
    "Responses are synthesized in the isolated profile; project reads, approvals and storage use real native interfaces. Trust and scan the demo project after setup.",
  ],
  "responses.fixtureReady": [
    "Responses 本地夹具会话已开启；未连接真实模型。",
    "Local Responses fixture session is open; no real model is connected.",
  ],
  "responses.fixtureSetupFailed": [
    "本地夹具准备未完成，请查看详情后重试。",
    "Local fixture setup did not complete. Review details before retrying.",
  ],
  "responses.switchFailed": [
    "原生会话撤销尚未确认，已保留当前选择。请关闭应用后重试。",
    "Native session revocation was not confirmed. The current selection was kept. Close the application before retrying.",
  ],
  "responses.fixtureProvider": ["Responses · 本地合成", "Responses · local fixture"],
} as const;
