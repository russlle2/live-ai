export type LanguageCodeV1 = "en" | "es" | "fr" | "pt" | "de" | "it" | "unknown";

/**
 * detectLanguageV1
 * Lightweight heuristic. For truly robust multilingual output, enable LLM refinement/translation.
 */
export function detectLanguageV1(text: string): LanguageCodeV1 {
  const t = text.toLowerCase();

  // Very small heuristics to avoid extra dependencies.
  if (/[¿¡]/.test(text) || /\b(que|para|porque|precio|caro|vale la pena)\b/i.test(t)) return "es";
  if (/\b(prix|cher|valeur|raison)\b/i.test(t)) return "fr";
  if (/\b(preço|caro|valor|motivo)\b/i.test(t)) return "pt";
  if (/\b(preis|teuer|wert|warum)\b/i.test(t)) return "de";
  if (/\b(prezzo|caro|valore|perché)\b/i.test(t)) return "it";

  // Default
  return "en";
}
