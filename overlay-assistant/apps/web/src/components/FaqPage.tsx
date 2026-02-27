import React, { useState, useMemo, useRef, useEffect } from "react";

/* ═══════════════════════════════════════════════════════════════
   FAQ & Knowledge Base
   Searchable directory of every question about the product
   ═══════════════════════════════════════════════════════════════ */

type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
};

const FAQ_DATA: FaqEntry[] = [
  // ── Getting Started ──────────────────────────────────────
  {
    id: "gs-1",
    question: "What is the Sales Coach Overlay?",
    answer: "The Sales Coach Overlay is a real-time AI-powered coaching tool that listens to your sales conversations and provides word-for-word guidance, objection handling tips, and contextual coaching — all live during your call. Think of it as having an expert sales coach whispering in your ear during every conversation.",
    category: "Getting Started",
    tags: ["overview", "what is", "introduction", "about"]
  },
  {
    id: "gs-2",
    question: "How do I get started?",
    answer: "1. Sign up for an account and log in. 2. Click 'Start Session' to begin a coaching session. 3. Either click the 🎤 mic button to speak naturally (Chrome/Edge), or type what's being said in the conversation. 4. Real-time coaching tips will appear on the right panel. 5. Use the tips word-for-word or adapt them to your style.",
    category: "Getting Started",
    tags: ["setup", "start", "begin", "first time", "new user", "onboarding"]
  },
  {
    id: "gs-3",
    question: "Which browsers are supported?",
    answer: "The app works in all modern browsers. For the microphone/voice input feature, Chrome and Edge are recommended as they have full Web Speech API support. Firefox and Safari work for typing-based input. The coaching engine works identically regardless of browser.",
    category: "Getting Started",
    tags: ["browser", "chrome", "firefox", "safari", "edge", "compatibility"]
  },
  {
    id: "gs-4",
    question: "Do I need to install anything?",
    answer: "No installation required. The Sales Coach is a web application — just open the URL in your browser and start using it. For the microphone feature, your browser will ask for microphone permission the first time you click the mic button.",
    category: "Getting Started",
    tags: ["install", "download", "setup", "requirements"]
  },
  {
    id: "gs-5",
    question: "What do I need to run this locally for development?",
    answer: "You need: Node.js 22+, pnpm (install with 'npm install -g pnpm'), and Docker Desktop (for PostgreSQL). Then: 1) 'docker compose up -d db' to start Postgres, 2) 'cp .env.example .env' and fill in your API keys, 3) 'pnpm install', 4) 'pnpm run db:migrate', 5) 'pnpm dev'. The web UI opens at localhost:5173 and the server runs on localhost:8080.",
    category: "Getting Started",
    tags: ["local", "development", "developer", "setup", "pnpm", "docker", "node"]
  },

  // ── How It Works ─────────────────────────────────────────
  {
    id: "hw-1",
    question: "How does the AI coaching work?",
    answer: "When you send a transcript (via mic or typing), the server processes it through two paths: 1) A fast regex-based intent/objection detector that matches patterns like pricing concerns, competitor mentions, or scheduling intent. 2) An AI engine (OpenAI GPT-4o-mini) that understands full context — your conversation history, the product you're selling, and the prospect's concerns — to generate specific, actionable coaching. The AI path fires when an API key is configured; otherwise, the template path provides solid but less personalized guidance.",
    category: "How It Works",
    tags: ["ai", "coaching", "how", "engine", "gpt", "openai", "templates"]
  },
  {
    id: "hw-2",
    question: "What does the AI coach actually say?",
    answer: "The AI coach provides word-for-word phrases you can say, prefixed with 'Say:'. For example, if the prospect mentions budget concerns, it might say: 'Say: \"I totally understand — let's figure out what works for your budget. Most of our clients see a 3x return in the first quarter, so it usually pays for itself pretty fast.\"' Every suggestion is tailored to your specific product, the conversation context, and the prospect's concerns.",
    category: "How It Works",
    tags: ["suggestions", "tips", "guidance", "what does it say", "examples", "word for word"]
  },
  {
    id: "hw-3",
    question: "How does the microphone input work?",
    answer: "The mic button uses your browser's built-in Web Speech API — no additional software or API keys needed. When you click 🎤, your browser captures audio from your microphone and converts it to text in real-time. You'll see interim (partial) text as you speak, and when a sentence is complete, it's automatically sent to the coaching engine. The speech recognition runs entirely in your browser — audio never leaves your device.",
    category: "How It Works",
    tags: ["microphone", "voice", "audio", "speech", "stt", "speech to text", "mic"]
  },
  {
    id: "hw-4",
    question: "What is the Sound Wave Orb?",
    answer: "The orb in the center panel is a visual indicator of system status. It animates in 'listening' mode when the system is actively processing your conversation, 'speaking' mode when new coaching appears, and 'idle' when waiting for input. It provides at-a-glance feedback so you know the system is working without reading text.",
    category: "How It Works",
    tags: ["orb", "animation", "visual", "indicator", "sound wave"]
  },
  {
    id: "hw-5",
    question: "What are Product Profiles?",
    answer: "Product Profiles let you configure the coaching engine for specific products or services you sell. You can set the product name, key differentiators, target industry, common objections, and competitor information. When a profile is active, the AI coach uses this context to give highly specific guidance — e.g., it will reference your actual differentiators when handling competitor objections.",
    category: "How It Works",
    tags: ["profile", "product", "configuration", "customize", "differentiators"]
  },
  {
    id: "hw-6",
    question: "What is the Trust Dashboard?",
    answer: "The Trust Dashboard (Insights tab) shows transparency metrics: how many coaching suggestions were shown, applied, dismissed, or muted. It also shows patch health (reject rate, coalesce rate) and overall trust score. This data helps you and your organization verify the system is working correctly and being used effectively.",
    category: "How It Works",
    tags: ["trust", "dashboard", "insights", "metrics", "analytics", "transparency"]
  },
  {
    id: "hw-7",
    question: "How fast is the AI response?",
    answer: "The AI coaching response typically arrives in 200–800ms using GPT-4o-mini. The template-based fallback responds in under 1ms. Most users don't notice any delay — the coaching appears before you've finished processing what the prospect said. If the AI takes longer than 5 seconds (rare), it automatically falls back to template-based coaching.",
    category: "How It Works",
    tags: ["speed", "latency", "fast", "response time", "delay", "performance"]
  },
  {
    id: "hw-8",
    question: "What happens if the AI is unavailable?",
    answer: "The system has a built-in dual-path architecture. If the OpenAI API key isn't set, or the API is slow/down, the coaching engine automatically falls back to a curated set of template-based responses matched by intent detection (regex patterns). These templates cover pricing objections, competitor comparisons, scheduling, security questions, ROI discussions, and more. You'll see 'Template Mode' in the input area when this fallback is active.",
    category: "How It Works",
    tags: ["fallback", "offline", "unavailable", "templates", "backup", "reliability"]
  },

  // ── Privacy & Security ───────────────────────────────────
  {
    id: "ps-1",
    question: "Is my conversation data stored?",
    answer: "No raw transcripts are ever stored. The server processes transcript text in memory to generate coaching, then discards it. Only metadata is persisted: a one-way SHA-256 hash of the text (for deduplication), the text length, timestamps, and coaching categories. This is a foundational privacy guarantee — even if the database were compromised, no conversation content could be recovered.",
    category: "Privacy & Security",
    tags: ["privacy", "data", "stored", "transcript", "logging", "recording", "gdpr"]
  },
  {
    id: "ps-2",
    question: "Is my API key secure?",
    answer: "Your OpenAI API key is stored only in the server's .env file (environment variables) and never leaves the server. The browser/frontend never sees the key — it only sends transcript text to your server, which then calls OpenAI server-side. The .env file is gitignored by default. In production, use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) for even stronger protection.",
    category: "Privacy & Security",
    tags: ["api key", "security", "secret", "openai", "env", "environment"]
  },
  {
    id: "ps-3",
    question: "Can someone use this as a free GPT tool?",
    answer: "No. The system has multiple layers of protection: 1) Per-session rate limit (60 coaching requests max per session). 2) Per-tenant per-minute burst limit (20 requests/min). 3) Per-tenant hourly limit (200 requests/hour). 4) JWT authentication — only logged-in users can access the coaching endpoint. 5) The system prompt is hardcoded server-side — users can only send transcript text, not override the AI's instructions. 6) You can set a monthly spend cap directly in the OpenAI dashboard.",
    category: "Privacy & Security",
    tags: ["abuse", "free", "gpt", "rate limit", "protection", "cost", "spend"]
  },
  {
    id: "ps-4",
    question: "How does authentication work?",
    answer: "The server uses JWT (JSON Web Tokens) for authentication. When JWT_SECRET is set in .env, users must log in via /api/auth/login to get a token, then include it as 'Authorization: Bearer <token>' in all API requests. Tokens expire after 8 hours. When JWT_SECRET is not set (development/demo mode), authentication is bypassed with a demo identity so developers can test without auth infrastructure.",
    category: "Privacy & Security",
    tags: ["auth", "authentication", "jwt", "login", "token", "bearer", "session"]
  },
  {
    id: "ps-5",
    question: "What compliance standards does this meet?",
    answer: "The architecture is designed for SOC 2, GDPR, and HIPAA compliance readiness: no raw transcript storage, encrypted credential storage (AES-256-GCM), audit logging of all operations, tenant data isolation, and configurable data retention. The enterprise documentation package includes a Security Controls Summary, Data Flow & Retention policy, and Integration Architecture document ready for procurement review.",
    category: "Privacy & Security",
    tags: ["compliance", "soc2", "gdpr", "hipaa", "enterprise", "procurement", "audit"]
  },
  {
    id: "ps-6",
    question: "Does the microphone audio get sent to any server?",
    answer: "The microphone audio is processed entirely in your browser using the Web Speech API. The browser converts speech to text locally, and only the resulting text is sent to the coaching server. No raw audio is ever transmitted, stored, or processed server-side. Google's speech servers may process the audio for Chrome's speech recognition, subject to Google's privacy policy.",
    category: "Privacy & Security",
    tags: ["microphone", "audio", "voice", "privacy", "speech", "browser"]
  },

  // ── Pricing & Plans ──────────────────────────────────────
  {
    id: "pp-1",
    question: "How much does it cost?",
    answer: "Pricing is per-seat, per-month: individual plans start at $29/month, team plans at $49/seat/month with admin dashboard and usage analytics, and enterprise plans with custom pricing based on seat count, support tier, and deployment model. The AI coaching cost (OpenAI API) is included in your subscription — you don't need your own API key.",
    category: "Pricing & Plans",
    tags: ["price", "cost", "pricing", "plan", "subscription", "monthly", "per seat"]
  },
  {
    id: "pp-2",
    question: "Is there a free trial?",
    answer: "Yes — every new account gets a 14-day free trial with full AI coaching features. No credit card required to start. After the trial, you can continue on a paid plan or use the template-based coaching mode for free (limited features).",
    category: "Pricing & Plans",
    tags: ["trial", "free", "demo", "test", "try"]
  },
  {
    id: "pp-3",
    question: "What's included in each plan?",
    answer: "Individual ($29/mo): AI coaching, mic input, product profiles, unlimited sessions. Team ($49/seat/mo): Everything in Individual + Trust Dashboard analytics, CRM integration (Salesforce/HubSpot), shared product profiles, usage reports. Enterprise (custom): Everything in Team + dedicated hosting, custom AI fine-tuning, SSO/SAML, SLA, priority support, on-premise deployment option.",
    category: "Pricing & Plans",
    tags: ["plans", "features", "individual", "team", "enterprise", "comparison"]
  },
  {
    id: "pp-4",
    question: "Can I cancel anytime?",
    answer: "Yes, all subscription plans are month-to-month and can be cancelled at any time. Enterprise annual contracts have terms specified in the agreement. When you cancel, your data is retained for 30 days in case you want to reactivate, then permanently deleted.",
    category: "Pricing & Plans",
    tags: ["cancel", "cancellation", "refund", "stop", "subscription"]
  },

  // ── CRM & Integrations ──────────────────────────────────
  {
    id: "ci-1",
    question: "Does it integrate with Salesforce?",
    answer: "Yes. The system includes a Salesforce integration that can write coaching notes, call summaries, and objection data directly to Salesforce records. The integration uses OAuth for authentication, idempotent writes (no duplicates), and automatic retry with exponential backoff. Currently available as a stub — connect your Salesforce OAuth credentials in the .env file to activate.",
    category: "CRM & Integrations",
    tags: ["salesforce", "crm", "integration", "sync", "notes"]
  },
  {
    id: "ci-2",
    question: "Does it integrate with HubSpot?",
    answer: "Yes. The HubSpot integration works the same way as Salesforce — write notes and coaching data to HubSpot contact/deal records. Uses OAuth, idempotent writes, and retry/backoff. Configure your HubSpot OAuth credentials in .env to connect.",
    category: "CRM & Integrations",
    tags: ["hubspot", "crm", "integration", "sync", "notes"]
  },
  {
    id: "ci-3",
    question: "Can I connect it to Zoom, Teams, or Google Meet?",
    answer: "The current version works alongside your meeting tool — you keep your Zoom/Teams/Meet call running and use the Sales Coach in a separate browser tab. The mic input captures what's said through your device's microphone. Direct deep integration with meeting platforms (capturing audio directly from the call) is on the Q4 roadmap.",
    category: "CRM & Integrations",
    tags: ["zoom", "teams", "meet", "google meet", "meeting", "video call"]
  },
  {
    id: "ci-4",
    question: "Can I export my data?",
    answer: "Yes. The Trust Dashboard data, coaching usage metrics, and CRM write history can all be exported. The API provides endpoints for programmatic access: /api/trust/summary for trust metrics, /api/admin/usage for token consumption, and direct database access for enterprise deployments.",
    category: "CRM & Integrations",
    tags: ["export", "data", "download", "api", "reporting"]
  },

  // ── Troubleshooting ──────────────────────────────────────
  {
    id: "ts-1",
    question: "The mic button doesn't appear",
    answer: "The mic button only shows in browsers that support the Web Speech API — primarily Chrome and Edge. If you're using Firefox or Safari, the mic won't appear but you can still type your transcript. Also check that you haven't denied microphone permissions for the site (click the lock icon in the address bar to check).",
    category: "Troubleshooting",
    tags: ["mic", "microphone", "missing", "not showing", "button", "speech"]
  },
  {
    id: "ts-2",
    question: "I see 'Template Mode' instead of 'AI Coach Active'",
    answer: "This means the OpenAI API key is not configured on the server. If you're self-hosting: add OPENAI_API_KEY=sk-... to your .env file and restart the server. If you're using the SaaS version: contact support, as the AI should always be active for paid accounts.",
    category: "Troubleshooting",
    tags: ["template mode", "ai not working", "no ai", "api key", "configuration"]
  },
  {
    id: "ts-3",
    question: "Coaching responses seem generic",
    answer: "Three things to check: 1) Make sure AI mode is active (look for '● AI Coach Active' in the input area). 2) Set up a Product Profile with your product's name, differentiators, and common objections — this gives the AI crucial context. 3) Provide enough conversational context — the AI gets better as the conversation progresses and it has more turns to work with.",
    category: "Troubleshooting",
    tags: ["generic", "bad", "coaching", "quality", "improve", "not specific"]
  },
  {
    id: "ts-4",
    question: "Connection keeps dropping",
    answer: "The app uses WebSockets for real-time communication. If the connection drops: 1) Check that the server is running (localhost:8080/health should return {ok: true}). 2) Check for VPN or firewall issues that might block WebSocket connections. 3) The app automatically reconnects — wait a few seconds. 4) If using Codespaces/Gitpod, make sure port 8080 is forwarded and public.",
    category: "Troubleshooting",
    tags: ["connection", "disconnect", "websocket", "drop", "reconnect", "error"]
  },
  {
    id: "ts-5",
    question: "I got a 'rate_limited' error",
    answer: "Rate limits protect against abuse and excessive API costs. Limits: 60 requests per session, 20/minute, 200/hour per tenant. If you hit a limit: wait for the Retry-After period shown in the error, or start a new session if you hit the per-session limit. Enterprise plans have higher limits — contact support to increase yours.",
    category: "Troubleshooting",
    tags: ["rate limit", "429", "too many requests", "throttle", "blocked"]
  },
  {
    id: "ts-6",
    question: "npm install fails with workspace error",
    answer: "This project uses pnpm workspaces, not npm. Run 'npm install -g pnpm' to install pnpm globally, then use 'pnpm install' instead of 'npm install'. The workspace:* protocol in package.json is a pnpm feature that npm doesn't understand.",
    category: "Troubleshooting",
    tags: ["npm", "pnpm", "install", "workspace", "error", "dependency"]
  },

  // ── Enterprise & Deployment ──────────────────────────────
  {
    id: "ed-1",
    question: "Can this be self-hosted / on-premise?",
    answer: "Yes. The entire system ships as a Docker image. Run 'docker compose up' to start the full stack (server + PostgreSQL). Enterprise customers can deploy in their own AWS/GCP/Azure environment or on-premise Kubernetes cluster. The .env file is the only configuration surface. Self-hosted customers bring their own OpenAI API key.",
    category: "Enterprise & Deployment",
    tags: ["self-hosted", "on-premise", "docker", "deploy", "enterprise", "kubernetes"]
  },
  {
    id: "ed-2",
    question: "How does multi-tenant isolation work?",
    answer: "Every request includes a tenant_id that isolates data at the database level. All obs_events, sessions, trust metrics, and CRM writes are scoped to the tenant. In the SaaS model, one deployment serves all customers with data isolated by tenant_id. Enterprise customers can also get a dedicated, single-tenant deployment for maximum isolation.",
    category: "Enterprise & Deployment",
    tags: ["multi-tenant", "isolation", "data", "security", "enterprise"]
  },
  {
    id: "ed-3",
    question: "What's the architecture?",
    answer: "The stack is a TypeScript monorepo: React + Vite frontend, Express + WebSocket backend, PostgreSQL database. packages/shared contains versioned protocol types and a patch sanitizer shared by server and web. The backend runs deterministic arbitration (regex) + AI coaching (OpenAI) in a dual-path architecture. All communication uses WebSockets for real-time delivery. Enterprise docs include a full architecture diagram.",
    category: "Enterprise & Deployment",
    tags: ["architecture", "stack", "tech", "typescript", "react", "express", "postgres"]
  },
  {
    id: "ed-4",
    question: "How do I monitor usage and costs?",
    answer: "The /api/admin/usage endpoint shows per-tenant token consumption with estimated USD cost. The /api/health/metrics endpoint shows active sessions, connections, memory, and AI status. All usage events are logged to the obs_events table with event_type 'ai_token_usage' including model, token counts, and estimated cost per request. Set up periodic queries or connect to your monitoring tool (Datadog, Grafana, etc.).",
    category: "Enterprise & Deployment",
    tags: ["monitoring", "usage", "cost", "billing", "admin", "metrics", "token"]
  },
  {
    id: "ed-5",
    question: "What are the rate limits?",
    answer: "Default limits: 60 coaching requests per session, 20 requests per minute per tenant, 200 requests per hour per tenant. All limits are configurable via environment variables: RATE_LIMIT_PER_SESSION, RATE_LIMIT_PER_TENANT_MINUTE, RATE_LIMIT_PER_TENANT_HOUR. Enterprise customers can set custom limits. Rate limit events are logged for monitoring.",
    category: "Enterprise & Deployment",
    tags: ["rate limit", "limits", "configuration", "environment", "customization"]
  },
  {
    id: "ed-6",
    question: "How do I set up for production?",
    answer: "1) Set JWT_SECRET to a strong random value (64+ hex chars). 2) Set OPENAI_API_KEY. 3) Set WEB_ORIGIN to your domain (not *). 4) Use a managed PostgreSQL (RDS, Cloud SQL). 5) Set a spend cap in the OpenAI dashboard. 6) Deploy the Docker image behind a reverse proxy (nginx, Cloudflare) with HTTPS. 7) Set up monitoring on /api/health/metrics. See docs/operations/deploy_docker.md for full instructions.",
    category: "Enterprise & Deployment",
    tags: ["production", "deploy", "setup", "https", "ssl", "reverse proxy"]
  },

  // ── AI & Coaching Quality ────────────────────────────────
  {
    id: "aq-1",
    question: "Which AI model is used?",
    answer: "By default, GPT-4o-mini — OpenAI's fastest and most cost-effective model. It provides excellent coaching quality at ~$0.15 per million input tokens. You can switch to GPT-4o for higher quality (at higher cost) by setting OPENAI_MODEL=gpt-4o in your .env file. The system works with any OpenAI chat completion model.",
    category: "AI & Coaching Quality",
    tags: ["model", "gpt", "openai", "gpt-4o-mini", "gpt-4o", "quality"]
  },
  {
    id: "aq-2",
    question: "How does the AI know about my product?",
    answer: "Through Product Profiles. When you create a profile with your product name, key differentiators, target industry, competitors, and common objections, this context is injected into every AI coaching request. The AI uses this to generate product-specific responses — e.g., 'Our [specific feature] does X differently than [competitor]' instead of generic advice.",
    category: "AI & Coaching Quality",
    tags: ["product", "context", "profile", "personalization", "custom"]
  },
  {
    id: "aq-3",
    question: "Does the AI remember previous conversations?",
    answer: "Within a single session, yes — the AI receives the last 20 conversation turns as context, so it builds understanding as the call progresses. Across sessions, no — each session starts fresh. This is by design for privacy (no conversation history is persisted) and ensures data minimization. The AI gets progressively more helpful as a conversation develops.",
    category: "AI & Coaching Quality",
    tags: ["memory", "history", "context", "conversation", "session", "remember"]
  },
  {
    id: "aq-4",
    question: "Can I customize the coaching style?",
    answer: "Currently, the coaching style is optimized for consultative B2B sales. The AI is prompted to be confident, specific, and action-oriented. Customization options on the roadmap include: coaching tone presets (assertive vs. consultative vs. empathetic), industry-specific templates, custom prompt injection for enterprise customers, and training on your team's best call recordings.",
    category: "AI & Coaching Quality",
    tags: ["customize", "style", "tone", "personality", "coaching style"]
  },
  {
    id: "aq-5",
    question: "What types of objections can it handle?",
    answer: "The system detects and coaches on: pricing/budget objections, security/compliance concerns, competitor comparisons, timing ('not the right time'), legal/procurement processes, decision authority, integration questions, ROI justification, and stakeholder management. With AI mode active, it can handle virtually any objection with contextual responses.",
    category: "AI & Coaching Quality",
    tags: ["objections", "handling", "types", "pricing", "security", "competitor"]
  },
  {
    id: "aq-6",
    question: "What's the difference between AI mode and Template mode?",
    answer: "AI Mode (● green dot): Uses OpenAI GPT to generate unique, contextual coaching responses based on your full conversation history and product profile. Highly specific and adaptive. Template Mode (○ grey dot): Uses regex pattern matching to detect intents/objections and serves pre-written coaching templates. Faster but less personalized. Template mode activates when no OpenAI API key is set, or as a fallback when the AI is temporarily unavailable.",
    category: "AI & Coaching Quality",
    tags: ["ai mode", "template mode", "difference", "comparison", "fallback"]
  },

  // ── Account & Billing ────────────────────────────────────
  {
    id: "ab-1",
    question: "How do I upgrade my plan?",
    answer: "Go to Settings → Billing → Upgrade. You can switch between Individual, Team, and Enterprise plans at any time. Upgrades take effect immediately, and you're prorated for the remaining billing period. Downgrades take effect at the next billing cycle.",
    category: "Account & Billing",
    tags: ["upgrade", "plan", "billing", "change", "switch"]
  },
  {
    id: "ab-2",
    question: "How do I add team members?",
    answer: "On the Team plan: go to Settings → Team → Invite Members. Enter their email address and role (rep, admin, viewer). They'll receive an invite link to join your tenant. Each team member gets their own login and can have individual Product Profiles. Admins can view aggregate usage and Trust Dashboard data across all reps.",
    category: "Account & Billing",
    tags: ["team", "members", "invite", "add", "users", "seats"]
  },
  {
    id: "ab-3",
    question: "Where can I see my usage?",
    answer: "The Insights tab shows your Trust Dashboard with session analytics. For API/token usage (admin): visit /api/admin/usage or the admin dashboard when available. Usage includes: total coaching requests, AI tokens consumed, estimated cost, and average response latency. All data is scoped to your tenant.",
    category: "Account & Billing",
    tags: ["usage", "analytics", "metrics", "consumption", "dashboard"]
  },

  // ── Technical / API ──────────────────────────────────────
  {
    id: "ta-1",
    question: "What API endpoints are available?",
    answer: "POST /api/auth/login — get a JWT token. POST /api/demo/transcript_final — send transcript for coaching. POST /api/ui-event — log UI telemetry. GET /api/trust/summary?tenantId=X — get trust metrics. POST /api/integrations/write-note — write to CRM. GET /api/ai-status — check AI mode. GET /api/health/metrics — system health. GET /api/admin/usage — token usage. GET /api/admin/rate-limits — rate limit stats. WebSocket /ws — real-time session communication.",
    category: "Technical / API",
    tags: ["api", "endpoints", "rest", "routes", "documentation"]
  },
  {
    id: "ta-2",
    question: "How does WebSocket communication work?",
    answer: "Connect to /ws and send a JSON 'start' message with session_id, tenantId, and repId. The server responds with 'ready' and initial settings. During the session, you receive 'transcript_final' echoes and 'overlay_message' patches containing coaching. Send 'ping' for keepalive and 'stop' to end the session. The server pings every 25s with a 35s timeout.",
    category: "Technical / API",
    tags: ["websocket", "ws", "real-time", "protocol", "communication"]
  },
  {
    id: "ta-3",
    question: "What is patch sanitization?",
    answer: "Every coaching response goes through sanitizePatch_v1 before being sent to the client. This enforces: maximum payload size (10KB), allowed patch paths (only 'text' and 'settings'), no script injection, and valid JSON structure. Rejected patches are logged and never reach the client. This is a core safety mechanism — the allowlist is intentionally small and governed.",
    category: "Technical / API",
    tags: ["patch", "sanitization", "safety", "security", "validation"]
  },
  {
    id: "ta-4",
    question: "How do I contribute or extend the code?",
    answer: "The codebase is a pnpm monorepo: packages/shared for protocol types, apps/server for the backend, apps/web for the frontend. To add a new intent: edit apps/server/src/arbitration/intents_v1.ts. To add a template: edit templates_v1.ts. To modify patch safety: edit packages/shared/src/sanitize/sanitizePatch_v1.ts and update tests. Run 'pnpm run typecheck' and 'pnpm test' before committing.",
    category: "Technical / API",
    tags: ["contribute", "extend", "code", "development", "modify"]
  }
];

