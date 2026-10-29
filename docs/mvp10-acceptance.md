# Controlled Local Execution Requirements

- Terminal classification uses a no-shell parser, exact allowlist and dangerous-pattern denylist. Shell metacharacters, argument-based writes and raw environment injection must be rejected.
- Native execution requires a trusted, canonical contained cwd, matching project/root, native proposal registry entry, bounded expiry, and a consumed one-time approval. Renderer declarations cannot mint an executable token.
- The runtime routes proposal -> approval -> execution through `DesktopRuntimeAdapter` and the native commands `propose_terminal_command`, `approve_terminal_proposal`, and `execute_terminal_command_real`.
- Command templates cover build/test/lint/typecheck and read-only Git inspection. A proposed command never executes automatically. Timeout/cancel must close the owned process and report the true terminal state.
- Terminal output is bounded, chunked, and redacted. Audit/evidence/session data records redacted cwd, native lifecycle metadata, exit code and duration, never raw credentials or canonical home paths.
- The real watcher is default-off, requires its own feature/trusted-root gate, and reports actual native capability. It debounces by path/kind, bounds the queue at 10,000, surfaces overflow/backpressure, and exposes start/stop/read-diff/session commands.
- Watcher `Read Diff` drains native events; the UI clears dirty/queue only after native state confirms the drain. Failures remain visible as blocked/error states.
- Browser preview uses structured URL classification: approved localhost/127.0.0.1 or trusted contained local files only. External/private hosts, IPv6 browser-preview targets, userinfo, malformed URLs and outside-root files block before launch. This browser policy is separate from the MCP endpoint policy.
- Native preview creation is asynchronous, explicitly navigates only to the classified target, and has a bounded runtime timeout. Subsequent disallowed navigation is rejected.
- Replay returns recorded terminal/browser/watcher summaries without invoking native commands, opening windows, or restarting watchers. Screenshot capture retains a separate consent gate.

Reusable positive, rejection, timeout, cancellation, replay and redaction checks are described in [the local execution guide](mvp10-manual-smoke.md). See [development](development.md) for build and verification commands.
