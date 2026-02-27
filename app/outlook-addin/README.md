# Outlook Add-in Scaffold

This folder contains a minimal Outlook add-in scaffold that captures the selected email into Tareva inbox via:

- `POST /api/orgs/:orgId/inbox-from-email`

## Files

- `outlook-addin/manifest.xml`:
  - Add-in manifest (Message Read command button + taskpane).
- `outlook-addin/taskpane.html`:
  - Lightweight UI for API URL, Office SSO, MSAL fallback config/sign-in, password fallback, and workspace picker.
- `outlook-addin/taskpane.js`:
  - Handles Office SSO token acquisition, MSAL popup fallback acquisition, backend exchange, refresh-token retry, workspace loading, and metadata capture post.

## Local usage

1. Start app UI (`npm run dev`) and backend (`npm run server:dev`).
2. Ensure `taskpane.html` is hosted at:
   - `https://localhost:5173/outlook-addin/taskpane.html`
3. Sideload `outlook-addin/manifest.xml` in Outlook.
4. Open an email, click `Capture to Inbox`, and:
   - enter API URL (default `http://localhost:4000`)
   - click `Office SSO` (preferred)
   - if Office SSO is unavailable, set MSAL fallback fields and click `MSAL Fallback`
   - if needed, use email/password fallback
   - choose workspace from dropdown
   - click `Create Inbox Task`

## Backend requirements for SSO

- Set `MICROSOFT_SSO_CLIENT_ID` (or `MICROSOFT_SSO_ALLOWED_AUDIENCES`) in `server/.env`.
- Optional hardening: set `MICROSOFT_SSO_ALLOWED_TENANT_IDS` and/or `MICROSOFT_SSO_ALLOWED_ISSUERS`.
- Restart backend after env changes.
- For Office SSO: your add-in manifest/app registration must mint Office identity tokens for the configured audience.
- For MSAL fallback: use the same app registration client ID and scope (`api://<client-id>/access_as_user` by default).

## Scope and privacy

- The scaffold captures metadata only (subject/from/time/link fields if available).
- It does not persist email body content.
- Supports Office identity token exchange plus MSAL popup fallback, with password fallback preserved.

## Enterprise rollout hardening

### Least-privilege permissions

- `manifest.xml` currently requests `ReadItem` permission only.
- Keep Graph scope requests metadata-focused:
  - default fallback scope: `api://<client-id>/access_as_user`
  - avoid Mail.ReadWrite unless a future feature truly needs it.
- Validate any new scope against the minimum required endpoint.

### Admin consent flow (tenant)

1. Register/verify Entra app registration for Tareva API audience.
2. Configure redirect URI(s) used by taskpane MSAL popup flow.
3. Grant admin consent for required delegated scopes in tenant.
4. Sideload manifest to pilot users, then deploy centrally.
5. Confirm `MICROSOFT_SSO_ALLOWED_TENANT_IDS` includes the production tenant IDs.

### Host support matrix (recommended smoke test)

- Outlook on the web (OWA): Office SSO path + MSAL fallback.
- Outlook desktop (Windows): Office SSO path + taskpane command surface.
- Outlook desktop (Mac): command/button availability + MSAL fallback behavior.

For each host validate:

- sign in (SSO or fallback)
- workspace picker load
- metadata-only inbox capture success
- auth failure telemetry (`outlook.import.fail`) and success telemetry (`outlook.import.success`)
