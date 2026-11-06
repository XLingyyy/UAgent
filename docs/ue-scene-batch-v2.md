> Current engine target (2026-11-03): UE **5.8.4 / CL 58902052**, compatible CL / module BuildId **55116800**. See [current compatibility and verification limits](ue584-compatibility.md). Any 5.8.1/5.8.2 results below are historical evidence, not validation of the current engine or a current release.

# T14 current-run scene batch policy

## Current ordinary-project entry (2026-11-05, source contract 2.4.0)

Supersedes the Lab-only desktop scope described below. A user-selected, trusted UE 5.8.4 project can prepare a new map under `/Game/UAgentBuildLab/Scene_T14` with 1–20 explicitly reviewed objects. The selected root-level `.uproject` is held and hashed; startup approval, owned editor launch, preparation, placement and save retain separate confirmations. Existing maps and approval files are never overwritten. The project must already have the matching plugin and prepared `Saved/UAgentSceneT14` and `Content/UAgentBuildLab/Scene_T14` directories. The existing read-only connection does not authorize writes.

Requires plugin `2.4.0-scene-batch-current-run`, scope `approved_project_new_map_current_run` and the approved-project write flag. The old frozen 2.3.0 plugin and normal EXE r3 do not contain this change. This slice has synthetic native/renderer validation only; new plugin compilation and actual UE/desktop validation remain outstanding. No ordinary user project was opened or modified.

## Historical 2.3.0 integration (superseded scope)

## Custom object list (2026-11-05, source contract 2.3.0)

The Scene batch UI supports 1–20 user-selected objects, editable names, Cube/Sphere/Cylinder meshes and per-object location, rotation and scale. The grid remains an optional list reset. Names are unique with a `UA14_` prefix; location is bounded to ±10000 cm, rotation to ±180 degrees and scale to 0.1–10. Material remains the Engine basic-shape material. Editing invalidates review; native approval binds the complete immutable list. Completion/save checks use the approved list length, with unchanged per-object verification, fresh-query continuation and separate save approval.

This is still isolated UAgentBuildLab only. Ordinary projects need a separately authorized scene write scope and lifecycle integration; the existing read-only ordinary-project connection does not grant scene writes. No existing maps are overwritten. This source change requires a matching 2.3.0 scene plugin/schema and a rebuilt desktop; old 2.2.0 binaries must fail negotiation. Validation uses mock UE responses only, not a new plugin compile or editor/desktop run.

## Desktop Lab entry (2026-11-05 source integration)

The normal desktop workflow selector now includes Scene batch. The user reviews one new map and 1–20 explicitly selected Engine-mesh objects, approves the startup file and owned editor launch, then separately approves preparation, execution, optional same-run continuation and saving. Query receipts show all approved object identities/statuses/transforms. Cancellation leaves applied objects in the unsaved world; stopping/closing the owned editor discards unsaved work. Saving requires a fresh verified completed query and exclusive creation of the approved map.

The existing isolated marker and prepared `Saved/UAgentSceneT14` and `Content/UAgentBuildLab/Scene_T14` directories are required. Startup files and `receipt-*.json` observations are created without overwriting previous files. Use a fresh isolated Lab for a new approval; the application does not delete old approval files. Scope remains Lab-only, with the existing launch gates and UE 5.8.4 identity preflight. No arbitrary existing-map or user-project write authority is enabled.

Current source accepts one or two exact startup plans, preserving the historical two-plan test. This desktop entry uses one. The C++ plugin must be rebuilt with this change; old binaries requiring two plans cannot run the new entry. This slice uses mock UE responses, native protocol tests, component tests and production Rust type checking only. It does not verify actual UE/desktop execution or publish a rebuilt EXE/plugin. Receipts are local Lab evidence, not native task-history recovery grants or cross-restart resume authority.


