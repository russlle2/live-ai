# Runtime v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the provider-neutral, interruption-aware runtime foundation and use it to fix cancellation, feedback attribution, slow style adaptation, and high-impact correctness defects in the existing app.

**Architecture:** A new pure TypeScript workspace package owns canonical runtime events, conversation reduction, guidance lifecycles, and style profiles. The existing server and web app adopt those contracts incrementally, preserving the runnable browser path while making stale work cancellable and feedback attributable.

**Tech Stack:** TypeScript 5.9, Vitest 2, React 18, Express 4, OpenAI Responses API, pnpm workspaces

**Execution status (2026-07-20):** Complete. All eight tasks shipped, with additional AudioWorklet VAD, local inference, encrypted archive/search, permissive local memory, and transport hardening. Automated/manual evidence and physical-platform exclusions are recorded in `docs/IMPLEMENTATION_CHECKPOINT.md`.

## Global Constraints

- Keep the current browser application runnable throughout this slice.
- Use test-first red/green cycles for every behavior change.
- Raw audio must never be persisted.
- Mixed overlap must remain unknown unless an authoritative source identifies the speaker.
- Style promotion requires 12 observations across 3 sessions.
- Exact phrases are reusable only when explicitly pinned.
- New turns must abort obsolete model work.
- Personal memory remains permissive; secret handling and factual grounding remain strict.
- Do not add cloud or platform-specific semantics to the runtime core.

---

## File map

### New runtime package

- `packages/runtime/package.json`: workspace package metadata and scripts.
- `packages/runtime/tsconfig.json`: strict NodeNext build.
- `packages/runtime/src/events_v2.ts`: canonical event envelope and validation.
- `packages/runtime/src/conversation_state_v2.ts`: overlapping-turn and interruption reducer.
- `packages/runtime/src/guidance_lifecycle_v2.ts`: deadline and cancellation coordinator.
- `packages/runtime/src/style_profile_v2.ts`: bounded slow-learning profile.
- `packages/runtime/src/index.ts`: public exports.
- `packages/runtime/test/fixtures.ts`: deterministic runtime-event builder used by reducer tests.
- `packages/runtime/test/*.test.ts`: pure conformance tests.

### Existing integration points

- `packages/shared/src/protocol/ws_messages_v1.ts`: attach a stable guidance ID and feedback status.
- `apps/server/src/arbitration/ai_coach_v1.ts`: accept and propagate `AbortSignal`.
- `apps/server/src/index.ts`: serialize transcript processing, cancel stale work, emit guidance IDs, and connect owner feedback.
- `apps/web/src/App.tsx`: retain the active guidance ID and send accurate apply/dismiss/mute feedback.
- `apps/web/src/components/OverlayPreview.tsx`: use the stable guidance ID instead of the fixed `text_v1` identifier.

### Correctness hardening

- `packages/shared/src/sanitize/sanitizePatch_v1.ts`: reject non-finite numeric values.
- `apps/server/src/arbitration/arbitration_v1.ts`: include speaker/domain data in cache identity.
- `apps/server/src/integrations/google/sources.ts`: align PDF metadata behavior with product documentation.
- `apps/server/src/integrations/google/cache.ts`: release deleted-source capacity.
- `apps/server/src/obs/identifiers.ts`: isolate opaque-ID generation.
- `apps/server/src/obs/emitLog.ts`: reuse isolated identifiers.
- `apps/server/src/db/queries.ts`: query telemetry with the stored opaque tenant ID.
- `apps/server/src/middleware/security.ts`: bound and sanitize request IDs.

## Task 1: Create the runtime package and canonical event envelope

**Files:**
- Create: `packages/runtime/package.json`
- Create: `packages/runtime/tsconfig.json`
- Create: `packages/runtime/src/events_v2.ts`
- Create: `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/events_v2.test.ts`

**Interfaces:**
- Produces: `RuntimeEventV2`, `RuntimeEventPayloadV2`, `parseRuntimeEventV2()`
- Consumes: no application package

