# Cloudflare deployment setup

GitHub Actions builds and deploys Moviloq using credentials stored in GitHub environment secrets. Browser sessions are not needed for subsequent releases.

## 1. Create a scoped API token

In Cloudflare, create an API token limited to the Moviloq account with the minimum permissions required to edit Workers scripts and D1 databases. Domain setup also needs permissions for the selected zone. Keep the token value private.

## 2. Add GitHub environment secrets

Create `production` and `preview` environments in the GitHub repository. Add these secrets to both environments:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Automatic publishing does not require manual environment approval. The production workflow accepts only the `main` branch; fork pull requests never receive deployment credentials.

## 3. Enable the workflows

Create repository variables:

- `CLOUDFLARE_DEPLOY_ENABLED=true`
- `CLOUDFLARE_PREVIEWS_ENABLED=true` (optional)

Also set `CLOUDFLARE_WORKERS_SUBDOMAIN` to the Workers subdomain reported by Cloudflare. It is used for preview URLs.

Once enabled, a merge or push to `main` runs lint, type checking, tests and a build, applies pending D1 migrations, then deploys production. A pull request from a branch in this repository receives an isolated Worker and EU-jurisdiction database, both named `moviloq-pr-<number>`; both are deleted when the pull request closes. The cleanup job uses the preview environment credentials and checks out `main`.

The Vite build uses `CLOUDFLARE_ENV=production` or `CLOUDFLARE_ENV=preview`. Production binds `moviloq.com` and `www.moviloq.com`; preview builds have an explicitly empty routes list and no production data bindings. `prepare-preview.mjs` creates/reuses the exact PR database and generates an ignored `wrangler.preview.json`, selected via `MOVILOQ_WRANGLER_CONFIG`. Wrangler migrates and deploys from the flattened configuration produced by Vite. Do not deploy with a locally built development configuration; `pnpm deploy` explicitly rebuilds production first.

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

- Push a branch and open a pull request to get CI and a preview deployment.
- Merge the pull request into `main` to deploy production automatically.
- Run the `Deploy production` workflow on `main` to retry a failed release.
- To stop automatic production deployment, set `CLOUDFLARE_DEPLOY_ENABLED=false`.
- To roll back application code, revert the relevant commit and merge the revert into `main` so the normal quality and deployment checks run again.
- Reverting code does not revert database migrations. Review schema compatibility before rolling back; do not drop production tables to undo an application release.
- Inspect the GitHub Actions run and Cloudflare Worker deployment logs when a smoke check fails.

References: [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/).
