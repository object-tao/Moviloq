# Moviloq technical architecture

## Current foundation

Moviloq is a Cloudflare-native full-stack application:

- React renders the customer-facing single-page application.
- Vite builds the web assets and the Cloudflare Worker together.
- Hono exposes versionable HTTP endpoints under `/api/*`.
- Cloudflare Workers serves both the API and static application.
- Cloudflare D1 stores browser-scoped draft workspaces in an EU-jurisdiction production database; each preview uses a different database.
- GitHub Actions enforces lint, type checking, tests and a production build on every change.

The browser never receives provider credentials. Current shared pricing rules are public development fixtures, not private commercial rates. Both the quote API and draft saves calculate on the server, ignoring client-supplied totals.

## Operations preparation (implemented)

The separate admin Worker keeps password credentials and staff roles in `ADMIN_DB`, and accesses only explicit `ops_*` preparation workflows through the server using an allowlisted `OPS_DB` binding. It does not expose anonymous customer draft data to staff. Owner, operations and reviewer permissions are checked on every protected handler. Documents are private, size/type bounded and access-audited; published configurations are immutable. A global operations revision and guarded D1 transactions serialize dependent validation and writes, including the audit event. Published preview tariffs and vehicle capacities feed customer quote/draft validation without repricing stored snapshots. Live orders and payments remain off. See [operations implementation, limits and runbook](admin-operations.md).

## Draft workspace details

`POST /api/drafts` creates a workspace only after valid input. A random 256-bit bearer credential is held in an HttpOnly, SameSite=Strict, host-only cookie (Secure and `__Host-` prefixed on HTTPS); D1 stores only its SHA-256 hash. This is browser access, not account authentication or cross-device recovery. All reads, updates and deletes scope SQL by the session hash. Draft IDs alone grant no access. Mutations require the exact same Origin, and private responses are never cached.

Drafts contain route, contact fields, cargo, schedule, selected vehicle and an estimate snapshot. Validation limits payloads to 32 KiB, 20 drop-offs and the vehicle's total weight/largest upright item envelope. The system does not yet geocode addresses, validate service coverage or solve multi-item packing. A workspace holds at most 30 drafts. Save retries use an idempotency key within an established session. Atomic version checks reject concurrent update/delete conflicts instead of overwriting them. Version numbers are conflict controls, not a full revision-history audit log.

Cloudflare's rate-limit binding throttles draft requests by workspace; requests without a workspace use the connecting IP. This is a per-location safety throttle, not a globally exact quota or complete bot defence. Expiry is fixed at 30 days from workspace creation. A production scheduled handler removes expired sessions and cascades their drafts; access checks enforce expiry even if that job is delayed.

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
