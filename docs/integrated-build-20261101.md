# Integrated local candidate build, 2026-11-01

Central ownership: guard build allowlist/caller, Cargo profile, central entrypoints,
this document and evidence/integrated-product-20261101-r1. Preserve all files.
Independent module boundaries available to parent: native writer fence/catalog
(runtime_host_service.rs, runtime_host_recovery_catalog.rs, local_run_store);
T11 exact v2 read host (ue_semantic_read_commands.rs, native-ue-semantic-read.ts,
UESemanticReadPanel.tsx); Anthropic adapter (new runtime provider module files);
workflow templates (new packages/runtime/src/workflows files).
Central owns lib.rs, App.tsx and ConfigSettings.tsx integrations. Authors must not
run builds/tests independently or modify the central build guard.

Fixed web512:512MiB process/640MiB tree,120s; native768:768MiB/896MiB,360s.
Whole admission including controller, watcher, closer and64MiB caller:1056MiB/
1312MiB. RAM4GiB and commit8GiB floors remain. All previous profile semantics,
Native launcher, no-breakaway, original-handle identity, independent watchdog,
serial lease gate, strict exits0/75/0, checked-close, complete empty PID lists
and automatic final verifier code remain. Review is same-author static comparison;
there is no new independent review claim. Historical failures remain failures.

Web writes new E-drive output with emptyOutDir false. Fixture/acceptance UI flags
are forced off. Native builds offline with one worker and a new integrated profile
(dev, debug0, incremental false); old debug/release products are preserved.
TAURI_CONFIG binds the new web directory. No real credentials/API/production DB.

Use E:\anaconda\python.exe -I -B scripts/invoke-integrated-build-once.py web
then native only after web succeeds. One invocation each. Resource refusal creates
no root and never permits lower floors. Public exit0 plus assessment is success.
A development candidate is not a completed Beta or installer. T01-T24 gaps stay open.

Current r2: web256 keeps512MiB/process and tightens tree to512MiB; V8 heap256MiB, no source maps. Whole web budget928MiB including caller; admission RAM4.90625GiB/commit8.90625GiB. This changes build workload and tightens its ceiling; running floors stay4/8GiB. First web512 attempt refused before root creation. Evidence r1 is preserved. Native profile unchanged.

Current r3 web-serial retains r2 hard limits and disables final minification/transpilation (esnext), uses Go CPU1/GC50/soft memory192MiB. This development candidate targets installed modern WebView2; it is not legacy-browser compatibility evidence. r2 failed because esbuild hit quota (557056-byte VirtualAlloc1455, peak tree537206784), and its strict cleanup-only public exit0 is recorded. No historical failure was promoted to success.
