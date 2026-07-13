import type { ScenarioModeV1, SessionProfileV1 } from "../types/session_v1.js";
export declare const CONVERSATION_PLAYBOOK_STAGE_IDS_V1: readonly ["greeting", "rapport", "discovery", "proof", "questions", "close", "goodbye"];
export type ConversationPlaybookStageIdV1 = (typeof CONVERSATION_PLAYBOOK_STAGE_IDS_V1)[number];
export type ConversationPlaybookStageV1 = {
    id: ConversationPlaybookStageIdV1;
    order: number;
    title: string;
    /** Exact, directly speakable words. No fill-in-the-blank substitution is required. */
    say: string;
};
export type ConversationPlaybookV1 = {
    schema: "conversation_playbook_v1";
    mode: ScenarioModeV1;
    stages: ConversationPlaybookStageV1[];
};
export type SelectNextPlaybookStageInputV1 = {
    /** Recent conversation text. Used only for local, deterministic cue matching. */
    transcript?: string;
    completedStageIds?: readonly ConversationPlaybookStageIdV1[];
};
/** Build a complete, offline script from greeting through goodbye. */
export declare function buildConversationPlaybookV1(profile: SessionProfileV1): ConversationPlaybookV1;
/** Return the complete opening stage, including its exact spoken line. */
export declare function getInitialPlaybookStageV1(profile: SessionProfileV1): ConversationPlaybookStageV1;
/** Convenience helper for surfaces that need only the first exact line. */
export declare function getInitialGreetingV1(profile: SessionProfileV1): string;
/**
 * Infer a relevant script stage from transcript cues. This does not call a
 * model, inspect private memory, or treat transcript content as instructions.
 */
export declare function inferPlaybookStageIdV1(transcript: string | undefined): ConversationPlaybookStageIdV1 | undefined;
/**
 * Select the next useful stage. The greeting is always first unless it was
 * explicitly completed. Afterwards, strong transcript cues can jump to a
 * relevant unfinished stage; otherwise the first unfinished stage is used.
 */
export declare function selectNextPlaybookStageV1(profile: SessionProfileV1, input?: SelectNextPlaybookStageInputV1): ConversationPlaybookStageV1;
