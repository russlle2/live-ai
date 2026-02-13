# Local development

## Prereqs
- Node 22+
- Docker Desktop (for Postgres)

## Setup
```bash
docker compose up -d db
cp .env.example .env
npm install
npm run db:migrate -w apps/server
npm run dev
```

## Run only the backend
```bash
npm run dev -w apps/server
```

## Run only the web UI
```bash
npm run dev -w apps/web
```

## Common workflows

### Edit templates / rules
- templates: `apps/server/src/arbitration/templates_v1.ts`
- intent scoring: `apps/server/src/arbitration/intents_v1.ts`
- objection scoring: `apps/server/src/arbitration/objections_v1.ts`

### Tighten patch safety
- `packages/shared/src/sanitize/sanitizePatch_v1.ts`
- update tests: `packages/shared/test/sanitizePatch_v1.test.ts`

### Watch events for debugging
Events are printed as JSON to stdout (privacy-safe). You can also query Postgres:
```sql
select * from obs_events order by at desc limit 50;
```
