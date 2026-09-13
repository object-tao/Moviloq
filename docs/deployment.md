# Cloudflare deployment setup

GitHub Actions builds and deploys Moviloq using credentials stored in GitHub environment secrets. Browser sessions are not needed for subsequent releases.

## 1. Create a scoped API token

In Cloudflare, create an API token limited to the Moviloq account with the minimum permissions required to edit Workers scripts. Keep the token value private.

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

Once enabled, a merge or push to `main` runs lint, type checking, tests and a build, then deploys production. A pull request from a branch in this repository receives an isolated Worker named `moviloq-pr-<number>`; it is deleted when the pull request closes. The cleanup job uses the preview environment credentials and checks out `main`.

The Vite build uses `CLOUDFLARE_ENV=production` or `CLOUDFLARE_ENV=preview`. Production binds `moviloq.com` and `www.moviloq.com`; preview builds have an explicitly empty routes list and no production data bindings. Wrangler deploys the flattened configuration produced by Vite.

Each deployment runs `scripts/smoke.mjs` against its public HTTPS URL. It verifies the environment reported by the API, homepage, JavaScript asset, direct `/book` navigation, a valid quote, validation errors and missing API routes. Failed checks mark the workflow failed; they do not silently roll back a release.

## 4. Create D1 when persistence work begins

Run:

```bash
pnpm wrangler d1 create moviloq
```

Copy the returned database ID into the `d1_databases` block in `wrangler.jsonc`, uncomment the block, then apply migrations:

```bash
pnpm db:migrate:local
pnpm db:migrate:remote
```

The local migration command uses `wrangler.local.jsonc`, so the schema can be verified before a Cloudflare D1 database exists. Its all-zero database ID is local-only and must never be copied into the production configuration.

Do not enable real orders until backups, retention rules, data export/deletion workflows and legal documents are reviewed.

## 5. Attach moviloq.com

Custom domains for `moviloq.com` and `www.moviloq.com` are declared in the production environment of `wrangler.jsonc`. Both serve the same Worker. Cloudflare manages their DNS records and TLS certificates through its Workers Custom Domains feature.

## Release and recovery

- Push a branch and open a pull request to get CI and a preview deployment.
- Merge the pull request into `main` to deploy production automatically.
- Run the `Deploy production` workflow on `main` to retry a failed release.
- To stop automatic production deployment, set `CLOUDFLARE_DEPLOY_ENABLED=false`.
- To roll back application code, revert the relevant commit and merge the revert into `main` so the normal quality and deployment checks run again.
- Inspect the GitHub Actions run and Cloudflare Worker deployment logs when a smoke check fails.

References: [Vite environments](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
