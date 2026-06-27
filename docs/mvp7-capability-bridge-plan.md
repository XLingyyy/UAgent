# MVP7 Capability Bridge Plan

## Architecture

The Capability Bridge is a policy-first runtime service:

`CapabilityRequest -> CapabilityDecision -> fixture/read-only adapter or blocked result -> TaskEvent/Audit/Session/Evidence projection`.

UI controls never bypass policy. The default mode is disabled or fixture.

## Capability Modes

- `disabled`: visible state, no adapter call.
- `fixture`: deterministic simulated result, no external side effect.
- `read_only`: project-root allowlisted read-only result.
- `manual_live`: explicit opt-in only, requires confirmation and `secretRef`; default CI and UI tests stay fixture.

## Capability Kinds

- Files: read-only previews inside registered roots; write/delete/move/rename/mkdir blocked.
- Terminal: command proposal and fixture output only; no shell execution.
- Browser: request preview and fixture navigation summary only; external URLs blocked by default; no `window.open` or `location.href`.
- Screenshot: permission model and fixture metadata only; no `getDisplayMedia`.
- Provider live: manual opt-in, confirmation, and `secretRef` required; missing secret or missing confirmation blocks.

## Decisions

Decisions are normalized to `allow`, `requires_approval`, or `blocked`, with reason values such as `disabled`, `fixture_only`, `allowed_read_only`, `requires_approval`, `blocked`, `missing_secret`, `manual_confirmation_required`, `out_of_scope`, and `limit_exceeded`.

## Approval, Sandbox, Audit, Session

Sensitive actions require approval before an adapter may run. Deny, cancel, and timeout produce events but do not execute adapters. Sandbox policy blocks write/exec/capture/browser-control by default. All payloads pass recursive redaction before audit/session/replay display.
