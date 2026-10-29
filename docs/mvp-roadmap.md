# UAgent Product Roadmap

UAgent combines a desktop conversation workspace with policy-controlled Unreal Engine tooling. Current user-facing availability and limitations are described in [README](../README.md).

| Area | Implementation boundary |
| --- | --- |
| Desktop | Tauri/React workspace, task composer, project sidebar, optional tool drawer, settings, Chinese/English localization, and incremental conversation rendering. |
| Provider | Provider/model configuration and explicit session/request controls. Live transport currently supports DeepSeek / `deepseek-flash`; other configured providers must not appear runnable. |
| Runtime | Ordered task events, bounded conversation history, deterministic fixtures, cancellation, failures, redacted audit, and recorded-only replay. |
| Projects | Trusted roots, bounded read-only indexing/previews, capability status, and controlled terminal/browser/screenshot/watcher bridges. |
| UE diagnostics | Read-only metadata/build diagnostics and local Context Pack construction. |
| Text repair | Previewed ChangeSet v2, native one-time approvals, contained writes, hash-bound verification and rollback. |
| UE integration | Read-only process observation and a separate default-off, provenance-bound companion asset lifecycle. |

## Remaining product work

- Additional real provider/model transports and complete custom-configuration persistence.
- Saved conversation recovery that can safely resume request context rather than display a read-only copy.
- Current-source real API multi-turn/error/billing verification and end-to-end UE project/write/rollback acceptance.
- Native pointer drag/double-click and Windows Snap verification on supported systems.
- Release signing, distributable installers, and complete product acceptance.

Keep default-off capabilities, explicit outbound disclosure, memory-only credentials, independent tool approvals, trusted-root containment, and replay isolation as these capabilities expand. A configuration editor, fixture result, or historical binary does not establish live availability.
