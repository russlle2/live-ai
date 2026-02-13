/**
 * sanitizePatch_v1 (v1 strict)
 * - Fail-closed overlay patch sanitizer
 * - Allowlisted keys only
 * - Hard payload cap <= 8192 bytes (default)
 *
 * NOTE: Guidance patching is intentionally NOT supported in v1 strict,
 * because the repo's GuidanceItemV1 is a richer shape. We will enable it
 * later once we align the GuidanceItem schema. For now, "guidance" is dropped.
 */
export type PatchRejectReason = "payload_too_large" | "not_an_object" | "no_allowed_fields";
export type OverlaySettingsPatchV1 = Partial<{
    fontSize: number;
    speed: number;
    lineHeight: number;
    width: number;
    mirror: boolean;
    opacity: number;
}>;
export type OverlayPatchV1 = Partial<{
    text: string;
    settings: OverlaySettingsPatchV1;
}>;
export type SanitizedPatchV1 = OverlayPatchV1;
export type SanitizeOptionsV1 = {
    maxBytes?: number;
    maxTextChars?: number;
};
export type SanitizeOk = {
    ok: true;
    patch: OverlayPatchV1;
    bytes: number;
    droppedPaths: string[];
};
export type SanitizeErr = {
    ok: false;
    reason: PatchRejectReason;
    bytes: number;
    detailSafe?: string;
};
export declare function sanitizePatch_v1(input: unknown, opts?: SanitizeOptionsV1): SanitizeOk | SanitizeErr;
