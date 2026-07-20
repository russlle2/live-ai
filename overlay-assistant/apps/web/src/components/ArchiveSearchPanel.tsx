import React, { useEffect, useRef, useState } from "react";
import { searchTranscriptArchive } from "../lib/api";
import {
  normalizeArchiveResults,
  type ArchiveSearchResult
} from "../lib/archiveSearch";

type ArchiveSearchPanelProps = {
  httpBase: string;
  getAuthToken: () => Promise<string>;
  onClose: () => void;
};

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function displayDate(value: string): string {
  if (!value) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ArchiveSearchPanel({
  httpBase,
  getAuthToken,
  onClose
}: ArchiveSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArchiveSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [loading, onClose]);

  const search = async () => {
    const normalized = query.trim();
    if (normalized.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getAuthToken();
      const values = await searchTranscriptArchive(
        normalized,
        httpBase,
        token
      );
      setResults(normalizeArchiveResults(values));
      setSearched(true);
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "The encrypted archive could not be searched."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="archive-search-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !loading) onClose();
      }}
    >
      <section
        className="archive-search-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-search-title"
      >
        <header>
          <div>
            <p className="eyebrow">Encrypted personal archive</p>
            <h1 id="archive-search-title">Search past conversations</h1>
            <p>Search happens locally after records are decrypted in memory. Raw audio is never retained.</p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Close archive search">×</button>
        </header>

        <form
          className="archive-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={2}
            maxLength={500}
            placeholder="What did we decide about reliability?"
            aria-label="Search encrypted transcripts"
          />
          <button type="submit" disabled={loading || query.trim().length < 2}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <div className="archive-search-message" role="alert">{error}</div>}
        <div className="archive-search-results" aria-live="polite">
          {!searched && !loading ? (
            <div className="archive-search-empty">Enter two or more words from a prior conversation.</div>
          ) : searched && results.length === 0 ? (
            <div className="archive-search-empty">No matching transcript turns were found.</div>
          ) : (
            results.map((result, index) => (
              <article key={`${result.sessionId}-${result.at}-${index}`}>
                <header>
                  <strong>{result.speaker === "rep" ? "Me" : result.speaker === "lead" ? "Other" : "Unknown"}</strong>
                  <span>{label(result.mode)} · {displayDate(result.at)}</span>
                </header>
                <p>{result.text}</p>
                <footer>Session <code>{result.sessionId}</code></footer>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
