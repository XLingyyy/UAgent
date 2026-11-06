# TypeScript Runtime Host 进度（2026-11-06）

独立进程、协调器生命周期和原生进程托管已实现并完成下列定向验证。桌面调查目前仍使用原有渲染进程协调器；原生业务 broker、界面接线、打包分发和跨重启续跑尚未完成，T17 保持进行中。

## 已有实现

- `packages/runtime/src/run/run-host.ts` 持有既有 `RunCoordinator`，观察者退出不终止任务，不续期授权。重新订阅返回带递增 revision 的状态副本；观察者修改和异常不影响执行。暂停、取消和退出等待对应持久化结束；存储失败不会报告检查点已保存。
- `apps/runtime-host/src/` 是独立 Node 进程入口。固定 JSON 行协议通过私有 stdin/stdout 与父进程通信，不开放网络监听。协调器调用模型、工具、来源核对和持久化时向父进程发出 broker 请求；进程内没有模型密钥、文件读写执行器或原生操作批准。
- 当前进程入口仅接单成员只读调查。协作、通用写任务和恢复历史权限没有通过该入口开放。父进程必须持有原始有效授权，逐次核对 scope、可信根、模型配置和真实结果；传入 sidecar 的描述不能替代这些检查。
- `apps/desktop/src-tauri/src/runtime_sidecar.rs` 使用现有 Windows Job Object，挂入 Job 后才恢复子进程，后台运行，父进程关闭 Job 会终止所拥有的子进程。命令与 broker 回包分开，阻塞管道读取/写入不占 UI 线程。启动路径由原生应用选择，尚无允许界面提交 broker 回包的 Tauri 命令。
- 子进程环境只保留 `SystemRoot`。已复现清空该项会使当前 Node/OpenSSL 的随机数初始化失败；另已复现 Node CJS 加载器拒绝 Rust `canonicalize` 产生的 verbatim Windows 入口路径，因此在启动前转换路径表示。
- `scripts/build-runtime-host.mjs` 复用桌面已有 Vite 构建依赖，生成 `apps/runtime-host/dist/runtime-host.cjs`。源码、配置和构建脚本已纳入现有生产源码标识与构建监视范围。未增加外部运行时库。

## 验证结果

| 验证 | 结果及边界 |
| --- | --- |
| RunCoordinator 定向回归 | 10 项通过。 |
| RunHost 生命周期 | 6 项通过：观察者断开/重连、状态副本、观察者异常、退出检查点、撤销后的禁止恢复、暂停续跑和取消持久化与退出竞争。 |
| 独立 Node 进程 | 4 项通过。模拟模型经父进程 broker 进行三轮有依赖的真实隔离文件读取；随后重新查询最终状态。另覆盖退出等待检查点、存储失败不得声称保存成功、父进程管道断开退出。 |
| 原生受管 Node 进程 | Cargo integrated profile，`runtime_sidecar::tests::managed_node_handshake_and_shutdown` 1 项通过；覆盖真实 Windows Job/管道、握手、未知 run 拒绝、正常关闭与退出。 |
| 生产源码范围 | 现有 representative/watch-set 测试 2 项通过，新 Host 入口、server 和构建脚本纳入范围。 |
| TypeScript | Host 入口及其导入链检查通过。当前迁移后的依赖目录拒绝 pnpm 无 TTY 的重建请求，未强制重建；本次检查显式复用桌面已有 Node 类型目录。 |
| 构建 | Vite SSR 构建通过，当前 bundle 约 93 kB，不含 Node 可执行文件。 |

该组没有真实模型请求，没有读取 API Key，没有桌面界面刷新或通用写任务验收。测试结束后删除其专用临时文件；原生日志位于 `.local-dev/temp/runtime-sidecar-native.log`。

## 接下来的接线

1. 原生业务 broker 持有任务级授权、临时凭证、可信根和存储身份，复用现有原生 transport、读取及持久化校验。现有窗口绑定会话不能直接改成永久有效。
2. 桌面从 Host 状态恢复展示和控制；界面订阅身份与执行身份分离，重新加载不能重建或自动重放 Run。
3. 加入随应用分发的 Node/Host 资源和退出等待，再验证真实模型、界面重载、取消和重新打开应用后的状态核对。
4. 在已有副作用批准、回执和恢复屏障上接通用执行任务及 UE 对象恢复。

实现参考 [Tauri Node sidecar 文档](https://v2.tauri.app/learn/sidecar-nodejs/)及 [Node 子进程文档](https://nodejs.org/api/child_process.html)。本实现使用原生私有管道与既有 Job 托管，没有向界面开放通用 shell 启动权限。