See the [unified integration index](ue-build-integration.md#integration-index-t09--t11--t13--t14) for commit order, main-baseline conflicts and mandatory production host boundaries.

独立模块，默认不接 IPC、不注册生产工具，不支持 Host 重启后恢复。所有开发与测试产物应遵守 tools/ENVIRONMENT.md，并在 E:/G: 上运行。

## 契约

- contractVersion: `2.2.0-scene-batch-current-run`，protocolVersion: `2`。
- 根目录固定 `/Game/UAgentBuildLab/Scene_T14`；只允许直接子包 `L_` 普通地图、原磁盘不存在、20 个固定静态对象。
- 模型非 discovery 参数仅 `protocolVersion, contractVersion, expectedProjectKey, expectedInstanceId, expectedRootObjectId, runId, plan`。`resume` 与 `save` 都额外要求 `queryToken`。
- `prepare/execute/cancel/resume/save` 的 `hostPermit` 只能 native 校验后注入；模型传入一律拒绝。`query` 无许可、无写入、无资源加载，允许重复。
- `prepare` 的新世界与资源准备是独立副作用许可。cancel 保留已应用对象，`cancelIsRollback=false`。save 是独立、可选的明确磁盘写入许可。
- plan 的所有层都闭合；20 项逐值审批，itemId 唯一、objectName 大小写不敏感唯一。hash 不是审批。
- 所有结果都有闭合 envelope 和 data。data 必需 `appliedCount` 与 `conflictReason`，仅 `queryToken` 可省略。每项仅 `transform` 可省略，未 applied 的项必须省略它、owned=false、空 guid/path；mesh/material 可空或为已批准资源。
- applied 的 GUID 非零小写且不重复，路径必须是 `${targetMap}.${mapName}:PersistentLevel.${objectName}`，mesh/material 必须逐项匹配。实际位置/比例比较容差为 `1e-3`；旋转按 UE FRotator 对应四元数的最短整体姿态角比较，容差为 `0.001°`，接受规范化及奇异角处的等价欧拉表示。审批计划自身始终逐值相等。
- planHash 验证为小写 64 hex 的 BLAKE3 receipt 字段形状；模块不重新编码计划计算 hash，也不据此授予权限。权限来自完整计划与本机审批。

## Native 宿主接口

`SceneHostScope::from_verified_owned_editor(project_key, instance_id, root_object_id, run_id, host_session_id, approved_plan)` 仅由本机可信代码调用。调用前必须实际验证 owned editor、持有 root lease、取得精确完整计划审批；这些参数不能来自模型 JSON。scope、authorization、permits 没有 Deserialize。

`SceneHostAuthorization::new_for_verified_owned_editor(scope, SceneHostPermits { prepare, execute, cancel, resume, save: Option<String> })` 要求用途间不同的非零小写 GUID。没有 save permit 就不能保存。

1. 每次操作先重新检查活跃 owned-editor/root lease，传入来自本机状态的 `active_host_session_id`，而非模型字段。任何进程、editor、root 或 run 更换都必须更换该会话 generation。不同 generation 会永久撤销旧 authorization。
2. `authorize(active_host_session_id, &model_call)` 拒绝模型 permit/额外字段，绑定完整 plan 与 project/instance/root/run。它在返回 transport call 前消费一次许可。返回后即使 transport 结果未知，也必须 query，不能重试 mutation。
3. 收到 owned editor 的实际 transport 响应后调用 `observe_owned_editor_result(active_host_session_id, tool, &envelope)`。execute 需要先观测到 prepare 的真实 prepared 结果。
4. query 也先走 authorize。每个 scope 必须串行发送并接收 query。实际 query 响应调用 `bind_owned_editor_query(...)`，或使用上述 observe 方法的 query 分支。该方法不接受单独 token；先核对整个 envelope、20 项身份与状态，再生成内部检查点。它不是模型可调用的审批接口。
5. resume 检查点只接受 cancelled/paused 且存在 not_started、所有项只有 applied/not_started、世界匹配、无 conflict、无磁盘文件、未 saved。save 检查点只接受 completed、20 项全 verified applied，且同样无 conflict/磁盘文件。两者都必须匹配 query 发出的非空新 token。
6. null、未绑定、过期或错误 token 均不能消费 resume/save 许可。任何新 query 或成功授权的 mutation 都先清除旧检查点；无效 query 响应也清除旧检查点。重复 token 不会重新绑定。
7. 撤销调用 `revoke()`。顺序进入另一张地图前撤销上一张图的 authorization；不得把旧图或旧 scope 恢复为 authority。授权对象仅保存在当前 Host 进程内存中。

## TypeScript 接口

`parseSceneBatchPlan` 建立深冻结的独立计划副本；`createSceneSessionFromVerifiedHost` 仅建立 frontend binding，不授予写权限。`negotiateSceneBatchV2` 校验闭合 manifest、两个完整 approvedPlans、当前 native 身份和全部七个工具的精确嵌套 schemas。`createSceneCall` 永不添加 hostPermit。`parseSceneResult` 校验完整 envelope 和每项实际效果；`sceneRemainingItemIds` 从可恢复的已解析查询中取得剩余 13 项等明细。

`sceneInputSchema(tool, 'model')` 可提供去除 permit 的模型参数 schema；默认 transport schema 包含需要 native 注入的 permit。用 `node scripts/export-ue-scene-batch-schemas.mjs` 导出全部 transport schemas（stdout，无临时文件）。Backend discovery 与 tools/list 必须使用同一份契约。required/enum 的次序不影响协商，其他 schema 值不能弱化或扩张。

## 最小检查

同一 PowerShell 进程先运行 E 盘环境脚本，再执行：

```powershell
& 'E:\Codex\UAgent\2026-10-29\tools\use-e-drive.ps1' -CargoCache t09
node scripts/test-ue-scene-batch.mjs
& ./scripts/test-ue-scene-batch-native.ps1
```

Native runner 仅离线编译这个纯模块，不加载 Tauri 或 UE；Cargo home 固定 `E:\Codex\UAgent\2026-10-29\build-cache\t09-cargo-home`。没有修改现有入口，因此这些局部测试不表示已连接真实 UE 或完成端到端验证。

## UE companion and actual verification

The companion module `UAgentSceneBatchToolsV2` is independent of shared/main IPC. It loads the generated exact transport schemas from `Resources/scene-batch-v2-schemas.json`; `scripts/export-ue-scene-batch-schemas.mjs` regenerates those declarations from the runtime contract. Missing/mismatched resources leave the tools unavailable. Default-disabled discovery uses `unverified-root`, a nil run ID and zero approved plans; that response is schema-valid but cannot establish a session.

Lab activation requires the matching `UAgentBuildLab` project file and isolated marker, explicit `UAgentSceneEnableLabWrites`/`UAgentSceneAllowedProjectFile`/`UAgentSceneApprovedPlansFile` launch options, and a trusted host file under `Saved/UAgentSceneT14/host-approved-plans.json`. That file approves one or two exact full plans, a run/root identity and distinct per-purpose one-use permits. Its private `pauseAfterItem:7` setting is only a controlled test boundary; model arguments cannot choose a pause or broaden targets. Neither this file nor discovery should be adopted as production authority from model input.

Prepare explicitly loads only the fixed Engine meshes/material and creates/names a new unsaved ordinary world. Dirty current worlds, pre-existing target maps, World Partition, external actors and streaming levels are refused. A core ticker places one native StaticMeshActor per step. It records actual weak-object identity and Actor GUID; tags are supplemental metadata and never permit adoption. Before continuing, querying or saving, it checks the current world/package, recorded object identity, exact name/label, mesh/material and transforms, baseline membership, editor modification notifications and map disk state. Runtime and native independently verify each response. A count alone cannot prove completion. Resource ownership remains serial until the approved map is saved.

Cancellation stops future steps and retains applied actors in the unsaved world. Only a verified cancelled query provides a resume token. Previously applied actors are checked and skipped; changed/missing/unowned actors become unknown/failed and block continuation. A completed query similarly binds the explicit save permit. Save serializes only this world package to a bounded staging file and then creates only the approved `.umap` relative to the held physical output directory using exclusive `FILE_CREATE`. Existing targets are never overwritten. Directory reparse points and target reparse/hardlink reads are rejected. Staging/UE APIs remain path-based; this is not an atomic whole-editor transaction or a cross-process recovery system. Unknown I/O effects are queried, never automatically replayed.

The real UE 5.8.2 / CL 56702186 evidence is under the isolated Lab's `Evidence/scene-v2-session`. The normal plan placed and verified 20 distinct actual Actor GUIDs/paths/resource references/transforms and saved `L_T14Full20`. The second plan cancelled after seven, queried seven applied and thirteen not-started, resumed only those thirteen, preserved the first seven GUIDs/paths/transforms, and saved `L_T14Resume20`. Both used one editor and one Host run, with 26 positive calls validated by the native module. All real envelopes matched the schemas; earlier Lab assets remained byte-identical. Final failure-report guards (conflicted/unavailable world is not a verified saved scene, unreadable disk is an unknown-effect error) received a subsequent incremental compile; those exceptional branches were not separately fault-injected in the live two-case run.

Only the two approved ordinary maps were newly saved. Packaging, rendered appearance, navigation/light building, existing-map update, arbitrary actor editing, World Partition and cross-process recovery are not verified or enabled. `ue-scene-batch-v2-entrypoints.patch` suggests declarations only; the parent integration still owns the live resource lease, protected IPC/transport route and approval issuance.

Prepare checks the old current world before consuming its plugin permit, loading dependencies or calling NewBlankMap: loaded level, external-object/actor and map build-data packages must be clean; World Partition, streaming, extra loaded levels and external actors are unsupported. It rechecks world identity and these preconditions after dependency loading before switching maps. Rejection preserves the current world, loaded child levels and their dirty state. This does not change the host rule that transport authorization consumes native grants before dispatch; a host grant is not automatically restored by a plugin precondition error.

The focused review run uses `Evidence/scene-review-world-guard`: UE 5.8.2 compiled the revised module and one actual-handler Automation test passed (main-clean/child-dirty, extra loaded level, streaming and external-actor rejection); all nine existing Lab assets retained identical hashes. This is in-process rejection-path evidence, not a new MCP twenty-item run or a real World Partition fixture. TS 57 tests and Rust 13 tests include the same 23 quaternion receipt vectors, equivalent Euler normalizations and singularities, plus a separate exact-plan approval rejection.
