# Taskable Backend MVP

Local backend scaffold for auth, org scoping, task CRUD, audit events, local-data import, and realtime presence.

## Run

```bash
cd server
npm install
npm run dev
```

Server default URL: `http://localhost:4000`

## Core endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/microsoft/exchange`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/mfa/enroll/start`
- `POST /api/auth/mfa/enroll/confirm`
- `POST /api/auth/mfa/disable`
- `POST /api/auth/resend-verification`
- `POST /api/auth/verify-email`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`
- `GET /api/auth/sessions`
- `GET /metrics/basic`
- `GET /metrics/slo`
- `GET /api/me`
- `POST /api/ops/events`
- `GET /api/orgs`
- `POST /api/orgs`
- `GET /api/orgs/:orgId/members`
- `POST /api/orgs/:orgId/members`
- `PATCH /api/orgs/:orgId/members/:userId`
- `DELETE /api/orgs/:orgId/members/:userId`
- `POST /api/orgs/:orgId/stream-token`
- `GET /api/orgs/:orgId/stream`
- `GET /api/orgs/:orgId/presence`
- `POST /api/orgs/:orgId/presence/claim`
- `POST /api/orgs/:orgId/presence/release`
- `POST /api/orgs/:orgId/presence/release-all`
- `GET /api/orgs/:orgId/tasks`
- `POST /api/orgs/:orgId/tasks`
- `PUT /api/orgs/:orgId/tasks/:taskId`
- `DELETE /api/orgs/:orgId/tasks/:taskId`
- `GET /api/orgs/:orgId/activity`
- `POST /api/orgs/:orgId/import-local`
- `POST /api/orgs/:orgId/inbox-from-email`

## Notes

- Uses SQLite (`server/data/taskable.db`) via `better-sqlite3`.
- Uses bearer JWT auth plus refresh-token session rotation.
- Supports Microsoft identity token exchange for Outlook add-in SSO (`/api/auth/microsoft/exchange`).
- Supports TOTP MFA enrollment and login challenge for local auth users.
- Email verification and password reset support provider-backed delivery (`EMAIL_PROVIDER`) with test/console/sandbox options.
- Org membership is enforced in task/audit/import routes.
- RBAC roles: `owner`, `admin`, `member`, `viewer`.
- Write routes require `owner/admin/member`; task delete requires `owner/admin`.
- Audit entries are written for create/update/delete/import task operations.
- `import-local` supports full snapshot replacement with `replaceAll: true` and safely nulls unknown assignees.
- `inbox-from-email` creates a metadata-only inbox task for Outlook/email capture flows.
- Tasks include optimistic concurrency `version`; writes can provide `ifVersion` to avoid silent overwrites.
- Realtime org updates are published over SSE (`task.changed`, `tasks.synced`, `member.changed`, `presence.changed`).
- SSE auth is hardened with one-time stream tokens from `/api/orgs/:orgId/stream-token` and query access-token fallback disabled in production by default.
- Presence locks are hard write gates for concurrent task/day editing, with owner/admin takeover support.
- Operational telemetry events can be ingested via `POST /api/ops/events` (best-effort, no task-title payload by default).
- SLO summary metrics available at `GET /metrics/slo` (sync latency/error rate, SSE connected ratio).
- Auth endpoints are rate-limited in-memory (configurable via env vars).
- Requests emit `X-Request-Id` and structured server logs for traceability.
- Production hardening applies CSP + security headers (`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`, `X-Content-Type-Options`).
- `GET /api/orgs/:orgId/activity` supports admin filters: `action`, `userId`, `taskId`, `from`, `to`, `limit`.

## Environment variables

- `PORT` (default `4000`)
- `JWT_SECRET`
- `ACCESS_TOKEN_TTL` (default `7d`)
- `REFRESH_TOKEN_TTL_DAYS` (default `30`)
- `VERIFICATION_TOKEN_TTL_HOURS` (default `24`)
- `PASSWORD_RESET_TOKEN_TTL_MINUTES` (default `30`)
- `MFA_LOGIN_TOKEN_TTL_MINUTES` (default `10`)
- `MFA_ISSUER` (default `Taskable`)
- `AUTH_RATE_LIMIT_WINDOW_MS` (default `600000`)
- `AUTH_RATE_LIMIT_MAX_ATTEMPTS` (default `12`)
- `CORS_ORIGIN` (default `http://localhost:5173`; preferred single-origin setting)
- `CLIENT_ORIGIN` (legacy alias for `CORS_ORIGIN`)
- `CORS_ALLOWED_ORIGINS` (comma-separated allow-list; defaults to `CORS_ORIGIN`/`CLIENT_ORIGIN`)
- `BASE_URL` (preferred frontend base URL for auth links)
- `APP_BASE_URL` (legacy alias for `BASE_URL`)
- `EMAIL_PROVIDER` (`disabled | console | test | sendgrid | postmark`)
- `EMAIL_FROM`
- `EMAIL_API_KEY` (generic provider key alias; used when provider-specific key is not set)
- `EMAIL_SANDBOX_MODE` (`true|false`)
- `EMAIL_TEST_LOG_PATH` (optional file path for test provider logs)
- `SENDGRID_API_KEY` (required for `EMAIL_PROVIDER=sendgrid`)
- `POSTMARK_SERVER_TOKEN` (required for `EMAIL_PROVIDER=postmark`)
- `POSTMARK_MESSAGE_STREAM` (default `outbound`)
- `ENABLE_DEV_TOKEN_PREVIEW` (default `false` in prod; dev-only token preview support)
- `EMAIL_REQUIRE_DELIVERY` (default `true` in prod)
- `ALLOW_QUERY_TOKEN_AUTH` (default `false` in prod)
- `SSE_STREAM_TOKEN_TTL_MINUTES` (default `5`)
- `ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN` (default `false`, intended for local fallback only)
- `OPS_RETENTION_DAYS` (default `7`)
- `OPS_ALERT_WINDOW_MINUTES` (default `15`)
- `OPS_ALERT_SYNC_ERROR_RATE_THRESHOLD` (default `0.25`)
- `OPS_ALERT_SSE_DISCONNECT_RATIO_THRESHOLD` (default `0.3`)
- `OPS_ALERT_OUTLOOK_FAIL_COUNT_THRESHOLD` (default `3`)
- `MICROSOFT_SSO_CLIENT_ID` (expected audience for Microsoft SSO token validation)
- `MICROSOFT_SSO_ALLOWED_AUDIENCES` (optional comma-separated audiences; overrides/extends client id)
- `MICROSOFT_SSO_ALLOWED_TENANT_IDS` (optional comma-separated tenant allow-list)
- `MICROSOFT_SSO_ALLOWED_ISSUERS` (optional comma-separated issuer allow-list)
- `MICROSOFT_SSO_DISCOVERY_BASE` (default `https://login.microsoftonline.com`)

## Email deliverability checklist (production)

1. Configure sender domain DNS records:
   - SPF include for your provider.
   - DKIM keys for signing.
   - DMARC policy (`p=none` during warmup, then tighten).
2. Use a real sender identity for `EMAIL_FROM` and verify domain in provider.
3. Enable provider sandbox in staging (`EMAIL_SANDBOX_MODE=true`) to avoid accidental user sends.
4. Turn off dev token preview in production (`ENABLE_DEV_TOKEN_PREVIEW=false`).
5. Set `EMAIL_REQUIRE_DELIVERY=true` in production so auth flows fail safely if delivery is down.
6. Monitor bounce/complaint dashboards and rotate compromised sender keys immediately.
