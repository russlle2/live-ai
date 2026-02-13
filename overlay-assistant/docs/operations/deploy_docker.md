# Docker deployment

## Option A: Single container (API + static web)
This is the simplest “ship it” deployment.

```bash
docker build -t overlay-assistant .
docker run --rm -p 8080:8080 --env-file .env overlay-assistant
```

Set `DATABASE_URL` to your production Postgres.

## Option B: Split web and API (recommended)
- Build web: `npm run build -w apps/web`
- Publish `apps/web/dist` to a CDN
- Run the API behind an ingress/load balancer

## Scaling notes
- WebSocket connections should be sticky (session affinity) or you need a shared message bus.
- Store session state in Redis if you plan to horizontally scale the WS layer.
- Use per-tenant rate limits at the API gateway.

## Security notes
- Put TLS termination in front of the API.
- Use least-privileged DB users.
- Consider enabling Postgres RLS for tenant isolation in enterprise environments.
