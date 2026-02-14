import type { DetectedMoment, SessionMemoryV1 } from "./session_memory_v1";

export type MomentDetection = {
  primary: DetectedMoment;
  hits: DetectedMoment[];   // all detected moments in this block
  confidence: number;       // 0..1
};

const hasAny = (t: string, list: RegExp[]) => list.some((r) => r.test(t));

const RX = {
  price: [
    /\btoo expensive\b/i, /\bprice\b/i, /\bcost\b/i, /\bbudget\b/i, /\bcheaper\b/i, /\bdiscount\b/i,
  ],
  value: [
    /\bwhat makes\b/i, /\bworth it\b/i, /\broi\b/i, /\boutcomes?\b/i, /\bvalue\b/i,
  ],
  // Make integration its own moment (NOT "value")
  integration: [
    /\bintegration\b/i, /\bintegrate\b/i, /\bintegration depth\b/i, /\bapi\b/i, /\bwebhook\b/i,
    /\bsso\b/i, /\bscim\b/i, /\bcrm\b/i, /\bsalesforce\b/i, /\bhubspot\b/i, /\bzapier\b/i,
    /\bdata sync\b/i, /\bwriteback\b/i, /\bpermissions?\b/i, /\baudit\b/i,
  ],
  security: [
    /\bsoc ?2\b/i, /\bhipaa\b/i, /\bsecurity\b/i, /\bdata retention\b/i, /\bpii\b/i, /\bcompliance\b/i,
    /\bdpa\b/i, /\bsubprocessor\b/i,
  ],
  competitor: [
    /\bcompared\b/i, /\bcomparing\b/i, /\bother vendors?\b/i, /\balternative\b/i, /\bvs\b/i,
    /\bwe use\b/i, /\bcurrently using\b/i, /\bswitch\b/i, /\bcompetitor\b/i,
  ],
  timeline: [
    /\btimeline\b/i, /\bthis quarter\b/i, /\bnext week\b/i, /\bby (?:end|eoy)\b/i, /\bwhen\b.*\bstart\b/i,
  ],
  stakeholder: [
    /\bwho signs off\b/i, /\bdecision maker\b/i, /\bprocurement\b/i, /\blegal\b/i, /\bstakeholder\b/i,
  ],
  // Deployment/environment questions (weather, heat, humidity, storms, outdoors)
  deployment: [
    /\bweather\b/i, /\bflorida\b/i, /\bhumidity\b/i, /\bheat\b/i, /\bhurricane\b/i, /\bstorm\b/i,
    /\boutdoor\b/i, /\bon-site\b/i, /\bonsite\b/i, /\binstall\b/i, /\bdeployment\b/i, /\bdeploy\b/i,
  ],
};

function splitSegments(text: string): string[] {
  return text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectMomentV1(text: string, memory: SessionMemoryV1): MomentDetection {
  const segments = splitSegments(text.toLowerCase());
  const hitSet = new Set<DetectedMoment>();

  for (const seg of segments) {
    if (hasAny(seg, RX.price)) hitSet.add("price");
    if (hasAny(seg, RX.value)) hitSet.add("value");
    if (hasAny(seg, RX.integration)) hitSet.add("integration");
    if (hasAny(seg, RX.security)) hitSet.add("security");
    if (hasAny(seg, RX.competitor)) hitSet.add("competitor");
    if (hasAny(seg, RX.timeline)) hitSet.add("timeline");
    if (hasAny(seg, RX.stakeholder)) hitSet.add("stakeholder");
    if (hasAny(seg, RX.deployment)) hitSet.add("deployment");
  }

  const hits = Array.from(hitSet);

  // Stage-aware primary selection:
  // In evaluation stage, integration questions should win when present.
  let primary: DetectedMoment = "unknown";
  if (memory.stage === "evaluation" && hitSet.has("integration")) {
    primary = "integration";
  } else {
    const priority: DetectedMoment[] = [
      "price",
      "value",
      "integration",
      "competitor",
      "security",
      "timeline",
      "stakeholder",
      "deployment",
    ];
    primary = priority.find((p) => hitSet.has(p)) ?? "unknown";
  }

  const confidence =
    primary === "unknown"
      ? 0.25
      : Math.min(1, 0.45 + Math.max(0, hits.length - 1) * 0.12);

  if (primary !== "unknown") memory.activeMoments.add(primary);

  return { primary, hits, confidence };
}
