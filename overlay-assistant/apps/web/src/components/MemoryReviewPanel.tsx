import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteMemoryFact,
  getMemoryFacts,
  verifyOrCorrectMemoryFact
} from "../lib/api";
import {
  categorizeMemoryFacts,
  memoryReviewReasons,
  prepareVerifiedMemoryFact,
  type CategorizedMemoryFacts,
  type MemoryFact
} from "../lib/memoryReview";

type MemoryReviewPanelProps = {
  httpBase: string;
  getAuthToken: () => Promise<string>;
  onClose: () => void;
  onFactsChanged?: () => void | Promise<unknown>;
};

const EMPTY_FACTS: CategorizedMemoryFacts = { confirmedReviewClear: [], needsReview: [] };

function displayLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function FactMetadata({ fact }: { fact: MemoryFact }) {
  const sourceLabel = displayLabel(fact.source.type);
  return (
    <dl className="memory-fact-meta">
      <div><dt>Category</dt><dd>{displayLabel(fact.category)}</dd></div>
      <div><dt>Sensitivity</dt><dd className={`memory-sensitivity memory-sensitivity--${fact.sensitivity}`}>{displayLabel(fact.sensitivity)}</dd></div>
      <div><dt>Confidence</dt><dd>{Math.round(fact.confidence * 100)}%</dd></div>
      <div><dt>Source</dt><dd>{sourceLabel}</dd></div>
      {fact.source.title && <div className="memory-fact-meta__wide"><dt>Source title</dt><dd>{fact.source.title}</dd></div>}
      {fact.source.ref && <div className="memory-fact-meta__wide"><dt>Source reference</dt><dd><code>{fact.source.ref}</code></dd></div>}
    </dl>
  );
}

type FactCardProps = {
  fact: MemoryFact;
  needsReview: boolean;
  busy: boolean;
  working: boolean;
  editing: boolean;
  correction: string;
  onCorrectionChange: (value: string) => void;
  onStartCorrection: () => void;
  onCancelCorrection: () => void;
  onVerify: () => void;
  onSaveCorrection: () => void;
  onDelete: () => void;
};

