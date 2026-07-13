import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createGunzip } from "node:zlib";
import { z } from "zod";
import { CoachingDomainSchema, type CoachingDomain } from "./coaching_corpus.js";

const HELPSTEER2_SOURCE_ID = "hf-nvidia-helpsteer2" as const;
const HELPSTEER2_LICENSE = "CC-BY-4.0" as const;
const HELPSTEER2_URL = "https://huggingface.co/datasets/nvidia/HelpSteer2" as const;

const HelpSteer2PreferenceRowSchema = z.object({
  prompt: z.string().min(1),
  response_1: z.string().min(1),
  response_2: z.string().min(1),
  preference_strength: z.number().int().min(-3).max(3),
  preference_statement: z.string(),
  preference_elaboration: z.string(),
  split: z.enum(["train", "val"])
}).passthrough();

export const StagedCoachingPreferenceSchema = z.object({
  schema: z.literal("coaching_preference_candidate_v1"),
  id: z.string().regex(/^helpsteer2_[a-f0-9]{20}$/),
  domain: CoachingDomainSchema,
  prompt: z.string().min(12).max(1400),
  preferredResponse: z.string().min(20).max(3000),
  rejectedResponse: z.string().min(20).max(3000),
  preferenceStrength: z.number().int().min(1).max(3),
  source: z.object({
    sourceId: z.literal(HELPSTEER2_SOURCE_ID),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    sourceRowNumber: z.number().int().positive(),
    sourceSplit: z.enum(["train", "val"]),
    rowHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceArtifact: z.literal("preference/preference.jsonl.gz"),
    license: z.literal(HELPSTEER2_LICENSE),
    licenseUrl: z.literal("https://creativecommons.org/licenses/by/4.0/"),
    attributionRequired: z.literal(true),
    sourceUrl: z.literal(HELPSTEER2_URL)
  }),
  review: z.object({
    status: z.literal("quarantined"),
    liveRetrievalAllowed: z.literal(false),
    reasons: z.array(z.string().min(2).max(80)).min(1).max(8)
  })
});

export type StagedCoachingPreference = z.infer<typeof StagedCoachingPreferenceSchema>;

export type HelpSteer2RejectionReason =
  | "invalid_json"
  | "invalid_schema"
  | "tied_preference"
  | "weak_preference"
  | "missing_justification"
  | "preference_direction_disagreement"
  | "no_professional_domain"
  | "not_communication_focused"
  | "conversation_history"
  | "possible_personal_data"
  | "unsafe_or_sensitive"
  | "instruction_injection"
  | "non_dialogue_task"
  | "external_source_dependent"
  | "length_out_of_bounds"
  | "duplicate_responses"
  | "duplicate_candidate";

export type HelpSteer2StageResult =
  | { candidate: StagedCoachingPreference; rejectionReason?: never }
  | { candidate?: never; rejectionReason: HelpSteer2RejectionReason };

export type HelpSteer2StagingOptions = {
  sourceRevision: string;
  minimumPreferenceStrength?: 1 | 2 | 3;
  maximumPerDomain?: number;
};

export type HelpSteer2StagingReport = {
  schema: "helpsteer2_staging_audit_v1";
  source: {
    sourceId: typeof HELPSTEER2_SOURCE_ID;
    sourceRevision: string;
    sourceUrl: typeof HELPSTEER2_URL;
    license: typeof HELPSTEER2_LICENSE;
    inputSha256: string;
    stagedArtifactSha256: string;
  };
  policy: {
    minimumPreferenceStrength: number;
    maximumPerDomain: number;
    liveRetrievalAllowed: false;
    requiresHumanContentReview: true;
  };
  counts: {
    inputRows: number;
    eligibleBeforeCap: number;
    stagedAfterCap: number;
    byDomain: Record<CoachingDomain, number>;
    rejectedByReason: Partial<Record<HelpSteer2RejectionReason, number>>;
  };
};

