# UAgent Asset Tools v2 companion

Independent companion for the tested UE 5.8 installation. It leaves the existing `../UAgentAssetTools` v1 exact-six plugin unchanged. The semantic read manifest publishes **no write capabilities**; separate pickup/scene contracts below remain default-disabled and Lab-only. See the [unified integration index](../../../docs/ue-build-integration.md#integration-index-t09--t11--t13--t14) before main integration.

See [the protocol and integration contract](../../../docs/ue-semantic-v2.md) for exact tools, schemas, native host obligations, observed version compatibility, limits and planned next contracts.

Enable this plugin only in an explicitly selected project. Build that project's single Editor target. For a temporary read session, pass `-UAgentEnableSemanticReads -UAgentSemanticReadRoot=/Game/ApprovedFolder`; keep the MCP listener on loopback and do not change user/engine global settings. The native host must independently verify peer/root identity and enforce its read grant.

`UAgentSemanticToolsV2Tests` contains an explicitly gated isolated-Lab fixture. It is not an asset-creation API, is inactive without the Lab flags/marker and is absent from the MCP capability list. Normal read calls do not compile, edit or save assets.

Read calls never prepare assets: Blueprint objects must already be fully loaded. Cold assets and redirectors fail closed. World/selection calls require `expectedWorldPackage`; source/actor data is read only after the current world matches that scoped target. Runtime response parsing requires the original call, and this read-only contract never permits snapshot reuse. See the integration document for exact schemas and the explicit Lab review fixture.

The plugin also hosts the independent, default-disabled `2.1.0-pickup-create-only` isolated-Lab template contract. Its fixed native Actor parent supplies runtime behavior; Blueprint copies/configuration are compiled and saved only under explicit one-use write authority. The semantic read manifest still grants no writes. See [the pickup contract](../../../docs/ue-pickup-template-v2.md) for exact dependencies, scope and recovery limits.

T14 adds a separate default-disabled `2.2.0-scene-batch-current-run` Lab contract for two exactly approved twenty-item StaticMeshActor plans. It queries actual identities/properties, cancels without rollback, resumes only verified remaining items in the same run, and saves only each new approved ordinary map. Production activation and main IPC are absent. See [the scene batch contract](../../../docs/ue-scene-batch-v2.md).