const CATEGORIES = [...new Set(FAQ_DATA.map(f => f.category))];

/**
 * Simple fuzzy-ish search: splits query into words and scores entries
 * by how many words match in question + answer + tags.
 */
function searchFaq(query: string): FaqEntry[] {
  if (!query.trim()) return FAQ_DATA;

  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return FAQ_DATA;

  type Scored = { entry: FaqEntry; score: number };
  const scored: Scored[] = [];

  for (const entry of FAQ_DATA) {
    const haystack = `${entry.question} ${entry.answer} ${entry.tags.join(" ")} ${entry.category}`.toLowerCase();
    let score = 0;

    for (const word of words) {
      // Exact question match (highest weight)
      if (entry.question.toLowerCase().includes(word)) score += 3;
      // Tag match (high weight)
      if (entry.tags.some(t => t.includes(word))) score += 2;
      // Answer match
      if (entry.answer.toLowerCase().includes(word)) score += 1;
      // Category match
      if (entry.category.toLowerCase().includes(word)) score += 1;
    }

    // Bonus for phrase match
    if (haystack.includes(query.toLowerCase())) score += 5;

    if (score > 0) scored.push({ entry, score });
  }

  return scored.sort((a, b) => b.score - a.score).map(s => s.entry);
}

export function FaqPage({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    let items = searchFaq(query);
    if (activeCategory) items = items.filter(f => f.category === activeCategory);
    return items;
  }, [query, activeCategory]);

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id);

  return (
    <div className="faq-overlay">
      <div className="faq-container">
        {/* Header */}
        <div className="faq-header">
          <div>
            <h2 className="faq-title">Help Center</h2>
            <p className="faq-subtitle">Search our knowledge base or browse by category</p>
          </div>
          <button className="faq-close" onClick={onClose} aria-label="Close FAQ">✕</button>
        </div>

        {/* Search Bar */}
        <div className="faq-search-wrapper">
          <span className="faq-search-icon">🔍</span>
          <input
            ref={inputRef}
            className="faq-search"
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setActiveCategory(null); }}
            placeholder="Search for anything — pricing, mic setup, security, API, troubleshooting…"
            aria-label="Search FAQ"
          />
          {query && (
            <button className="faq-search-clear" onClick={() => setQuery("")} aria-label="Clear search">✕</button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="faq-categories">
          <button
            className={`faq-cat-btn ${!activeCategory ? "faq-cat-btn--active" : ""}`}
            onClick={() => setActiveCategory(null)}
          >
            All ({FAQ_DATA.length})
          </button>
          {CATEGORIES.map(cat => {
            const count = FAQ_DATA.filter(f => f.category === cat).length;
            return (
              <button
                key={cat}
                className={`faq-cat-btn ${activeCategory === cat ? "faq-cat-btn--active" : ""}`}
                onClick={() => { setActiveCategory(cat); setQuery(""); }}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Results */}
        <div className="faq-results">
          {results.length === 0 ? (
            <div className="faq-empty">
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div>No results for "{query}"</div>
              <div style={{ fontSize: 13, opacity: 0.5, marginTop: 4 }}>Try different keywords or browse categories above</div>
            </div>
          ) : (
            results.map(entry => (
              <div key={entry.id} className={`faq-item ${expandedId === entry.id ? "faq-item--expanded" : ""}`}>
                <button className="faq-question" onClick={() => toggle(entry.id)} aria-expanded={expandedId === entry.id}>
                  <span className="faq-q-text">{highlightMatch(entry.question, query)}</span>
                  <span className="faq-chevron">{expandedId === entry.id ? "▾" : "▸"}</span>
                </button>
                {expandedId === entry.id && (
                  <div className="faq-answer">
                    <span className="faq-category-badge">{entry.category}</span>
                    <p>{entry.answer}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Result count */}
        <div className="faq-footer">
          {query ? `${results.length} result${results.length !== 1 ? "s" : ""} for "${query}"` : `${results.length} articles`}
        </div>
      </div>
    </div>
  );
}

/** Highlight matching words in a string */
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const words = query.split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return text;

  const regex = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i} className="faq-highlight">{part}</mark> : part
  );
}
