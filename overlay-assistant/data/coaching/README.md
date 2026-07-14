# Coaching knowledge corpus

This directory is reusable coaching knowledge, not personal memory. Nothing in
these files is evidence about the owner. Personal communication-style facts are
applied only at response generation time and never rewrite this corpus.

## Live library

- `seed_examples_v1.jsonl`: 36 original weak-versus-improved response pairs.
- `original_expansion_customer_v1.jsonl`: 30 additional interview, IT-support,
  and inbound-service contrasts.
- `original_expansion_growth_v1.jsonl`: 30 additional insurance-sales,
  negotiation, and professional-growth contrasts.
- `source_manifest_v1.json`: deny-by-default license and provenance decisions
  for possible external sources.

The 96-row live set is deliberately balanced: 16 reviewed contrasts in each of
the six domains. The server loads all three shards atomically, validates every
row against the manifest, and rejects the whole live library for an unadmitted
source, license mismatch, malformed row, or duplicate ID.

These three shards and the manifest are copied into the production app image so
runtime retrieval does not depend on a host-only source checkout. They contain
no owner facts; personal memory remains a separately mounted runtime store.

## External preference-data staging

`apps/server/src/knowledge/helpsteer2_staging.ts` is a streaming quarantine
importer for the pinned `nvidia/HelpSteer2` preference snapshot. It records the
source revision, input and output hashes, row locator, split, license, and
attribution. It rejects ties, weak or unexplained preferences, annotation/sign
conflicts, duplicate responses/candidates, multi-turn artifacts, possible
personal data, prompt injection, unsafe content, source-dependent tasks, and
non-dialogue material. Its output uses `coaching_preference_candidate_v1`, which
the live loader cannot parse, and every row is marked `liveRetrievalAllowed:
false`.

The committed audit in `audits/helpsteer2_staging_audit_v1.json` covers all
9,125 preference rows at revision
`990b2711a36180dd19d9c94b8627844866f8982a`. Only five strong, short,
communication-focused pairs survived the automatic quarantine filters. They
remain external review candidates, not proof that either answer is safe or
factually correct and not part of runtime coaching. The incompatible staging
schema and `liveRetrievalAllowed: false` flag provide an additional mechanical
boundary beyond source-manifest review.

Reproduce the audit without putting the external rows in the repository:

```bash
hf download nvidia/HelpSteer2 preference/preference.jsonl.gz \
  --repo-type dataset \
  --revision 990b2711a36180dd19d9c94b8627844866f8982a \
  --local-dir data/private/hf/helpsteer2

pnpm -C apps/server coaching:stage:helpsteer2 -- \
  --input data/private/hf/helpsteer2/preference/preference.jsonl.gz \
  --output data/private/coaching-staging/helpsteer2.staging.jsonl \
  --audit data/private/coaching-staging/helpsteer2.audit.json \
  --revision 990b2711a36180dd19d9c94b8627844866f8982a
```

## Safe scale-up path

1. Discover external datasets by metadata only.
2. Record exact source, version, license, attribution, intended use, and risks in
   the manifest. An apparently permissive license tag is not a provenance review.
3. Keep the source excluded or in legal review until that review is explicit.
4. Import only the minimum approved fields into a staging area; remove personal
   data, secrets, copied brand scripts, manipulative tactics, and unsafe technical
   actions.
5. Convert source material into the `coaching_example_v1` contrast schema with
   row-level provenance. Do not silently relabel weak responses as good ones.
6. Hold out scenario families for evaluation and test accuracy, honesty,
   compliance, empathy, next-step quality, and latency before enabling runtime
   retrieval.
7. Independently score the winner for clarity, factual support, empathy,
   credibility, compliance, and next-step quality; relative preference alone
   does not mean an answer is good.
8. Convert only approved material into short `coaching_example_v1` contrasts,
   mark it `adapted`, and preserve its source attribution.
9. Admit a source to live retrieval only by changing its reviewed manifest status
   to `included`. The runtime gate otherwise fails closed.

TED talks, motivational speeches, podcasts, and coaching-session transcripts are
not bulk-ingestion shortcuts. Their expressive wording may be copyrighted, some
licenses prohibit commercial use or derivatives, and some conversations contain
sensitive health information. This corpus instead uses newly authored examples
of general principles such as a clear thesis, concrete evidence, contrast,
reflection, and an actionable close.

## Retrieval and voice blending

`apps/server/src/knowledge/coaching_corpus.ts` provides deterministic retrieval
and a style-aware context builder. Retrieval chooses examples by domain, cue,
stage, and tags. The generator should take the response principles from those
examples, ground every personal claim in verified personal memory, and then
mirror only safe attributes of the owner's style: sentence length, vocabulary,
cadence, and directness. It must polish clarity and must not copy filler,
confusion, hostility, deceptive claims, pressure tactics, or unsafe steps.

This separation lets a large generic corpus improve substance without turning
fictional examples into autobiography or letting personal data contaminate
reusable training material.
