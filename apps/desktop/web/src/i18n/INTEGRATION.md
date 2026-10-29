# 剩余界面接入与覆盖记录

API 保持不变：`useI18n()` 返回 `{ locale, setLocale, t, text }`，`translate(locale, key, params)` 可用于非 React 调用。默认中文，即时切换，语言偏好仅存入 `uagent.locale`。

本模块仅改 `i18n/`。组件接入由 UI 负责人完成。`text()` 只处理界面编写者提供的完整静态文案；动态句子优先用下列 `t()` 模板，避免把路径、模型回复或原始日志拿去翻译。参数均为 `string | number`，字段缺失会报 TypeScript 错误。

## 448 项静态清单的覆盖

对 `output/playwright/ui-redesign-20261028-stage1/ui-i18n-missing-static.json` 的原始 448 项逐项检查，428 项已能命中语义词条或精确别名。其余 20 项是应原样显示的符号、标识或路径，无遗漏的自然语言说明：

`CNY`、`ChangeSet v2`、`DefaultGame.ini`、`KB`、`KB /`、`MB /`、`MCP`、`MCP:`、`MIME:`、`MVP10`、`MVP9`、`RefreshTools`、`SF Mono / Cascadia Code`、`UE:`、`URL:`、`ds`、`fixture://lyra`、`u`、`x`、`~/uagent/config/profiles/default.json`。

不为这些值添加翻译词条。扫描时应把它们列为保留项；`text()` 会原样返回。所有现有数额和参数也保持原值，未改变任何费用或授权逻辑。

## 动态文案接入表

同目录的 `ui-dynamic-copy.json` 有 42 项。其中 8 项仅连接原始模型名称、状态、项目显示名或哈希前缀，不含需翻译的自然语言；其余 34 项对应的完整模板如下。

| 组件                                       | 语义 key                                      | 必需参数                        |
| ------------------------------------------ | --------------------------------------------- | ------------------------------- |
| `composer/AttachmentPanel.tsx`             | `attachments.preview`                         | `name`                          |
| `composer/ComposerDock.tsx`                | `composer.proposeCommandLabel`                | `command`                       |
| 同上                                       | `composer.workingDirectoryLabel`              | `path`                          |
| `composer/ModelSelector.tsx`               | `composer.modelContextLabel`                  | `context`, `networkMode`        |
| `composer/PermissionSelector.tsx`          | `permissions.modeLabel`                       | `mode`                          |
| `composer/ProjectSelector.tsx`             | `project.selectorLabel`                       | `project`                       |
| `inspector/AssetLifecycleEvidence.tsx`     | `tools.panelLabel`                            | `title`                         |
| `inspector/AuditPanel.tsx`                 | `audit.eventCount`                            | `count`                         |
| `inspector/ChangesPanel.tsx`               | `changes.eventCount`                          | `count`                         |
| `inspector/DiagnosticsPanel.tsx`           | `diagnostics.kindLabel`                       | `kind`                          |
| 同上                                       | `diagnostics.repairLabel`                     | `id`                            |
| 同上                                       | `diagnostics.buildCounts`                     | `errors`, `warnings`            |
| `inspector/EditorPanel.tsx`                | `editor.heartbeatSummary`                     | `reason`, `alive`               |
| `inspector/InspectorFinding.tsx`           | `review.findingLabel`                         | `title`                         |
| `inspector/ReviewPanel.tsx`                | `review.nextCheckLabel`                       | `number`                        |
| `inspector/RuntimePanel.tsx`               | `mcp.discoverySummary`                        | `tools`, `resources`, `prompts` |
| `inspector/TerminalPanel.tsx`              | `terminal.quickActionLabel`                   | `action`                        |
| `inspector/UtilityPlaceholderPanel.tsx`    | `tools.placeholderLabel`                      | `title`                         |
| `settings/pages/ArchivedChatsSettings.tsx` | `history.count`                               | `count`                         |
| `settings/pages/ConfigSettings.tsx`        | `config.runNegativeCaseLabel`                 | `number`                        |
| 同上                                       | `project.validationReady`                     | `project`                       |
| 同上                                       | `mcp.statusCounts`                            | `status`, `readOnly`, `blocked` |
| 同上                                       | `mcp.statusReadOnly`                          | `status`                        |
| `settings/pages/ProviderSettings.tsx`      | `provider.contextTokens`                      | `count`                         |
| `settings/SettingsPageLayout.tsx`          | `settings.pageLabel`                          | `page`                          |
| `shell/TitleBar.tsx`                       | `shell.mcpPolicyHint`                         | `status`                        |
| 同上                                       | `shell.editorStatusLabel`                     | `status`                        |
| `sidebar/ProjectSection.tsx`               | `project.indexSummary`                        | `count`                         |
| `sidebar/ProjectTreeNode.tsx`              | `project.collapseNode` / `project.expandNode` | `name`                          |
| 同上                                       | `project.diagnosticsForNode`                  | `count`, `name`                 |
| 同上                                       | `project.diagnosticCount`                     | `count`                         |
| 同上                                       | `project.nodeMarkers`                         | `markers`, `name`               |
| `workspace/ConversationMessage.tsx`        | `workspace.messageLabel`                      | `label`, `title`                |
| `workspace/WelcomeHero.tsx`                | `onboarding.projectTitle`                     | `project`                       |

无需翻译的 8 个清单条目：模型服务名与模型名的组合；资源变更面板和配置页各两个哈希前缀；编辑器进程名/状态组合；编辑器状态/项目名组合；编辑器会话状态/模式组合。内部枚举若要用自然语言显示，可只对该已知枚举调用 `text(value)`，不要对任意外部返回字符串调用。

## 旧 JSX 拼接句

`legacy-fragments.ts` 为现有 JSX 中确实出现的静态片段提供精确兼容映射，包括数量后缀、审批要求、预留费提示及 HTML 实体。优先逐步替换为完整句子：

| 页面           | 推荐完整 key                                                               |
| -------------- | -------------------------------------------------------------------------- |
| 出站费用确认   | `budget.maximumReservation` (`amount`)                                     |
| 出站项目与版本 | `outbound.projectGeneration` (`project`, `generation`)                     |
| 费用金额       | `currency.cnyAmount` (`amount`)                                            |
| 资源操作审计   | `changes.operationSummary` (`phase`, `tool`, `path`, `result`, `evidence`) |
| 终端输出上限   | `terminal.outputSummary` (`lines`, `kilobytes`)                            |
| 终端脱敏计数   | `terminal.redactionSummary` (`secrets`, `paths`)                           |
| 命令令牌期限   | `terminal.expirySeconds` (`seconds`)                                       |
| 文件监控策略   | `watcher.policy` (`milliseconds`, `limit`, `overflow`)                     |
| 模型建议及项目 | `proposal.commandProject` (`command`, `project`)                           |

已登记的带冒号标签会保留正确的中英文冒号，且不会重复添加。路径、模型标识、命令、事件类型、原始日志、保存的真实会话内容和模型回复始终按原数据显示。`workspace/workspace-data.ts` 中的模拟会话正文及静态日志示例没有通过词典替换；不要在真实会话正文上套用 `text()`。
