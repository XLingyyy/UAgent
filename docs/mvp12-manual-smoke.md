# MVP12 Manual Smoke

| Step | Coverage |
| --- | --- |
| S1 launch app and confirm MVP12 stage/gate | README, Settings status |
| S2 register trusted UE-like fixture root | fixture exists under `packages/runtime/src/fixtures/mvp12-repair-fixture` |
| S3 run MVP11 diagnostics | automated MVP11 path retained |
| S4 click Propose fix | DiagnosticsPanel action wired |
| S5 preview diff | ChangeSet service/native preview tests |
| S6 `.uasset` repair blocked | runtime/native tests plus existing MVP11 binary fixture path; MVP12 does not add or mutate `.uasset` files |
| S7 approve ChangeSet | runtime lifecycle tests |
| S8 apply ChangeSet changes text file | native Rust test |
| S9 run verification via allowlist only | verification model, no automatic background run |
| S10 ProjectTree markers | desktop store marker test |
| S11 rollback restores before hash | runtime/native tests |
| S12 replay does not reapply | runtime/native recorded-only tests |
| S13 outside root blocked | runtime/native root escape tests |
| S14 side-effect scan 0 blocked | final verification command |
