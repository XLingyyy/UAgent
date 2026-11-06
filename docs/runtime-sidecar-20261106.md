# TypeScript Runtime Host 进度（2026-11-06）

独立进程、协调器生命周期、原生进程托管及随包资源已实现并完成下列定向验证。新增原生业务 broker 和独立的“后台文件调查”入口；既有调查入口仍使用原有渲染进程协调器。新入口的真实模型、重载、暂停、继续、取消、原生范围拒绝、期限结束及正常退出后的历史读取已通过。最终安装包与通用任务尚未完成，T17 保持进行中。

## 已有实现

- `packages/runtime/src/run/run-host.ts` 持有既有 `RunCoordinator`，观察者退出不终止任务，不续期授权。重新订阅返回带递增 revision 的状态副本；观察者修改和异常不影响执行。暂停、取消和退出等待对应持久化结束；存储失败不会报告检查点已保存。
- `apps/runtime-host/src/` 是独立 Node 进程入口。固定 JSON 行协议通过私有 stdin/stdout 与父进程通信，不开放网络监听。协调器调用模型、工具、来源核对和持久化时向父进程发出 broker 请求；进程内没有模型密钥、文件读写执行器或原生操作批准。
- 当前进程入口仅接单成员只读调查。协作、通用写任务和恢复历史权限没有通过该入口开放。父进程必须持有原始有效授权，逐次核对 scope、可信根、模型配置和真实结果；传入 sidecar 的描述不能替代这些检查。
- `apps/desktop/src-tauri/src/runtime_sidecar.rs` 使用现有 Windows Job Object，挂入 Job 后才恢复子进程，后台运行，父进程关闭 Job 会终止所拥有的子进程。命令与 broker 回包分开，阻塞管道读取/写入不占 UI 线程。启动路径由原生应用选择，尚无允许界面提交 broker 回包的 Tauri 命令。
- 子进程环境只保留 `SystemRoot`。已复现清空该项会使当前 Node/OpenSSL 的随机数初始化失败；另已复现 Node CJS 加载器拒绝 Rust `canonicalize` 产生的 verbatim Windows 入口路径，因此在启动前转换路径表示。
- `scripts/build-runtime-host.mjs` 复用桌面已有 Vite 构建依赖，生成 `apps/runtime-host/dist/runtime-host.cjs`。源码、配置和构建脚本已纳入现有生产源码标识与构建监视范围。未增加外部运行时库。
- `scripts/prepare-runtime-node.py` 下载并核对官方固定 Node **24.22.2 win-x64** 发行档，提取执行文件和完整第三方许可；该版本为本次查询官方发行索引中的最新 24.x LTS。Tauri 开发/发布前置命令准备资源，映射到应用 `runtime-host/` 目录。原生 `start_bundled` 仅从应用资源目录选择入口，不查系统 PATH。生成的二进制资源不入 Git。
- Host 和桌面共用 `packages/runtime/src/run/native-run-store.ts` 的存储序列化、增量游标和提交回执核对，沿用现有数据库格式。Host 的 `store.commit` 请求已使用原生提交协议。
- 原生 `NativeStoreTaskGrant` 将存储身份限定到一个项目和 Run，生命周期独立于窗口；应用关闭和任务释放仍会撤销它。身份只由原生层签发，历史记录和 sidecar 数据不能重建它。
- `native_task_admission.rs` 为未选择项目记忆的任务复用现有物理恢复目录、共享模型队列和原生 transport。真实 SQLite 事务核对原始运行记录，工作线程释放数据库所有权后才能获得一次性发送许可；取消、来源变化和重复批准仍会拒绝发送。此路径已接入新后台文件调查入口，真实发送验收另记。
- `native_host_model.rs` 已接临时 DeepSeek 配置：原生开启身份绑定当前文档与配置版本；只有新批准的原生任务可取得单独限时会话。窗口导航释放开启身份，已取得的任务会话保留原期限；显式关闭会话、修改模型配置、撤销项目、退出应用会撤销任务凭证。新会话仍只保存在内存，未写入凭证库。新后台文件调查可路由到 Host；既有调查和协作入口保持原有路径。
- 原生 Host 的进程所有者与通信句柄已分开。模型/存储 broker 可以持有通信句柄，不必持有等待命令回复的同一把互斥锁；即使通信句柄仍存活，释放进程所有者也会终止其 Job。

## 验证结果

