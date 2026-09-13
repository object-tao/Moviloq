# Cloudflare deployment setup

GitHub Actions builds and deploys Moviloq using credentials stored in GitHub environment secrets. Browser sessions are not needed for subsequent releases.

## 1. Create a scoped API token

In Cloudflare, create an API token limited to the Moviloq account with the minimum permissions required to edit Workers scripts and D1 databases. Domain setup also needs permissions for the selected zone. Keep the token value private.

## 2. Add GitHub environment secrets

Create `production` and `preview` environments in the GitHub repository. Add these secrets to both environments:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Production also needs `MOVILOQ_ADMIN_OWNER_SHA256`, the private SHA-256 fingerprint of the approved lowercase administrator email. The pre/post-deployment password checks compare it with the provisioned owner in the dedicated authentication D1 without reading password hashes or logging the identity. The deployment token needs account-scoped Access application **Read** permission to confirm the retired admin Access gate is absent, in addition to Workers/D1 permissions. One-time removal of that exact gate requires Access application Edit separately. Never put administrator identities, passwords or token values in this repository.

Automatic publishing does not require manual environment approval. The production workflow accepts only the `main` branch; fork pull requests never receive deployment credentials.

## 3. Enable the workflows

Create repository variables:

- `CLOUDFLARE_DEPLOY_ENABLED=true`
- `CLOUDFLARE_PREVIEWS_ENABLED=true` (optional)

Also set `CLOUDFLARE_WORKERS_SUBDOMAIN` to the Workers subdomain reported by Cloudflare. It is used for preview URLs.

Once enabled, a merge or push to `main` runs lint, type checking, tests and a build, applies pending D1 migrations, then deploys production. A pull request from a branch in this repository receives an isolated Worker and EU-jurisdiction database, both named `moviloq-pr-<number>`; both are deleted when the pull request closes. The cleanup job uses the preview environment credentials and checks out `main`.

The Vite build uses `CLOUDFLARE_ENV=production` or `CLOUDFLARE_ENV=preview`. Production binds `moviloq.com` and `www.moviloq.com`; preview builds have an explicitly empty routes list and no production data bindings. `prepare-preview.mjs` creates/reuses the exact PR database and generates an ignored `wrangler.preview.json`, selected via `MOVILOQ_WRANGLER_CONFIG`. D1 migration commands use explicit `--config` and `--env` arguments; unlike deploy, they do not follow Vite's generated configuration redirect. Wrangler deploys the flattened configuration produced by Vite. Do not deploy with a locally built development configuration; `pnpm deploy` explicitly rebuilds production first.

Preview cleanup uses the Cloudflare Worker API directly, so it needs no KV storage permissions. Before deletion it validates the numbered `moviloq-pr-<number>` name and the Worker's `ENVIRONMENT=preview` marker. An already-absent Worker is treated as a successful cleanup, making retries safe.

Each deployment runs `scripts/smoke.mjs` against its public HTTPS URL. It verifies environment, database availability, anonymous draft access, homepage, JavaScript asset, direct `/book` navigation, quotes and API errors. Preview additionally runs `drafts-smoke.mjs` (CRUD, authentication boundary, CSRF, idempotency, concurrent editing, input limits) and `browser-smoke.mjs` (actual bilingual UI, save/reload/edit/delete and mobile widths). Failed checks mark the workflow failed; they do not silently roll back a release.

## 4. D1 and retention

Production is bound to `moviloq-production` in `wrangler.jsonc`. The database was created with `jurisdiction: eu`; this setting concerns D1 storage, not all Worker processing. Apply local migrations before starting development:

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

The local migration command uses `wrangler.local.jsonc`. Its all-zero database ID is local-only and must never be copied into production. Automated deployment applies only pending migrations before changing the Worker code. Migrations must remain additive/backward-compatible with the previous running version.

Production runs an expiry cleanup daily at 03:15 UTC. A workspace expires 30 days after its first save; its drafts are inaccessible immediately at expiry, then removed from the live database by the scheduled job via a foreign-key cascade. Manual draft deletion is immediate. Provider recovery/backups have separate retention. Preview databases are removed in full on PR closure; they do not contain production data.

Do not enable real orders until backups, retention rules, data export/deletion workflows and legal documents are reviewed.

## 5. Attach moviloq.com

Custom domains for `moviloq.com` and `www.moviloq.com` are declared in the production environment of `wrangler.jsonc`. Both serve the same Worker. Cloudflare manages their DNS records and TLS certificates through its Workers Custom Domains feature.

## Release and recovery

The independent administration Worker is configured in `wrangler.admin.jsonc`. `pnpm check` also builds it with Wrangler `--dry-run`; production deployment applies its separate `admin-migrations` to `ADMIN_DB`, then publishes it explicitly after the customer Worker. It is not part of customer PR preview domains and carries no customer database/service binding. The login page, assets and non-sensitive health status are public; protected APIs require a server-validated database session. Only readiness, password change and logout are available. Business operations remain disabled. Missing DB/secret fails closed with 503; invalid sessions receive 401 or redirect to the own login page.

The `ADMIN_AUTH_SECRET` Worker secret is random HMAC key material for pseudonymous IP fingerprints, never the Cloudflare API token or owner password. It is configured outside source control and preserved on deployment. `verify-admin-password.mjs` checks the exact owner, dedicated auth binding, retired Access gate and disabled alternative URLs before and after deployment. `admin-smoke.mjs` verifies the own login form, CSRF and forged-identity rejection without real credentials. CI additionally runs real workerd/D1/browser login, change-password and logout tests with synthetic credentials. See [password setup and controlled cutover](admin-access-setup.md). Complete that one-time cutover before merging the first password-auth release; subsequent releases are automated.

- Push a branch and open a pull request to get CI and a preview deployment.
- Merge the pull request into `main` to deploy production automatically.
- Run the `Deploy production` workflow on `main` to retry a failed release.
- To stop automatic production deployment, set `CLOUDFLARE_DEPLOY_ENABLED=false`.
- To roll back application code, revert the relevant commit and merge the revert into `main` so the normal quality and deployment checks run again.
- Reverting code does not revert database migrations. Review schema compatibility before rolling back; do not drop production tables to undo an application release.
- Inspect the GitHub Actions run and Cloudflare Worker deployment logs when a smoke check fails.

References: [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).
