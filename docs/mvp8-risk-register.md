# MVP8 Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R01 | Raw absolute path leaked to UI/DOM | Medium | High | Path redaction at bridge boundary; no raw paths in displayPath |
| R02 | Symlink escape reads files outside root | Low | High | Canonicalize all paths; block if outside root |
| R03 | Binary file content exposed as text | Low | Medium | NUL byte detection; extension allowlist; content redaction |
| R04 | Large project freezes UI during scan | Medium | Medium | maxDepth/maxNodes/maxFiles caps; progress batching; cancellation |
| R05 | Permission denied blocks entire scan | Low | Medium | Permission errors as warnings; continue scanning other files |
| R06 | Secret in preview content reaches user | Low | High | Content redaction before returning to UI |
| R07 | Network/UNC path treated as valid root | Low | High | Block paths starting with `//` or `\\` |
| R08 | Dangerous root (/, C:\) accepted | Low | High | Reject root-only and drive-only paths |
