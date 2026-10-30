export const demoMessages = {
  "demo.openSession":["开启演示会话","Open demo session"],
  "demo.closeSession":["清除演示会话","Clear demo session"],
  "demo.banner": ["本地离线演示 · 合成模型输出 · 不调用 API", "Local offline demo · synthetic model output · no API calls"],
 "demo.sessionHelp":["手动开启本地演示会话。普通聊天按发送即可发起该次请求；调查读取范围、额外外发和工具操作仍需审批。重启后需重新开启会话。","Open a local demo session explicitly. Send starts one ordinary chat request; investigation scopes, additional sharing and tools still need approval. Reopen the session after restart."],
  "demo.sessionReady": ["离线演示会话已开启 · 未连接真实服务", "Offline demo session open · no live provider connection"],
  "demo.usage": ["用量为合成演示计数，不计费。", "Usage counters are synthetic demo values and are not billable."],
} as const;
