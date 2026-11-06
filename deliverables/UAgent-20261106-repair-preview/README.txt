UAgent 构建修复开发预览（2026-11-06）

追加验证与诊断更新（2026-11-06）
Test01 用户工程原本无 Source，Content 为空；已在独立副本加入小型受控 C++ 模块，原工程未修改。本地审阅草稿及真实 DeepSeek 建议均通过了同批 .h/.cpp 两项原生 applied 写入和单独批准重建（exit 0）。模型链在更正临时密钥后用一次真实请求完成建议，两文件各改一行（BasValue→BaseValue、4O→40），保留 CRLF，重建 succeeded、exit 0，用到 1/3 次。界面估算 0.020082 CNY，实际账单未知。
模型链：初始失败 e2cde551a0e7bf57bfc570167a632e69；写入 7f678c2c31eae3549e78e3e3265349e7；成功重建 45ab510b34dd24286662da650779f06f。
诊断版此前的 auth_missing 对应服务器 HTTP 401/403 鉴权拒绝，更正密钥后成功。更早两次泛化失败没有可追溯原因，不反向归为同一原因；手工链及此前 Lab 成功记录保留。
本预览新增固定安全错误分类：截断、无效 JSON、提案校验、会话失效，以及 Provider 的鉴权、限流、超时、传输、格式等错误；不显示任意原始异常或模型正文。相关 43 项定向测试、集成类型检查、Vite 与原生 integrated 构建通过。原生修复测试脚本改为复用生产 Cargo 配置，24 项定向测试通过。
新预览继续使用原独立配置，当前项目为 Test01 副本。重启后临时会话和项目信任需由用户重新确认；真实既有游戏源码、运行语义及失败恢复仍待验证。此更新仍为开发预览。
独立三轮上限实机验收已通过：使用手工草稿，零模型调用；完成 3 次分别批准的原生写入与重建，诊断数 4→3→2→1，最终仍 exit 6。存储核对确认写入/构建均 settled、effect 为 verifiedCompleted，界面在第 3 次后强制停止，未发生第 4 次重建。这确认轮次控制及停止行为，不计为最终修复成功或连续三轮模型建议。
双文件预检冲突保护已通过：精确 preview 后外部修改第二个 h，写入 d4d0ecbe4060e890d32b471bdb3ac920 返回 cpp not_started、h conflict，verifiedNotOccurred / settled；字节核对确认 cpp 原内容和 h 外部修改保留，无 before 备份、恢复候选或重建。
历史事件读取窄修复已通过 19 项测试及集成类型检查；完整 applied 记录无 barrier 的恢复准入修复已通过 9 项真实进程退出/SQLite 原生测试。包含这两项修复的 web/native 两步构建均 exit 0，已重开原配置；写入及构建历史详情、附件入口已在真实桌面验证可读，仍只读且不可续跑。恢复写入尚未执行，正在等待用户重新信任已恢复的 Test01 副本。

首轮验收记录
本目录 uagent.exe 已通过本机 UE 5.8.4 隔离工程的两类真实桌面修复闭环：C2065 代码错误、HTTP 缺依赖 LNK2019/LNK1120。共 2 次真实 DeepSeek 请求、2 次原生写入、2 次单独批准的重建成功；每条链均在第 1 / 3 次重建成功。

两次均批准读取两个文件，模型各修改一个文件：第一轮仅将 CompileProbe.cpp 中故意注入的未声明标识符改为 1，保留 HTTP 调用；第二轮仅在 UAgentBuildLab.Build.cs 补充 HTTP 依赖。每次都实际审阅完整外发正文、模型提案、原生单行差异，再分别批准写入和重建。原生结果均输出完整、进程树已停止，写入 applied，重建退出码 0；无自动写入或自动重试。

两次界面费用估算为 0.020224 CNY、0.020164 CNY，实际账单费用未核实。请求仍限 32 KiB，输出仍限 1024 token。当前仍待验收真实既有游戏源码及运行语义、失败恢复和 Windows Beta；UE 中文诊断仍有源端乱码，ASCII 错误码和路径可核对。

本轮修复了生产临时会话入口、重启恢复信任的 nativeSource、UBT 白名单遗漏 ProgramData、非 Unity 对象文件诊断、长 C++ 标识符脱敏及外发审批模态框。此前“临时已配置”误把保存密钥表单当作临时入口；现有保存密钥保留、不提取删除、不自动回退。修复前两次 UBA 初始化失败未进入 C++ 编译，历史证据仍保留。

首轮预览统一验证：建议 UI 10 项测试、集成类型检查、Vite、Cargo integrated / custom-protocol 原生构建四步全部退出 0。另有修复建议 28 项、信任来源 3 项、审批 9 项、Rust 真实子进程 1 项定向测试通过；真实 Chromium 验证审批队列及返回构建模态框的焦点。此前多文件与 Provider/脱敏等验证详见仓库 docs/t22-online-repair-suggestion-20261104.md。

预览使用正式目录源码构建；包含最新历史读取及恢复准入修复的 web/native 产物已构建成功并重新打开原配置。本目录用于本地开发验收，尚未正式发布；GitHub 同步源码、测试和说明，不包含本地 EXE、配置或原始运行数据。
本次使用独立配置目录；进程重启后需重新开启临时会话并信任项目，再保持项目和模型不变继续操作。重新打开同一预览配置：
"E:\Codex\UAgent\deliverables\UAgent-20261106-repair-preview\uagent.exe" --profile-dir "E:\Codex\UAgent\.local-dev\temp\ue-build-repair-acceptance-20261106\desktop-profile"

本地验证目录：E:\Codex\UAgent\.local-dev\temp\ue-build-repair-acceptance-20261106
真实闭环摘要：live-desktop\compiler-live-cycle-summary.json、live-desktop\http-live-cycle-summary.json。
原始编译回执摘要：live-desktop\native-compiler-fixed-summary.json；统一构建：live-desktop\acceptance-fixes-build.json。
此前直接 UBT、helper、环境探针和 UBA 失败记录均保留在上述本地目录，未上传 GitHub。
Test01 验收摘要位于 E:\Codex\UAgent\.local-dev\temp\test01-build-repair-acceptance-20261106：live-two-file-summary.json（手工草稿）、live-model-two-file-summary.json（真实 DeepSeek）、live-round-limit-summary.json（手工草稿三轮上限，最终 exit 6）、live-conflict-summary.json（双文件预检冲突保护）。
