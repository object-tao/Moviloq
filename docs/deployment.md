# Cloudflare deployment setup

The workflows are ready but intentionally disabled until the Cloudflare account is authorised.

## 1. Create a scoped API token

In Cloudflare, create an API token limited to the Moviloq account with the minimum permissions required to edit Workers scripts. Keep the token value private.

## 2. Add GitHub environment secrets

Create `production` and `preview` environments in the GitHub repository. Add these secrets to both environments:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

For production, enable required reviewers if the GitHub plan supports it.

## 3. Enable the workflows

Create repository variables:

- `CLOUDFLARE_DEPLOY_ENABLED=true`
- `CLOUDFLARE_PREVIEWS_ENABLED=true` (optional)

Once enabled, a merge or push to `main` deploys production. A pull request from a branch in this repository receives an isolated Worker named `moviloq-pr-<number>`; it is deleted when the pull request closes.

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

After the first controlled deployment, add `moviloq.com` as a Worker custom domain. Redirect `www.moviloq.com` to the canonical host or attach it to the same Worker. Confirm TLS, caching, security headers, the API health endpoint and both language variants before announcing the pilot.
