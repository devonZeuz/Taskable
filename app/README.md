# Taskable

Taskable is a planner app with web + desktop surfaces and a Node/Express backend in `server/`.

## Local Development

1. Use Node version in `.nvmrc`:
   - `nvm use`
2. Install web/desktop dependencies:
   - `npm ci`
3. Install backend dependencies:
   - `npm --prefix server ci`
4. Create env files:
   - Copy `.env.example` to `.env`
   - Set required values (`JWT_SECRET`, `VITE_API_URL`, etc.)
5. Start backend:
   - `npm run server:dev`
6. Start frontend:
   - `npm run dev`
7. Optional desktop dev shell:
   - `npm run desktop:dev`

Local onboarding test note:

- In local dev on `localhost`, opening `/` defaults to onboarding (`/welcome`) so auth/onboarding flows are easy to retest.
- If you want remembered-mode behavior at `/` during dev, use `/?persistMode=1`.

## Deployment

### Backend (Render example)

1. Create a new Render Web Service from this repo.
2. Root directory: `app/server`.
3. Build command: `npm ci`.
4. Start command: `npm run start`.
5. Set env vars from `.env.example` (server section), especially:
   - `NODE_ENV=production`
   - `JWT_SECRET` (strong, 32+ chars)
   - `CORS_ORIGIN` (frontend URL)
   - `BASE_URL` (frontend URL)
6. Verify `GET /health` returns `200` with `{ "ok": true }`.

### Frontend (Vercel example)

1. Import repo into Vercel.
2. Root directory: `app`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Set frontend env vars:
   - `VITE_API_URL` to backend base URL
   - `VITE_EDITION` (for target edition labeling)
6. Deploy and validate login + task CRUD.

### Desktop Build

- Unpacked desktop build: `npm run desktop:build`
- Installer/distributables: `npm run desktop:dist`

## Environment Variables

See `.env.example` for the full template.

- Server:
  - `NODE_ENV`, `JWT_SECRET`, `BASE_URL`, `CORS_ORIGIN`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`
- Frontend:
  - `VITE_API_URL`, `VITE_EDITION`
- Optional:
  - `MFA_ISSUER`

Notes:

- In production, auth is always required.
- Query-token auth is disabled unless explicitly enabled in non-production via `ALLOW_QUERY_TOKEN_AUTH=true`.

## Health Check

- Endpoint: `GET /health`
- Healthy means:
  - HTTP `200`
  - JSON response body contains `{"ok": true}`
- Use it for load balancer and deploy smoke checks.

## Private Beta Checklist

1. Set production env vars (no placeholder secrets).
2. Confirm CORS only includes trusted frontend origins.
3. Run quality gates locally before tagging:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format:check`
   - `npm run test`
   - `npm run test:e2e`
4. Deploy backend, then frontend, then desktop build if needed.
5. Invite 3-10 testers and monitor errors, sync conflicts, and auth failures.
