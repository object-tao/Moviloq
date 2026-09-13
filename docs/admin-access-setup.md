# Administration access setup (pending)

The reserved production endpoint is `admin.moviloq.com`, served by the independent `moviloq-admin` Worker. `wrangler.admin.jsonc` deliberately contains no DB or service bindings. Its locked page returns 403; `/api/health` reports `mode: locked`, not a ready management system. Local development uses `pnpm admin:dev`; all administrative operations remain disabled locally too.

## Prerequisites before enabling real administration

- Confirm the Cloudflare Zero Trust organization for the Moviloq account without changing unrelated account-wide policies.
- Configure an Access self-hosted application scoped only to `admin.moviloq.com`. Do not protect the public customer domain by accident.
- Add only the explicitly approved administrator identities. Never allow `Everyone` or a whole consumer-email domain such as `qq.com`.
- Configure an identity provider or email OTP and independent MFA. OTP by email alone does not satisfy the project's administrator-MFA requirement.
- Implement JWT signature, issuer, audience, type and expiry checks at the origin with a maintained verification library. Do not trust `Cf-Access-Authenticated-User-Email` alone.
- Implement server-side RBAC, audited access, session expiration/revocation and a tested recovery process before adding data bindings.
- Test direct-origin/alternative-host bypasses, forged tokens, invalid audience, expired token, revoked roles and cross-tenant access.
- Test the first allowed login and MFA enrollment with the actual administrator; an allowlist entry is not a verified working login.

## Current authorization blocker

Reading `/accounts/<account>/access/organizations` returned HTTP 403 with Cloudflare code 10000 (`Authentication error`). The current credential works for existing deployments but is not sufficient to complete Access organization setup. The official organization API accepts `Access: Organizations, Identity Providers, and Groups Write` for setup. Access application/policy configuration separately requires `Access: Apps and Policies Write`.

The account owner can edit the existing scoped token's permissions in **My Profile → API Tokens**, adding only the Access permissions needed in the Moviloq account (UI may label Write as Edit). If replacing the token, use secure environment/GitHub secret storage; never paste it into source, a PR, an issue or chat. Keep existing Workers/D1/domain permissions needed by current CI/CD.

Do not change global deny-unmatched, WARP, organization-wide MFA or existing identity providers without inspecting their current impact. If a Zero Trust organization does not exist, first-time plan/terms selection needs the account owner. Do not subscribe to a paid plan without approval.

References: [organization setup API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/create/), [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/).