function FactCard({
  fact,
  needsReview,
  busy,
  working,
  editing,
  correction,
  onCorrectionChange,
  onStartCorrection,
  onCancelCorrection,
  onVerify,
  onSaveCorrection,
  onDelete
}: FactCardProps) {
  const reasons = needsReview ? memoryReviewReasons(fact) : [];
  const correctionId = `memory-correction-${fact.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <article className={`memory-fact-card ${needsReview ? "memory-fact-card--review" : "memory-fact-card--verified"}`}>
      <div className="memory-fact-status">
        <span>{needsReview ? "Needs owner review" : "Confirmed + review-clear"}</span>
        <small>{fact.temporality}</small>
      </div>
      <p className="memory-fact-text">{fact.fact}</p>
      <FactMetadata fact={fact} />

      {reasons.length > 0 && (
        <div className="memory-review-reasons">
          <strong>Why it needs review</strong>
          <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      {(fact.source.type === "gmail" || fact.source.type === "drive") && (
        <p className="memory-source-refresh-note">If this Google source changes, a later sync can replace the stored extraction and require review again.</p>
      )}

      {editing ? (
        <form className="memory-correction" onSubmit={(event) => {
          event.preventDefault();
          onSaveCorrection();
        }}>
          <label htmlFor={correctionId}>Correct this fact, then save it as verified</label>
          <textarea
            id={correctionId}
            value={correction}
            onChange={(event) => onCorrectionChange(event.target.value)}
            minLength={2}
            maxLength={4000}
            rows={4}
            autoFocus
            disabled={busy}
          />
          <div className="memory-fact-actions">
            <button type="submit" className="memory-action memory-action--primary" disabled={busy || correction.trim().length < 2}>
              {working ? "Saving…" : "Save correction"}
            </button>
            <button type="button" className="memory-action" onClick={onCancelCorrection} disabled={busy}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="memory-fact-actions">
          {needsReview && (
            <>
              <button type="button" className="memory-action memory-action--primary" onClick={onVerify} disabled={busy}>
                {working ? "Saving…" : "Verify as written"}
              </button>
              <button type="button" className="memory-action" onClick={onStartCorrection} disabled={busy}>Correct</button>
            </>
          )}
          <button type="button" className="memory-action memory-action--delete" onClick={onDelete} disabled={busy}>
            {working ? "Working…" : "Delete"}
          </button>
        </div>
      )}
    </article>
  );
}

export function MemoryReviewPanel({ httpBase, getAuthToken, onClose, onFactsChanged }: MemoryReviewPanelProps) {
  const [facts, setFacts] = useState<CategorizedMemoryFacts>(EMPTY_FACTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadFacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const response = await getMemoryFacts(httpBase, token);
      setFacts(categorizeMemoryFacts(response.facts));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Memory facts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [getAuthToken, httpBase]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    void loadFacts();
  }, [loadFacts]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyId) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busyId, onClose]);

  const afterMutation = useCallback(async (message: string) => {
    await loadFacts();
    setNotice(message);
    try {
      await onFactsChanged?.();
    } catch {
      // The fact mutation succeeded; the next runtime poll will refresh its count.
    }
  }, [loadFacts, onFactsChanged]);

  const verify = useCallback(async (fact: MemoryFact, correctedText?: string) => {
    setBusyId(fact.id);
    setError(null);
    setNotice(null);
    try {
      const token = await getAuthToken();
      await verifyOrCorrectMemoryFact(prepareVerifiedMemoryFact(fact, correctedText), httpBase, token);
      setEditingId(null);
      setCorrection("");
      await afterMutation(correctedText ? "Correction saved and verified." : "Fact verified.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The fact could not be saved.");
    } finally {
      setBusyId(null);
    }
  }, [afterMutation, getAuthToken, httpBase]);

  const remove = useCallback(async (fact: MemoryFact) => {
    if (!window.confirm(`Delete this ${displayLabel(fact.category).toLowerCase()} memory fact? This cannot be undone.`)) return;
    setBusyId(fact.id);
    setError(null);
    setNotice(null);
    try {
      const token = await getAuthToken();
      await deleteMemoryFact(fact.id, httpBase, token);
      if (editingId === fact.id) {
        setEditingId(null);
        setCorrection("");
      }
      await afterMutation("Fact deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The fact could not be deleted.");
    } finally {
      setBusyId(null);
    }
  }, [afterMutation, editingId, getAuthToken, httpBase]);

  const renderFact = (fact: MemoryFact, needsReview: boolean) => (
    <FactCard
      key={fact.id}
      fact={fact}
      needsReview={needsReview}
      busy={Boolean(busyId)}
      working={busyId === fact.id}
      editing={editingId === fact.id}
      correction={editingId === fact.id ? correction : ""}
      onCorrectionChange={setCorrection}
      onStartCorrection={() => {
        setEditingId(fact.id);
        setCorrection(fact.fact);
        setNotice(null);
      }}
      onCancelCorrection={() => {
        setEditingId(null);
        setCorrection("");
      }}
      onVerify={() => void verify(fact)}
      onSaveCorrection={() => void verify(fact, correction)}
      onDelete={() => void remove(fact)}
    />
  );

  const total = facts.confirmedReviewClear.length + facts.needsReview.length;
  return (
    <div className="memory-review-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !busyId) onClose();
    }}>
      <section className="memory-review-panel" role="dialog" aria-modal="true" aria-labelledby="memory-review-title" aria-describedby="memory-review-description">
        <header>
          <div>
            <p className="eyebrow">Owner-controlled memory</p>
            <h1 id="memory-review-title">Review what the aide knows</h1>
            <p id="memory-review-description">Confirm only claims you recognize. Normal review-clear facts can be eligible before confirmation; restricted facts stay excluded from live coaching even after confirmation. Only stored fact text and limited provenance are rendered as plain text; raw source contents, search keywords, and app credentials are not requested by this panel.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={Boolean(busyId)} aria-label="Close memory review">×</button>
        </header>

        <div className="memory-review-summary" aria-live="polite">
          <div><strong>{facts.needsReview.length}</strong><span>Needs owner review</span></div>
          <div><strong>{facts.confirmedReviewClear.length}</strong><span>Confirmed + clear</span></div>
          <div><strong>{total}</strong><span>Total shown</span></div>
          <button type="button" onClick={() => void loadFacts()} disabled={loading || Boolean(busyId)}>{loading ? "Loading…" : "Refresh"}</button>
        </div>

        {error && <div className="memory-review-message memory-review-message--error" role="alert">{error}</div>}
        {notice && <div className="memory-review-message memory-review-message--success" role="status">{notice}</div>}

        <div className="memory-review-content">
          {loading ? (
            <div className="memory-review-empty" role="status">Loading private memory…</div>
          ) : error && total === 0 ? (
            <div className="memory-review-empty"><button type="button" className="memory-action" onClick={() => void loadFacts()}>Try again</button></div>
          ) : (
            <>
              <section className="memory-fact-group" aria-labelledby="needs-review-heading">
                <div className="memory-fact-group__heading">
                <div><h2 id="needs-review-heading">Needs owner review</h2><p>Unverified or flagged claims. Normal, review-clear items may already be eligible; verify, correct, or delete what you find.</p></div>
                  <span>{facts.needsReview.length}</span>
                </div>
                {facts.needsReview.length > 0
                  ? <div className="memory-fact-list">{facts.needsReview.map((fact) => renderFact(fact, true))}</div>
                  : <div className="memory-review-empty">Nothing is waiting for review.</div>}
              </section>

              <section className="memory-fact-group" aria-labelledby="verified-memory-heading">
                <div className="memory-fact-group__heading">
                  <div><h2 id="verified-memory-heading">Confirmed + review-clear</h2><p>Facts you confirmed that have no unresolved review flag. Restricted facts remain excluded from live coaching.</p></div>
                  <span>{facts.confirmedReviewClear.length}</span>
                </div>
                {facts.confirmedReviewClear.length > 0
                  ? <div className="memory-fact-list">{facts.confirmedReviewClear.map((fact) => renderFact(fact, false))}</div>
                  : <div className="memory-review-empty">No verified facts yet.</div>}
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
