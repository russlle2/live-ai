// Failure codes based on the Context Pack taxonomy.
// Keep this union stable (ship gate).
export type FailureCode =
  // WS
  | "ws_connect_failed"
  | "ws_unexpected_close"
  | "ws_ready_timeout"
  | "ws_pong_timeout"

  // Audio / STT
  | "audio_permission_denied"
  | "audio_device_not_found"
  | "pcm_frame_alignment_error"
  | "stt_backpressure"
  | "stt_no_transcript_timeout"

  // LLM
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_malformed_output"

  // Guidance
  | "guidance_internal_error"
  | "guidance_runaway_volume"
  | "guidance_suppressed_expected"

  // Overlay
  | "overlay_popup_blocked"
  | "broadcastchannel_unsupported"
  | "overlay_desync_detected"

  // Patch safety
  | "patch_rejected"
  | "patch_payload_too_large"

  // Knowledge
  | "knowledge_no_active_index"
  | "knowledge_retrieval_timeout"
  | "knowledge_retrieval_failed"
  | "knowledge_ingest_failed"

  // Learning / persistence
  | "learning_store_unavailable"
  | "local_storage_quota";