| 验证 | 结果及边界 |
| --- | --- |
| RunCoordinator 定向回归 | 10 项通过。 |
| RunHost 生命周期 | 6 项通过：观察者断开/重连、状态副本、观察者异常、退出检查点、撤销后的禁止恢复、暂停续跑和取消持久化与退出竞争。 |
| 独立 Node 进程 | 4 项通过。模拟模型经父进程 broker 进行三轮有依赖的真实隔离文件读取；随后重新查询最终状态。另覆盖退出等待检查点、存储失败不得声称保存成功、父进程管道断开退出。 |
| 原生受管 Node 进程 | Cargo integrated profile，`runtime_sidecar::tests::managed_node_handshake_and_shutdown` 1 项通过；覆盖真实 Windows Job/管道、握手、未知 run 拒绝、正常关闭与退出。 |
| 随包 Node 资源 | `bundled_node_resource_handshake_and_shutdown` 1 项通过，使用官方 24.22.2 执行文件；Tauri 构建已实际复制 Node、Host 和许可证到 integrated 输出目录。尚未生成最终安装包。 |
| 生产源码范围 | 现有 representative/watch-set 测试 2 项通过，新 Host 入口、server 和构建脚本纳入范围。 |
| TypeScript | Host 入口及其导入链检查通过。当前迁移后的依赖目录拒绝 pnpm 无 TTY 的重建请求，未强制重建；本次检查显式复用桌面已有 Node 类型目录。 |
| 共用存储协议 | 原有桌面存储 24 项与独立进程 4 项合计 28 项通过；原生提交协议仍剥离运行授权和原始路径。 |
| 任务存储身份 | 原生 4 项通过，覆盖窗口撤销、项目/Run 绑定和应用关闭。 |
| 任务物理恢复校验 | 原生 3 项通过，覆盖原始运行记录、替换持有者、记录变化及校验期间取消。 |
| 任务模型发送链 | 原生 3 项通过，真实 SQLite 工作线程与模拟 transport 验证精确请求体、释放数据库后发送、取消及来源变化后零发送、禁止重批复用。初次测试复现同一会话锁重入死锁，修正锁内取消检查后通过。 |
| 临时模型会话生命周期 | 原生 4 项通过：窗口撤销后任务继续持有租约、禁止旧文档再创建任务、配置更新/项目撤销/显式关闭、Run/文档/窗口身份不可替换。前端新接入 3 项和原有会话/凭证界面 46 项通过。 |
| 原生 Host 通信句柄 | 原生 3 项通过，包含释放所有者后即使保留客户端也会停止随包 Host；原有握手和关闭用例仍通过。 |
| 构建 | Vite SSR 构建通过，Host 约 118 kB；独立 Node 资源约 94 MB，另附许可证。 |

上表早期基础测试未进行真实模型请求、API Key 读取、桌面刷新或通用写任务验收；后续后台入口的真实验收记录见下节。进程测试清理自身临时文件；原生隔离样本保留在 `.local-dev/temp/`，日志包括 `runtime-sidecar-native.log`、`host-task-store-native.log`、`host-task-recovery-native.log` 和 `host-task-pipeline-native.log`。

临时会话接线后执行了一次完整前端类型检查，仍有 15 个错误，全部位于本轮未修改的测试文件（引擎字面量和旧测试 mock 类型等）；本轮修改文件没有类型错误。该次完整检查不计为通过，详见 `.local-dev/temp/host-model-web-types.log`。本轮原生会话与 Host 生命周期日志为 `host-model-lifetime-native.log`、`host-client-lifetime-native.log`。

## 原生 broker 与后台入口的限定验收

