import { createHash } from "node:crypto";
import type { MemorySensitivity } from "./types.js";

const CREDENTIAL_LINE = /\b(api[ _-]?key|password|passcode|passwd|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|authorization|bearer|private[ _-]?key|recovery[ _-]?code|verification[ _-]?code|one[ -]?time (?:password|code)|otp)\b\s*(?:is|was|:|=|#)\s*["']?\S{4,}/i;
const VERIFICATION_CODE_LINE = /\b(?:verification|one[ -]?time|security|login|recovery)\s+code\b[^\n]*\b\d{4,10}\b/i;
const ACCOUNT_ID = /\b(account|routing|passport|driver'?s? license|state id|social security|ssn|tax id|ein|medicare|medicaid)\s*(?:number|no\.?|#|id)?\s*[:=-]?\s*[a-z0-9-]{4,}\b/i;
const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/g;
const PAYMENT_CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const LONG_SECRET = /\b(?:sk|pk|ghp|github_pat|xox[baprs]|ya29)[-_a-z0-9]{12,}\b/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const QUERY_SECRET = /([?&](?:token|code|key|secret|signature|sig|auth|credential)=)[^&#\s]+/gi;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_NUMBER = /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}\b/g;
const STREET_ADDRESS = /\b\d{1,6}\s+[a-z0-9.' -]{2,60}\s(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|circle|cir|parkway|pkwy|highway|hwy)\b/gi;

const RESTRICTED_TERMS = /\b(felony|conviction|criminal record|probation|parole|addiction|substance use|sobriety|rehab|mental health|psychiatr|diagnos(?:is|ed)|medical record|disability|bankruptcy|domestic violence|sexual assault|social security|ssn)\b/i;
const SENSITIVE_TERMS = /\b(health|medical|therapy|counseling|recovery|legal|court|lawsuit|salary|compensation|debt|credit score|bank|financial aid|religion|pregnan|family emergency)\b/i;

export function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Remove secrets and exact government/financial identifiers before caching or model use. */
export function sanitizeGoogleSourceText(value: string, maxLength = 50_000): {
  text: string;
  exclusions: string[];
} {
  const exclusions = new Set<string>();
  let sanitized = value.replace(PRIVATE_KEY, () => {
    exclusions.add("private_key");
    return "[excluded credential material]";
  });
  sanitized = sanitized.replace(LONG_SECRET, () => {
    exclusions.add("credential_token");
    return "[excluded credential token]";
  });
  sanitized = sanitized.replace(QUERY_SECRET, (_match, prefix: string) => {
    exclusions.add("url_secret");
    return `${prefix}[excluded]`;
  });
  sanitized = sanitized.replace(EMAIL_ADDRESS, () => {
    exclusions.add("email_address");
    return "[excluded email address]";
  });
  sanitized = sanitized.replace(PHONE_NUMBER, () => {
    exclusions.add("phone_number");
    return "[excluded phone number]";
  });
  sanitized = sanitized.replace(STREET_ADDRESS, () => {
    exclusions.add("street_address");
    return "[excluded street address]";
  });
  sanitized = sanitized.replace(SSN, () => {
    exclusions.add("government_id");
    return "[excluded government ID]";
  });
  sanitized = sanitized.replace(PAYMENT_CARD, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (!passesLuhn(digits)) return candidate;
    exclusions.add("payment_card");
    return "[excluded payment card]";
  });

  sanitized = sanitized
    .split("\n")
    .map((line) => {
      if (CREDENTIAL_LINE.test(line) || VERIFICATION_CODE_LINE.test(line)) {
        exclusions.add("credential_line");
        return "[excluded credential-like content]";
      }
      if (ACCOUNT_ID.test(line)) {
        exclusions.add("account_or_government_id");
        return "[excluded account/government identifier]";
      }
      return line;
    })
    .join("\n");

  const text = normalizeText(sanitized).slice(0, maxLength);
  if (normalizeText(sanitized).length > maxLength) exclusions.add("truncated");
  return { text, exclusions: [...exclusions].sort() };
}

/** Sanitize a source label before it can enter cache, provenance, or model context. */
export function sanitizeGoogleSourceTitle(value: string, fallback: string): {
  text: string;
  exclusions: string[];
} {
  const sanitized = sanitizeGoogleSourceText(value, 500);
  return {
    text: sanitized.text.replace(/\n+/g, " ").trim() || fallback,
    exclusions: sanitized.exclusions
  };
}

export function classifySensitivity(text: string): MemorySensitivity {
  if (RESTRICTED_TERMS.test(text)) return "restricted";
  if (SENSITIVE_TERMS.test(text)) return "sensitive";
  return "normal";
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function stableId(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.map((part) => normalizeText(part).toLowerCase()).join("\u001f"))
    .digest("hex");
}

export function stripHtml(html: string): string {
  return normalizeText(
    html
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function passesLuhn(value: string): boolean {
  if (value.length < 13 || value.length > 19 || /^(\d)\1+$/.test(value)) return false;
  let sum = 0;
  let double = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}