- [ ] **Step 1: Write the failing event parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseRuntimeEventV2 } from "../src/events_v2.js";

describe("runtime event v2", () => {
  it("accepts a versioned, sequenced speech event", () => {
    expect(parseRuntimeEventV2({
      protocolVersion: 2,
      eventId: "evt-1",
      sessionId: "session-1",
      sourceId: "mic-1",
      sequence: 4,
      capturedAtMonotonicMs: 120.5,
      capturedAt: "2026-07-20T18:00:00.000Z",
      receivedAt: "2026-07-20T18:00:00.010Z",
      privacyClass: "private",
      provenance: "separated_channel",
      confidence: 1,
      payload: { type: "speech.started", turnId: "turn-1", speaker: "owner" }
    }).payload.type).toBe("speech.started");
  });

  it("rejects malformed, non-finite, and unknown payloads", () => {
    expect(() => parseRuntimeEventV2({ protocolVersion: 1 })).toThrow();
    expect(() => parseRuntimeEventV2({
      protocolVersion: 2,
      eventId: "evt",
      sessionId: "s",
      sourceId: "x",
      sequence: 1,
      capturedAtMonotonicMs: Number.NaN,
      capturedAt: "bad",
      receivedAt: "bad",
      privacyClass: "private",
      provenance: "unverified",
      confidence: 0,
      payload: { type: "made.up" }
    })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm -C packages/runtime test`

Expected: FAIL because the package and parser do not exist.

- [ ] **Step 3: Add package scaffolding and the strict parser**

The parser must:

- accept protocol version `2` only;
- accept finite nonnegative sequence/monotonic values;
- accept ISO timestamps;
- bound IDs to 240 characters;
- clamp no values silently;
- reject unknown event types;
- return a discriminated payload union for source, speech, transcript, overlap, interruption, and guidance lifecycle events.

- [ ] **Step 4: Run the package test and verify GREEN**

Run: `pnpm -C packages/runtime test`

Expected: 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add overlay-assistant/packages/runtime
git commit -m "feat: add canonical runtime event protocol"
```

## Task 2: Add interruption-aware conversation reduction

**Files:**
- Create: `packages/runtime/src/conversation_state_v2.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/fixtures.ts`
- Create: `packages/runtime/test/conversation_state_v2.test.ts`

**Interfaces:**
- Consumes: `RuntimeEventV2`
- Produces: `ConversationStateV2`, `initialConversationStateV2()`, `reduceConversationStateV2()`

- [ ] **Step 1: Write failing overlap and interruption tests**

Create the event fixture first:

```ts
import type {
  RuntimeEventPayloadV2,
  RuntimeEventV2
} from "../src/events_v2.js";

export function event(
  sequence: number,
  payload: RuntimeEventPayloadV2,
  sourceId = "owner-source"
): RuntimeEventV2 {
  return {
    protocolVersion: 2,
    eventId: `evt-${sequence}`,
    sessionId: "session-1",
    sourceId,
    sequence,
    capturedAtMonotonicMs: sequence * 10,
    capturedAt: `2026-07-20T18:00:${String(sequence).padStart(2, "0")}.000Z`,
    receivedAt: `2026-07-20T18:00:${String(sequence).padStart(2, "0")}.010Z`,
    privacyClass: "private",
    provenance: sourceId === "mixed-mic" ? "unverified" : "separated_channel",
    confidence: sourceId === "mixed-mic" ? 0 : 1,
    payload
  };
}
```

```ts
import { describe, expect, it } from "vitest";
import {
  initialConversationStateV2,
  reduceConversationStateV2
} from "../src/conversation_state_v2.js";
import { event } from "./fixtures.js";

describe("conversation state v2", () => {
  it("detects a remote interruption while owner speech remains active", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(2, {
      type: "speech.started",
      turnId: "remote-turn",
      speaker: "remote"
    }, "remote-source"));

    expect(state.activeTurns.map((turn) => turn.turnId).sort()).toEqual([
      "owner-turn",
      "remote-turn"
    ]);
    expect(state.overlapActive).toBe(true);
    expect(state.lastInterruption).toMatchObject({
      interruptedTurnId: "owner-turn",
      interruptingTurnId: "remote-turn"
    });
  });

  it("does not invent an interruption identity for unknown mixed speech", () => {
    let state = initialConversationStateV2("session-1");
    state = reduceConversationStateV2(state, event(1, {
      type: "speech.started",
      turnId: "owner-turn",
      speaker: "owner"
    }));
    state = reduceConversationStateV2(state, event(2, {
      type: "speech.started",
      turnId: "mixed-turn",
      speaker: "unknown"
    }, "mixed-mic"));

    expect(state.overlapActive).toBe(true);
    expect(state.lastInterruption).toBeNull();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm -C packages/runtime test -- conversation_state_v2`

Expected: FAIL because the reducer does not exist.

- [ ] **Step 3: Implement the pure reducer**

The reducer must:

- keep simultaneous active turns instead of one global speaker;
- treat remote-on-owner as an interruption only with remote identity;
- preserve unknown overlap without relabeling;
- close the exact turn on `speech.ended`;
- retain the latest 200 committed turns;
- ignore duplicate event IDs and stale source sequence numbers;
- keep the latest partial revision per turn;
- return new immutable state.

- [ ] **Step 4: Add deterministic replay and duplicate tests**

Replay the same event list twice and assert identical state. Repeat an event ID and assert no duplicate turn.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `pnpm -C packages/runtime test`

Expected: all runtime tests passing.

- [ ] **Step 6: Commit**

```bash
git add overlay-assistant/packages/runtime
git commit -m "feat: track overlapping turns and interruptions"
```

## Task 3: Add guidance deadlines and real cancellation

**Files:**
- Create: `packages/runtime/src/guidance_lifecycle_v2.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/guidance_lifecycle_v2.test.ts`

**Interfaces:**
- Produces: `GuidanceLeaseV2`, `GuidanceLifecycleV2`
- Consumes: a monotonic clock function

- [ ] **Step 1: Write failing cancellation tests**

```ts
import { describe, expect, it } from "vitest";
import { GuidanceLifecycleV2 } from "../src/guidance_lifecycle_v2.js";

describe("guidance lifecycle v2", () => {
  it("aborts obsolete work when a newer turn begins", () => {
    let now = 100;
    const lifecycle = new GuidanceLifecycleV2(() => now);
    const first = lifecycle.begin("turn-1", 1_500);
    const second = lifecycle.begin("turn-2", 1_500);

    expect(first.signal.aborted).toBe(true);
    expect(first.canPublish()).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.canPublish()).toBe(true);
  });

  it("refuses output after its deadline", () => {
    let now = 100;
    const lifecycle = new GuidanceLifecycleV2(() => now);
    const lease = lifecycle.begin("turn-1", 400);
    now = 501;
    expect(lease.canPublish()).toBe(false);
    expect(lease.status()).toBe("expired");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm -C packages/runtime test -- guidance_lifecycle_v2`

Expected: FAIL because the lifecycle does not exist.

- [ ] **Step 3: Implement the lifecycle**

Each `begin()` call creates a stable guidance ID, `AbortController`, turn binding, start time, and deadline. Beginning newer work aborts prior work. `canPublish()` requires current identity, an open signal, and a non-expired deadline.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm -C packages/runtime test`

Expected: all runtime tests passing.

- [ ] **Step 5: Commit**

```bash
git add overlay-assistant/packages/runtime
git commit -m "feat: add cancellable guidance lifecycle"
```

## Task 4: Implement slow, aggregate-only style adaptation

**Files:**
- Create: `packages/runtime/src/style_profile_v2.ts`
- Modify: `packages/runtime/src/index.ts`
- Create: `packages/runtime/test/style_profile_v2.test.ts`

**Interfaces:**
- Produces: `StyleFeaturesV2`, `StyleObservationV2`, `StyleProfileV2`, `extractStyleFeaturesV2()`, `promoteStyleProfileV2()`

- [ ] **Step 1: Write failing slow-promotion tests**

```ts
import { describe, expect, it } from "vitest";
import {
  emptyStyleProfileV2,
  promoteStyleProfileV2,
  type StyleObservationV2
} from "../src/style_profile_v2.js";

function observations(count: number, sessions: number): StyleObservationV2[] {
  return Array.from({ length: count }, (_, index) => ({
    observationId: `obs-${index}`,
    sessionId: `session-${index % sessions}`,
    turnId: `turn-${index}`,
    observedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    features: {
      wordsPerResponse: 10,
      wordsPerSentence: 8,
      questionRatio: 0.2,
      contractionRatio: 0.4,
      acknowledgmentRatio: 0.3,
      hedgeRatio: 0.1,
      directness: 0.8,
      warmth: 0.7
    },
    source: "owner_spontaneous"
  }));
}

describe("style profile v2", () => {
  it("does not promote before 12 observations across 3 sessions", () => {
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), observations(11, 3)).status)
      .toBe("insufficient_evidence");
    expect(promoteStyleProfileV2(emptyStyleProfileV2(), observations(12, 2)).status)
      .toBe("insufficient_session_diversity");
  });

  it("promotes bounded aggregate features without learning phrases", () => {
    const result = promoteStyleProfileV2(
      emptyStyleProfileV2(),
      observations(12, 3)
    );
    expect(result.status).toBe("promoted");
    expect(result.profile.version).toBe(1);
    expect(JSON.stringify(result.profile)).not.toContain("phrase");
    expect(result.profile.features.directness).toBeLessThanOrEqual(0.03);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm -C packages/runtime test -- style_profile_v2`

Expected: FAIL because the style profile does not exist.

- [ ] **Step 3: Implement bounded feature extraction and promotion**

Rules:

- minimum 12 unique observations;
- minimum 3 session IDs;
- duplicate observation IDs ignored;
- features are finite and clamped to documented ranges;
- initial movement per feature is capped at `0.03`;
- later updates use learning rate `0.05` and the same cap;
- no text or phrase field exists in the automatic profile;
- pinned phrases use a separate explicit API and never arise from promotion;
- factual corrections are excluded from style observations.

- [ ] **Step 4: Add tests for duplicate observations, non-finite values, and rollback**

Reject non-finite features, ensure duplicates do not satisfy thresholds, and verify that a previous profile object remains unchanged.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `pnpm -C packages/runtime test`

Expected: all runtime tests passing.

- [ ] **Step 6: Commit**

```bash
git add overlay-assistant/packages/runtime
git commit -m "feat: add slow bounded style adaptation"
```

## Task 5: Integrate stable guidance IDs and owner feedback

**Files:**
- Modify: `packages/shared/src/protocol/ws_messages_v1.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/OverlayPreview.tsx`
- Test: `packages/shared/test/protocol_lock_v1.test.ts`
- Create: `apps/server/src/session/guidance_feedback_v2.test.ts`
- Create: `apps/server/src/session/guidance_feedback_v2.ts`

**Interfaces:**
- Consumes: `guidanceId` from coaching delivery
- Produces: `GuidanceFeedbackStoreV2.mark()`, `GuidanceFeedbackStoreV2.takeForOwnerTurn()`

- [ ] **Step 1: Write failing protocol and feedback tests**

The protocol test asserts that a final coaching delivery contains a non-empty `guidanceId`. Feedback tests assert:

- apply marks the exact guidance as `accepted`;
- dismiss marks it `ignored`;
- mismatched or stale IDs do not attach to an owner turn;
- feedback is consumed once.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm -C packages/shared test -- protocol_lock_v1
pnpm -C apps/server test -- guidance_feedback_v2
```

Expected: FAIL because `guidanceId` and the store do not exist.

- [ ] **Step 3: Implement the feedback store and protocol field**

Add `guidanceId: string` to `CoachingDeliveryV1`. Store bounded pending feedback by session and guidance ID, with a ten-minute expiry and one-time consumption.

- [ ] **Step 4: Wire server and UI**

- `sendCoachingPatch()` emits the lifecycle guidance ID.
- `App` stores the current ID from each overlay message.
- `OverlayPreview` calls apply/dismiss with the real ID.
- `/api/ui-event` updates the feedback store after validating session ownership.
- mute toggles emit `mute_on` or `mute_off`.
- dismiss emits `suggestion_dismissed`.
- style-difference observations include feedback status and are not treated as accepted wording when ignored.

- [ ] **Step 5: Run focused and workspace tests**

Run: `pnpm run check`

Expected: all tests and typechecks passing.

- [ ] **Step 6: Commit**

```bash
git add overlay-assistant/packages/shared overlay-assistant/apps/server overlay-assistant/apps/web
git commit -m "feat: attribute guidance feedback with stable IDs"
```

## Task 6: Propagate cancellation into OpenAI work

**Files:**
- Modify: `apps/server/src/arbitration/ai_coach_v1.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/arbitration/ai_coach_v1.test.ts`
- Create: `apps/server/src/session/session_guidance_v2.ts`
- Create: `apps/server/src/session/session_guidance_v2.test.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: `GuidanceLifecycleV2`
- Produces: serialized `SessionGuidanceV2.beginTurn()`

- [ ] **Step 1: Add failing abort propagation tests**

Use a fake OpenAI client/request function that records the request option signal. Begin turn 1, begin turn 2, and assert turn 1's signal aborts and cannot publish.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm -C apps/server test -- session_guidance_v2 ai_coach_v1`

Expected: FAIL because the server does not accept a signal.

- [ ] **Step 3: Add runtime workspace dependency**

Run:

```bash
pnpm --filter @overlay-assistant/server add @overlay-assistant/runtime@workspace:*
```

- [ ] **Step 4: Implement cancellation and serialization**

- `getAiCoaching()` accepts `signal?: AbortSignal`.
- Pass `signal` through OpenAI request options.
- Treat `AbortError` as expected cancellation with a bounded event class.
- Each session owns one `SessionGuidanceV2`.
- New remote turns abort prior guidance.
- Transcript state updates are serialized per session.
- Provisional output is always followed by either final, rejected, cancelled, or superseded lifecycle state.
- Actual publish requires `lease.canPublish()`.

- [ ] **Step 5: Run focused and workspace tests**

Run:

```bash
pnpm -C apps/server test -- session_guidance_v2 ai_coach_v1
pnpm run check
```

Expected: all tests passing with no unhandled rejection.

- [ ] **Step 6: Commit**

```bash
git add overlay-assistant/apps/server overlay-assistant/pnpm-lock.yaml
git commit -m "feat: cancel obsolete coaching work"
```

## Task 7: Correct high-impact protocol, retrieval, and telemetry defects

**Files:**
- Modify: `packages/shared/src/sanitize/sanitizePatch_v1.ts`
- Modify: `packages/shared/test/sanitizePatch_v1.test.ts`
- Modify: `apps/server/src/arbitration/arbitration_v1.ts`
- Create: `apps/server/src/arbitration/arbitration_v1.test.ts`
- Modify: `apps/server/src/integrations/google/sources.ts`
- Modify: `apps/server/src/integrations/google/sources.test.ts`
- Modify: `apps/server/src/integrations/google/cache.ts`
- Modify: `apps/server/src/integrations/google/cache.test.ts`
- Create: `apps/server/src/obs/identifiers.ts`
- Create: `apps/server/src/obs/identifiers.test.ts`
- Modify: `apps/server/src/obs/emitLog.ts`
- Modify: `apps/server/src/db/queries.ts`
- Modify: `apps/server/src/middleware/security.ts`
- Create: `apps/server/src/middleware/security.test.ts`

**Interfaces:**
- Produces: finite patch values, cache-correct arbitration, PDF metadata admission, released cache capacity, shared opaque identifier, safe request ID.

- [ ] **Step 1: Add failing sanitizer tests**

Assert `NaN`, `Infinity`, and `-Infinity` settings are dropped and an otherwise empty patch is rejected.

- [ ] **Step 2: Add failing arbitration cache test**

Run the same transcript under different speakers and domain keywords and assert decisions do not cross-contaminate.

- [ ] **Step 3: Add failing Google tests**

- `DEFAULT_DRIVE_QUERY` includes `application/pdf`.
- `readDriveFile()` returns PDF metadata with `pdf_metadata_only`.
- deleting a cached source releases one capacity slot.

- [ ] **Step 4: Add failing telemetry/request tests**

- raw and opaque tenant IDs are never mixed in the trust query path;
- request IDs longer than 128 characters or containing controls are replaced with a generated UUID;
- valid short request IDs are preserved.

- [ ] **Step 5: Run focused tests and verify RED**

Run:

```bash
pnpm -C packages/shared test -- sanitizePatch_v1
pnpm -C apps/server test -- arbitration_v1 sources cache identifiers security
```

Expected: tests fail on current behavior.

- [ ] **Step 6: Implement minimal fixes**

- accept only finite numeric patch values;
- include speaker and sorted domain keywords in arbitration cache identity;
- admit PDF metadata but never fetch PDF body;
- remove deleted source entries instead of retaining capacity-consuming tombstones;
- move HMAC opaque-ID generation to `obs/identifiers.ts`;
- convert the raw tenant ID before querying stored telemetry;
- sanitize `X-Request-Id` to `^[A-Za-z0-9._:-]{1,128}$`.

- [ ] **Step 7: Run focused and workspace tests**

Run: `pnpm run check`

Expected: all tests and typechecks passing.

- [ ] **Step 8: Commit**

```bash
git add overlay-assistant/packages/shared overlay-assistant/apps/server
git commit -m "fix: harden runtime correctness boundaries"
```

## Task 8: Verify the complete foundation

**Files:**
- Modify: `docs/IMPLEMENTATION_CHECKPOINT.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks
- Produces: reproducible validation record and updated repository map

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
pnpm run check
pnpm run build
pnpm -C apps/server smoke:runtime
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=services/speaker/src python3 -m unittest discover -s services/speaker/tests -v
PYTHONDONTWRITEBYTECODE=1 python3 -m compileall -q -f services/speaker/src services/speaker/tests
pnpm audit --prod
```

Expected: zero failures and no known production dependency vulnerabilities.

- [ ] **Step 2: Run privacy and repository checks**

Run:

```bash
git diff --check
git status --short
```

Use the dedicated repository search tool to confirm no credential-shaped values were added outside test fixtures.

- [ ] **Step 3: Run manual browser acceptance**

Start the current server/web path in a persistent terminal. Verify:

- onboarding;
- authenticated session start;
- exact opening guidance;
- remote manual turn;
- provisional/final guidance;
- stable guidance feedback IDs;
- dismiss and mute telemetry behavior;
- no UI regression in transcript and memory panels.

Record one concise successful walkthrough video.

- [ ] **Step 4: Update implementation checkpoint**

Record exact test counts, build output, runtime smoke result, dependency audit result, and unverified Windows/Android physical paths.

- [ ] **Step 5: Commit and push**

```bash
git add overlay-assistant/docs/IMPLEMENTATION_CHECKPOINT.md overlay-assistant/README.md
git commit -m "docs: record runtime v2 foundation validation"
git push -u origin cursor/local-first-runtime-a4ef
```

