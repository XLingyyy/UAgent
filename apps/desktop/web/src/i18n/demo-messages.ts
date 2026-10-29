export const demoMessages = {
  "demo.openSession":["开启演示会话","Open demo session"],
  "demo.closeSession":["清除演示会话","Clear demo session"],
  "demo.banner": ["本地离线演示 · 合成模型输出 · 不调用 API", "Local offline demo · synthetic model output · no API calls"],
  "demo.sessionHelp": ["手动开启本地演示会话。每个任务仍需批准范围，每个请求仍需确认完整正文；重启后需重新开启。", "Open a local demo session explicitly. Each task still needs scope approval and each request needs full-body approval. Reopen the session after restart."],
  "demo.sessionReady": ["离线演示会话已开启 · 未连接真实服务", "Offline demo session open · no live provider connection"],
  "demo.usage": ["用量为合成演示计数，不计费。", "Usage counters are synthetic demo values and are not billable."],
} as const;
