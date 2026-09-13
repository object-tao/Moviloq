# Moviloq

Moviloq is a bilingual logistics marketplace being built for an initial pilot in Frankfurt am Main. The first product line helps individuals and businesses estimate local deliveries and will later match them with verified independent drivers and fleets.

This repository is in active development. It does **not** yet accept binding orders, payments or partner applications.

Administration has a separate endpoint at [admin.moviloq.com](https://admin.moviloq.com) with self-owned username/password authentication, as requested by the owner. No email OTP or MFA is required. Salted scrypt password hashes, centralized throttling and revocable server-side sessions live in a dedicated authentication D1 database; no customer business data is bound. Only readiness, password change and logout are available. The owner sets their password privately on a local setup page. See the [admin / driver / fleet plan](docs/admin-driver-fleet-plan.md) and [password setup and recovery](docs/admin-access-setup.md).

## What is implemented

- original, responsive English/Chinese marketing experience;
- personal, business, partner, tracking, account and legal placeholders;
- bilingual multi-stop delivery planning with cargo, vehicle capacity and schedule validation;
- save, reopen, edit and delete delivery drafts in a browser-scoped workspace;
- a validated Hono quote API running in a Cloudflare Worker;
- EU-jurisdiction D1 storage with expiry, optimistic version checks and session isolation;
- automated lint, type checking, unit tests and production builds;
- guarded Cloudflare deployments with independent databases for PR previews;
- API and Chromium browser smoke tests against preview deployments.

The draft prices are engineering fixtures inspired by the product model, not published Moviloq tariffs and not copied Lalamove prices. They must be replaced by approved commercial rules before launch.

## Technology

- React 19 and React Router
- TypeScript and Vite
- Cloudflare Workers and the Cloudflare Vite plugin
- Hono
- Zod
- Cloudflare D1 migrations
- Vitest and ESLint
- pnpm

## Local development

Requirements: Node.js 24 and pnpm 11.

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

The Vite development server runs the React application and Worker API in one local environment. Useful commands:

```bash
pnpm check          # lint, types, tests and production build
pnpm test:watch     # unit tests in watch mode
pnpm cf:typegen     # regenerate Cloudflare binding types
node scripts/drafts-smoke.mjs http://127.0.0.1:5173
node scripts/browser-smoke.mjs http://127.0.0.1:5173
```

Never put secrets in `.dev.vars.example`. Create an ignored `.dev.vars` file for local secrets when providers are connected.

Browser tests use installed Edge on Windows or Chrome on Linux. Set `BROWSER_EXECUTABLE` to override the executable. They write only synthetic data in local/preview environments. See [development progress](docs/development-progress.md) for scope and remaining launch requirements.

Drafts are not orders or registered accounts. The HttpOnly cookie grants access only in the same browser and hostname. Each workspace expires 30 days after its first save; edits do not extend retention. Use sample data while the company and full privacy policy are pending.

## Repository structure

```text
src/                 React application
worker/              Cloudflare Worker API
shared/              schemas and logic shared by web/API tests
migrations/          ordered Cloudflare D1 migrations
admin-migrations/    separate administrator authentication schema
docs/                architecture and deployment notes
.github/workflows/   CI and guarded Cloudflare delivery
```

## Delivery status

Production and preview workflows use GitHub environment secrets. Production publishes `main` to [moviloq.com](https://moviloq.com) after the quality gate; same-repository pull requests receive isolated Workers previews. Each deployment verifies its public website and API, and closing a pull request removes its preview. Repository variables allow automatic deployments to be paused. See [deployment setup](docs/deployment.md) and [architecture](docs/architecture.md).

## Product and legal notes

- Pilot geography: Frankfurt am Main and an initial service radius of roughly 75 km.
- Initial languages: English and Simplified Chinese; German follows before wider local launch.
- Initial business line: self-service marketplace; cross-border FTL/LTL and managed fleets are later phases.
- The legal entity, payments, insurance position, privacy notices and transport contract wording require German professional review before transactions open.

Security reports: see [SECURITY.md](SECURITY.md).
