UAgent 构建修复开发预览（2026-11-06）

本目录 uagent.exe 已通过本机 UE 5.8.4 隔离工程的两类真实桌面修复闭环：C2065 代码错误、HTTP 缺依赖 LNK2019/LNK1120。共 2 次真实 DeepSeek 请求、2 次原生写入、2 次单独批准的重建成功；每条链均在第 1 / 3 次重建成功。

两次均批准读取两个文件，模型各修改一个文件：第一轮仅将 CompileProbe.cpp 中故意注入的未声明标识符改为 1，保留 HTTP 调用；第二轮仅在 UAgentBuildLab.Build.cs 补充 HTTP 依赖。每次都实际审阅完整外发正文、模型提案、原生单行差异，再分别批准写入和重建。原生结果均输出完整、进程树已停止，写入 applied，重建退出码 0；无自动写入或自动重试。

两次界面费用估算为 0.020224 CNY、0.020164 CNY，实际账单费用未核实。请求仍限 32 KiB，输出仍限 1024 token。多文件同时写入、连续三轮修复、真实复杂工程的广泛适用性尚未实测；UE 中文诊断仍有源端乱码，ASCII 错误码和路径可核对。

本轮修复了生产临时会话入口、重启恢复信任的 nativeSource、UBT 白名单遗漏 ProgramData、非 Unity 对象文件诊断、长 C++ 标识符脱敏及外发审批模态框。此前“临时已配置”误把保存密钥表单当作临时入口；现有保存密钥保留、不提取删除、不自动回退。修复前两次 UBA 初始化失败未进入 C++ 编译，历史证据仍保留。

本轮统一验证：建议 UI 10 项测试、集成类型检查、Vite、Cargo integrated / custom-protocol 原生构建四步全部退出 0。另有修复建议 28 项、信任来源 3 项、审批 9 项、Rust 真实子进程 1 项定向测试通过；真实 Chromium 验证审批队列及返回构建模态框的焦点。此前多文件与 Provider/脱敏等验证详见仓库 docs/t22-online-repair-suggestion-20261104.md。

使用正式目录源码构建，预览 EXE 已更新。本目录用于本地开发验收，尚未正式发布；GitHub 同步源码、测试和说明，不包含本地 EXE、配置或原始运行数据。
本次使用独立配置目录；进程重启后需重新开启临时会话并信任项目，再保持项目和模型不变继续操作。重新打开同一预览配置：
"E:\Codex\UAgent\deliverables\UAgent-20261106-repair-preview\uagent.exe" --profile-dir "E:\Codex\UAgent\.local-dev\temp\ue-build-repair-acceptance-20261106\desktop-profile"

本地验证目录：E:\Codex\UAgent\.local-dev\temp\ue-build-repair-acceptance-20261106
真实闭环摘要：live-desktop\compiler-live-cycle-summary.json、live-desktop\http-live-cycle-summary.json。
原始编译回执摘要：live-desktop\native-compiler-fixed-summary.json；统一构建：live-desktop\acceptance-fixes-build.json。
此前直接 UBT、helper、环境探针和 UBA 失败记录均保留在上述本地目录，未上传 GitHub。
