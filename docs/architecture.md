# Moviloq technical architecture

## Current foundation

Moviloq is a Cloudflare-native full-stack application:

- React renders the customer-facing single-page application.
- Vite builds the web assets and the Cloudflare Worker together.
- Hono exposes versionable HTTP endpoints under `/api/*`.
- Cloudflare Workers serves both the API and static application.
- Cloudflare D1 is the planned transactional store; its first migration is already versioned.
- GitHub Actions enforces lint, type checking, tests and a production build on every change.

The browser never receives private pricing configuration, account credentials or provider secrets. The current public quote endpoint contains only a clearly labelled development estimate.

## Product boundary

The first business line is a self-service logistics marketplace for the Frankfurt pilot area. Customers request a vehicle category; verified independent drivers choose whether to accept available jobs. The final legal contract chain, money flow and platform role must be approved by German counsel before real transactions are enabled.

The platform must keep an auditable record of:

1. the quote inputs and pricing version shown to the customer;
2. customer acceptance of the applicable terms;
3. which driver and registered vehicle accepted the order;
4. status, location and proof-of-delivery events;
5. payments, refunds, disputes and administrative actions.

## Deployment flow

```text
feature branch -> pull request -> CI quality gate -> optional Cloudflare preview
                                                     |
                                                     v
main branch ------------------------------------> production Worker
```

Production and preview credentials are stored in separate GitHub environments. Vite selects the deployment environment at build time: only production carries custom domain bindings. Repository variables can pause either workflow. Deployment smoke checks verify both the website and API over HTTPS.

## Planned service boundaries

Keep the first release as one deployable application while maintaining internal boundaries:

- identity and organisation membership;
- quotes and pricing versions;
- orders, stops and cargo items;
- partner, fleet, vehicle and document verification;
- job offers and assignments;
- tracking and delivery evidence;
- payments and invoices;
- notifications and support;
- audit and compliance.

Split services only when operational scale or team ownership justifies the added complexity.
