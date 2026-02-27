# Tareva Email Deliverability Runbook

Last updated: 2026-02-24

## Scope

Operational runbook for verification and password-reset email delivery in production.

## Preconditions

1. `EMAIL_PROVIDER` is set to `sendgrid` or `postmark`.
2. `EMAIL_FROM` uses a verified sender/domain.
3. `EMAIL_REQUIRE_DELIVERY=true` in production.
4. SPF, DKIM, and DMARC records are configured for the sender domain.

## DNS baseline

1. Publish SPF include for the selected provider.
2. Publish DKIM keys from provider onboarding.
3. Start DMARC with `p=none` during warmup, then progress to `quarantine`/`reject`.

## Deployment checklist

1. Validate env:
   - `EMAIL_PROVIDER`
   - `EMAIL_FROM`
   - provider secret (`SENDGRID_API_KEY` or `POSTMARK_SERVER_TOKEN`)
2. Send smoke emails in staging with sandbox/test mode.
3. Confirm production links resolve against `BASE_URL`.
4. Confirm auth APIs fail safely when provider is unavailable (`EMAIL_REQUIRE_DELIVERY=true`).

## Monitoring

1. Use owner admin dashboard:
   - `/admin` -> Email Health
   - watch attempted/sent/failed counts over 24h and 7d.
2. Track provider console for:
   - hard bounces
   - spam complaints
   - suppression-list growth

## Incident response

1. If provider outage or auth delivery failures spike:
   - switch to backup provider profile if available.
   - keep `EMAIL_REQUIRE_DELIVERY=true` to avoid silent auth lockouts.
2. If sender domain compromised:
   - rotate API keys immediately.
   - rotate sender identity and re-verify domain.
   - invalidate affected sessions if account takeover is suspected.
3. If bounce/complaint rate rises:
   - pause bulk resend actions.
   - inspect recipient quality and suppression behavior.

## Evidence for release readiness

1. Screenshot/admin export of Email Health panel after smoke run.
2. Provider delivery logs for verification + reset sends.
3. DNS record captures for SPF/DKIM/DMARC.