const DOMAIN_PATTERNS: Record<CoachingDomain, RegExp[]> = {
  interview: [
    /\bjob interview\b/i,
    /\binterview(?:er|ing|ed)?\b/i,
    /\brecruiter\b/i,
    /\bhiring\b/i,
    /\bhiring manager\b/i,
    /\bjob candidate\b/i,
    /\bjob application\b/i,
    /\bresume\b|\brésumé\b/i,
    /\bcover letter\b/i
  ],
  insurance_sales: [
    /\binsurance (?:agent|sales|policy|coverage|premium|prospect)\b/i,
    /\bsales (?:pitch|call|script|objection|prospect|conversation)\b/i,
    /\bsales\b/i,
    /\bsell(?:ing)?\b/i,
    /\bprospects?\b/i,
    /\bcold call\b/i,
    /\blead generation\b/i,
    /\bprospective (?:buyer|client|customer)\b/i
  ],
  it_support: [
    /\bit support\b/i,
    /\bit professional\b/i,
    /\btech support\b/i,
    /\btechnical support\b/i,
    /\bhelp ?desk\b/i,
    /\bservice desk\b/i,
    /\bsupport ticket\b/i,
    /\btechnical issue\b/i,
    /\bsoftware issue\b/i,
    /\bcomputer problem\b/i,
    /\bpassword reset\b/i,
    /\btroubleshoot(?:ing)? (?:a|the|this|customer|user)\b/i
  ],
  inbound_service: [
    /\bcustomer service\b/i,
    /\bcustomer support\b/i,
    /\bcustomer\b/i,
    /\bclient communication\b/i,
    /\bcustomer experience\b/i,
    /\bcall cent(?:er|re)\b/i,
    /\bcontact cent(?:er|re)\b/i,
    /\binbound call\b/i,
    /\bcustomer complaint\b/i,
    /\bangry customer\b/i,
    /\brefund request\b/i,
    /\bbilling issue\b/i
  ],
  negotiation: [
    /\bnegotiat(?:e|es|ed|ing|ion|ions)\b/i,
    /\bsalary (?:discussion|offer|request|negotiation)\b/i,
    /\bcompensation (?:discussion|offer|package|negotiation)\b/i,
    /\bcounter[ -]?offer\b/i,
    /\bcontract terms\b/i
  ],
  professional_growth: [
    /\bcareer development\b/i,
    /\bprofessional development\b/i,
    /\bcareer\b/i,
    /\bprofessional\b/i,
    /\bworkplace\b/i,
    /\bcoaching\b/i,
    /\bleadership\b/i,
    /\bmotivational speaking\b/i,
    /\bTED (?:event|talk)\b/i,
    /\bworkplace feedback\b/i,
    /\bperformance review\b/i,
    /\bpublic speaking\b/i,
    /\bpresentation skills\b/i,
    /\bleadership communication\b/i,
    /\bcareer goal\b/i,
    /\bprofessional coaching\b/i
  ]
};

