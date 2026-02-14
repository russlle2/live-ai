import type { ObjectionKeyV1, ObjectionStackEntryV1, ObjectionStackV1 } from "./types_pro_v1";

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function nowMs(): number {
  return Date.now();
}

const RX: Record<ObjectionKeyV1, Array<{ id: string; re: RegExp; w: number }>> = {
  price: [
    { id: "price:expensive", re: /\b(expensive|too much|pricey|overpriced)\b/i, w: 0.55 },
    { id: "price:pricing", re: /\b(pricing|price|cost|budget|rate|per seat|per user)\b/i, w: 0.40 },
    { id: "price:discount", re: /\b(discount|deal|negotiate|cheaper)\b/i, w: 0.35 }
  ],
  value_roi: [
    { id: "roi:worth", re: /\b(worth it|value|benefit)\b/i, w: 0.40 },
    { id: "roi:roi", re: /\b(roi|payback|return|savings|cost control)\b/i, w: 0.50 },
    { id: "roi:outcomes", re: /\b(outcome|impact|results|time[- ]to[- ]value)\b/i, w: 0.35 }
  ],
  integration: [
    { id: "int:integration", re: /\b(integration|integrate|connect|sync|webhook|api)\b/i, w: 0.55 },
    { id: "int:systems", re: /\b(salesforce|hubspot|crm|sso|okta|azure ad|google workspace|data warehouse|snowflake|bigquery)\b/i, w: 0.45 },
    { id: "int:writeback", re: /\b(writeback|two[- ]way|bi[- ]directional|real[- ]time|latency)\b/i, w: 0.40 }
  ],
  security_compliance: [
    { id: "sec:soc2", re: /\b(soc ?2|iso ?27001)\b/i, w: 0.60 },
    { id: "sec:privacy", re: /\b(gdpr|hipaa|pii|privacy|data retention|dpa)\b/i, w: 0.55 },
    { id: "sec:security", re: /\b(security|compliance|encryption|audit logs?|access controls?)\b/i, w: 0.40 }
  ],
  competitor: [
    { id: "comp:compare", re: /\b(compare|compared|comparison|evaluating|shortlist)\b/i, w: 0.35 },
    { id: "comp:vs", re: /\b(vs\.?|versus|alternative|other vendors?)\b/i, w: 0.40 },
    { id: "comp:already", re: /\b(already use|switch(ing)? from|incumbent)\b/i, w: 0.50 }
  ],
  timing: [
    { id: "time:later", re: /\b(not now|later|next quarter|q[1-4]|in a few weeks?)\b/i, w: 0.55 },
    { id: "time:deadline", re: /\b(deadline|by (today|tomorrow|this week|next week)|asap|urgent)\b/i, w: 0.45 },
    { id: "time:timeline", re: /\b(timeline|timing|when can we|go live|rollout)\b/i, w: 0.40 }
  ],
  authority: [
    { id: "auth:signoff", re: /\b(sign[- ]?off|who signs|approve|approval)\b/i, w: 0.60 },
    { id: "auth:stakeholders", re: /\b(decision maker|stakeholders?|committee|exec sponsor)\b/i, w: 0.45 },
    { id: "auth:cfo", re: /\b(cfo|vp|director|ceo|founder)\b/i, w: 0.35 }
  ],
  legal_procurement: [
    { id: "lp:procurement", re: /\b(procurement|legal|msa|sow|po|security review)\b/i, w: 0.60 },
    { id: "lp:terms", re: /\b(terms|redlines?|contract)\b/i, w: 0.45 }
  ],
  risk_trust: [
    { id: "risk:trust", re: /\b(trust|reliable|reliability|uptime|downtime)\b/i, w: 0.45 },
    { id: "risk:risk", re: /\b(risk|risky|concerned|worried)\b/i, w: 0.40 }
  ],
  feature_fit: [
    { id: "fit:must", re: /\b(must[- ]have|require|need|non[- ]negotiable)\b/i, w: 0.45 },
    { id: "fit:missing", re: /\b(missing|does it|can you|support)\b/i, w: 0.40 }
  ],
  deployment_it: [
    { id: "dep:deploy", re: /\b(deploy|deployment|install|it|infosec|admin)\b/i, w: 0.45 },
    { id: "dep:onprem", re: /\b(on[- ]prem|self[- ]host|air[- ]gapped)\b/i, w: 0.55 },
    { id: "dep:cloud", re: /\b(cloud|saas|device)\b/i, w: 0.25 }
  ]
};

const LABEL: Record<ObjectionKeyV1, string> = {
  price: "price / budget",
  value_roi: "ROI / value",
  integration: "integration depth",
  security_compliance: "security / compliance",
  competitor: "vendor comparison",
  timing: "timeline / urgency",
  authority: "decision process / sign‑off",
  legal_procurement: "legal / procurement",
  risk_trust: "risk / trust",
  feature_fit: "feature fit",
  deployment_it: "deployment / IT"
};

export function objectionLabelV1(k: ObjectionKeyV1): string {
  return LABEL[k] ?? k;
}

function tinySnippet(text: string, max = 120): string {
  const s = (text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function updateObjectionStackV1(memory: any, text: string, at: number = nowMs()): ObjectionStackV1 {
  // store under memory.pro to avoid breaking older session memory schemas
  if (!memory.pro) memory.pro = {};
  if (!memory.pro.objections) memory.pro.objections = {};
  const store: Record<string, ObjectionStackEntryV1> = memory.pro.objections;

  // decay existing scores
  for (const k of Object.keys(store)) {
    store[k].score = clamp01(store[k].score * 0.92);
    // drop very stale/low entries
    if (store[k].score < 0.12 && at - store[k].lastSeenAt > 10 * 60 * 1000) {
      delete store[k];
    }
  }

  const newKeys: ObjectionKeyV1[] = [];
  const updatedKeys: Set<string> = new Set();

  for (const key of Object.keys(RX) as ObjectionKeyV1[]) {
    const rules = RX[key];
    const hits = rules.filter((r) => r.re.test(text));
    if (hits.length === 0) continue;

    const boost = hits.reduce((sum, h) => sum + h.w, 0);
    const reasons = hits.map((h) => h.id);

    if (!store[key]) {
      store[key] = { key, score: 0, count: 0, lastSeenAt: at, lastSnippet: undefined, reasons: [] };
      newKeys.push(key);
    }

    store[key].count += 1;
    store[key].lastSeenAt = at;
    store[key].lastSnippet = tinySnippet(text);
    store[key].reasons = Array.from(new Set([...(store[key].reasons ?? []), ...reasons]));

    // scoring: fast rise, slow decay
    store[key].score = clamp01(store[key].score + Math.min(0.65, 0.25 + 0.25 * boost));
    updatedKeys.add(key);
  }

  const entries = Object.values(store).sort((a, b) => b.score - a.score);
  const top = entries.filter((e) => e.score >= 0.22).slice(0, 3);

  return { entries, top, newKeys, updated: updatedKeys.size > 0 };
}
