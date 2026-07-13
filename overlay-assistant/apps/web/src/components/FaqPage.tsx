import React, { useEffect } from "react";

const HELP = [
  {
    title: "Use Zoom or Google Meet",
    body: "Open the meeting and Live Rhetoric on the laptop. Choose call audio, allow the microphone, then select the Meet/Zoom browser tab—or a supported Zoom window/system source—with Share audio enabled. A browser tab is the cleanest remote track; headphones reduce echo."
  },
  {
    title: "Keep guidance on your phone",
    body: "Tap the session code on the laptop to copy its companion link. Open that link on your phone. The phone joins the same session and receives transcript and guidance updates without becoming another audio source."
  },
  {
    title: "What the speaker labels mean",
    body: "On separated laptop capture, Me means the microphone track and Other means the tab/system-audio track. In explicit two-person stereo mode, Me can also be a strong owner-voice match and Other can be a repeated opposite-side directional inference. The app does not claim to recognize the other person's biometric identity; conflicts stay Unknown."
  },
  {
    title: "Phone and speakerphone listening",
    body: "The installed phone view can use its foreground microphone for an in-room conversation or a speakerphone playing on another device. Android does not let an ordinary PWA or third-party app directly capture the protected uplink/downlink of a cellular or VoIP call on that same phone. If true stereo is exposed, the explicit fixed-side mode can calibrate direction; mono, movement, overlap, and conflicts remain Unknown."
  },
  {
    title: "How it learns your speaking style",
    body: "After a final exact line is shown and your verified microphone turn arrives, the app compares the suggested and spoken wording. It notes exact use, a natural paraphrase, or changed wording, then learns repeated length and phrasing patterns after at least three grounded comparisons."
  },
  {
    title: "How the coaching library is used",
    body: "Each verified Other turn retrieves a few relevant good-versus-weak contrasts from the reviewed library. The app uses their structure and guardrails, grounds personal claims only in your evidence bank, then applies safe patterns from your speaking style. External preference data stays quarantined until separately reviewed."
  },
  {
    title: "Why a generic line appears first",
    body: "As soon as the other person’s turn completes, a short deterministic bridge appears. It gives you a natural beat while the tailored response is generated, then the stronger response replaces it."
  },
  {
    title: "If Share audio is missing",
    body: "Use a Chromium-based browser on the laptop and share a browser tab that is playing audio. Make sure Share tab audio is checked in the picker. Some operating systems and browsers do not expose system audio. Typed Other input remains available in that case."
  },
  {
    title: "Install it like an app",
    body: "Use the Install button when it appears, or choose Add to Home screen from your mobile browser. The installed shell opens quickly, but live transcription and tailored coaching still require a network connection."
  },
  {
    title: "Audio, transcripts, and personal memory",
    body: "Active audio is transcribed through a short-lived OpenAI Realtime client secret; the permanent API key stays on the server. Transcript text and selected evidence-backed memory can be processed and stored by your private deployment. Do not assume a call is private: follow applicable consent, recording, employer, and interview-assistance rules."
  },
  {
    title: "Keep claims truthful",
    body: "The aide should turn verified experience into clear answers, not manufacture credentials, employment, licenses, or results. If a suggested detail is wrong or outdated, clear it and correct the source memory before relying on it."
  }
];

export function FaqPage({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="help-sheet" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <header>
          <div>
            <p className="eyebrow">Practical setup</p>
            <h1 id="help-title">Using Live Rhetoric</h1>
          </div>
          <button onClick={onClose} aria-label="Close help">×</button>
        </header>
        <div className="help-list">
          {HELP.map((item) => (
            <article key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
