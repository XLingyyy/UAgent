export const responsesMessages = {
  "responses.freshChatAuthorization":["继续会创建新对话。需重新开启临时会话并检查每次实际请求；不会恢复旧凭证或审批。","Continuing creates a new conversation. Open a fresh memory session and review each actual request; old credentials and approvals are not restored."],
  "responses.continueChatHint":["已选择历史对话正文。请开启临时会话，输入新的问题，并在发送前检查实际正文。","Archived conversation text selected. Open a memory session, enter a new question and review the actual body before sending."],
  "responses.shareArchivedText":["选择已完成的普通对话正文作为新对话上下文；发送前仍需检查实际请求","Select completed conversation text as context for the new conversation; review the actual request before sending"],
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
    "Responses 目前仅支持隔离的本机夹具，普通模式尚未开放。",
    "Responses is currently available only in an isolated local fixture. Ordinary mode is not yet supported.",
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
