# T23 本地诊断导出：独立实现交接（2026-10-31）

本切片已新增源码并完成作者静态复核，尚未挂载、编译、运行或验收。它只覆盖 T23 的本地白名单诊断导出，不代表完整首用、签名安装、自动更新、版本兼容或 Windows Beta 完成。所有运行验证由中央 main01a192ca 按现有内存硬限额、超时和串行规则执行。本作者没有运行产品代码、测试、构建或安装。

新增文件：

- `apps/desktop/web/src/runtime/diagnostic-export.ts`：精确 `DiagnosticSnapshot` 类型、有限浅层统计、固定错误类别、JSON 预览和本地下载。
- `apps/desktop/web/src/workspace/DiagnosticsExportPanel.tsx`：中文 / 英文预览面板，可内嵌或使用原生 dialog；使用现有 `useI18n`、`useRuntimeStore`。
- `apps/desktop/web/src/workspace/DiagnosticsExportPanel.css`：独立样式，沿用现有主题变量。
- 本交接文件。

未修改 App、lib.rs、i18n、package、store、原有诊断面板或其他作者文件。读过当前状态文档、既有 `DiagnosticsPanel`、设置页面、应用 profile、build flags、共享 runtime DTO 与宿主 DTO。项目及已检查的祖先目录没有找到适用的 AGENTS.md / .agents / SKILL.md。本切片不需要新增依赖或 IPC。

## 中央最小挂载

建议放在现有设置内容区内；它必须处于现有 `UIProvider` 下。组件自行导入 CSS，不要复制已有日志面板的正文或文件列表作为诊断输入。

```tsx
import { DiagnosticsExportPanel } from "../workspace/DiagnosticsExportPanel";

// 设置内容区域：无新增持久化、无原生连接、无自动下载。
<DiagnosticsExportPanel inline />
```

路径按挂载文件的实际位置调整。省略 `inline` 则显示普通布局中的启动按钮，点击后打开 dialog；启动按钮没有固定屏幕定位，避免与现有 UE / 宿主按钮重叠。中央可把它放进现有工具 / 设置操作区。

可选传入**已经成功解析的真实原生宿主快照**，例如现有 `RuntimeHostOwnerSnapshot`；其结构可直接赋给 `hostSnapshot`。不要为了导出创建 owner、触发调度、恢复任务、建立 provider session 或制造样例快照。没有现成快照就保持默认 `null`。

```tsx
<DiagnosticsExportPanel inline hostSnapshot={alreadyObservedNativeHostSnapshot ?? null} />
```

宿主只导出 connected、monitorActive、recoveryCatalogInstalled、modelConcurrency、pendingExecutions、unknownExecutions，逐字段复制且校验 boolean / 非负安全整数（最大 256）。不复制 source 对象，不读取其身份、路径、job、ticket、资源或错误字段。来源标为 `caller_supplied_status_snapshot`，新鲜度标为 `not_rechecked_by_export`，不把该来源标签当作原生真实性证明。

## 实际字段及来源

| 字段组 | 实际来源和限制 |
| --- | --- |
| identity | `apps/desktop/package.json` 的前端包版本；版本仅接受长度 ≤48 的固定数字 semver / alpha、beta、rc 编号格式。已有 `VITE_UAGENT_BUILD_COMMIT` 仅接受完整 40 / 64 位 hex。缺失 / 不合法都置 null，明确来源；不填 development 假版本。 |
| native identity | 没有运行中二进制身份端口，本实现的 runningNativeVersion、executableHash 为 null，runningNativeIdentity 为 not_observed，sourceTreeDirty 为 unknown。不把前端版本或提交号当作 EXE 核验。 |
| environment | 截断到 512 字符的 renderer user agent 仅在本地用于固定 OS / renderer 家族分类，原字符串不保存；bridge 只检测函数存在，不调用。build mode 只输出 production / development；secureContext 仅布尔值。不是原生 OS / 精确系统版本证明。 |
| profile / flags | 读取现有内存 application-profile 的两项布尔值及现有 fixtures / acceptance build flags。profile 不可用时两项为 null。renderer 统计可能含 fixture 状态；明确不是原生外部执行证据。 |
| capabilities | 8 项固定 id / status / evidence。下载仅证明 API 存在，native bridge 仅证明函数存在。history、UE execution、安装更新均 not_checked；宿主为 not_observed 或 snapshot_supplied。自动上传和完整日志 / 敏感内容导出明确 unsupported。 |
| runtime tasks | 当前 renderer 内存中前 256 条自有 task map 记录，只读取 `state`；固定 10 种状态计数及未知状态计数。超过 256 条标记 scanLimited；不是归档总量或按时间排序。 |
| runtime events | 当前 active task 最近最多 512 条事件，只读取 `type`、`level`。12 个固定错误类别计数，未分类 error 统一 other_error。没有任务时为零；零只表示样本未观察到。不是完整日志、不是独立故障数。 |
| scope / privacy / limits | 固定枚举、布尔值和限额，不接收自由文本。history / 外部效果 / connectivity 都未验证，runtimeObservationIsNativeProof=false。 |

