export const runMessages = {
  "run.discussion": ["讨论", "Discuss"],
  "run.investigate": ["调查工程", "Investigate project"],
  "run.modeLabel": ["任务方式", "Task mode"],
  "run.scopeTitle": ["允许本次调查读取哪些内容？", "What may this investigation read?"],
  "run.scopeHint": [
    "仅限所选项目的只读目录、文件检索与文本预览，不运行命令或修改 UE。",
    "Read-only index listing, path search and text previews in the selected project; no commands or UE changes.",
  ],
  "run.goal": ["任务目标", "Goal"],
  "run.prefixes": ["可读取的相对目录", "Readable relative directories"],
  "run.prefixHint": [
    "用逗号分隔，如 Source, Config。路径必须位于当前可信项目内。",
    "Comma-separated, e.g. Source, Config. Paths must stay within the current trusted project.",
  ],
  "run.wholeProject": [
    "整个项目（仍排除密钥文件、二进制和生成目录）",
    "Entire project (secret files, binaries and generated directories remain excluded)",
  ],
  "run.shareResults": [
    "允许把上述范围内的工具结果发给所选模型；每次发送仍逐次确认实际正文。",
    "Allow tool results in this scope to be sent to the selected model; review each actual request before sending.",
  ],
  "run.noShare": [
    "不勾选时结果只保留本地，回传前会暂停。自动脱敏只是辅助，请继续检查出站正文。",
    "Unchecked results stay local and pause before sharing. Automatic redaction is an aid; inspect the outbound body.",
  ],
  "run.callLimit": ["最多工具调用次数", "Maximum tool calls"],
  "run.stopLimits": [
    "本次最长 10 分钟；同一失败最多尝试 2 次。范围、凭证或上下文失效后暂停。",
    "Up to 10 minutes, with at most 2 attempts for the same failure. Scope, credential or context expiry pauses the task.",
  ],
  "run.approveScope": ["允许本次只读调查", "Allow this read-only investigation"],
  "run.invalidScope": [
    "请填写有效的项目相对目录，并将调用次数设为 1–30。",
    "Enter valid project-relative directories and a call limit from 1 to 30.",
  ],
  "run.scopeCancelled": [
    "调查已取消，没有发送请求。",
    "Investigation cancelled. No request was sent.",
  ],
  "run.scopeNeedsProject": [
    "请先选择、信任并扫描一个项目，再开始调查。",
    "Select, trust and scan a project before investigating.",
  ],
  "run.scopeExpired": [
    "本次任务授权已失效，请重新确认范围。",
    "This task authorization expired. Review the scope again.",
  ],
  "run.completed": ["调查完成", "Investigation completed"],
  "run.paused": ["调查已暂停", "Investigation paused"],
  "run.stopped": ["调查已停止", "Investigation stopped"],
  "run.readStarted": ["正在读取项目", "Reading project"],
  "run.readCompleted": ["项目读取完成", "Project read completed"],
  "run.readStopped": ["项目读取已停止", "Project read stopped"],
  "run.readTool": ["只读项目工具。", "Read-only project tool."],
  "run.readRecorded": ["只读结果已记录。", "Read-only result recorded."],
  "run.finishedBody": ["只读调查已完成。", "Read-only investigation completed."],
  "run.pause": ["暂停调查", "Pause investigation"],
  "run.resume": ["继续调查", "Resume investigation"],
  "run.pausing": ["正在暂停调查", "Pausing investigation"],
  "run.finishing": [
    "正在等待当前读取或模型回复收尾。",
    "Waiting for the current read or model response to finish.",
  ],
  "run.reviewDetails": ["请查看任务详情。", "Review task details."],
  "run.reasonSourceChanged": [
    "项目来源已变化，本次发送已停止。请停止任务并重新调查。",
    "A project source changed. Sending stopped; stop this task and investigate again.",
  ],
  "run.reasonSourceUnavailable": [
    "无法核对当前项目来源，已暂停发送。请检查项目访问后重新调查。",
    "Current project sources could not be verified. Sending is paused; check project access and investigate again.",
  ],
  "run.reasonSourceInvalid": [
    "上下文来源或工具记录不匹配，已暂停发送。请展开详情查看。",
    "Context sources or tool records do not match. Sending is paused; expand details.",
  ],
  "run.reasonPaused": [
    "已暂停。继续时会重新确认下一次实际请求。",
    "Paused. Continuing requires confirmation of the next actual request.",
  ],
  "run.reasonSharing": [
    "结果已留在本地，尚未获准发送。请停止本任务，再调整分享范围。",
    "Results remain local and are not authorized for sharing. Stop this task before reviewing a new sharing scope.",
  ],
  "run.reasonLimit": [
    "已达到本次任务的调用、时长或上下文边界。请停止并缩小下一次任务范围。",
    "This task reached its call, time or context boundary. Stop it and start a smaller task.",
  ],
  "run.reasonExpired": [
    "任务授权已失效。请停止本任务并重新确认范围。",
    "Task authorization expired. Stop this task and review a new scope.",
  ],
  "run.reasonNoEvidence": [
    "模型没有返回可核验的工具结果，本次调查尚未完成。",
    "The model returned no verifiable tool evidence. This investigation is incomplete.",
  ],
  "run.reasonStorage": [
    "本地记录未能保存。任务已暂停，未继续调度。",
    "The local record could not be saved. Scheduling is paused.",
  ],
  "run.reasonOther": [
    "任务已暂停，请展开详情查看原因。",
    "The task is paused. Expand details to inspect the reason.",
  ],
} as const satisfies Record<string, readonly [string, string]>;

export function runStopReasonKey(reason: string) {
  if (reason === "context_stale") return "run.reasonSourceChanged";
  if (reason === "context_unavailable") return "run.reasonSourceUnavailable";
  if (reason === "context_scope" || reason === "context_protocol") return "run.reasonSourceInvalid";
  if (reason === "user_paused") return "run.reasonPaused";
  if (reason === "sharing_scope") return "run.reasonSharing";
  if (reason === "scope_expired") return "run.reasonExpired";
  if (reason === "no_tool_evidence") return "run.reasonNoEvidence";
  if (reason.startsWith("persistence_failed")) return "run.reasonStorage";
  if (
    [
      "tool_limit",
      "model_limit",
      "duration_limit",
      "context_limit",
      "output_limit",
      "failure_limit",
    ].includes(reason)
  )
    return "run.reasonLimit";
  return "run.reasonOther";
}
