/**
 * overlay_messages_v1
 * Overlay inbound protocol: only these types are allowed in v1.
 */
import type { SanitizedPatchV1 } from "../sanitize/sanitizePatch_v1";
export type OverlayInboundMessageV1 = {
    type: "script";
    text: string;
} | {
    type: "settings";
    settings: Record<string, unknown>;
} | {
    type: "patch";
    patch: SanitizedPatchV1;
};
export type OverlayMessageV1 = OverlayInboundMessageV1;
export declare const OVERLAY_INBOUND_TYPES_V1: readonly ["script", "settings", "patch"];
