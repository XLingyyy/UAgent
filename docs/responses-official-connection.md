# Official Responses connection

The Windows desktop supports ordinary text chat with user-configured models at
`https://api.openai.com/v1` using the Responses protocol. Other Responses endpoints
remain configuration-only. The existing DeepSeek route is unchanged.

In Settings > Providers, add the **OpenAI · Responses** template, add an exact
model ID available to your account (snapshot IDs recommended), choose the default
model and save. Enable reasoning effort only for a model that supports the chosen
effort. Enter a new session key, authorize the session and open it. Opening does
not make an API request or verify connectivity. Clicking Send creates one
memory-only intent for that exact request; ordinary chat has no second dialog.
Tool approvals remain separate. Production Responses investigation is not enabled.

The key is held in process memory and is not stored in SQLite, preferences or
logs. Normal startup uses the official native HTTPS transport, with certificate
validation and redirects/cookies/automatic authentication disabled. A native-owned
profile binds the configured provider, model, configuration generation, window,
credential lifetime and current request identity. Cancel/reconfiguration revokes
the old session. A failed close must be acknowledged before changing models.
The explicit isolated offline-demo flag alone selects synthetic responses; normal
startup never selects a fixture automatically.

Live Responses requests use the saved native model defaults; unset temperature
and output limits are omitted, using server defaults. Reasoning is sent only when
declared for the model. No model is automatically selected, substituted or queried.
The parser currently requires the response model to match the configured exact ID;
an alias resolved to a different model ID is rejected. Use a snapshot ID in that case.

Text history is archived in the existing isolated/native SQLite store, without
keys, old approvals or reusable send intents. Restoring history is not restoring
permission: a fresh credential/session is required. Context is bounded text;
native reasoning output is archival, not transparent cross-run replay.

Validation uses synthetic native transports/SSE and isolated application data.
Opening a normal profile with a synthetic key verifies local setup only; it is not
a real API success. Real API and external TLS acceptance remain for the user.
