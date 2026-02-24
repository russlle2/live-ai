import React, { useEffect, useMemo, useState } from "react";

const API_KEY = (import.meta as any).env?.VITE_OVERLAY_API_KEY as string | undefined;

type Provider = "zoom" | "google";

type PrivacyControls = {
  transcriptOptOut: boolean;
  encryptTranscriptFields: boolean;
  retentionDays: number;
};

type RetentionStatus = {
  enabled: boolean;
  intervalMs: number;
  lastRun?: {
    at: string;
    mode: "manual" | "scheduled";
    result?: {
      tenantsProcessed: number;
      deletedObs: number;
      deletedTimeline: number;
      deletedCrm: number;
      deletedSessions: number;
    };
    error?: string;
  } | null;
};

export function SetupPanel(props: { tenantId: string; sessionId: string }) {
  const [status, setStatus] = useState<Record<Provider, boolean>>({ zoom: false, google: false });
  const [busy, setBusy] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [privacy, setPrivacy] = useState<PrivacyControls>({ transcriptOptOut: false, encryptTranscriptFields: true, retentionDays: 30 });
  const [retentionStatus, setRetentionStatus] = useState<RetentionStatus | null>(null);

  const headers = useMemo(() => ({ "Content-Type": "application/json", ...(API_KEY ? { "x-overlay-key": API_KEY } : {}) }), []);

  const loadStatuses = async () => {
    const providers: Provider[] = ["zoom", "google"];
    const next: Record<Provider, boolean> = { zoom: false, google: false };

    for (const provider of providers) {
      const res = await fetch(`http://localhost:8080/api/integrations/oauth/status?tenantId=${encodeURIComponent(props.tenantId)}&provider=${provider}`, {
        headers: API_KEY ? { "x-overlay-key": API_KEY } : {}
      });
      const json = await res.json().catch(() => ({}));
      next[provider] = Boolean(json?.connected);
    }

    setStatus(next);
  };

  const loadPrivacy = async () => {
    const res = await fetch(`http://localhost:8080/api/privacy/controls?tenantId=${encodeURIComponent(props.tenantId)}`, {
      headers: API_KEY ? { "x-overlay-key": API_KEY } : {}
    });
    const json = await res.json().catch(() => ({}));
    if (json?.controls) {
      setPrivacy({
        transcriptOptOut: Boolean(json.controls.transcriptOptOut),
        encryptTranscriptFields: Boolean(json.controls.encryptTranscriptFields),
        retentionDays: Number(json.controls.retentionDays || 30)
      });
    }
  };

  const loadRetentionStatus = async () => {
    const res = await fetch(`http://localhost:8080/api/privacy/retention-status?tenantId=${encodeURIComponent(props.tenantId)}`, {
      headers: API_KEY ? { "x-overlay-key": API_KEY } : {}
    });
    const json = await res.json().catch(() => ({}));
    if (json?.ok && json?.scheduler) {
      setRetentionStatus(json.scheduler as RetentionStatus);
    }
  };

  const beginOauth = async (provider: Provider) => {
    setBusy(`oauth:${provider}`);
    setMessage("");

    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}?provider=${provider}`;
      const res = await fetch("http://localhost:8080/api/integrations/oauth/start", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenantId: props.tenantId, provider, redirectUri })
      });
      const json = await res.json();
      if (!json?.ok || !json?.authUrl) {
        setMessage(`Could not start ${provider} OAuth: ${json?.error || "unknown_error"}`);
        return;
      }
      window.location.href = json.authUrl;
    } finally {
      setBusy("");
    }
  };

  const completeOauthIfPresent = async () => {
    const q = new URLSearchParams(window.location.search);
    const code = q.get("code");
    const state = q.get("state");
    const provider = q.get("provider") as Provider | null;

    if (!code || !state || (provider !== "zoom" && provider !== "google")) return;

    setBusy(`callback:${provider}`);
    setMessage("");
    try {
      const redirectUri = `${window.location.origin}${window.location.pathname}?provider=${provider}`;
      const res = await fetch("http://localhost:8080/api/integrations/oauth/callback", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenantId: props.tenantId, provider, code, state, redirectUri })
      });
      const json = await res.json().catch(() => ({}));

      if (!json?.ok) {
        setMessage(`OAuth callback failed for ${provider}: ${json?.error || "unknown_error"}`);
      } else {
        setMessage(`${provider} connected successfully.`);
      }
    } finally {
      window.history.replaceState({}, document.title, window.location.pathname);
      setBusy("");
      await loadStatuses();
    }
  };

  const savePrivacy = async () => {
    setBusy("privacy");
    setMessage("");
    try {
      const res = await fetch("http://localhost:8080/api/privacy/controls", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenantId: props.tenantId, ...privacy })
      });
      const json = await res.json().catch(() => ({}));
      setMessage(json?.ok ? "Privacy controls saved." : `Failed to save privacy controls: ${json?.error || "unknown_error"}`);
    } finally {
      setBusy("");
    }
  };

  const deleteSessionArtifacts = async () => {
    setBusy("delete-session");
    setMessage("");
    try {
      const res = await fetch("http://localhost:8080/api/privacy/delete-session", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenantId: props.tenantId, sessionId: props.sessionId })
      });
      const json = await res.json().catch(() => ({}));
      setMessage(json?.ok ? "Session artifacts deleted." : `Delete failed: ${json?.error || "unknown_error"}`);
    } finally {
      setBusy("");
    }
  };

  const runRetentionNow = async () => {
    setBusy("retention-run");
    setMessage("");
    try {
      const res = await fetch("http://localhost:8080/api/privacy/prune-retention", {
        method: "POST",
        headers,
        body: JSON.stringify({ tenantId: props.tenantId })
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) {
        setMessage(`Retention run failed: ${json?.error || "unknown_error"}`);
      } else {
        setMessage("Retention prune completed.");
      }
      await loadRetentionStatus();
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    loadStatuses().catch(() => undefined);
    loadPrivacy().catch(() => undefined);
    loadRetentionStatus().catch(() => undefined);
    completeOauthIfPresent().catch(() => undefined);
  }, [props.tenantId]);

  return (
    <div style={{ border: "1px solid #2b3a51", borderRadius: 12, padding: 12, marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Setup: Integrations + Privacy</h3>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <button disabled={busy.length > 0} onClick={() => beginOauth("zoom")}>
          {status.zoom ? "Zoom connected" : "Connect Zoom"}
        </button>
        <button disabled={busy.length > 0} onClick={() => beginOauth("google")}>
          {status.google ? "Google connected" : "Connect Google"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
        <label>
          <input
            type="checkbox"
            checked={privacy.transcriptOptOut}
            onChange={(e) => setPrivacy((s) => ({ ...s, transcriptOptOut: e.target.checked }))}
          />
          &nbsp;Transcript opt-out
        </label>

        <label>
          <input
            type="checkbox"
            checked={privacy.encryptTranscriptFields}
            onChange={(e) => setPrivacy((s) => ({ ...s, encryptTranscriptFields: e.target.checked }))}
          />
          &nbsp;Encrypt transcript fields
        </label>

        <label>Retention days</label>
        <input
          type="number"
          min={1}
          max={3650}
          value={privacy.retentionDays}
          onChange={(e) => setPrivacy((s) => ({ ...s, retentionDays: Number(e.target.value || 30) }))}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button disabled={busy.length > 0} onClick={savePrivacy}>Save privacy</button>
        <button disabled={busy.length > 0} onClick={deleteSessionArtifacts}>Delete current session artifacts</button>
      </div>

      <div style={{ marginTop: 12, borderTop: "1px solid #2b3a51", paddingTop: 10 }}>
        <h4 style={{ margin: "0 0 8px" }}>Retention admin</h4>
        <div style={{ fontSize: 12, color: "#9db2ce" }}>
          Scheduler: <b>{retentionStatus?.enabled ? "enabled" : "disabled"}</b>
          {retentionStatus ? ` • every ${Math.max(1, Math.round(retentionStatus.intervalMs / 60000))} min` : ""}
        </div>
        {retentionStatus?.lastRun ? (
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Last run: <b>{new Date(retentionStatus.lastRun.at).toLocaleString()}</b> ({retentionStatus.lastRun.mode})
            {retentionStatus.lastRun.result ? (
              <span>
                {` • obs ${retentionStatus.lastRun.result.deletedObs}, timeline ${retentionStatus.lastRun.result.deletedTimeline}, crm ${retentionStatus.lastRun.result.deletedCrm}, sessions ${retentionStatus.lastRun.result.deletedSessions}`}
              </span>
            ) : null}
            {retentionStatus.lastRun.error ? <span style={{ color: "#ff9ca8" }}>{` • error: ${retentionStatus.lastRun.error}`}</span> : null}
          </div>
        ) : (
          <div style={{ fontSize: 12, marginTop: 6, color: "#9db2ce" }}>No retention runs recorded yet.</div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button disabled={busy.length > 0} onClick={runRetentionNow}>Run retention now</button>
          <button disabled={busy.length > 0} onClick={() => loadRetentionStatus().catch(() => undefined)}>Refresh status</button>
        </div>
      </div>

      {message ? <div style={{ marginTop: 8, fontSize: 13 }}>{message}</div> : null}
    </div>
  );
}
