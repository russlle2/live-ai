export type IntentId =
  | "scheduling"
  | "budget_discussion"
  | "security_compliance_question"
  | "integration_question"
  | "competitor_comparison"
  | "decision_process";

export type IntentScore = { intent: IntentId; matchScore: number; reasons: string[] };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

const PATTERNS: Record<IntentId, RegExp[]> = {
  scheduling: [/next week|calendar|schedule|book (a )?time|availability|meeting|follow.?up|call back|when can|free time/i],
  budget_discussion: [/budget|pricing|cost|too expensive|price|money|spend|afford|investment|roi|return/i],
  security_compliance_question: [/soc ?2|hipaa|gdpr|security|compliance|privacy|encryption|data protection|audit|penetration test/i],
  integration_question: [/integration|api|salesforce|hubspot|crm|slack|jira|sso|connect|plug.?in|sync|webhook|zapier/i],
  competitor_comparison: [/competitor|vs\.?|compare|already use|switch from|currently using|other option|alternative|looked at/i],
  decision_process: [/procurement|legal|decision process|approve|sign|security review|stakeholder|who decides|sign.?off|next step/i]
};

export function scoreIntents(tNorm: string): IntentScore[] {
  function hits(rxs: RegExp[]): number {
    let n = 0;
    for (const rx of rxs) if (rx.test(tNorm)) n++;
    return n;
  }

  const out: IntentScore[] = [];
  for (const k of Object.keys(PATTERNS) as IntentId[]) {
    const h = hits(PATTERNS[k]);
    if (h) out.push({ intent: k, matchScore: clamp01(0.6 + 0.12 * h), reasons: [`rx:${k}`] });
  }
  return out.sort((a, b) => b.matchScore - a.matchScore);
}