const COMMUNICATION_FOCUS = [
  /\b(?:what|how) (?:should|would|could) (?:I|we|you) (?:say|respond|reply|answer|handle|communicate|ask)\b/i,
  /\b(?:write|draft|rewrite|prepare|create|provide|give me)\b[^.!?\n]{0,80}\b(?:answer|response|reply|email|message|script|pitch|cover letter|resume|résumé|interview (?:answer|response|questions?)|talking points|speech|presentation|opening|closing)\b/i,
  /\b(?:role[ -]?play|practice|simulate) (?:an? )?(?:interview|sales call|customer call|support call|negotiation)\b/i,
  /\b(?:handle|respond to|answer) (?:an? )?(?:objection|complaint|question|customer|caller|interviewer|recruiter)\b/i,
  /\b(?:persuade|convince) (?:a|the|my|our)? ?(?:prospect|customer|client|hiring manager|interviewer)\b/i,
  /\b(?:improve|polish|make more professional) (?:this|the|my) (?:answer|response|email|message|pitch|script|speech)\b/i
];
const HISTORY_MARKER = /<extra_id_|\b(?:assistant|system|developer)\s*:\s|\bconversation history\b/i;
const PERSONAL_DATA = /\b\d{3}-\d{2}-\d{4}\b|\b(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const UNSAFE_OR_SENSITIVE = /\b(?:suicid(?:e|al)|self[ -]?harm|kill myself|bomb making|build a bomb|sexually explicit|pornograph|hate speech|racial slur|medical diagnosis|therapy session|mental health crisis)\b/i;
const INSTRUCTION_INJECTION = /\b(?:ignore|disregard|forget) (?:all |any )?(?:the )?(?:previous|prior|system|developer)? ?(?:instructions?|messages?)\b|\bsystem prompt\b|\bjailbreak\b|\bprompt injection\b|\breveal (?:the )?(?:api key|password|secret|token)\b/i;
const NON_DIALOGUE_TASK = /\b(?:alphabetical order|answer in a table|categorize|classify|extract|product reviews?|questionnaires?|quiz|reviews found on the web|worksheet)\b/i;
const EXTERNAL_SOURCE_DEPENDENT = /https?:\/\/|\bbased on (?:this|the) (?:article|report|website|web page)\b/i;
const RESPONSE_1_PREFERRED = /(?:\bprefer(?:red|s)?\b[^.!?]{0,35}(?:@?response\s*1|the first response)|(?:@?response\s*1|the first response)[^.!?]{0,45}\b(?:better|best|preferred|superior)\b)/i;
const RESPONSE_2_PREFERRED = /(?:\bprefer(?:red|s)?\b[^.!?]{0,35}(?:@?response\s*2|the second response)|(?:@?response\s*2|the second response)[^.!?]{0,45}\b(?:better|best|preferred|superior)\b)/i;

function normalizeText(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function classifyDomain(prompt: string): CoachingDomain | null {
  let best: { domain: CoachingDomain; matches: number } | null = null;
  for (const domain of CoachingDomainSchema.options) {
    const matches = DOMAIN_PATTERNS[domain].reduce((count, pattern) => count + Number(pattern.test(prompt)), 0);
    if (matches > 0 && (!best || matches > best.matches)) best = { domain, matches };
  }
  return best?.domain ?? null;
}

function rowHash(row: z.infer<typeof HelpSteer2PreferenceRowSchema>): string {
  return createHash("sha256")
    .update(row.prompt)
    .update("\u0000")
    .update(row.response_1)
    .update("\u0000")
    .update(row.response_2)
    .digest("hex");
}

export function stageHelpSteer2PreferenceLine(
  rawLine: string,
  sourceRowNumber: number,
  options: HelpSteer2StagingOptions
): HelpSteer2StageResult {
  let decoded: unknown;
  try {
    decoded = JSON.parse(rawLine);
  } catch {
    return { rejectionReason: "invalid_json" };
  }

  const parsed = HelpSteer2PreferenceRowSchema.safeParse(decoded);
  if (!parsed.success || !/^[a-f0-9]{40}$/.test(options.sourceRevision)) {
    return { rejectionReason: "invalid_schema" };
  }
  const row = parsed.data;
  const minimumPreferenceStrength = options.minimumPreferenceStrength ?? 2;
  const strength = Math.abs(row.preference_strength);
  if (strength === 0) return { rejectionReason: "tied_preference" };
  if (strength < minimumPreferenceStrength) return { rejectionReason: "weak_preference" };
  if (row.preference_statement.trim().length < 5 || row.preference_elaboration.trim().length < 5) {
    return { rejectionReason: "missing_justification" };
  }
  const statementPrefers1 = RESPONSE_1_PREFERRED.test(row.preference_statement);
  const statementPrefers2 = RESPONSE_2_PREFERRED.test(row.preference_statement);
  if (
    statementPrefers1 !== statementPrefers2 &&
    ((statementPrefers1 && row.preference_strength > 0) || (statementPrefers2 && row.preference_strength < 0))
  ) {
    return { rejectionReason: "preference_direction_disagreement" };
  }

  const prompt = normalizeText(row.prompt);
  const response1 = normalizeText(row.response_1);
  const response2 = normalizeText(row.response_2);
  if (
    prompt.length < 12 || prompt.length > 1400 ||
    response1.length < 20 || response1.length > 3000 ||
    response2.length < 20 || response2.length > 3000
  ) {
    return { rejectionReason: "length_out_of_bounds" };
  }
  if (HISTORY_MARKER.test(row.prompt)) return { rejectionReason: "conversation_history" };
  if (PERSONAL_DATA.test(`${prompt}\n${response1}\n${response2}`)) {
    return { rejectionReason: "possible_personal_data" };
  }
  if (UNSAFE_OR_SENSITIVE.test(`${prompt}\n${response1}\n${response2}`)) {
    return { rejectionReason: "unsafe_or_sensitive" };
  }
  if (INSTRUCTION_INJECTION.test(`${prompt}\n${response1}\n${response2}`)) {
    return { rejectionReason: "instruction_injection" };
  }
  if (NON_DIALOGUE_TASK.test(prompt)) return { rejectionReason: "non_dialogue_task" };
  if (EXTERNAL_SOURCE_DEPENDENT.test(prompt)) return { rejectionReason: "external_source_dependent" };
  const domain = classifyDomain(prompt);
  if (!domain) return { rejectionReason: "no_professional_domain" };
  if (!COMMUNICATION_FOCUS.some((pattern) => pattern.test(prompt))) {
    return { rejectionReason: "not_communication_focused" };
  }
  if (response1 === response2) return { rejectionReason: "duplicate_responses" };

  // HelpSteer2 preference strength uses negative values for response_1 and
  // positive values for response_2. Ties were rejected above.
  const preferredResponse = row.preference_strength < 0 ? response1 : response2;
  const rejectedResponse = row.preference_strength < 0 ? response2 : response1;
  const hash = rowHash(row);
  const reviewReasons = ["external_unreviewed", "not_personal_evidence"];
  if (/\b(?:insurance|policy|coverage|premium|legal|guarantee|percent|\d+(?:\.\d+)?%)\b/i.test(preferredResponse)) {
    reviewReasons.push("fact_check_required");
  }

  return {
    candidate: StagedCoachingPreferenceSchema.parse({
      schema: "coaching_preference_candidate_v1",
      id: `helpsteer2_${hash.slice(0, 20)}`,
      domain,
      prompt,
      preferredResponse,
      rejectedResponse,
      preferenceStrength: strength,
      source: {
        sourceId: HELPSTEER2_SOURCE_ID,
        sourceRevision: options.sourceRevision,
        sourceRowNumber,
        sourceSplit: row.split,
        rowHash: hash,
        sourceArtifact: "preference/preference.jsonl.gz",
        license: HELPSTEER2_LICENSE,
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        attributionRequired: true,
        sourceUrl: HELPSTEER2_URL
      },
      review: {
        status: "quarantined",
        liveRetrievalAllowed: false,
        reasons: row.split === "val" ? [...reviewReasons, "evaluation_only"] : reviewReasons
      }
    })
  };
}

function emptyDomainCounts(): Record<CoachingDomain, number> {
  return {
    interview: 0,
    insurance_sales: 0,
    it_support: 0,
    inbound_service: 0,
    negotiation: 0,
    professional_growth: 0
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function stageHelpSteer2File(args: {
  inputPath: string;
  outputPath: string;
  auditPath: string;
  options: HelpSteer2StagingOptions;
}): Promise<HelpSteer2StagingReport> {
  const minimumPreferenceStrength = args.options.minimumPreferenceStrength ?? 2;
  const maximumPerDomain = Math.max(1, Math.min(args.options.maximumPerDomain ?? 250, 1000));
  const candidates: StagedCoachingPreference[] = [];
  const candidateIds = new Set<string>();
  const rejectedByReason: Partial<Record<HelpSteer2RejectionReason, number>> = {};
  let inputRows = 0;

  const compressed = fs.createReadStream(args.inputPath);
  const input = args.inputPath.endsWith(".gz") ? compressed.pipe(createGunzip()) : compressed;
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    inputRows += 1;
    const result = stageHelpSteer2PreferenceLine(line, inputRows, {
      ...args.options,
      minimumPreferenceStrength,
      maximumPerDomain
    });
    if (result.candidate) {
      if (candidateIds.has(result.candidate.id)) {
        rejectedByReason.duplicate_candidate = (rejectedByReason.duplicate_candidate ?? 0) + 1;
      } else {
        candidateIds.add(result.candidate.id);
        candidates.push(result.candidate);
      }
    } else {
      rejectedByReason[result.rejectionReason] = (rejectedByReason[result.rejectionReason] ?? 0) + 1;
    }
  }

  const eligibleBeforeCap = candidates.length;
  candidates.sort((a, b) =>
    b.preferenceStrength - a.preferenceStrength || a.id.localeCompare(b.id)
  );
  const selectedCounts = emptyDomainCounts();
  const selected = candidates.filter((candidate) => {
    if (selectedCounts[candidate.domain] >= maximumPerDomain) return false;
    selectedCounts[candidate.domain] += 1;
    return true;
  });

  const stagedJsonl = `${selected.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const report: HelpSteer2StagingReport = {
    schema: "helpsteer2_staging_audit_v1",
    source: {
      sourceId: HELPSTEER2_SOURCE_ID,
      sourceRevision: args.options.sourceRevision,
      sourceUrl: HELPSTEER2_URL,
      license: HELPSTEER2_LICENSE,
      inputSha256: await sha256File(args.inputPath),
      stagedArtifactSha256: createHash("sha256").update(stagedJsonl).digest("hex")
    },
    policy: {
      minimumPreferenceStrength,
      maximumPerDomain,
      liveRetrievalAllowed: false,
      requiresHumanContentReview: true
    },
    counts: {
      inputRows,
      eligibleBeforeCap,
      stagedAfterCap: selected.length,
      byDomain: selectedCounts,
      rejectedByReason
    }
  };

  await fsp.mkdir(path.dirname(args.outputPath), { recursive: true });
  await fsp.mkdir(path.dirname(args.auditPath), { recursive: true });
  const temporaryOutput = `${args.outputPath}.tmp`;
  const temporaryAudit = `${args.auditPath}.tmp`;
  await fsp.writeFile(temporaryOutput, stagedJsonl, "utf8");
  await fsp.writeFile(temporaryAudit, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fsp.rename(temporaryOutput, args.outputPath);
  await fsp.rename(temporaryAudit, args.auditPath);
  return report;
}
