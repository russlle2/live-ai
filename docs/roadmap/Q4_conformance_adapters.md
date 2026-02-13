# Q4 Conformance & Adapters

Goal: ship “adapters” so you can plug into different environments without rewriting the core.

## Conformance suite (what you should automate)
- Patch sanitizer tests (fuzz / property tests)
- No transcript leakage tests (log scanning)
- Protocol lock tests (/ws union types + overlay types)
- Tenant boundary checks (tenantId required)

## Adapter interfaces
- Meeting platform adapter (Zoom/Meet/Teams)
- CRM adapter (Salesforce/HubSpot)
- Auth adapter (SSO/SAML later)
- Storage adapter (Postgres, etc.)

## How to do it
1. Define TypeScript interfaces for adapters.
2. Provide 1 “golden” adapter implementation.
3. Build contract tests that every adapter must pass.
4. Only then add more adapters.
