# MVP12 Manual Smoke

| Step | Coverage | Status |
| --- | --- | --- |
| S1 launch app and confirm MVP12 stage/gate | README, Settings status | Needs supervisor local UI复核 |
| S2 register trusted UE-like fixture root | fixture exists under `packages/runtime/src/fixtures/mvp12-repair-fixture` | Needs supervisor local UI复核 |
| S3 run MVP11 diagnostics | automated MVP11 path retained | Needs supervisor local UI复核 |
| S4 click Propose fix | DiagnosticsPanel action wired | Automated store/UI coverage plus local复核 |
| S5 preview diff | ChangeSet service/native preview tests | Automated |
| S6 `.uasset` repair blocked | runtime/native tests plus existing MVP11 binary fixture path; MVP12 does not add or mutate `.uasset` files | Automated |
| S7 approve ChangeSet | runtime lifecycle tests | Automated |
| S8 apply ChangeSet changes text file | native Rust test | Automated |
| S9 run verification via allowlist only | verification model, no automatic background run | Needs supervisor command/UI复核 |
| S10 ProjectTree markers | desktop store marker test | Automated |
| S11 rollback restores before hash | runtime/native tests | Automated |
| S12 replay does not reapply | runtime/native recorded-only tests | Automated |
| S13 outside root blocked | runtime/native root escape tests | Automated |
| S14 side-effect scan 0 blocked | final verification command | Automated command |
| S15 final verification full run | implementation REPORT records actual command output | Automated command plus supervisor review |
