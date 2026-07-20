# Live Rhetoric

Live Rhetoric is a private, single-owner, real-time communication aide. It listens through separately captured audio channels and gives the owner a short, directly speakable next line for:

- job interviews;
- insurance-sales practice and approved call flows;
- IT support and troubleshooting;
- inbound customer service and de-escalation;
- negotiation and general high-stakes conversations.

The runnable application is in [`overlay-assistant`](./overlay-assistant). It includes an installable phone/laptop PWA, user-initiated Google Meet/Zoom browser-audio capture, exact greeting-to-goodbye playbooks, a low-latency OpenAI coaching path, a 96-example reviewed good-versus-weak rhetoric library, a quarantined Hugging Face preference-data audit path, automatic transcript/Gmail/Drive memory learning, suggestion-to-speech style adaptation, and fail-closed owner-voice verification.

## Personal data boundary

This repository is public. API keys, Gmail/Drive-derived memory, transcripts, recordings, voice embeddings, Google state, and runtime databases are deliberately ignored by Git and remain under private runtime paths. Those exclusions are publication boundaries, not runtime exclusions: the running app loads and updates those resources automatically.

Git exclusion is not encryption. Google OAuth material, sync cursors, cached source records, personal memory, transcripts, and suggestion/style comparison logs are application-encrypted. Populated environment files/API keys, managed auth bootstrap state, PostgreSQL data, numeric style-feature logs, and the speaker embedding still depend on owner-only permissions plus disk/volume encryption. Use encrypted backups on every machine that stores them.

Authentication is fail-closed by default. In direct host development, if explicit secrets are absent, the server creates owner-only local credentials and the laptop UI can retrieve the pairing code only through a directly observed loopback connection. Container and reverse-proxy deployments must provision explicit secrets; bridge/NAT/proxy traffic is not a trustworthy direct-loopback signal. Unauthenticated mode exists only behind the explicit `ALLOW_INSECURE_DEMO_AUTH=true` switch and is unsuitable for a network deployment.

Start with [`overlay-assistant/README.md`](./overlay-assistant/README.md). Historical SaaS/sales material under `overlay-assistant/docs/selling`, `overlay-assistant/docs/roadmap`, and `overlay-assistant/docs/context_pack` is archival context, not the current product specification.
