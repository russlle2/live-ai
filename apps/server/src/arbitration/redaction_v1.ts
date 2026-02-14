/**
 * redactForLLMV1
 * Keep it simple + deterministic. Expand over time.
 */
export function redactForLLMV1(text: string): string {
  let t = text;

  // Emails
  t = t.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");

  // US-ish phone numbers (very loose)
  t = t.replace(/(\+?\d{1,2}\s*)?(\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g, "[REDACTED_PHONE]");

  // Credit card-ish sequences (loose; avoids long numeric leakage)
  t = t.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_NUMBER]");

  return t;
}
