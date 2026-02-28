/** Package version — used for API version negotiation and cache busting */
export const SHARED_VERSION = "1.1.0";

export * from "./types/core_types_v1";
export * from "./protocol/ws_messages_v1";
export * from "./protocol/overlay_messages_v1";
export * from "./protocol/failure_codes_v1";
export * from "./sanitize/sanitizePatch_v1";
