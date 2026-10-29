import { createOutboundConsentGate } from "@uagent/runtime";
// Ephemeral consent only. Never serialize this gate or its single-use grants.
export const outboundReviewGate = createOutboundConsentGate();
