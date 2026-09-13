# Administration access readiness

The production endpoint is `admin.moviloq.com`, served by the independent `moviloq-admin` Worker. `wrangler.admin.jsonc` deliberately contains no DB or service bindings. Cloudflare Access protects the entire hostname. Only an allowlisted owner with a verified application JWT can view the readiness page and session/health metadata. Every business operation remains disabled. Local development without the private auth configuration stays locked; there is no development authentication bypass.

## Configured on 2026-09-13

- Existing Zero Trust organization reused; no team rename, plan change, global deny-unmatched rule or global MFA enforcement.
- A dedicated email OTP provider, one self-hosted admin application and one exact-email allow policy. No Everyone, whole-email-domain, service-token or bypass policy.
- Organization MFA enrollment enabled for TOTP, biometrics and security keys. Only the admin application explicitly requires independent MFA on each Access login (`0m`); application sessions last one hour. Existing sessions are not shortened by the MFA duration.
- `ADMIN_AUTH_CONFIG` is a Worker secret containing HTTPS issuer, exact audience, SHA-256 of the approved lowercase email and a Unix-second `notBefore` cutoff. It contains no deployment API credential. No owner identity appears in the public UI or source.
- Origin verification uses `jose`, fixed issuer keys, RS256, required app-token claims, expiry, maximum one-hour lifetime and the session cutoff. Headers claiming an email/role, cookies and URL flags never grant access.
- Only the `owner` role with `admin:readiness:read` exists. Multi-role invitations, business authorization and a durable audit ledger are future work. Operational events use a hashed subject, generated request ID, fixed route category and outcome; no JWT/email/request query is logged by this application.
- `workers.dev` and preview URLs remain off. Production CI verifies Access policy drift and origin isolation before/after deployment, and checks that unauthenticated requests are challenged.

Real mailbox delivery, first MFA enrollment, successful owner login and logout/relogin still require owner verification. Automated negative tests do not prove the owner's real login works.

## One-time setup and verification

`scripts/configure-admin-access.mjs --apply` performs explicit account-scoped bootstrap using private `CLOUDFLARE_API_TOKEN` and `MOVILOQ_ADMIN_EMAIL` environment variables. It refuses to replace an existing admin application or different organization MFA configuration. It preserves organization fields, leaves global enforcement off and stores origin metadata as a Worker secret. It is not a routine deployment step. A partial failure must be inspected before retrying; do not delete existing policies to make a retry pass.

`scripts/verify-admin-access.mjs` is read-only and uses `CLOUDFLARE_API_TOKEN` and `MOVILOQ_ADMIN_OWNER_SHA256` (the latter is a production GitHub environment secret). It verifies exact-email identity, MFA, audience, cookie/session settings, the origin secret's presence and no data/alternative-host bindings. It cannot read back a secret's value or replace a genuine authenticated login test.

The owner enrolls a personal MFA device at the existing team's `/AddMfaDevice` page, then logs in at the admin hostname. Do not share enrollment QR codes, TOTP seeds, login codes, sessions or recovery material in a task, PR or repository. Logout uses the Cloudflare-managed `/cdn-cgi/access/logout` endpoint.

## Recovery and revocation

Keep an independently secured Cloudflare account/recovery method. If the owner loses their only MFA device, the verified Cloudflare account owner must review identity and reset only that user's MFA device; never add an Everyone/bypass policy or disable global protections as a workaround.

For a lost admin session, revoke it in Access and advance the origin secret's `notBefore` cutoff; all older signed tokens then fail locally. Removing/replacing the approved owner fingerprint immediately denies the old identity at the origin. Routine sign-out is not a guarantee that a copied bearer token is immediately revoked; tokens are bounded to one hour. Before business data is connected, implement and test durable per-user revocation and multi-role permissions.

An API token previously pasted in chat must be rotated through private configuration. Replace all local/CI consumers first, verify them, then revoke the old token. Avoid breaking other projects sharing that credential. No automatic token revocation has been performed.

## Prerequisites before enabling real administration

- Confirm the Cloudflare Zero Trust organization for the Moviloq account without changing unrelated account-wide policies.
- Configure an Access self-hosted application scoped only to `admin.moviloq.com`. Do not protect the public customer domain by accident.
- Add only the explicitly approved administrator identities. Never allow `Everyone` or a whole consumer-email domain such as `qq.com`.
- Configure an identity provider or email OTP and independent MFA. OTP by email alone does not satisfy the project's administrator-MFA requirement.
- Implement JWT signature, issuer, audience, type and expiry checks at the origin with a maintained verification library. Do not trust `Cf-Access-Authenticated-User-Email` alone.
- Implement server-side RBAC, audited access, session expiration/revocation and a tested recovery process before adding data bindings.
- Test direct-origin/alternative-host bypasses, forged tokens, invalid audience, expired token, revoked roles and cross-tenant access.
- Test the first allowed login and MFA enrollment with the actual administrator; an allowlist entry is not a verified working login.

## Resolved authorization blocker

Reading `/accounts/<account>/access/organizations` previously returned HTTP 403 with Cloudflare code 10000. After the owner updated the scoped token, this read returned 200 and setup succeeded. The official organization API accepts `Access: Organizations, Identity Providers, and Groups Write` for setup. Access application/policy configuration separately requires `Access: Apps and Policies Write`.

The account owner can edit the existing scoped token's permissions in **My Profile → API Tokens**, adding only the Access permissions needed in the Moviloq account (UI may label Write as Edit). If replacing the token, use secure environment/GitHub secret storage; never paste it into source, a PR, an issue or chat. Keep existing Workers/D1/domain permissions needed by current CI/CD.

Do not change global deny-unmatched, WARP, organization-wide MFA or existing identity providers without inspecting their current impact. If a Zero Trust organization does not exist, first-time plan/terms selection needs the account owner. Do not subscribe to a paid plan without approval.

References: [organization setup API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/create/), [JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), [independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/).