快照的可变文本只有时间戳、已校验的版本与 hex 提交号；其他文本均来自本地固定枚举。所有导出文本值不超过 128 字符。能力项固定 8 条，错误类别固定 12 条。最终 UTF-8 字节数必须 ≤16,384，超出则整体拒绝，不截取半份 JSON。无 generic object 递归序列化，也不会调用输入的 toJSON。

不会读取或导出 API Key、系统凭据、聊天正文、task draft / title / error、event title / body / payload、用户文件、项目路径 / 名称、provider endpoint、个人标识、原始 user agent、完整日志、原始异常消息。异常只展示本地固定错误码及对应双语文案。

## 用户动作及资源清理

打开面板不会生成快照或创建下载。点击“生成字段预览”后，才按白名单生成完整 JSON 并冻结预览对象；此动作没有 native invoke / 网络调用。预览展示全部 JSON、UTC 时间与实际字节数。

点击“下载预览中的 JSON”才创建本地 Blob、对象 URL 和临时 download anchor。下载字节来自同一预览的不可变 JSON，文件名只含固定前缀和 UTC 时间，不带项目 / 用户信息。本模块用 WeakSet 拒绝外部拼造的预览。界面只报告“已请求本地下载”，不声称磁盘保存成功。

anchor 在 finally 中移除；对象 URL 在 30 秒后、生成新预览、清除预览、关闭 / 卸载面板或重新下载时撤销。清除 / 关闭不删除用户已经下载的本地文件。不上传、不分享、不复制剪贴板、不调整任何系统权限。

## 未执行局部用例（交中央受保护验证）

下列均为待执行设计用例，**本作者未运行，不能记为通过**。

1. 空 runtime / 无 native bridge / 无 build commit：生成合法 JSON，runtime 和 host 为 null；原生身份仍未观测，功能未凭空变为成功。
2. 在 task draft、title、error，event title、body、payload，host identity / root / jobs 中放合成 canary（不要真实 Key）：JSON / 文件名中无 canary。可用抛异常 getter 验证这些禁止字段从未被访问。
3. 给输入 source 定义有副作用的 toJSON：导出不调用它，不读取多余字段，不递归复制对象。
4. 300 条 task、600 条 active events：任务采样 256 条、事件取最近 512 条，两项 scanLimited=true；状态 / 错误计数之和不超过各自采样量。
5. 256 条 task、512 条事件的正好边界：不错误标记截断；不存在 active task / events 时也不扫描其他 task 的事件。
6. 非法 task/runtime 状态及未知 event type 携带合成秘密：状态归为 unknown，未知 error 事件为 other_error；原始字符串不出现。已知失败事件按类别计数，普通非 error 事件不计入。
7. host 缺失为 null；负数、NaN、小数、>256 的 host 数值为 null，非 boolean 不转成 true。不得把原生恢复目录 installed 解释为已扫描或停稳。
8. 合法完整 hex commit 与非法 / 路径 / Secret / 短 hash / 缺失 env：只接受规定格式，非法为 null。前端包版本来源明确，runningNativeVersion 始终未观测。
9. 全部导出文本值 ≤128 字符，capabilities.length=8，errorsByCategory.length=12，UTF-8 大小 ≤16,384；任何最终大小越界都整体拒绝。
10. 双语 UI 初始不导出、不上传、不连接；生成后显示完整 JSON。runtime 改变时旧预览保持固定，只有刷新才更新；locale 切换改变 UI，不悄悄修改已经展示的快照。
11. download Blob 字节与预览逐字节一致；固定文件名无用户 / 项目数据；拼造预览拒绝。浏览器 / WebView 不支持下载时按钮禁用并如实说明，预览仍可用。
12. 临时 anchor 移除，对象 URL 正常超时 / 清除 / 刷新 / 重复下载 / 卸载均撤销；发生下载异常也清理，并只显示固定错误文案。
13. dialog 的 Escape / 关闭 / 重新打开，以及 inline 模式、键盘焦点、长 JSON 滚动、中英文和小窗口布局；无已有按钮遮挡。下载回执只称 requested，不称 saved。
14. 对 fetch、native invoke、credential/storage/file-reader、clipboard、分享入口设合成调用观察：导出路径不触发它们。不要调用真实 API、凭据仓、生产数据库或系统 settings。

中央挂载及上述验证完成前，正确状态为“独立源码已实现，静态复核；中央接线与运行待验”。即使局部通过，也只更新 T23 本地诊断切片，不将原方案 T23 / T24 或完整集成 EXE 标为完成。
