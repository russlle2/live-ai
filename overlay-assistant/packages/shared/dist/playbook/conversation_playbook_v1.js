export const CONVERSATION_PLAYBOOK_STAGE_IDS_V1 = [
    "greeting",
    "rapport",
    "discovery",
    "proof",
    "questions",
    "close",
    "goodbye"
];
const TITLES = {
    greeting: "Open",
    rapport: "Build rapport",
    discovery: "Understand",
    proof: "Respond with proof",
    questions: "Ask a strong question",
    close: "Confirm the next step",
    goodbye: "Close warmly"
};
/**
 * Keep user-supplied labels usable in a spoken sentence without allowing them to
 * turn into a second sentence or instruction. No inference is made from these
 * fields: a role or company is spoken only when it was actually supplied.
 */
function spokenLabel(value, maxLength = 96) {
    if (!value)
        return "";
    return value
        .normalize("NFKC")
        .replace(/[^\p{L}\p{M}\p{N} &+/#'’_-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength)
        .trim();
}
function interviewGreeting(role, company) {
    if (role && company) {
        return `Hi, thank you for taking the time to speak with me about the ${role} role at ${company}. I'm glad to be here.`;
    }
    if (role) {
        return `Hi, thank you for taking the time to speak with me about the ${role} role. I'm glad to be here.`;
    }
    if (company) {
        return `Hi, thank you for taking the time to speak with me about the opportunity at ${company}. I'm glad to be here.`;
    }
    return "Hi, thank you for taking the time to speak with me today. I'm glad to be here.";
}
function interviewStages(role, company) {
    const outcomes = role
        ? `what are the most important outcomes for the ${role} role in the first few months?`
        : "what are the most important outcomes for this role in the first few months?";
    const performance = company
        ? `How does ${company} measure strong performance in this role during the first few months?`
        : "How do you measure strong performance in this role during the first few months?";
    return [
        stage("greeting", interviewGreeting(role, company)),
        stage("rapport", "Before we begin, I'm happy to give you a quick overview, or I can follow your questions—whichever is more useful."),
        stage("discovery", `To make my answers relevant, ${outcomes}`),
        stage("proof", "I want to answer that with a specific example from my actual experience, including what I did and the result. Give me one moment to choose the closest match."),
        stage("questions", performance),
        stage("close", "Thank you for the context. Is there anything about my background or answers that you would like me to clarify before we wrap up?"),
        stage("goodbye", "Thank you for your time and for explaining the role. I appreciate the conversation, and I look forward to hearing about the next step.")
    ];
}
function insuranceSalesStages() {
    return [
        stage("greeting", "Hi, thanks for taking my call. I'd like to understand what you need and see whether there may be a suitable option. Is now still a good time?"),
        stage("rapport", "I'll keep this straightforward and focus on what matters to you, without assuming an option is a fit before we verify it."),
        stage("discovery", "What are you most concerned about protecting, what timing are you working with, and what budget range feels realistic?"),
        stage("proof", "Let me connect this to what you told me: the right option has to address your stated priority, and we should verify the terms before treating it as a fit."),
        stage("questions", "Before we discuss a next step, what must-have benefit or limitation should I make sure we verify?"),
        stage("close", "If a verified option fits the priorities and budget you gave me, would you be comfortable reviewing the exact terms and deciding on the next step?"),
        stage("goodbye", "Thank you for your time. Please rely on the verified terms and documents, and let me know what you would like clarified before we finish.")
    ];
}
function itSupportStages() {
    return [
        stage("greeting", "Hi, thanks for reaching support. I'll ask a few questions so we can narrow down what's happening. What are you seeing right now?"),
        stage("rapport", "I know an interruption like this can be frustrating. We'll take it one safe step at a time."),
        stage("discovery", "What were you trying to do, what happened instead, and when did it last work normally?"),
        stage("proof", "Let me confirm what we know before changing anything: I heard the symptom you described, and I want to verify its scope and the last time things worked normally."),
        stage("questions", "Has anything changed recently, and do you see an exact error message or code?"),
        stage("close", "I want to use only a verified safe next step. May I take a moment to confirm it before you make any change?"),
        stage("goodbye", "Thanks for working through that with me. Before we end, is there anything else related to this issue you want me to note?")
    ];
}
function inboundServiceStages() {
    return [
        stage("greeting", "Hi, thank you for calling. I'm here to help. What can I take care of for you today?"),
        stage("rapport", "I can help you work through this. Let me make sure I understand it correctly."),
        stage("discovery", "What outcome are you hoping for today, and what has happened so far?"),
        stage("proof", "Let me repeat that back in my own words so I can make sure I have the request and key facts right. Please correct anything I miss."),
        stage("questions", "What details should I verify before I explain the available next steps?"),
        stage("close", "I want to offer only an action I am authorized to take. May I confirm the available next step before we close?"),
        stage("goodbye", "Thank you for calling. I appreciate your time, and I hope the rest of your day goes smoothly.")
    ];
}
function negotiationStages() {
    return [
        stage("greeting", "Hi, thanks for making time. I'd like to understand what matters most to both sides and work toward a practical agreement."),
        stage("rapport", "I'd like this to be clear and constructive, even where our positions differ."),
        stage("discovery", "What matters most to you in the outcome, and where do you have flexibility?"),
        stage("proof", "Let me make sure I understand your position before I answer: what is the one priority you would not want a proposal to miss?"),
        stage("questions", "If we can resolve the main issue, what else would you need in order to move forward?"),
        stage("close", "I don't want to offer terms I cannot honor. Let me confirm exactly what I am authorized to propose before we finalize anything."),
        stage("goodbye", "Thank you for the direct conversation. Before we leave, let's repeat only the terms we both confirmed.")
    ];
}
function generalStages() {
    return [
        stage("greeting", "Hi, thanks for taking the time to speak with me. What would make this conversation most useful for you?"),
        stage("rapport", "I appreciate the context. I'll listen first and make sure I understand before I respond."),
        stage("discovery", "What outcome are you aiming for, and what is the biggest obstacle right now?"),
        stage("proof", "Let me make sure I'm responding to the facts rather than making assumptions. Would you summarize the situation and your top priority in one sentence?"),
        stage("questions", "What would a useful next step look like from your perspective?"),
        stage("close", "Let me confirm our next step so neither of us has to guess: who will do what, and by when?"),
        stage("goodbye", "Thank you for the conversation. I appreciate your time, and I'll leave it there unless there is anything else we should cover.")
    ];
}
function stage(id, say) {
    return { id, title: TITLES[id], say };
}
function normalizeMode(mode) {
    switch (mode) {
        case "interview":
        case "insurance_sales":
        case "it_support":
        case "inbound_service":
        case "negotiation":
        case "general":
            return mode;
        default:
            return "general";
    }
}
/** Build a complete, offline script from greeting through goodbye. */
export function buildConversationPlaybookV1(profile) {
    const mode = normalizeMode(profile.mode);
    const role = spokenLabel(profile.targetRole);
    const company = spokenLabel(profile.company);
    let copy;
    switch (mode) {
        case "interview":
            copy = interviewStages(role, company);
            break;
        case "insurance_sales":
            copy = insuranceSalesStages();
            break;
        case "it_support":
            copy = itSupportStages();
            break;
        case "inbound_service":
            copy = inboundServiceStages();
            break;
        case "negotiation":
            copy = negotiationStages();
            break;
        case "general":
            copy = generalStages();
            break;
    }
    return {
        schema: "conversation_playbook_v1",
        mode,
        stages: copy.map((item, index) => ({ ...item, order: index + 1 }))
    };
}
/** Return the complete opening stage, including its exact spoken line. */
export function getInitialPlaybookStageV1(profile) {
    return buildConversationPlaybookV1(profile).stages[0];
}
/** Convenience helper for surfaces that need only the first exact line. */
export function getInitialGreetingV1(profile) {
    return getInitialPlaybookStageV1(profile).say;
}
const CUE_PATTERNS = [
    {
        id: "goodbye",
        pattern: /\b(?:goodbye|bye|talk (?:to you )?soon|have a (?:good|great) (?:day|evening|weekend))\b/i
    },
    {
        id: "questions",
        pattern: /\b(?:any questions(?: for me)?|what (?:questions|would you like to ask)|questions for us)\b/i
    },
    {
        id: "close",
        pattern: /\b(?:next steps?|move forward|ready to proceed|wrap (?:this|things) up|anything else)\b/i
    },
    {
        id: "proof",
        pattern: /\b(?:tell me about a time|give me an example|describe a time|experience with|why should|walk me through an example)\b/i
    },
    {
        id: "discovery",
        pattern: /\b(?:what happened|what do you need|what are you looking for|what matters|priorit(?:y|ies)|budget|coverage|error|not working|problem|issue)\b/i
    }
];
/**
 * Infer a relevant script stage from transcript cues. This does not call a
 * model, inspect private memory, or treat transcript content as instructions.
 */
export function inferPlaybookStageIdV1(transcript) {
    if (!transcript)
        return undefined;
    const bounded = transcript.normalize("NFKC").slice(-2_000);
    return CUE_PATTERNS.find(({ pattern }) => pattern.test(bounded))?.id;
}
/**
 * Select the next useful stage. The greeting is always first unless it was
 * explicitly completed. Afterwards, strong transcript cues can jump to a
 * relevant unfinished stage; otherwise the first unfinished stage is used.
 */
export function selectNextPlaybookStageV1(profile, input = {}) {
    const playbook = buildConversationPlaybookV1(profile);
    const completed = new Set(input.completedStageIds ?? []);
    if (!completed.has("greeting"))
        return playbook.stages[0];
    const inferred = inferPlaybookStageIdV1(input.transcript);
    if (inferred && !completed.has(inferred)) {
        return playbook.stages.find((item) => item.id === inferred);
    }
    return (playbook.stages.find((item) => !completed.has(item.id)) ??
        playbook.stages[playbook.stages.length - 1]);
}
