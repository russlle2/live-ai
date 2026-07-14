# ARCHIVED — predecessor SaaS packaging draft

This file is historical design context. Live Rhetoric is now a single-owner personal app and is not offered in these packages.

# Packaging & Delivery (how to sell it)

## Fastest to sell: SaaS + browser extension (recommended)
- **SaaS backend**: arbitration, governance, telemetry, integrations
- **Browser extension** (or desktop wrapper): overlay + meeting capture
Pros:
- easiest to deploy to many reps
- central control for safety & rollbacks
- simple updates

## Enterprise option: self-hosted
- ship Docker images + Helm charts
- customer runs Postgres + your API
Pros:
- helps with regulated buyers
Cons:
- longer sales cycles, higher support load

## Avoid at v1
- Custom hardware device (slow, expensive, hard to support)

## Pricing lever
Price on:
- seats (reps)
- meetings processed
- add-ons (CRM integration, SSO, audit exports)
