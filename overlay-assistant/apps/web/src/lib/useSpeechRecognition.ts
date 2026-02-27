import { useRef, useState, useCallback, useEffect } from "react";

/**
 * useSpeechRecognition — Browser-native speech-to-text via Web Speech API.
 *
 * Works in Chrome, Edge, Safari. Firefox has partial support.
 * No API key needed — runs entirely in the browser.
 *
 * Returns interim results in real-time and fires onFinal when a
 * sentence/phrase is complete.
 */

type SpeechRecognitionEvent = any;
type SpeechRecognition = any;

// Extend Window to include vendor-prefixed SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export type UseSpeechOptions = {
  /** Called with interim (partial) recognized text */
  onInterim?: (text: string) => void;
  /** Called when a final transcript segment is ready */
  onFinal: (text: string) => void;
  /** Language (default: en-US) */
  lang?: string;
  /** Continuous listening mode (default: true) */
  continuous?: boolean;
};

export function useSpeechRecognition(opts: UseSpeechOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimText, setInterimText] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldRestart = useRef(false);

  // Check support on mount
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  const stop = useCallback(() => {
    shouldRestart.current = false;
    setIsListening(false);
    setInterimText("");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { /* already stopped */ }
      recognitionRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    // Stop any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const recognition = new SR();
    recognition.lang = opts.lang ?? "en-US";
    recognition.continuous = opts.continuous ?? true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalTranscript.trim()) {
        setInterimText("");
        opts.onFinal(finalTranscript.trim());
      } else if (interim) {
        setInterimText(interim);
        opts.onInterim?.(interim);
      }
    };

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      // Auto-restart if we're still in listening mode
      // (browser stops recognition after silence)
      if (shouldRestart.current) {
        try {
          recognition.start();
        } catch {
          setIsListening(false);
        }
      } else {
        setIsListening(false);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        // Expected — just restart
        return;
      }
      console.warn("[speech] Recognition error:", event.error);
      if (event.error === "not-allowed") {
        stop();
      }
    };

    shouldRestart.current = true;
    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [opts.lang, opts.continuous, opts.onFinal, opts.onInterim, stop]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestart.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    interimText,
    start,
    stop,
    toggle
  };
}