- `native_host_tasks.rs` 持有独立任务存储身份、原生限时模型会话、真实根目录句柄及原生来源证据。只开放文件读取；范围确认后最多 4 次模型请求、8 次读取、2 分钟。模型凭证不进入子进程管道。
- 每次模型请求经过既有原生队列、SQLite 物理恢复目录和一次性发送许可。DeepSeek 固定端点使用原有 WinHTTP 通道，核对完整工具调用、实际用量和凭证回显，再向 Host 返回投影结果。
- 文件读取使用现有持有句柄的有界读取，核对 read/share 范围，复用前端原有脱敏规则；失败读取记录为明确失败或阻止。结束且原生工作线程返回后释放文件证据，不提前声称外部操作结束。
- `HostedTasksPanel` 重新打开时只查询现存任务，不自动新建、续期、恢复或取消。暂停/继续受原期限限制；到期会发出取消，应用退出时先让 Host 保存停止检查点，再关闭存储。
- 新入口观察者重挂测试 1 项、独立进程测试 4 项、既有文件脱敏定向测试 1 项通过。Host 类型检查和前端构建通过；完整前端类型诊断与此前 15 项完全相同。原生路径边界测试 1 项通过。
- 预览发现并修正了打包启动缺少 `custom-protocol`、入口按钮复用固定定位样式、原生项目 ID 校验不接受 `root:<hex>` 的问题。
- Test01 独立副本的真实 DeepSeek Flash 任务 `run-fb4e0be06d75385e5cf47ca6eca235be` 完成 4 次模型请求、3 次文件读取，SQLite 状态 `succeeded`、revision 12。界面显示运行中时执行 Ctrl+R，重载后的 UI 临时模型会话关闭；重新打开后台面板取得原任务完整结果。证据：`.local-dev/temp/host-task-acceptance-20261106/live-reload-run.json`。
- 任务 `run-b8733a117cdf19e75d6c1bad13bac4e3` 在第 3 次模型请求、2 次读取后暂停，原检查点为 `user_paused`；继续后完成第 3 次读取和第 4 次模型请求，最终 `succeeded`、revision 14。证据：同目录 `live-pause-resume-run.json`。完成后通过无写入的读写打开确认 3 个文件的写共享限制已经释放。
- 首次取消尝试所选任务在点击前已因 `provider_failed` 结束，不能计作取消成功。随后的新任务也未能启动。已定位凭证/租约接口要求绝对时刻，而新任务错误传入剩余时长；已修正为原单调时钟上的任务 deadline，原有 4 项及新增晚启动/原 profile TTL 边界测试共 5 项通过，打包协议原生构建通过。该失败证据为 `live-cancel-first-failure.json`。
- 修复后任务 `run-6e4beeaffb5d6f7969a41448a1d2bd57` 完成 4 次模型请求、3 次读取，最终 succeeded。第二次取消尝试也晚于完成，不计取消通过。
- 真实取消任务 `run-9a925a304424e7c49996fe9dc43337b3`：首轮响应及 1 次读取完成，第二次模型请求期间点击取消；最终 cancelled、revision 6，保存 cancelled 检查点，未执行余下两个读取。第二次请求没有完成用量回执，不能宣称其费用为零。证据：`live-cancel-run.json`。
- 范围拒绝任务 `run-c0675e4d56b10be71689073e9be5b549`：仅批准 Source，模型请求读取 Config/DefaultEngine.ini，原生返回 host_read_scope_denied，工具状态 blocked，运行 failed、revision 5；没有读取范围外正文，也没有第二次模型请求。证据：`live-scope-denied-run.json`。
- 期限任务 `run-8032ac670664c85e31ae7a0108858950` 在临时会话开启约 154 秒后成功创建，完成 3 次模型响应、2 次读取后暂停；在创建后约 120.9 秒被原生期限监视结束为 cancelled、revision 10，暂停没有续期，后续读取没有执行。证据：`live-expiry-run.json`。该入口当前将原授权到期记作取消，不提供延长旧授权。
- 正常退出任务 `run-182aff118d07c474328fd452a6a58ae9` 在模型循环运行中关闭应用，保存 paused、revision 6 检查点。原 UAgent 和随包 Node 进程均退出；新进程没有恢复信任或临时密钥。无需密钥与项目信任即可打开历史详情，显示已暂停、全部 5 条保存消息、工具记录及只读提示。证据：`live-exit-run.json`、`live-restart-history.txt`。这是正常退出及历史读取验收，不代表强杀/断电后自动续跑。

## 接下来的接线

后台入口已继续接入[暂停后补充要求与重新规划](run-plan-amendment-20261106.md)，真实模型完成了保留既有结果、跳过未派发调用、保存新版本并继续的链路。此项仍限单成员只读调查。

1. 将既有调查入口与新 Host 的能力范围统一；当前新增入口仅支持单成员文件读取。
2. 在已有副作用批准、回执和恢复屏障上接通用执行任务及 UE 对象恢复；历史记录不得重建执行权限。
3. 随包资源已接入真实应用启动与退出生命周期，后续验证最终安装包、异常进程退出和干净 Windows 安装。

实现参考 [Tauri Node sidecar 文档](https://v2.tauri.app/learn/sidecar-nodejs/)及 [Node 子进程文档](https://nodejs.org/api/child_process.html)。本实现使用原生私有管道与既有 Job 托管，没有向界面开放通用 shell 启动权限。

分发资源按 [Tauri resources 文档](https://v2.tauri.app/develop/resources/)配置；Node 版本与发行校验值来自 [官方发行索引](https://nodejs.org/dist/index.json)及 [24.22.2 发行清单](https://nodejs.org/dist/v24.22.2/SHASUMS256.txt)。
