# Official Responses connection

The Windows desktop supports ordinary text chat with user-configured models at
`https://api.openai.com/v1` using the Responses protocol. Other Responses endpoints
remain configuration-only. The existing DeepSeek route is unchanged.

In Settings > Providers, add the **OpenAI · Responses** template, add an exact
model snapshot ID available to your account (required by this version), choose the default
model and save. Enable reasoning effort only for a model that supports the chosen
effort. Enter an API key and save it in Windows protected credential storage.
The input then shows a fixed mask. Later ordinary conversations use the saved
provider-bound key after model selection and an explicit Send, without another
credential form. Saving/selecting/opening does not make an API request or verify connectivity. Clicking Send creates one
memory-only intent for that exact request; ordinary chat has no second dialog.
Tool approvals remain separate. Production Responses investigation is not enabled.

The key is stored by Windows Credential Manager, separately from nonsecret
SQLite active-reference metadata. It is loaded only into native memory; the
renderer receives a mask and expiring handle, never the saved key. It is not
stored in SQLite, preferences or logs. See [credential storage](provider-credential-storage.md). Normal startup uses the official native HTTPS transport, with certificate
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
an alias normally resolved to a different snapshot ID may be incompatible and is rejected.
Use the exact snapshot ID listed under Snapshots on the selected model page in the
[official model catalog](https://developers.openai.com/api/docs/models). This is a
client compatibility limitation, not evidence of model tampering.

HTTP rejection status is retained as a safe numeric value: parameter/model errors,
authentication errors and rate/quota errors have distinct bilingual guidance.
Failure bodies, response headers and credential echoes are never forwarded. There
is no automatic 401 retry, 429 retry loop or model substitution. HTTP rejection
never becomes an unsent claim; uncertain sends remain mayHaveBeenSent.

Text history is archived in the existing isolated/native SQLite store, without
keys, old approvals or reusable send intents. Restoring history is not restoring
permission: a fresh native session and new Send intent are required. A user-saved
provider-bound key can supply that new session without restoring old grants. Context is bounded text;
native reasoning output is archival, not transparent cross-run replay.

Validation uses synthetic native transports/SSE and isolated application data.
Opening a normal profile with a synthetic key verifies local setup only; it is not
a real API success. Real API and external TLS acceptance remain for the user.
