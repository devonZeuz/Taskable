import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import crypto from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  clearExpiredAuthRateLimits,
  consumeAuthRateLimit,
  countVerificationResendsForUser,
  createId,
  db,
  fetchScopedConflictEvents,
  fetchScopedOperationalEvents,
  findUserForScopedAdmin,
  getOwnedOrgIdsForUser,
  listScopedOrgsForAdmin,
  listScopedUsersForAdmin,
  summarizeScopedEmailEvents,
  summarizeScopedOrgs,
  summarizeScopedUsers,
} from './db.js';
import { getValidatedEnv } from './env.js';
import { ORG_ROLES, requireAuth, requireOrgAccess, requireOrgRole, signAuthToken } from './auth.js';
import { getEmailDeliveryConfig, sendPasswordResetEmail, sendVerificationEmail } from './email.js';
import {
  aggregateOperationalSlo,
  evaluateOperationalAlerts,
  isoAtRetentionCutoff,
  isoAtWindowStart,
  sanitizeOperationalMetadata,
} from './opsTelemetry.js';
import { createAuthRateLimiter } from './authRateLimiter.js';

const app = express();
app.disable('etag');
const PORT = Number(process.env.PORT || 4000);
const ACCESS_TOKEN_COOKIE_NAME = 'taskable_access_token';
const REFRESH_TOKEN_COOKIE_NAME = 'taskable_refresh_token';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const VERIFICATION_TOKEN_TTL_HOURS = Number(process.env.VERIFICATION_TOKEN_TTL_HOURS || 24);
const PASSWORD_RESET_TOKEN_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 30);
const MFA_LOGIN_TOKEN_TTL_MINUTES = Number(process.env.MFA_LOGIN_TOKEN_TTL_MINUTES || 10);
const { isProduction, enableAdminApi: ENABLE_ADMIN_API } = getValidatedEnv();
const SSE_STREAM_TOKEN_TTL_MINUTES = Math.max(
  1,
  Number(process.env.SSE_STREAM_TOKEN_TTL_MINUTES || 5)
);
const ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN =
  process.env.ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN === 'true' && !isProduction;
const MFA_ISSUER = (process.env.MFA_ISSUER || 'Tareva').trim() || 'Tareva';
const RATE_LIMIT_WINDOW_MS = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const RATE_LIMIT_MAX_ATTEMPTS = Number(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || 12);
const ENABLE_DEV_TOKEN_PREVIEW = !isProduction && process.env.ENABLE_DEV_TOKEN_PREVIEW === 'true';
const EMAIL_REQUIRE_DELIVERY = process.env.EMAIL_REQUIRE_DELIVERY === 'true' || isProduction;
const defaultCorsOrigin =
  process.env.CORS_ORIGIN || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const configuredCorsOrigins = process.env.CORS_ALLOWED_ORIGINS || defaultCorsOrigin;
const allowedOrigins = Array.from(
  new Set(
    configuredCorsOrigins
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  )
);
const microsoftDiscoveryBase = (
  process.env.MICROSOFT_SSO_DISCOVERY_BASE || 'https://login.microsoftonline.com'
)
  .trim()
  .replace(/\/+$/, '');
const microsoftSsoAudienceFallback = process.env.MICROSOFT_SSO_CLIENT_ID || '';
const microsoftSsoAllowedAudiences = Array.from(
  new Set(
    [process.env.MICROSOFT_SSO_ALLOWED_AUDIENCES, microsoftSsoAudienceFallback]
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean)
  )
);
const microsoftSsoAllowedTenantIds = Array.from(
  new Set(
    String(process.env.MICROSOFT_SSO_ALLOWED_TENANT_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
);
const microsoftSsoAllowedIssuers = Array.from(
  new Set(
    String(process.env.MICROSOFT_SSO_ALLOWED_ISSUERS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  )
);
const MFA_TOTP_PERIOD_SECONDS = 30;
const MFA_TOTP_EPOCH_TOLERANCE_SECONDS = [30, 30];

let microsoftJwksResolver = null;

function isLoopbackOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function toNormalizedOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

function toWebSocketOrigin(origin) {
  try {
    const parsed = new URL(origin);
    parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return parsed.origin;
  } catch {
    return null;
  }
}

const cspConnectSources = Array.from(
  new Set([
    "'self'",
    ...allowedOrigins,
    ...allowedOrigins.map((origin) => toWebSocketOrigin(origin)).filter(Boolean),
  ])
);
const cspScriptSources = ["'self'", ...(!isProduction ? ["'unsafe-eval'"] : [])];

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: cspScriptSources,
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: cspConnectSources,
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    frameguard: {
      action: 'deny',
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), autoplay=()'
  );
  next();
});
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const requestOrigin = toNormalizedOrigin(origin);
      if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
        return;
      }

      // Local dev frontends may auto-shift ports (e.g. 5173 -> 5174).
      if (!isProduction && requestOrigin && isLoopbackOrigin(requestOrigin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use('/api/v1', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

const requestMetrics = {
  total: 0,
  byStatus: new Map(),
  byRoute: new Map(),
  lastRequestAt: null,
};
const OP_METRIC_SAMPLE_LIMIT = 600;
const OPS_RETENTION_DAYS = Math.max(1, Number(process.env.OPS_RETENTION_DAYS || 7));
const OPS_RETENTION_SWEEP_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.OPS_RETENTION_SWEEP_INTERVAL_MS || 5 * 60 * 1000)
);
const OPS_ALERT_WINDOW_MINUTES = Math.max(5, Number(process.env.OPS_ALERT_WINDOW_MINUTES || 15));
const OPS_ALERT_SYNC_ERROR_RATE_THRESHOLD = Number(
  process.env.OPS_ALERT_SYNC_ERROR_RATE_THRESHOLD || 0.25
);
const OPS_ALERT_SSE_DISCONNECT_RATIO_THRESHOLD = Number(
  process.env.OPS_ALERT_SSE_DISCONNECT_RATIO_THRESHOLD || 0.3
);
const OPS_ALERT_OUTLOOK_FAIL_COUNT_THRESHOLD = Math.max(
  1,
  Number(process.env.OPS_ALERT_OUTLOOK_FAIL_COUNT_THRESHOLD || 3)
);
const METRICS_ACCESS_TOKEN = (process.env.METRICS_ACCESS_TOKEN || '').trim();
const APP_THEME_VALUES = ['default', 'sugar-plum', 'vibrant-pop', 'mono', 'white'];
const ADMIN_DEFAULT_PAGE_LIMIT = 50;
const ADMIN_MAX_PAGE_LIMIT = 200;
const ADMIN_RESEND_LIMIT_PER_DAY = 3;
const operationalMetrics = {
  syncSuccessCount: 0,
  syncFailureCount: 0,
  syncLatencyMsSamples: [],
  sseConnectedEvents: 0,
  sseReconnectEvents: 0,
  outlookImportSuccess: 0,
  outlookImportFailure: 0,
  dragResizeLatencyMsSamples: [],
  eventCounts: new Map(),
  lastEventAt: null,
};
let lastOperationalRetentionSweepAt = 0;

function isSyncRoutePattern(routePattern) {
  return (
    routePattern === '/api/v1/orgs/:orgId/tasks' ||
    routePattern === '/api/v1/orgs/:orgId/tasks/:taskId' ||
    routePattern === '/api/v1/orgs/:orgId/import-local'
  );
}

function pushMetricSample(samples, value) {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > OP_METRIC_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - OP_METRIC_SAMPLE_LIMIT);
  }
}

function maybeSweepOperationalEvents() {
  const now = Date.now();
  if (now - lastOperationalRetentionSweepAt < OPS_RETENTION_SWEEP_INTERVAL_MS) return;
  lastOperationalRetentionSweepAt = now;
  db.prepare('DELETE FROM ops_events WHERE created_at < ?').run(
    isoAtRetentionCutoff(OPS_RETENTION_DAYS)
  );
}

function persistOperationalEvent({
  orgId = null,
  userId,
  eventType,
  durationMs = null,
  value = null,
  status = null,
  code = null,
  source = null,
  metadata = null,
}) {
  if (!userId || !eventType) return;
  maybeSweepOperationalEvents();
  db.prepare(
    `INSERT INTO ops_events (
       id, org_id, user_id, event_type, duration_ms, value, status, code, source, metadata_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    createId('ops'),
    orgId,
    userId,
    eventType,
    typeof durationMs === 'number' ? durationMs : null,
    typeof value === 'number' ? value : null,
    Number.isInteger(status) ? status : null,
    typeof code === 'string' ? code.slice(0, 64) : null,
    typeof source === 'string' ? source.slice(0, 32) : null,
    metadata && typeof metadata === 'object' ? JSON.stringify(metadata) : null,
    new Date().toISOString()
  );
}

function fetchOperationalEvents({ orgId = null, sinceIso }) {
  if (orgId) {
    return db
      .prepare(
        `SELECT event_type, duration_ms, value, status, code, source, created_at
         FROM ops_events
         WHERE org_id = ? AND created_at >= ?
         ORDER BY created_at DESC
         LIMIT 8000`
      )
      .all(orgId, sinceIso);
  }
  return db
    .prepare(
      `SELECT event_type, duration_ms, value, status, code, source, created_at
       FROM ops_events
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT 8000`
    )
    .all(sinceIso);
}

function recordOperationalEventMetric(eventType, payload = {}) {
  operationalMetrics.lastEventAt = new Date().toISOString();
  operationalMetrics.eventCounts.set(
    eventType,
    (operationalMetrics.eventCounts.get(eventType) ?? 0) + 1
  );

  if (eventType === 'sync.success') {
    operationalMetrics.syncSuccessCount += 1;
    if (typeof payload.durationMs === 'number') {
      pushMetricSample(operationalMetrics.syncLatencyMsSamples, payload.durationMs);
    }
    return;
  }

  if (eventType === 'sync.fail') {
    operationalMetrics.syncFailureCount += 1;
    return;
  }

  if (eventType === 'sse.connected') {
    operationalMetrics.sseConnectedEvents += 1;
    return;
  }

  if (eventType === 'sse.reconnect') {
    operationalMetrics.sseReconnectEvents += 1;
    return;
  }

  if (eventType === 'outlook.import.success') {
    operationalMetrics.outlookImportSuccess += 1;
    return;
  }

  if (eventType === 'outlook.import.fail') {
    operationalMetrics.outlookImportFailure += 1;
    return;
  }

  if (eventType === 'dnd.drop.performance' || eventType === 'dnd.resize.performance') {
    if (typeof payload.durationMs === 'number') {
      pushMetricSample(operationalMetrics.dragResizeLatencyMsSamples, payload.durationMs);
    }
  }
}

app.use((req, res, next) => {
  const requestId = createId('req');
  const startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    requestMetrics.total += 1;
    requestMetrics.lastRequestAt = new Date().toISOString();
    requestMetrics.byStatus.set(
      res.statusCode,
      (requestMetrics.byStatus.get(res.statusCode) ?? 0) + 1
    );
    const routePattern = req.route?.path ?? req.path;
    const routeKey = `${req.method} ${routePattern}`;
    requestMetrics.byRoute.set(routeKey, (requestMetrics.byRoute.get(routeKey) ?? 0) + 1);

    if (isSyncRoutePattern(routePattern)) {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        recordOperationalEventMetric('sync.success', { durationMs });
      } else {
        recordOperationalEventMetric('sync.fail');
      }
    }

    if (routePattern === '/api/v1/orgs/:orgId/inbox-from-email') {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        recordOperationalEventMetric('outlook.import.success');
      } else {
        recordOperationalEventMetric('outlook.import.fail');
      }
    }

    console.log(
      `[${requestId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
    );
  });

  next();
});

function sendError(res, status, code, message, details) {
  res.status(status).json({
    error: message,
    code,
    details: details ?? undefined,
  });
}

const rateLimitAuth = createAuthRateLimiter({
  consumeAuthRateLimit,
  clearExpiredAuthRateLimits,
  sendError,
  defaultMaxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
  defaultWindowMs: RATE_LIMIT_WINDOW_MS,
});

function isLoopbackIp(value) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function requireMetricsToken(req, res, next) {
  if (!METRICS_ACCESS_TOKEN) {
    if (isLoopbackIp(req.ip || '')) {
      next();
      return;
    }
    sendError(
      res,
      401,
      'METRICS_DISABLED',
      'Metrics access token is not configured for non-loopback requests.'
    );
    return;
  }

  const providedHeader = req.headers['x-metrics-token'];
  const providedQueryToken = req.query?.token;
  const providedRaw = Array.isArray(providedHeader)
    ? providedHeader[0]
    : typeof providedHeader === 'string'
      ? providedHeader
      : Array.isArray(providedQueryToken)
        ? providedQueryToken[0]
        : typeof providedQueryToken === 'string'
          ? providedQueryToken
          : '';
  const provided = (providedRaw || '').trim();
  if (!provided || provided !== METRICS_ACCESS_TOKEN) {
    sendError(res, 401, 'METRICS_UNAUTHORIZED', 'Invalid metrics access token.');
    return;
  }

  next();
}

function ensureMicrosoftJwksResolver() {
  if (microsoftJwksResolver) {
    return microsoftJwksResolver;
  }

  const jwksUrl = `${microsoftDiscoveryBase}/common/discovery/v2.0/keys`;
  microsoftJwksResolver = createRemoteJWKSet(new URL(jwksUrl));
  return microsoftJwksResolver;
}

function buildMicrosoftIssuerCandidates(decodedToken) {
  if (microsoftSsoAllowedIssuers.length > 0) {
    return microsoftSsoAllowedIssuers;
  }

  if (microsoftSsoAllowedTenantIds.length > 0) {
    return microsoftSsoAllowedTenantIds.map(
      (tenantId) => `${microsoftDiscoveryBase}/${tenantId}/v2.0`
    );
  }

  const tokenTenantId = typeof decodedToken?.tid === 'string' ? decodedToken.tid.trim() : '';
  if (tokenTenantId) {
    return [`${microsoftDiscoveryBase}/${tokenTenantId}/v2.0`];
  }

  return [`${microsoftDiscoveryBase}/organizations/v2.0`, `${microsoftDiscoveryBase}/common/v2.0`];
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(';')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const separator = chunk.indexOf('=');
        if (separator === -1) return [chunk, ''];
        const key = chunk.slice(0, separator).trim();
        const value = decodeURIComponent(chunk.slice(separator + 1).trim());
        return [key, value];
      })
  );
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  const secureFlag = isProduction ? '; Secure' : '';
  const sameSite = isProduction ? 'None' : 'Lax';
  const commonCookieFlags = `; Path=/; HttpOnly; SameSite=${sameSite}${secureFlag}`;
  const refreshMaxAgeSeconds = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', [
    `${ACCESS_TOKEN_COOKIE_NAME}=${encodeURIComponent(accessToken)}; Max-Age=${15 * 60}${commonCookieFlags}`,
    `${REFRESH_TOKEN_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; Max-Age=${refreshMaxAgeSeconds}${commonCookieFlags}`,
  ]);
}

function clearAuthCookies(res) {
  const secureFlag = isProduction ? '; Secure' : '';
  const sameSite = isProduction ? 'None' : 'Lax';
  const commonCookieFlags = `; Path=/; HttpOnly; SameSite=${sameSite}${secureFlag}`;
  res.setHeader('Set-Cookie', [
    `${ACCESS_TOKEN_COOKIE_NAME}=; Max-Age=0${commonCookieFlags}`,
    `${REFRESH_TOKEN_COOKIE_NAME}=; Max-Age=0${commonCookieFlags}`,
  ]);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createOpaqueToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function addDuration(baseDate, amount, unit) {
  const next = new Date(baseDate.getTime());
  if (unit === 'days') {
    next.setDate(next.getDate() + amount);
  } else if (unit === 'hours') {
    next.setHours(next.getHours() + amount);
  } else if (unit === 'minutes') {
    next.setMinutes(next.getMinutes() + amount);
  }
  return next;
}

function toSqlDate(date) {
  return date.toISOString();
}

function nowSqlDate() {
  return toSqlDate(new Date());
}

function issueSessionTokens({ user, req, parentSessionId = null }) {
  const accessToken = signAuthToken(user);
  const refreshToken = createOpaqueToken();
  const refreshTokenHash = hashToken(refreshToken);
  const sessionId = createId('sess');
  const expiresAt = toSqlDate(addDuration(new Date(), REFRESH_TOKEN_TTL_DAYS, 'days'));
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 256);
  const ipAddress = String(req.ip || req.headers['x-forwarded-for'] || '').slice(0, 128);

  db.prepare(
    `INSERT INTO user_sessions (
       id, user_id, refresh_token_hash, expires_at, user_agent, ip_address
     ) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, user.id, refreshTokenHash, expiresAt, userAgent, ipAddress);

  if (parentSessionId) {
    db.prepare(
      `UPDATE user_sessions
       SET revoked_at = ?, replaced_by_session_id = ?
       WHERE id = ?`
    ).run(nowSqlDate(), sessionId, parentSessionId);
  }

  return { accessToken, refreshToken, sessionId, expiresAt };
}

function createAuthToken({ userId, tokenType, ttlAmount, ttlUnit }) {
  const rawToken = createOpaqueToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = toSqlDate(addDuration(new Date(), ttlAmount, ttlUnit));

  db.prepare(
    `INSERT INTO auth_tokens (id, user_id, token_type, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(createId('tok'), userId, tokenType, tokenHash, expiresAt);

  return rawToken;
}

function findAuthToken({ token, tokenType }) {
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT id, user_id, token_type, expires_at, used_at
       FROM auth_tokens
       WHERE token_hash = ? AND token_type = ?`
    )
    .get(tokenHash, tokenType);

  if (!row) {
    return { ok: false, reason: 'invalid' };
  }

  if (row.used_at) {
    return { ok: false, reason: 'used' };
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, tokenId: row.id, userId: row.user_id };
}

function markAuthTokenUsed(tokenId) {
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowSqlDate(), tokenId);
}

function consumeAuthToken({ token, tokenType }) {
  const tokenLookup = findAuthToken({ token, tokenType });
  if (!tokenLookup.ok) {
    return tokenLookup;
  }

  markAuthTokenUsed(tokenLookup.tokenId);
  return { ok: true, userId: tokenLookup.userId };
}

function toSseTokenType(orgId, sessionId) {
  return `sse_stream:${orgId}:${sessionId}`;
}

function issueSseStreamToken({ userId, orgId, sessionId }) {
  return createAuthToken({
    userId,
    tokenType: toSseTokenType(orgId, sessionId),
    ttlAmount: SSE_STREAM_TOKEN_TTL_MINUTES,
    ttlUnit: 'minutes',
  });
}

function consumeSseStreamToken({ token, orgId, sessionId }) {
  return consumeAuthToken({
    token,
    tokenType: toSseTokenType(orgId, sessionId),
  });
}

async function queueVerificationEmail({ userId, email, name, token }) {
  try {
    const delivery = await sendVerificationEmail({
      to: email,
      name,
      token,
      metadata: { userId },
    });
    const result = {
      ...delivery,
      failed: false,
      error: null,
    };
    persistOperationalEvent({
      userId,
      eventType: 'email.verification.send',
      status: result.queued ? 202 : 200,
      code: result.skipped ? 'skipped' : 'sent',
      source: 'email',
      metadata: {
        provider: result.provider,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error(`[email] verify delivery failed user=${userId} reason=${message}`);
    const provider = getEmailDeliveryConfig().provider;
    persistOperationalEvent({
      userId,
      eventType: 'email.verification.send',
      status: 503,
      code: 'failed',
      source: 'email',
      metadata: {
        provider,
        error: message.slice(0, 160),
      },
    });
    return {
      queued: false,
      skipped: false,
      provider,
      failed: true,
      error: message,
    };
  }
}

async function queuePasswordResetEmail({ userId, email, name, token }) {
  try {
    const delivery = await sendPasswordResetEmail({
      to: email,
      name,
      token,
      metadata: { userId },
    });
    const result = {
      ...delivery,
      failed: false,
      error: null,
    };
    persistOperationalEvent({
      userId,
      eventType: 'email.reset.send',
      status: result.queued ? 202 : 200,
      code: result.skipped ? 'skipped' : 'sent',
      source: 'email',
      metadata: {
        provider: result.provider,
      },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error(`[email] reset delivery failed user=${userId} reason=${message}`);
    const provider = getEmailDeliveryConfig().provider;
    persistOperationalEvent({
      userId,
      eventType: 'email.reset.send',
      status: 503,
      code: 'failed',
      source: 'email',
      metadata: {
        provider,
        error: message.slice(0, 160),
      },
    });
    return {
      queued: false,
      skipped: false,
      provider,
      failed: true,
      error: message,
    };
  }
}

function normalizeMfaCode(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/\s+/g, '');
}

function verifyMfaCode(secret, rawCode) {
  if (!secret) return false;
  const code = normalizeMfaCode(rawCode);
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const result = verifySync({
      secret,
      token: code,
      period: MFA_TOTP_PERIOD_SECONDS,
      epochTolerance: MFA_TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    return Boolean(result?.valid);
  } catch {
    return false;
  }
}

function createMfaQrDataUrl({ accountEmail, secret }) {
  const otpauthUrl = generateURI({
    issuer: MFA_ISSUER,
    label: accountEmail,
    secret,
    period: MFA_TOTP_PERIOD_SECONDS,
  });
  return QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 }).then((qrDataUrl) => ({
    otpauthUrl,
    qrDataUrl,
  }));
}

const orgStreams = new Map();
const orgPresenceLocks = new Map();
const PRESENCE_DEFAULT_TTL_MS = 15000;
const PRESENCE_MIN_TTL_MS = 5000;
const PRESENCE_MAX_TTL_MS = 45000;
const PRESENCE_SWEEP_INTERVAL_MS = 5000;

function sendSseEvent(stream, event, payload) {
  stream.write(`event: ${event}\n`);
  stream.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function addOrgStream(orgId, stream) {
  const group = orgStreams.get(orgId) ?? new Set();
  group.add(stream);
  orgStreams.set(orgId, group);
}

function removeOrgStream(orgId, stream) {
  const group = orgStreams.get(orgId);
  if (!group) return;
  group.delete(stream);
  if (group.size === 0) {
    orgStreams.delete(orgId);
  }
}

function publishOrgEvent(orgId, event, payload) {
  const group = orgStreams.get(orgId);
  if (!group || group.size === 0) return;

  group.forEach((stream) => {
    try {
      sendSseEvent(stream, event, payload);
    } catch {
      removeOrgStream(orgId, stream);
    }
  });
}

function toPresenceKey(scope, targetId) {
  return `${scope}:${targetId}`;
}

function getOrgPresenceGroup(orgId) {
  const group = orgPresenceLocks.get(orgId) ?? new Map();
  orgPresenceLocks.set(orgId, group);
  return group;
}

function mapPresenceLock(lock) {
  return {
    scope: lock.scope,
    targetId: lock.targetId,
    userId: lock.userId,
    userName: lock.userName,
    sessionId: lock.sessionId,
    expiresAt: lock.expiresAt,
    updatedAt: lock.updatedAt,
  };
}

function pruneExpiredPresence(orgId, now = Date.now()) {
  const group = orgPresenceLocks.get(orgId);
  if (!group || group.size === 0) return false;

  let changed = false;
  group.forEach((lock, key) => {
    if (lock.expiresAt <= now) {
      group.delete(key);
      changed = true;
    }
  });

  if (group.size === 0) {
    orgPresenceLocks.delete(orgId);
  }

  return changed;
}

function listPresenceLocks(orgId) {
  pruneExpiredPresence(orgId);
  const group = orgPresenceLocks.get(orgId);
  if (!group || group.size === 0) return [];
  return Array.from(group.values())
    .map(mapPresenceLock)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

function publishPresenceSnapshot(orgId) {
  publishOrgEvent(orgId, 'presence.changed', {
    locks: listPresenceLocks(orgId),
    ts: Date.now(),
  });
}

function releasePresenceBySession(orgId, userId, sessionId) {
  if (!sessionId) return false;
  const group = orgPresenceLocks.get(orgId);
  if (!group || group.size === 0) return false;

  let changed = false;
  group.forEach((lock, key) => {
    if (lock.userId === userId && lock.sessionId === sessionId) {
      group.delete(key);
      changed = true;
    }
  });

  if (group.size === 0) {
    orgPresenceLocks.delete(orgId);
  }

  return changed;
}

function sweepPresenceLocks() {
  orgPresenceLocks.forEach((_group, orgId) => {
    if (pruneExpiredPresence(orgId)) {
      publishPresenceSnapshot(orgId);
    }
  });
}

const presenceSweepTimer = setInterval(sweepPresenceLocks, PRESENCE_SWEEP_INTERVAL_MS);
if (typeof presenceSweepTimer.unref === 'function') {
  presenceSweepTimer.unref();
}

function parseBooleanHeader(value) {
  if (Array.isArray(value)) {
    return parseBooleanHeader(value[0]);
  }
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function getPresenceSessionIdFromRequest(req) {
  const raw = req.headers['x-taskable-session-id'];
  if (Array.isArray(raw)) return raw[0] ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function getWriteDayKey(startDateTime) {
  if (typeof startDateTime !== 'string' || startDateTime.length < 10) return null;
  const match = startDateTime.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(startDateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function roleCanForceTakeover(role) {
  return role === 'owner' || role === 'admin';
}

function enforcePresenceWriteGate({ req, res, orgId, scope, targetId, eventType, taskId = null }) {
  if (!targetId) return true;
  const now = Date.now();
  pruneExpiredPresence(orgId, now);
  const group = orgPresenceLocks.get(orgId);
  if (!group || group.size === 0) return true;
  const key = toPresenceKey(scope, targetId);
  const existing = group.get(key);
  if (!existing || existing.expiresAt <= now) return true;
  if (existing.userId === req.user.id) return true;

  const role = req.orgMembership?.role ?? null;
  const takeoverAllowed = roleCanForceTakeover(role);
  const forceTakeover = parseBooleanHeader(req.headers['x-taskable-force-takeover']);
  const sessionId = getPresenceSessionIdFromRequest(req);

  if (forceTakeover && takeoverAllowed && sessionId) {
    const nextLock = {
      scope,
      targetId,
      userId: req.user.id,
      userName: req.user.name,
      sessionId,
      expiresAt: now + PRESENCE_DEFAULT_TTL_MS,
      updatedAt: now,
    };
    group.set(key, nextLock);
    const locks = listPresenceLocks(orgId);
    publishOrgEvent(orgId, 'presence.changed', { locks, ts: Date.now() });
    writeAuditEvent({
      orgId,
      taskId,
      actorUserId: req.user.id,
      eventType,
      payload: {
        scope,
        targetId,
        previousOwnerUserId: existing.userId,
        previousOwnerName: existing.userName,
        takenOverByUserId: req.user.id,
        takenOverByName: req.user.name,
      },
    });
    return true;
  }

  res.status(423).json({
    error: 'This item is currently being edited by another teammate.',
    code: 'PRESENCE_LOCKED',
    scope,
    targetId,
    takeoverAllowed,
    lock: mapPresenceLock(existing),
    locks: listPresenceLocks(orgId),
  });
  return false;
}

function mapTaskRow(taskRow) {
  const subtasks = db
    .prepare(
      'SELECT id, title, completed, sort_order FROM subtasks WHERE task_id = ? ORDER BY sort_order ASC'
    )
    .all(taskRow.id)
    .map((subtask) => ({
      id: subtask.id,
      title: subtask.title,
      completed: Boolean(subtask.completed),
    }));

  return {
    id: taskRow.id,
    title: taskRow.title,
    description: taskRow.description || '',
    startDateTime: taskRow.start_date_time || undefined,
    durationMinutes: taskRow.duration_minutes,
    timeZone: taskRow.time_zone || undefined,
    completed: Boolean(taskRow.completed),
    color: taskRow.color,
    subtasks,
    type: taskRow.type,
    assignedTo: taskRow.assigned_to || undefined,
    status: taskRow.status,
    focus: Boolean(taskRow.focus),
    executionStatus: normalizeExecutionStatus(taskRow.execution_status, Boolean(taskRow.completed)),
    actualMinutes: Number(taskRow.actual_minutes) || 0,
    executionVersion: Number(taskRow.execution_version) || 1,
    executionUpdatedAt: taskRow.execution_updated_at || undefined,
    lastStartAt: taskRow.last_start_at || undefined,
    completedAt: taskRow.completed_at || undefined,
    lastEndPromptAt: taskRow.last_end_prompt_at || taskRow.last_prompt_at || undefined,
    lastPromptAt: taskRow.last_prompt_at || taskRow.last_end_prompt_at || undefined,
    version: Number(taskRow.version) || 1,
  };
}

function mapMemberRow(memberRow) {
  return {
    id: memberRow.user_id,
    name: memberRow.name,
    email: memberRow.email,
    role: memberRow.role,
  };
}

function writeAuditEvent({ orgId, taskId = null, actorUserId, eventType, payload }) {
  db.prepare(
    `INSERT INTO task_audit_events (id, org_id, task_id, actor_user_id, event_type, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(createId('audit'), orgId, taskId, actorUserId, eventType, JSON.stringify(payload ?? {}));
}

function parseIfVersion(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeExecutionStatus(value, completed) {
  if (completed) return 'completed';
  if (value === 'running' || value === 'paused' || value === 'idle') {
    return value;
  }
  if (value === 'completed' || value === 'scheduled') {
    return 'idle';
  }
  return 'idle';
}

function sendVersionConflict(res, { orgId, taskRow, actorUserId, clientVersion, operation }) {
  writeAuditEvent({
    orgId,
    taskId: taskRow.id,
    actorUserId,
    eventType: 'task.conflict_detected',
    payload: {
      operation,
      clientVersion: clientVersion ?? null,
      serverVersion: Number(taskRow.version) || 1,
    },
  });

  res.status(409).json({
    error: 'Version conflict. Please refresh and resolve.',
    code: 'VERSION_CONFLICT',
    clientVersion: clientVersion ?? null,
    serverVersion: Number(taskRow.version) || 1,
    serverTask: mapTaskRow(taskRow),
  });
}

function resolveAssignableUserId(orgId, assigneeId) {
  if (!assigneeId) return null;
  const member = db
    .prepare('SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?')
    .get(orgId, assigneeId);
  return member ? assigneeId : null;
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  mfaTicket: z.string().min(16).optional(),
  mfaCode: z
    .string()
    .transform((value) => normalizeMfaCode(value))
    .refine((value) => /^\d{6}$/.test(value), 'MFA code must be a 6-digit number.')
    .optional(),
});
const appThemeUpdateSchema = z.object({
  theme: z.enum(APP_THEME_VALUES),
});
const refreshSchema = z.object({
  refreshToken: z.string().min(16).optional(),
});
const verifyEmailSchema = z.object({
  token: z.string().min(16),
});
const emailOnlySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8),
});
const mfaConfirmSchema = z.object({
  code: z
    .string()
    .transform((value) => normalizeMfaCode(value))
    .refine((value) => /^\d{6}$/.test(value), 'MFA code must be a 6-digit number.'),
});
const mfaDisableSchema = z.object({
  code: z
    .string()
    .transform((value) => normalizeMfaCode(value))
    .refine((value) => /^\d{6}$/.test(value), 'MFA code must be a 6-digit number.'),
});
const microsoftExchangeSchema = z.object({
  accessToken: z.string().min(24),
});
const operationalEventSchema = z.object({
  orgId: z.string().min(1).optional(),
  eventType: z.string().min(1).max(80),
  durationMs: z.number().nonnegative().optional(),
  value: z.number().optional(),
  status: z.number().int().optional(),
  code: z.string().max(64).optional(),
  source: z.string().max(32).optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
const activityQuerySchema = z.object({
  userId: z.string().min(1).max(64).optional(),
  taskId: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const adminScopeQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
});
const adminPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const adminUsersQuerySchema = adminPaginationSchema.extend({
  query: z.string().max(160).optional(),
  orgId: z.string().min(1).optional(),
});
const adminOrgsQuerySchema = adminPaginationSchema.extend({
  orgId: z.string().min(1).optional(),
});
const adminConflictsQuerySchema = adminPaginationSchema.extend({
  status: z.enum(['unresolved', 'all']).optional().default('unresolved'),
  orgId: z.string().min(1).optional(),
});

async function verifyMicrosoftAccessToken(accessToken) {
  if (microsoftSsoAllowedAudiences.length === 0) {
    const error = new Error(
      'Microsoft SSO is not configured. Set MICROSOFT_SSO_CLIENT_ID or MICROSOFT_SSO_ALLOWED_AUDIENCES.'
    );
    error.code = 'SSO_NOT_CONFIGURED';
    throw error;
  }

  const decoded = decodeJwt(accessToken);
  const issuerCandidates = buildMicrosoftIssuerCandidates(decoded);
  const jwks = ensureMicrosoftJwksResolver();
  let lastError = null;

  for (const issuer of issuerCandidates) {
    try {
      const verified = await jwtVerify(accessToken, jwks, {
        issuer,
        audience: microsoftSsoAllowedAudiences,
      });

      const payload = verified.payload;
      const tokenTenantId = typeof payload.tid === 'string' ? payload.tid.trim() : '';
      if (
        microsoftSsoAllowedTenantIds.length > 0 &&
        (!tokenTenantId || !microsoftSsoAllowedTenantIds.includes(tokenTenantId))
      ) {
        const tenantError = new Error('Token tenant is not allowed.');
        tenantError.code = 'TENANT_NOT_ALLOWED';
        throw tenantError;
      }

      const emailClaim = [
        payload.preferred_username,
        payload.email,
        payload.upn,
        payload.unique_name,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);

      if (!emailClaim) {
        const missingEmailError = new Error('Microsoft token is missing an email claim.');
        missingEmailError.code = 'MISSING_EMAIL';
        throw missingEmailError;
      }

      const normalizedEmail = emailClaim.trim().toLowerCase();
      const defaultName = normalizedEmail.split('@')[0] || 'Tareva User';
      const nameClaim =
        typeof payload.name === 'string' && payload.name.trim().length > 0
          ? payload.name.trim()
          : defaultName;

      return {
        email: normalizedEmail,
        name: nameClaim.slice(0, 100),
        tenantId: tokenTenantId || null,
        objectId: typeof payload.oid === 'string' ? payload.oid : null,
        issuer: typeof payload.iss === 'string' ? payload.iss : null,
        audience: payload.aud,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Microsoft token could not be verified.');
}

function mapUserRow(userRow) {
  const appTheme =
    typeof userRow.app_theme === 'string' && APP_THEME_VALUES.includes(userRow.app_theme)
      ? userRow.app_theme
      : null;
  return {
    id: userRow.id,
    email: String(userRow.email || '')
      .trim()
      .toLowerCase(),
    name: userRow.name,
    created_at: userRow.created_at,
    appTheme,
    emailVerified: Boolean(userRow.email_verified_at),
    emailVerifiedAt: userRow.email_verified_at || null,
    mfaEnabled: Boolean(userRow.mfa_enabled),
    mfaEnrolledAt: userRow.mfa_enrolled_at || null,
  };
}

function loadUserById(userId) {
  return db
    .prepare(
      `SELECT id, email, name, app_theme, created_at, email_verified_at, mfa_enabled, mfa_enrolled_at
       FROM users
       WHERE id = ?`
    )
    .get(userId);
}

function mapOrgRows(userId) {
  return db
    .prepare(
      `SELECT o.id, o.name, m.role
       FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       WHERE m.user_id = ?
       ORDER BY o.created_at ASC`
    )
    .all(userId)
    .map((org) => ({
      ...org,
      role: ORG_ROLES.includes(org.role) ? org.role : 'member',
    }));
}

function toIsoOrNull(value) {
  if (!value || typeof value !== 'string') return null;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseOpsMetadata(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return {};
  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function clampPageParams(limit, offset) {
  const safeLimit = Number.isInteger(limit)
    ? Math.max(1, Math.min(ADMIN_MAX_PAGE_LIMIT, limit))
    : ADMIN_DEFAULT_PAGE_LIMIT;
  const safeOffset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
  return {
    limit: safeLimit,
    offset: safeOffset,
  };
}

function requireOwner(req, res, next) {
  const ownedOrgIds = getOwnedOrgIdsForUser(req.user?.id);
  if (!Array.isArray(ownedOrgIds) || ownedOrgIds.length === 0) {
    sendError(res, 403, 'OWNER_ROLE_REQUIRED', 'Owner role required for admin routes.');
    return;
  }
  req.ownedOrgIds = ownedOrgIds;
  next();
}

function requireAdminApiEnabled(_req, res, next) {
  if (!ENABLE_ADMIN_API) {
    sendError(res, 404, 'ADMIN_API_DISABLED', 'Admin API is disabled for this environment.');
    return;
  }
  next();
}

function resolveAdminOrgScope(req, res) {
  const ownedOrgIds = Array.isArray(req.ownedOrgIds) ? req.ownedOrgIds : [];
  if (ownedOrgIds.length === 0) return [];

  const requestedOrgId = typeof req.query?.orgId === 'string' ? req.query.orgId.trim() : '';
  if (!requestedOrgId) return ownedOrgIds;

  if (!ownedOrgIds.includes(requestedOrgId)) {
    sendError(
      res,
      403,
      'ORG_ACCESS_DENIED',
      'Requested org is outside your owner scope for admin routes.'
    );
    return null;
  }

  return [requestedOrgId];
}

function toConflictLookupKey(orgId, taskId) {
  return `${orgId || 'none'}::${taskId || 'unknown'}`;
}

function buildConflictTimeline(events, nowMs = Date.now()) {
  const sortedEvents = [...events]
    .map((event) => ({
      ...event,
      createdIso: toIsoOrNull(event.created_at),
      metadata: parseOpsMetadata(event.metadata_json),
    }))
    .filter((event) => event.createdIso)
    .sort((a, b) => Date.parse(a.createdIso) - Date.parse(b.createdIso));

  const activeByKey = new Map();
  const timeline = [];

  sortedEvents.forEach((event) => {
    const metadata = event.metadata;
    const taskId =
      typeof metadata.taskId === 'string' && metadata.taskId.trim().length > 0
        ? metadata.taskId.trim()
        : null;
    if (!taskId) return;

    const lookupKey = toConflictLookupKey(event.org_id, taskId);
    if (event.event_type === 'conflict_entered') {
      const entry = {
        orgId: event.org_id,
        taskId,
        userId: event.user_id ?? null,
        enteredAt: event.createdIso,
        resolvedAt: null,
        durationMs: Math.max(0, nowMs - Date.parse(event.createdIso)),
        strategy: null,
      };
      timeline.push(entry);
      const queue = activeByKey.get(lookupKey) ?? [];
      queue.push(entry);
      activeByKey.set(lookupKey, queue);
      return;
    }

    if (event.event_type !== 'conflict_resolved') return;

    const queue = activeByKey.get(lookupKey);
    if (!queue || queue.length === 0) return;
    const conflict = queue.shift();
    if (!conflict) return;
    conflict.resolvedAt = event.createdIso;
    conflict.durationMs = Math.max(
      0,
      Date.parse(event.createdIso) - Date.parse(conflict.enteredAt)
    );
    conflict.strategy =
      typeof metadata.strategy === 'string' && metadata.strategy.trim().length > 0
        ? metadata.strategy
        : null;
    if (queue.length === 0) {
      activeByKey.delete(lookupKey);
    } else {
      activeByKey.set(lookupKey, queue);
    }
  });

  return timeline.sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt));
}

function toAdminScopeTaskTitles({ orgIds }) {
  if (!Array.isArray(orgIds) || orgIds.length === 0) return new Map();
  const inClause = orgIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT id, org_id, title
       FROM tasks
       WHERE org_id IN (${inClause})`
    )
    .all(...orgIds);
  return new Map(rows.map((row) => [toConflictLookupKey(row.org_id, row.id), row.title]));
}

function authResponsePayload({ user, defaultOrgId }) {
  return {
    user: mapUserRow(user),
    defaultOrgId,
  };
}

function getRefreshTokenFromRequest(req, fallbackBodyToken) {
  if (fallbackBodyToken) return fallbackBodyToken;
  const cookies = parseCookies(req);
  return cookies[REFRESH_TOKEN_COOKIE_NAME] || null;
}

function listAccountDeletionBlockers(userId) {
  const ownershipRows = db
    .prepare(
      `SELECT
         o.id,
         o.name,
         SUM(CASE WHEN m.role = 'owner' THEN 1 ELSE 0 END) AS owner_count,
         COUNT(*) AS member_count
       FROM orgs o
       JOIN org_members m ON m.org_id = o.id
       WHERE o.id IN (
         SELECT org_id
         FROM org_members
         WHERE user_id = ? AND role = 'owner'
       )
       GROUP BY o.id, o.name`
    )
    .all(userId);

  return ownershipRows
    .filter((row) => Number(row.owner_count || 0) <= 1 && Number(row.member_count || 0) > 1)
    .map((row) => ({
      orgId: row.id,
      orgName: row.name,
      ownerCount: Number(row.owner_count || 0),
      memberCount: Number(row.member_count || 0),
    }));
}

const deleteAccountTransaction = db.transaction((userId) => {
  const transferCandidates = db
    .prepare('SELECT id FROM orgs WHERE created_by = ?')
    .all(userId)
    .map((row) => row.id);

  transferCandidates.forEach((orgId) => {
    const successor = db
      .prepare(
        `SELECT user_id
         FROM org_members
         WHERE org_id = ? AND user_id != ?
         ORDER BY
           CASE role
             WHEN 'owner' THEN 0
             WHEN 'admin' THEN 1
             WHEN 'member' THEN 2
             ELSE 3
           END ASC,
           joined_at ASC
         LIMIT 1`
      )
      .get(orgId, userId);

    if (successor?.user_id) {
      db.prepare('UPDATE orgs SET created_by = ? WHERE id = ?').run(successor.user_id, orgId);
      return;
    }

    db.prepare('DELETE FROM orgs WHERE id = ?').run(orgId);
  });

  const removed = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return removed.changes > 0;
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/metrics/basic', requireMetricsToken, (_req, res) => {
  res.json({
    totalRequests: requestMetrics.total,
    lastRequestAt: requestMetrics.lastRequestAt,
    byStatus: Object.fromEntries(requestMetrics.byStatus.entries()),
    byRoute: Object.fromEntries(requestMetrics.byRoute.entries()),
  });
});

app.get('/metrics/slo', requireMetricsToken, (_req, res) => {
  const sinceIso = isoAtWindowStart(24 * 60);
  const events = fetchOperationalEvents({ sinceIso });
  const aggregate = aggregateOperationalSlo(events);
  res.json({
    generatedAt: new Date().toISOString(),
    windowMinutes: 24 * 60,
    retentionDays: OPS_RETENTION_DAYS,
    ...aggregate,
  });
});

app.post(
  '/api/v1/auth/register',
  rateLimitAuth({ keyPrefix: 'auth-register' }),
  async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid registration payload.', parsed.error.flatten());
      return;
    }

    const { email, password, name } = parsed.data;
    const existing = db
      .prepare('SELECT id FROM users WHERE lower(trim(email)) = lower(trim(?))')
      .get(email);
    if (existing) {
      sendError(res, 409, 'EMAIL_EXISTS', 'Email already exists.');
      return;
    }

    const userId = createId('usr');
    const hash = await bcrypt.hash(password, 10);
    const now = nowSqlDate();

    db.prepare(
      'INSERT INTO users (id, email, password_hash, name, password_updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, email, hash, name, now);

    const orgId = createId('org');
    db.prepare('INSERT INTO orgs (id, name, created_by) VALUES (?, ?, ?)').run(
      orgId,
      `${name}'s Workspace`,
      userId
    );
    db.prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)').run(
      orgId,
      userId,
      'owner'
    );

    const user = loadUserById(userId);
    const verificationToken = createAuthToken({
      userId,
      tokenType: 'email_verify',
      ttlAmount: VERIFICATION_TOKEN_TTL_HOURS,
      ttlUnit: 'hours',
    });
    const verificationDelivery = await queueVerificationEmail({
      userId,
      email,
      name,
      token: verificationToken,
    });
    if (verificationDelivery.failed && EMAIL_REQUIRE_DELIVERY) {
      sendError(
        res,
        503,
        'EMAIL_DELIVERY_FAILED',
        'Unable to send verification email. Please try again.'
      );
      return;
    }
    const tokens = issueSessionTokens({ user, req });
    setAuthCookies(res, tokens);

    res.status(201).json({
      ...authResponsePayload({ user, defaultOrgId: orgId }),
      verification: {
        required: true,
        delivery: {
          queued: verificationDelivery.queued,
          skipped: verificationDelivery.skipped,
          provider: verificationDelivery.provider,
        },
        previewToken: ENABLE_DEV_TOKEN_PREVIEW ? verificationToken : undefined,
      },
    });
  }
);

app.post('/api/v1/auth/login', rateLimitAuth({ keyPrefix: 'auth-login' }), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid login payload.', parsed.error.flatten());
    return;
  }

  const { email, password, mfaTicket, mfaCode } = parsed.data;
  const row = db
    .prepare(
      `SELECT id, email, name, created_at, email_verified_at, password_hash, mfa_enabled, mfa_secret, mfa_enrolled_at
       FROM users
       WHERE lower(trim(email)) = lower(trim(?))`
    )
    .get(email);

  if (!row) {
    sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    return;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    return;
  }

  const mfaEnabled = Boolean(row.mfa_enabled && row.mfa_secret);
  if (mfaEnabled) {
    if (!mfaTicket || !mfaCode) {
      const issuedMfaTicket = createAuthToken({
        userId: row.id,
        tokenType: 'mfa_login',
        ttlAmount: MFA_LOGIN_TOKEN_TTL_MINUTES,
        ttlUnit: 'minutes',
      });

      sendError(res, 401, 'MFA_REQUIRED', 'Multi-factor authentication code required.', {
        mfaRequired: true,
        mfaMethod: 'totp',
        mfaTicket: issuedMfaTicket,
      });
      return;
    }

    const ticketLookup = findAuthToken({ token: mfaTicket, tokenType: 'mfa_login' });
    if (!ticketLookup.ok || ticketLookup.userId !== row.id) {
      sendError(res, 401, 'MFA_TICKET_INVALID', 'MFA ticket is invalid or expired.');
      return;
    }

    const mfaValid = verifyMfaCode(row.mfa_secret, mfaCode);
    if (!mfaValid) {
      sendError(res, 401, 'MFA_CODE_INVALID', 'Invalid MFA code.');
      return;
    }

    markAuthTokenUsed(ticketLookup.tokenId);
  }

  const user = {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    email_verified_at: row.email_verified_at,
    mfa_enabled: row.mfa_enabled,
    mfa_enrolled_at: row.mfa_enrolled_at,
  };
  const tokens = issueSessionTokens({ user, req });
  setAuthCookies(res, tokens);

  res.json({
    ...authResponsePayload({ user }),
    verification: {
      required: !row.email_verified_at,
    },
  });
});

app.post(
  '/api/v1/auth/microsoft/exchange',
  rateLimitAuth({ keyPrefix: 'auth-microsoft-exchange', maxAttempts: 30 }),
  async (req, res) => {
    const parsed = microsoftExchangeSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(
        res,
        400,
        'INVALID_INPUT',
        'Invalid Microsoft exchange payload.',
        parsed.error.flatten()
      );
      return;
    }

    let microsoftIdentity;
    try {
      microsoftIdentity = await verifyMicrosoftAccessToken(parsed.data.accessToken);
    } catch (error) {
      const code =
        typeof error?.code === 'string' && error.code.length > 0
          ? error.code
          : 'MICROSOFT_TOKEN_INVALID';
      const status = code === 'SSO_NOT_CONFIGURED' ? 503 : 401;
      sendError(res, status, code, 'Unable to validate Microsoft identity token.');
      return;
    }

    const now = nowSqlDate();
    let user = db
      .prepare(
        `SELECT id, email, name, created_at, email_verified_at
         FROM users
         WHERE lower(trim(email)) = lower(trim(?))`
      )
      .get(microsoftIdentity.email);
    let defaultOrgId;

    if (!user) {
      const userId = createId('usr');
      const passwordHash = await bcrypt.hash(createOpaqueToken(40), 10);
      db.prepare(
        `INSERT INTO users (
           id, email, password_hash, name, email_verified_at, password_updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(userId, microsoftIdentity.email, passwordHash, microsoftIdentity.name, now, now);

      const orgId = createId('org');
      db.prepare('INSERT INTO orgs (id, name, created_by) VALUES (?, ?, ?)').run(
        orgId,
        `${microsoftIdentity.name}'s Workspace`,
        userId
      );
      db.prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)').run(
        orgId,
        userId,
        'owner'
      );

      user = loadUserById(userId);
      defaultOrgId = orgId;
    } else {
      db.prepare(
        `UPDATE users
         SET email_verified_at = COALESCE(email_verified_at, ?)
         WHERE id = ?`
      ).run(now, user.id);
      user = loadUserById(user.id);
    }

    if (!defaultOrgId) {
      const orgs = mapOrgRows(user.id);
      if (orgs.length === 0) {
        const orgId = createId('org');
        db.prepare('INSERT INTO orgs (id, name, created_by) VALUES (?, ?, ?)').run(
          orgId,
          `${user.name}'s Workspace`,
          user.id
        );
        db.prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)').run(
          orgId,
          user.id,
          'owner'
        );
        defaultOrgId = orgId;
      } else {
        defaultOrgId = orgs[0].id;
      }
    }

    const tokens = issueSessionTokens({ user, req });
    setAuthCookies(res, tokens);

    res.json({
      ...authResponsePayload({ user, defaultOrgId }),
      authentication: {
        provider: 'microsoft',
        tenantId: microsoftIdentity.tenantId,
        objectId: microsoftIdentity.objectId,
        issuer: microsoftIdentity.issuer,
      },
      verification: {
        required: false,
      },
    });
  }
);

app.post(
  '/api/v1/auth/refresh',
  rateLimitAuth({ keyPrefix: 'auth-refresh', maxAttempts: 30 }),
  (req, res) => {
    const parsed = refreshSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid refresh payload.', parsed.error.flatten());
      return;
    }

    const refreshToken = getRefreshTokenFromRequest(req, parsed.data.refreshToken);
    if (!refreshToken) {
      sendError(res, 401, 'REFRESH_TOKEN_MISSING', 'Missing refresh token.');
      return;
    }

    const refreshTokenHash = hashToken(refreshToken);
    const session = db
      .prepare(
        `SELECT
           s.id,
           s.user_id,
           s.expires_at,
           s.revoked_at,
           u.id AS uid,
           u.email,
           u.name,
           u.created_at,
           u.email_verified_at,
           u.mfa_enabled,
           u.mfa_enrolled_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = ?`
      )
      .get(refreshTokenHash);

    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
      sendError(res, 401, 'REFRESH_TOKEN_INVALID', 'Invalid or expired refresh token.');
      return;
    }

    const user = {
      id: session.uid,
      email: session.email,
      name: session.name,
      created_at: session.created_at,
      email_verified_at: session.email_verified_at,
      mfa_enabled: session.mfa_enabled,
      mfa_enrolled_at: session.mfa_enrolled_at,
    };

    const tokens = issueSessionTokens({ user, req, parentSessionId: session.id });
    setAuthCookies(res, tokens);

    res.json({
      ...authResponsePayload({ user }),
      verification: {
        required: !session.email_verified_at,
      },
    });
  }
);

app.post('/api/v1/auth/logout', (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req, req.body?.refreshToken);
  if (refreshToken) {
    const refreshTokenHash = hashToken(refreshToken);
    db.prepare(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE refresh_token_hash = ?`
    ).run(nowSqlDate(), refreshTokenHash);
  }
  clearAuthCookies(res);
  res.status(204).send();
});

app.delete('/api/v1/auth/account', requireAuth, (req, res) => {
  const blockers = listAccountDeletionBlockers(req.user.id);
  if (blockers.length > 0) {
    sendError(
      res,
      409,
      'ACCOUNT_DELETE_BLOCKED',
      'Transfer workspace ownership before deleting this account.',
      {
        blockedOrgs: blockers,
      }
    );
    return;
  }

  const deleted = deleteAccountTransaction(req.user.id);
  clearAuthCookies(res);

  if (!deleted) {
    sendError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account was not found.');
    return;
  }

  res.status(204).send();
});

app.post(
  '/api/v1/auth/resend-verification',
  rateLimitAuth({ keyPrefix: 'auth-resend-verification' }),
  async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid email payload.', parsed.error.flatten());
      return;
    }

    const user = db
      .prepare('SELECT id, email_verified_at FROM users WHERE lower(trim(email)) = lower(trim(?))')
      .get(parsed.data.email);

    if (!user || user.email_verified_at) {
      res.json({ ok: true });
      return;
    }

    const verificationToken = createAuthToken({
      userId: user.id,
      tokenType: 'email_verify',
      ttlAmount: VERIFICATION_TOKEN_TTL_HOURS,
      ttlUnit: 'hours',
    });
    const emailRow = db.prepare('SELECT email, name FROM users WHERE id = ?').get(user.id);
    const verificationDelivery = await queueVerificationEmail({
      userId: user.id,
      email: emailRow?.email ?? parsed.data.email,
      name: emailRow?.name ?? '',
      token: verificationToken,
    });
    if (verificationDelivery.failed && EMAIL_REQUIRE_DELIVERY) {
      sendError(
        res,
        503,
        'EMAIL_DELIVERY_FAILED',
        'Unable to resend verification email. Please try again.'
      );
      return;
    }

    res.json({
      ok: true,
      verification: {
        delivery: {
          queued: verificationDelivery.queued,
          skipped: verificationDelivery.skipped,
          provider: verificationDelivery.provider,
        },
        previewToken: ENABLE_DEV_TOKEN_PREVIEW ? verificationToken : undefined,
      },
    });
  }
);

app.post(
  '/api/v1/auth/verify-email',
  rateLimitAuth({ keyPrefix: 'auth-verify-email', maxAttempts: 20 }),
  (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid verification payload.', parsed.error.flatten());
      return;
    }

    const consumed = consumeAuthToken({ token: parsed.data.token, tokenType: 'email_verify' });
    if (!consumed.ok) {
      sendError(
        res,
        400,
        'VERIFICATION_TOKEN_INVALID',
        'Verification token is invalid or expired.'
      );
      return;
    }

    db.prepare(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, ?)
       WHERE id = ?`
    ).run(nowSqlDate(), consumed.userId);

    res.json({ ok: true });
  }
);

app.post(
  '/api/v1/auth/request-password-reset',
  rateLimitAuth({ keyPrefix: 'auth-request-reset' }),
  async (req, res) => {
    const parsed = emailOnlySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid email payload.', parsed.error.flatten());
      return;
    }

    const user = db
      .prepare('SELECT id FROM users WHERE lower(trim(email)) = lower(trim(?))')
      .get(parsed.data.email);
    if (!user) {
      res.json({ ok: true });
      return;
    }

    const resetToken = createAuthToken({
      userId: user.id,
      tokenType: 'password_reset',
      ttlAmount: PASSWORD_RESET_TOKEN_TTL_MINUTES,
      ttlUnit: 'minutes',
    });
    const userRow = db.prepare('SELECT email, name FROM users WHERE id = ?').get(user.id);
    const resetDelivery = await queuePasswordResetEmail({
      userId: user.id,
      email: userRow?.email ?? parsed.data.email,
      name: userRow?.name ?? '',
      token: resetToken,
    });
    if (resetDelivery.failed && EMAIL_REQUIRE_DELIVERY) {
      sendError(
        res,
        503,
        'EMAIL_DELIVERY_FAILED',
        'Unable to send password reset email. Please try again.'
      );
      return;
    }

    res.json({
      ok: true,
      reset: {
        delivery: {
          queued: resetDelivery.queued,
          skipped: resetDelivery.skipped,
          provider: resetDelivery.provider,
        },
        previewToken: ENABLE_DEV_TOKEN_PREVIEW ? resetToken : undefined,
      },
    });
  }
);

app.post(
  '/api/v1/auth/reset-password',
  rateLimitAuth({ keyPrefix: 'auth-reset-password' }),
  async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid reset payload.', parsed.error.flatten());
      return;
    }

    const consumed = consumeAuthToken({ token: parsed.data.token, tokenType: 'password_reset' });
    if (!consumed.ok) {
      sendError(res, 400, 'RESET_TOKEN_INVALID', 'Reset token is invalid or expired.');
      return;
    }

    const hash = await bcrypt.hash(parsed.data.password, 10);
    const now = nowSqlDate();
    db.prepare(
      `UPDATE users
       SET password_hash = ?, password_updated_at = ?
       WHERE id = ?`
    ).run(hash, now, consumed.userId);
    db.prepare(
      `UPDATE user_sessions
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE user_id = ?`
    ).run(now, consumed.userId);
    clearAuthCookies(res);

    res.json({ ok: true });
  }
);

app.get('/api/v1/auth/sessions', requireAuth, (req, res) => {
  const sessions = db
    .prepare(
      `SELECT id, expires_at, revoked_at, created_at, last_used_at, user_agent, ip_address
       FROM user_sessions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(req.user.id);
  res.json({ sessions });
});

app.post('/api/v1/auth/mfa/enroll/start', requireAuth, async (req, res) => {
  const dbUser = db
    .prepare('SELECT id, email, mfa_enabled FROM users WHERE id = ?')
    .get(req.user.id);
  if (!dbUser) {
    sendError(res, 401, 'INVALID_AUTH', 'Unable to load current user.');
    return;
  }

  const pendingSecret = generateSecret();
  db.prepare(
    `UPDATE users
     SET mfa_pending_secret = ?
     WHERE id = ?`
  ).run(pendingSecret, dbUser.id);

  const setup = await createMfaQrDataUrl({
    accountEmail: dbUser.email,
    secret: pendingSecret,
  });

  res.json({
    mfa: {
      enabled: Boolean(dbUser.mfa_enabled),
      pending: true,
      secret: pendingSecret,
      otpauthUrl: setup.otpauthUrl,
      qrDataUrl: setup.qrDataUrl,
    },
  });
});

app.post('/api/v1/auth/mfa/enroll/confirm', requireAuth, (req, res) => {
  const parsed = mfaConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(
      res,
      400,
      'INVALID_INPUT',
      'Invalid MFA confirmation payload.',
      parsed.error.flatten()
    );
    return;
  }

  const dbUser = db
    .prepare('SELECT id, mfa_pending_secret FROM users WHERE id = ?')
    .get(req.user.id);
  if (!dbUser) {
    sendError(res, 401, 'INVALID_AUTH', 'Unable to load current user.');
    return;
  }

  if (!dbUser.mfa_pending_secret) {
    sendError(res, 400, 'MFA_NOT_PENDING', 'No pending MFA enrollment found.');
    return;
  }

  if (!verifyMfaCode(dbUser.mfa_pending_secret, parsed.data.code)) {
    sendError(res, 401, 'MFA_CODE_INVALID', 'Invalid MFA code.');
    return;
  }

  db.prepare(
    `UPDATE users
     SET mfa_enabled = 1,
         mfa_secret = ?,
         mfa_pending_secret = NULL,
         mfa_enrolled_at = ?
     WHERE id = ?`
  ).run(dbUser.mfa_pending_secret, nowSqlDate(), dbUser.id);

  const nextUser = loadUserById(dbUser.id);
  res.json({
    ok: true,
    user: mapUserRow(nextUser),
  });
});

app.post('/api/v1/auth/mfa/disable', requireAuth, (req, res) => {
  const parsed = mfaDisableSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid MFA disable payload.', parsed.error.flatten());
    return;
  }

  const dbUser = db
    .prepare('SELECT id, mfa_enabled, mfa_secret FROM users WHERE id = ?')
    .get(req.user.id);
  if (!dbUser) {
    sendError(res, 401, 'INVALID_AUTH', 'Unable to load current user.');
    return;
  }

  if (!dbUser.mfa_enabled || !dbUser.mfa_secret) {
    const nextUser = loadUserById(dbUser.id);
    res.json({
      ok: true,
      user: mapUserRow(nextUser),
    });
    return;
  }

  if (!verifyMfaCode(dbUser.mfa_secret, parsed.data.code)) {
    sendError(res, 401, 'MFA_CODE_INVALID', 'Invalid MFA code.');
    return;
  }

  db.prepare(
    `UPDATE users
     SET mfa_enabled = 0,
         mfa_secret = NULL,
         mfa_pending_secret = NULL,
         mfa_enrolled_at = NULL
     WHERE id = ?`
  ).run(dbUser.id);

  const nextUser = loadUserById(dbUser.id);
  res.json({
    ok: true,
    user: mapUserRow(nextUser),
  });
});

app.get('/api/v1/me', requireAuth, (req, res) => {
  const orgs = mapOrgRows(req.user.id);
  res.json({ user: mapUserRow(req.user), orgs });
});

app.patch('/api/v1/me/theme', requireAuth, (req, res) => {
  const parsed = appThemeUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid theme payload.', parsed.error.flatten());
    return;
  }

  db.prepare(
    `UPDATE users
     SET app_theme = ?
     WHERE id = ?`
  ).run(parsed.data.theme, req.user.id);

  const nextUser = loadUserById(req.user.id);
  if (!nextUser) {
    sendError(res, 404, 'USER_NOT_FOUND', 'User account could not be found.');
    return;
  }

  const orgs = mapOrgRows(req.user.id);
  res.json({ user: mapUserRow(nextUser), orgs });
});

app.get('/api/v1/admin/overview', requireAdminApiEnabled, requireAuth, requireOwner, (req, res) => {
  const parsed = adminScopeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid admin overview query.', parsed.error.flatten());
    return;
  }

  const scopedOrgIds = resolveAdminOrgScope(req, res);
  if (scopedOrgIds === null) return;
  const activeSessionAfterIso = nowSqlDate();
  const conflictSinceIso = isoAtWindowStart(7 * 24 * 60);
  const syncSinceIso = isoAtWindowStart(24 * 60);
  const emailSinceIso = isoAtWindowStart(7 * 24 * 60);

  const usersSummary = summarizeScopedUsers({
    orgIds: scopedOrgIds,
    activeSessionAfterIso,
  });
  const orgsSummary = summarizeScopedOrgs({ orgIds: scopedOrgIds });

  const conflictTimelineLast7d = buildConflictTimeline(
    fetchScopedConflictEvents({ orgIds: scopedOrgIds, sinceIso: conflictSinceIso })
  );
  const unresolvedLast7d = conflictTimelineLast7d.filter((entry) => !entry.resolvedAt);
  const topConflictOrgs = new Map();
  conflictTimelineLast7d.forEach((entry) => {
    if (!entry.orgId) return;
    topConflictOrgs.set(entry.orgId, (topConflictOrgs.get(entry.orgId) ?? 0) + 1);
  });
  const scopedOrgs = listScopedOrgsForAdmin({
    orgIds: scopedOrgIds,
    limit: scopedOrgIds.length,
    offset: 0,
    conflictSinceIso,
  }).orgs;
  const orgNameById = new Map(scopedOrgs.map((org) => [org.orgId, org.name]));

  const longestUnresolvedDurationMs = unresolvedLast7d.reduce(
    (longest, conflict) => Math.max(longest, conflict.durationMs ?? 0),
    0
  );

  const syncEvents = fetchScopedOperationalEvents({
    orgIds: scopedOrgIds,
    sinceIso: syncSinceIso,
  });
  const syncSummary = aggregateOperationalSlo(syncEvents);
  const emailSummaryRaw = summarizeScopedEmailEvents({
    orgIds: scopedOrgIds,
    sinceIso: emailSinceIso,
  });
  const emailProvider = getEmailDeliveryConfig().provider;
  const emailSummary = {
    providerMode: emailProvider,
    verification: emailSummaryRaw.verification,
    reset: emailSummaryRaw.reset,
  };

  res.json({
    usersSummary: {
      totalUsers: usersSummary.totalUsers,
      verifiedCount: usersSummary.verifiedCount,
      mfaEnabledCount: usersSummary.mfaEnabledCount,
      activeSessionsCount: usersSummary.activeSessionsCount,
    },
    orgsSummary: {
      totalOrgs: orgsSummary.totalOrgs,
      totalMembers: orgsSummary.totalMembers,
      totalTasks: orgsSummary.totalTasks,
    },
    conflictsSummary: {
      unresolvedCountLast7d: unresolvedLast7d.length,
      longestUnresolvedDurationMs,
      topOrgsByConflicts: Array.from(topConflictOrgs.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([orgId, count]) => ({
          orgId,
          orgName: orgNameById.get(orgId) ?? orgId,
          count,
        })),
    },
    syncSummary,
    emailSummary,
  });
});

app.get('/api/v1/admin/users', requireAdminApiEnabled, requireAuth, requireOwner, (req, res) => {
  const parsed = adminUsersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid admin users query.', parsed.error.flatten());
    return;
  }

  const scopedOrgIds = resolveAdminOrgScope(req, res);
  if (scopedOrgIds === null) return;

  const { limit, offset } = clampPageParams(parsed.data.limit, parsed.data.offset);
  const resendSinceIso = isoAtWindowStart(24 * 60);
  const result = listScopedUsersForAdmin({
    orgIds: scopedOrgIds,
    query: parsed.data.query ?? '',
    limit,
    offset,
    resendSinceIso,
  });

  res.json({
    total: result.total,
    limit,
    offset,
    users: result.users.map((user) => ({
      id: user.id,
      email: user.email,
      createdAt: toIsoOrNull(user.createdAt),
      emailVerifiedAt: toIsoOrNull(user.emailVerifiedAt),
      emailVerified: Boolean(user.emailVerifiedAt),
      mfaEnabled: Boolean(user.mfaEnabled),
      lastLoginAt: toIsoOrNull(user.lastLoginAt),
      orgCount: Number(user.orgCount) || 0,
      resendVerificationCountLast24h: Number(user.resendVerificationCountLast24h) || 0,
    })),
  });
});

app.post(
  '/api/v1/admin/users/:userId/resend-verification',
  requireAdminApiEnabled,
  requireAuth,
  requireOwner,
  async (req, res) => {
    const scopedOrgIds = resolveAdminOrgScope(req, res);
    if (scopedOrgIds === null) return;

    const targetUser = findUserForScopedAdmin({
      userId: req.params.userId,
      orgIds: scopedOrgIds,
    });
    if (!targetUser) {
      sendError(res, 404, 'USER_NOT_FOUND', 'User is outside your admin scope.');
      return;
    }

    const resendWindowStartIso = isoAtWindowStart(24 * 60);
    const resendCount = countVerificationResendsForUser({
      targetUserId: targetUser.id,
      sinceIso: resendWindowStartIso,
    });
    if (resendCount >= ADMIN_RESEND_LIMIT_PER_DAY) {
      persistOperationalEvent({
        orgId: targetUser.scopedOrgId ?? null,
        userId: req.user.id,
        eventType: 'email.verification.resend',
        status: 429,
        code: `target:${targetUser.id}`,
        source: 'admin',
        metadata: {
          reason: 'rate_limited',
        },
      });
      sendError(
        res,
        429,
        'VERIFICATION_RESEND_RATE_LIMITED',
        'Verification resend limit reached for this user (3/day).'
      );
      return;
    }

    if (targetUser.emailVerifiedAt) {
      res.json({
        ok: true,
        alreadyVerified: true,
        userId: targetUser.id,
      });
      return;
    }

    const verificationToken = createAuthToken({
      userId: targetUser.id,
      tokenType: 'email_verify',
      ttlAmount: VERIFICATION_TOKEN_TTL_HOURS,
      ttlUnit: 'hours',
    });
    const verificationDelivery = await queueVerificationEmail({
      userId: targetUser.id,
      email: targetUser.email,
      name: targetUser.name ?? '',
      token: verificationToken,
    });

    persistOperationalEvent({
      orgId: targetUser.scopedOrgId ?? null,
      userId: req.user.id,
      eventType: 'email.verification.resend',
      status: verificationDelivery.failed ? 503 : verificationDelivery.queued ? 202 : 200,
      code: `target:${targetUser.id}`,
      source: 'admin',
      metadata: {
        provider: verificationDelivery.provider,
        queued: verificationDelivery.queued,
        skipped: verificationDelivery.skipped,
        failed: verificationDelivery.failed,
      },
    });

    if (verificationDelivery.provider === 'disabled' || verificationDelivery.skipped) {
      sendError(
        res,
        503,
        'EMAIL_PROVIDER_DISABLED',
        'Email provider is disabled. Enable email delivery before resending verification.'
      );
      return;
    }

    if (verificationDelivery.failed && EMAIL_REQUIRE_DELIVERY) {
      sendError(
        res,
        503,
        'EMAIL_DELIVERY_FAILED',
        'Unable to resend verification email. Please try again.'
      );
      return;
    }

    res.json({
      ok: true,
      userId: targetUser.id,
      delivery: {
        queued: verificationDelivery.queued,
        skipped: verificationDelivery.skipped,
        provider: verificationDelivery.provider,
      },
      previewToken: ENABLE_DEV_TOKEN_PREVIEW ? verificationToken : undefined,
    });
  }
);

app.get('/api/v1/admin/orgs', requireAdminApiEnabled, requireAuth, requireOwner, (req, res) => {
  const parsed = adminOrgsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid admin orgs query.', parsed.error.flatten());
    return;
  }

  const scopedOrgIds = resolveAdminOrgScope(req, res);
  if (scopedOrgIds === null) return;

  const { limit, offset } = clampPageParams(parsed.data.limit, parsed.data.offset);
  const conflictSinceIso = isoAtWindowStart(7 * 24 * 60);
  const result = listScopedOrgsForAdmin({
    orgIds: scopedOrgIds,
    limit,
    offset,
    conflictSinceIso,
  });

  res.json({
    total: result.total,
    limit,
    offset,
    orgs: result.orgs.map((org) => {
      const taskActivityMs = Date.parse(toIsoOrNull(org.lastTaskActivityAt) ?? '');
      const opsActivityMs = Date.parse(toIsoOrNull(org.lastOpsActivityAt) ?? '');
      const lastActivityAt =
        Number.isFinite(taskActivityMs) && Number.isFinite(opsActivityMs)
          ? new Date(Math.max(taskActivityMs, opsActivityMs)).toISOString()
          : Number.isFinite(taskActivityMs)
            ? new Date(taskActivityMs).toISOString()
            : Number.isFinite(opsActivityMs)
              ? new Date(opsActivityMs).toISOString()
              : null;
      return {
        orgId: org.orgId,
        name: org.name,
        createdAt: toIsoOrNull(org.createdAt),
        memberCount: Number(org.memberCount) || 0,
        taskCount: Number(org.taskCount) || 0,
        conflictCountLast7d: Number(org.conflictCountLast7d) || 0,
        lastActivityAt,
      };
    }),
  });
});

app.get(
  '/api/v1/admin/conflicts',
  requireAdminApiEnabled,
  requireAuth,
  requireOwner,
  (req, res) => {
    const parsed = adminConflictsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(
        res,
        400,
        'INVALID_INPUT',
        'Invalid admin conflicts query.',
        parsed.error.flatten()
      );
      return;
    }

    const scopedOrgIds = resolveAdminOrgScope(req, res);
    if (scopedOrgIds === null) return;

    const { limit, offset } = clampPageParams(parsed.data.limit, parsed.data.offset);
    const allConflicts = buildConflictTimeline(fetchScopedConflictEvents({ orgIds: scopedOrgIds }));
    const filteredConflicts =
      parsed.data.status === 'all'
        ? allConflicts
        : allConflicts.filter((entry) => !entry.resolvedAt);
    const taskTitleByKey = toAdminScopeTaskTitles({ orgIds: scopedOrgIds });

    res.json({
      total: filteredConflicts.length,
      limit,
      offset,
      conflicts: filteredConflicts.slice(offset, offset + limit).map((conflict) => ({
        orgId: conflict.orgId,
        taskId: conflict.taskId,
        userId: conflict.userId,
        enteredAt: conflict.enteredAt,
        resolvedAt: conflict.resolvedAt,
        durationMs: conflict.durationMs ?? 0,
        strategy: conflict.strategy,
        title: taskTitleByKey.get(toConflictLookupKey(conflict.orgId, conflict.taskId)) ?? null,
      })),
    });
  }
);

app.get(
  '/api/v1/admin/sync-health',
  requireAdminApiEnabled,
  requireAuth,
  requireOwner,
  (req, res) => {
    const parsed = adminScopeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(
        res,
        400,
        'INVALID_INPUT',
        'Invalid admin sync-health query.',
        parsed.error.flatten()
      );
      return;
    }

    const scopedOrgIds = resolveAdminOrgScope(req, res);
    if (scopedOrgIds === null) return;

    const events24h = fetchScopedOperationalEvents({
      orgIds: scopedOrgIds,
      sinceIso: isoAtWindowStart(24 * 60),
    });
    const events7d = fetchScopedOperationalEvents({
      orgIds: scopedOrgIds,
      sinceIso: isoAtWindowStart(7 * 24 * 60),
    });
    const alertWindowEvents = fetchScopedOperationalEvents({
      orgIds: scopedOrgIds,
      sinceIso: isoAtWindowStart(OPS_ALERT_WINDOW_MINUTES),
    });
    const slo = aggregateOperationalSlo(events24h);
    const alerts = evaluateOperationalAlerts(alertWindowEvents, {
      windowMinutes: OPS_ALERT_WINDOW_MINUTES,
      thresholds: {
        syncErrorRate: OPS_ALERT_SYNC_ERROR_RATE_THRESHOLD,
        sseDisconnectRatio: OPS_ALERT_SSE_DISCONNECT_RATIO_THRESHOLD,
        outlookImportFailures: OPS_ALERT_OUTLOOK_FAIL_COUNT_THRESHOLD,
      },
    });

    res.json({
      generatedAt: new Date().toISOString(),
      syncErrors: {
        last24h: events24h.filter((event) => event.event_type === 'sync.fail').length,
        last7d: events7d.filter((event) => event.event_type === 'sync.fail').length,
      },
      sseConnectedRatio: slo.realtime.sseConnectedRatio,
      slo,
      alerts,
      windowMinutes: OPS_ALERT_WINDOW_MINUTES,
    });
  }
);

app.get(
  '/api/v1/admin/email-health',
  requireAdminApiEnabled,
  requireAuth,
  requireOwner,
  (req, res) => {
    const parsed = adminScopeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(
        res,
        400,
        'INVALID_INPUT',
        'Invalid admin email-health query.',
        parsed.error.flatten()
      );
      return;
    }

    const scopedOrgIds = resolveAdminOrgScope(req, res);
    if (scopedOrgIds === null) return;

    const providerConfig = getEmailDeliveryConfig();
    const windowDays = 7;
    const summary = summarizeScopedEmailEvents({
      orgIds: scopedOrgIds,
      sinceIso: isoAtWindowStart(windowDays * 24 * 60),
    });
    const attemptedTotal = summary.verification.attempted + summary.reset.attempted;

    let availability = 'available';
    let explanation = null;
    if (providerConfig.provider === 'disabled') {
      availability = 'disabled';
      explanation = 'Email provider disabled by configuration.';
    } else if (attemptedTotal === 0) {
      availability = 'unknown';
      explanation = 'No email delivery events were recorded in the selected window.';
    }

    res.json({
      generatedAt: new Date().toISOString(),
      providerMode: providerConfig.provider,
      availability,
      explanation,
      windowDays,
      verification: summary.verification,
      reset: summary.reset,
    });
  }
);

app.post('/api/v1/ops/events', requireAuth, (req, res) => {
  const parsed = operationalEventSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid telemetry payload.', parsed.error.flatten());
    return;
  }

  const payload = parsed.data;
  if (payload.orgId) {
    const membership = db
      .prepare('SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?')
      .get(payload.orgId, req.user.id);
    if (!membership) {
      sendError(res, 403, 'ORG_ACCESS_DENIED', 'You do not have access to this workspace.');
      return;
    }
  }

  const metadata = sanitizeOperationalMetadata(payload.metadata);
  recordOperationalEventMetric(payload.eventType, {
    durationMs: payload.durationMs,
  });
  persistOperationalEvent({
    orgId: payload.orgId ?? null,
    userId: req.user.id,
    eventType: payload.eventType,
    durationMs: payload.durationMs,
    value: payload.value,
    status: payload.status,
    code: payload.code,
    source: payload.source,
    metadata,
  });

  res.status(202).json({
    accepted: true,
    eventType: payload.eventType,
    metadata: metadata ?? undefined,
  });
});

app.get('/api/v1/ops/alerts', requireAuth, (req, res) => {
  const querySchema = z.object({
    orgId: z.string().min(1).optional(),
    windowMinutes: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .optional(),
  });
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid alert query.', parsed.error.flatten());
    return;
  }

  const orgId = parsed.data.orgId ?? null;
  if (orgId) {
    const membership = db
      .prepare('SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?')
      .get(orgId, req.user.id);
    if (!membership) {
      sendError(res, 403, 'ORG_ACCESS_DENIED', 'You do not have access to this workspace.');
      return;
    }
  }

  const windowMinutes = parsed.data.windowMinutes ?? OPS_ALERT_WINDOW_MINUTES;
  const events = fetchOperationalEvents({
    orgId,
    sinceIso: isoAtWindowStart(windowMinutes),
  });
  const alerts = evaluateOperationalAlerts(events, {
    windowMinutes,
    thresholds: {
      syncErrorRate: OPS_ALERT_SYNC_ERROR_RATE_THRESHOLD,
      sseDisconnectRatio: OPS_ALERT_SSE_DISCONNECT_RATIO_THRESHOLD,
      outlookImportFailures: OPS_ALERT_OUTLOOK_FAIL_COUNT_THRESHOLD,
    },
  });

  if (alerts.length > 0) {
    console.warn(
      `[ops-alert] ${alerts.map((alert) => alert.code).join(', ')} org=${orgId ?? 'all'} window=${windowMinutes}m`
    );
  }

  res.json({
    generatedAt: new Date().toISOString(),
    orgId,
    windowMinutes,
    alerts,
  });
});

app.get('/api/v1/orgs', requireAuth, (req, res) => {
  const orgs = mapOrgRows(req.user.id);
  res.json({ orgs });
});

app.post('/api/v1/orgs', requireAuth, (req, res) => {
  const schema = z.object({ name: z.string().min(1).max(120) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const orgId = createId('org');
  db.prepare('INSERT INTO orgs (id, name, created_by) VALUES (?, ?, ?)').run(
    orgId,
    parsed.data.name,
    req.user.id
  );
  db.prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)').run(
    orgId,
    req.user.id,
    'owner'
  );

  res.status(201).json({ org: { id: orgId, name: parsed.data.name, role: 'owner' } });
});

const streamTokenRequestSchema = z.object({
  sessionId: z.string().min(6).max(120),
});

function requireSseStreamAuth(req, res, next) {
  const streamToken = typeof req.query?.streamToken === 'string' ? req.query.streamToken : '';
  const streamSessionId = typeof req.query?.sessionId === 'string' ? req.query.sessionId : '';

  if (streamToken && streamSessionId) {
    const consumed = consumeSseStreamToken({
      token: streamToken,
      orgId: req.params.orgId,
      sessionId: streamSessionId,
    });
    if (!consumed.ok) {
      sendError(res, 401, 'SSE_TOKEN_INVALID', 'SSE stream token is invalid or expired.');
      return;
    }

    const user = loadUserById(consumed.userId);
    if (!user) {
      sendError(res, 401, 'INVALID_AUTH', 'Unable to load stream user.');
      return;
    }

    req.user = user;
    req.streamSessionId = streamSessionId;
    next();
    return;
  }

  if (ALLOW_LEGACY_SSE_QUERY_ACCESS_TOKEN) {
    const legacyAuth = requireAuth({ allowQueryToken: true });
    legacyAuth(req, res, () => {
      req.streamSessionId = streamSessionId;
      next();
    });
    return;
  }

  const cookieOrHeaderAuth = requireAuth({ allowQueryToken: false });
  cookieOrHeaderAuth(req, res, () => {
    req.streamSessionId = streamSessionId;
    next();
  });
}

app.post('/api/v1/orgs/:orgId/stream-token', requireAuth, requireOrgAccess, (req, res) => {
  const parsed = streamTokenRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid stream token payload.', parsed.error.flatten());
    return;
  }

  const streamToken = issueSseStreamToken({
    userId: req.user.id,
    orgId: req.params.orgId,
    sessionId: parsed.data.sessionId,
  });
  const expiresInSeconds = SSE_STREAM_TOKEN_TTL_MINUTES * 60;
  res.json({
    streamToken,
    expiresInSeconds,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
  });
});

app.get('/api/v1/orgs/:orgId/stream', requireSseStreamAuth, requireOrgAccess, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const stream = res;
  const orgId = req.params.orgId;
  const streamSessionId = typeof req.streamSessionId === 'string' ? req.streamSessionId : '';
  addOrgStream(orgId, stream);

  sendSseEvent(stream, 'connected', {
    orgId,
    userId: req.user.id,
    locks: listPresenceLocks(orgId),
    ts: Date.now(),
  });

  const keepAlive = setInterval(() => {
    sendSseEvent(stream, 'ping', { ts: Date.now() });
  }, 20_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    removeOrgStream(orgId, stream);
    if (releasePresenceBySession(orgId, req.user.id, streamSessionId)) {
      publishPresenceSnapshot(orgId);
    }
  });
});

const presenceClaimSchema = z.object({
  scope: z.enum(['task', 'day']),
  targetId: z.string().min(1).max(120),
  sessionId: z.string().min(6).max(120),
  ttlMs: z.number().int().min(PRESENCE_MIN_TTL_MS).max(PRESENCE_MAX_TTL_MS).optional(),
  forceTakeover: z.boolean().optional().default(false),
});

const presenceReleaseSchema = z.object({
  scope: z.enum(['task', 'day']),
  targetId: z.string().min(1).max(120),
  sessionId: z.string().min(6).max(120),
});

const presenceReleaseAllSchema = z.object({
  sessionId: z.string().min(6).max(120),
});

app.get('/api/v1/orgs/:orgId/presence', requireAuth, requireOrgAccess, (req, res) => {
  res.json({ locks: listPresenceLocks(req.params.orgId) });
});

app.post(
  '/api/v1/orgs/:orgId/presence/claim',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = presenceClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const orgId = req.params.orgId;
    const now = Date.now();
    pruneExpiredPresence(orgId, now);
    const group = getOrgPresenceGroup(orgId);
    const key = toPresenceKey(parsed.data.scope, parsed.data.targetId);
    const existing = group.get(key);
    const takeoverAllowed = roleCanForceTakeover(req.orgMembership?.role);
    const canForceTakeover =
      parsed.data.forceTakeover && takeoverAllowed && Boolean(parsed.data.sessionId);

    if (
      existing &&
      existing.expiresAt > now &&
      (existing.userId !== req.user.id || existing.sessionId !== parsed.data.sessionId)
    ) {
      if (canForceTakeover) {
        const nextLock = {
          scope: parsed.data.scope,
          targetId: parsed.data.targetId,
          userId: req.user.id,
          userName: req.user.name,
          sessionId: parsed.data.sessionId,
          expiresAt: now + (parsed.data.ttlMs ?? PRESENCE_DEFAULT_TTL_MS),
          updatedAt: now,
        };
        group.set(key, nextLock);
        const locks = listPresenceLocks(orgId);
        writeAuditEvent({
          orgId,
          taskId: parsed.data.scope === 'task' ? parsed.data.targetId : null,
          actorUserId: req.user.id,
          eventType: 'presence.lock_taken_over',
          payload: {
            scope: parsed.data.scope,
            targetId: parsed.data.targetId,
            previousOwnerUserId: existing.userId,
            previousOwnerName: existing.userName,
            takenOverByUserId: req.user.id,
            takenOverByName: req.user.name,
            source: 'presence.claim',
          },
        });
        publishOrgEvent(orgId, 'presence.changed', { locks, ts: Date.now() });
        res.json({ lock: mapPresenceLock(nextLock), locks, takenOver: true });
        return;
      }

      res.status(409).json({
        error: 'This item is currently being edited by another teammate.',
        code: 'PRESENCE_LOCKED',
        takeoverAllowed,
        lock: mapPresenceLock(existing),
        locks: listPresenceLocks(orgId),
      });
      return;
    }

    const nextLock = {
      scope: parsed.data.scope,
      targetId: parsed.data.targetId,
      userId: req.user.id,
      userName: req.user.name,
      sessionId: parsed.data.sessionId,
      expiresAt: now + (parsed.data.ttlMs ?? PRESENCE_DEFAULT_TTL_MS),
      updatedAt: now,
    };

    const shouldPublish =
      !existing ||
      existing.userId !== nextLock.userId ||
      existing.sessionId !== nextLock.sessionId ||
      existing.scope !== nextLock.scope ||
      existing.targetId !== nextLock.targetId;

    group.set(key, nextLock);
    const locks = listPresenceLocks(orgId);
    if (shouldPublish) {
      publishOrgEvent(orgId, 'presence.changed', { locks, ts: Date.now() });
    }

    res.json({ lock: mapPresenceLock(nextLock), locks });
  }
);

app.post(
  '/api/v1/orgs/:orgId/presence/release',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = presenceReleaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const orgId = req.params.orgId;
    const key = toPresenceKey(parsed.data.scope, parsed.data.targetId);
    const group = orgPresenceLocks.get(orgId);
    let released = false;

    if (group) {
      const existing = group.get(key);
      if (
        existing &&
        existing.userId === req.user.id &&
        existing.sessionId === parsed.data.sessionId
      ) {
        group.delete(key);
        released = true;
        if (group.size === 0) {
          orgPresenceLocks.delete(orgId);
        }
      }
    }

    const locks = listPresenceLocks(orgId);
    if (released) {
      publishOrgEvent(orgId, 'presence.changed', { locks, ts: Date.now() });
    }

    res.json({ released, locks });
  }
);

app.post(
  '/api/v1/orgs/:orgId/presence/release-all',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = presenceReleaseAllSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const orgId = req.params.orgId;
    const released = releasePresenceBySession(orgId, req.user.id, parsed.data.sessionId);
    const locks = listPresenceLocks(orgId);
    if (released) {
      publishOrgEvent(orgId, 'presence.changed', { locks, ts: Date.now() });
    }

    res.json({ released, locks });
  }
);

app.get('/api/v1/orgs/:orgId/members', requireAuth, requireOrgAccess, (req, res) => {
  const members = db
    .prepare(
      `SELECT m.user_id, m.role, u.name, u.email
       FROM org_members m
       JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ?
       ORDER BY u.name COLLATE NOCASE ASC`
    )
    .all(req.params.orgId)
    .map(mapMemberRow);

  res.json({ members });
});

app.post(
  '/api/v1/orgs/:orgId/members',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin']),
  (req, res) => {
    const schema = z.object({
      email: z
        .string()
        .email()
        .transform((value) => value.trim().toLowerCase()),
      role: z.enum(ORG_ROLES).optional().default('member'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    if (
      req.orgMembership.role !== 'owner' &&
      (parsed.data.role === 'owner' || parsed.data.role === 'admin')
    ) {
      sendError(res, 403, 'INSUFFICIENT_ROLE', 'Only owners can add admins or additional owners.');
      return;
    }

    const targetUser = db
      .prepare('SELECT id, email, name FROM users WHERE lower(trim(email)) = lower(trim(?))')
      .get(parsed.data.email);

    if (!targetUser) {
      res.status(404).json({ error: 'User not found. Ask them to create an account first.' });
      return;
    }

    const existingMembership = db
      .prepare('SELECT user_id FROM org_members WHERE org_id = ? AND user_id = ?')
      .get(req.params.orgId, targetUser.id);

    if (existingMembership) {
      res.status(409).json({ error: 'User is already in this org.' });
      return;
    }

    db.prepare('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)').run(
      req.params.orgId,
      targetUser.id,
      parsed.data.role
    );

    writeAuditEvent({
      orgId: req.params.orgId,
      actorUserId: req.user.id,
      eventType: 'org.member_added',
      payload: { userId: targetUser.id, role: parsed.data.role },
    });

    publishOrgEvent(req.params.orgId, 'member.changed', {
      type: 'added',
      userId: targetUser.id,
      role: parsed.data.role,
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.status(201).json({
      member: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: parsed.data.role,
      },
    });
  }
);

app.patch(
  '/api/v1/orgs/:orgId/members/:userId',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin']),
  (req, res) => {
    const schema = z.object({
      role: z.enum(ORG_ROLES),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid role payload.', parsed.error.flatten());
      return;
    }

    const targetMembership = db
      .prepare(
        `SELECT m.user_id, m.role, u.name
         FROM org_members m
         JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ? AND m.user_id = ?`
      )
      .get(req.params.orgId, req.params.userId);

    if (!targetMembership) {
      sendError(res, 404, 'MEMBER_NOT_FOUND', 'Member not found in org.');
      return;
    }

    if (req.orgMembership.role !== 'owner') {
      if (targetMembership.role === 'owner' || targetMembership.role === 'admin') {
        sendError(
          res,
          403,
          'INSUFFICIENT_ROLE',
          'Admins cannot change owner or admin memberships.'
        );
        return;
      }
      if (parsed.data.role === 'owner' || parsed.data.role === 'admin') {
        sendError(res, 403, 'INSUFFICIENT_ROLE', 'Admins cannot promote to admin or owner.');
        return;
      }
    }

    if (targetMembership.role === 'owner' && parsed.data.role !== 'owner') {
      const ownerCount = db
        .prepare(`SELECT COUNT(*) AS count FROM org_members WHERE org_id = ? AND role = 'owner'`)
        .get(req.params.orgId);
      if ((ownerCount?.count ?? 0) <= 1) {
        sendError(res, 400, 'LAST_OWNER', 'Workspace must keep at least one owner.');
        return;
      }
    }

    db.prepare('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?').run(
      parsed.data.role,
      req.params.orgId,
      req.params.userId
    );

    writeAuditEvent({
      orgId: req.params.orgId,
      actorUserId: req.user.id,
      eventType: 'org.member_role_updated',
      payload: {
        userId: req.params.userId,
        fromRole: targetMembership.role,
        toRole: parsed.data.role,
      },
    });

    publishOrgEvent(req.params.orgId, 'member.changed', {
      type: 'role_updated',
      userId: req.params.userId,
      role: parsed.data.role,
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.json({
      member: {
        id: req.params.userId,
        name: targetMembership.name,
        role: parsed.data.role,
      },
    });
  }
);

app.delete(
  '/api/v1/orgs/:orgId/members/:userId',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin']),
  (req, res) => {
    if (req.params.userId === req.user.id) {
      sendError(res, 400, 'SELF_REMOVE_BLOCKED', 'You cannot remove yourself from this workspace.');
      return;
    }

    const existingMembership = db
      .prepare('SELECT user_id, role FROM org_members WHERE org_id = ? AND user_id = ?')
      .get(req.params.orgId, req.params.userId);

    if (!existingMembership) {
      res.status(404).json({ error: 'Member not found in org.' });
      return;
    }

    if (
      req.orgMembership.role !== 'owner' &&
      (existingMembership.role === 'owner' || existingMembership.role === 'admin')
    ) {
      sendError(res, 403, 'INSUFFICIENT_ROLE', 'Admins cannot remove owners or other admins.');
      return;
    }

    if (existingMembership.role === 'owner') {
      const ownerCount = db
        .prepare(`SELECT COUNT(*) AS count FROM org_members WHERE org_id = ? AND role = 'owner'`)
        .get(req.params.orgId);
      if ((ownerCount?.count ?? 0) <= 1) {
        sendError(res, 400, 'LAST_OWNER', 'Workspace must keep at least one owner.');
        return;
      }
    }

    db.prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?').run(
      req.params.orgId,
      req.params.userId
    );

    writeAuditEvent({
      orgId: req.params.orgId,
      actorUserId: req.user.id,
      eventType: 'org.member_removed',
      payload: { userId: req.params.userId },
    });

    publishOrgEvent(req.params.orgId, 'member.changed', {
      type: 'removed',
      userId: req.params.userId,
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.status(204).send();
  }
);

const subtaskInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  completed: z.boolean().default(false),
});

const taskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  startDateTime: z.string().datetime().optional(),
  durationMinutes: z.number().int().positive(),
  timeZone: z.string().optional(),
  completed: z.boolean().default(false),
  color: z.string().min(1),
  subtasks: z.array(subtaskInputSchema).default([]),
  type: z.enum(['quick', 'large', 'block']),
  assignedTo: z.string().optional(),
  status: z.enum(['scheduled', 'inbox']).default('scheduled'),
  focus: z.boolean().default(false),
  executionStatus: z.enum(['idle', 'scheduled', 'running', 'paused', 'completed']).default('idle'),
  actualMinutes: z.number().nonnegative().default(0),
  executionVersion: z.number().int().positive().optional(),
  executionUpdatedAt: z.string().datetime().optional(),
  lastStartAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  lastEndPromptAt: z.string().datetime().optional(),
  lastPromptAt: z.string().datetime().optional(),
});

const taskCreateSchema = taskInputSchema.extend({
  id: z.string().optional(),
});

const conflictResolutionSchema = z.object({
  strategy: z.enum(['keep_mine', 'keep_theirs', 'merge']),
  fields: z.array(z.string().min(1).max(64)).max(32).optional(),
});

const taskUpdateSchema = taskInputSchema.partial().extend({
  ifVersion: z.number().int().positive().optional(),
  conflictResolution: conflictResolutionSchema.optional(),
});
const taskEndPromptAckSchema = z.object({
  scheduledEndAt: z.string().datetime(),
  ifVersion: z.number().int().positive().optional(),
});
const taskListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional().default(2000),
  since: z.string().datetime().optional(),
});

app.get('/api/v1/orgs/:orgId/tasks', requireAuth, requireOrgAccess, (req, res) => {
  const parsed = taskListQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid task list query.', parsed.error.flatten());
    return;
  }

  const { limit, since } = parsed.data;
  const sinceSql = since ? toSqlDate(new Date(since)) : null;
  const args = [req.params.orgId];
  let query = 'SELECT * FROM tasks WHERE org_id = ?';

  if (sinceSql) {
    query += ' AND datetime(updated_at) >= datetime(?)';
    args.push(sinceSql);
  }

  query += ' ORDER BY datetime(updated_at) DESC, id DESC LIMIT ?';
  args.push(limit);

  const rows = db.prepare(query).all(...args);
  const tasks = rows.map(mapTaskRow);
  const deletedTaskIds = sinceSql
    ? db
        .prepare(
          `SELECT DISTINCT json_extract(payload_json, '$.taskId') AS task_id
           FROM task_audit_events
           WHERE org_id = ?
             AND event_type = 'task.deleted'
             AND datetime(created_at) >= datetime(?)
           ORDER BY datetime(created_at) DESC
           LIMIT ?`
        )
        .all(req.params.orgId, sinceSql, limit)
        .map((row) => (typeof row.task_id === 'string' ? row.task_id : null))
        .filter(Boolean)
    : [];

  const nextSince =
    rows.length > 0 ? (toIsoOrNull(rows[0].updated_at) ?? new Date().toISOString()) : null;

  res.json({
    tasks,
    limit,
    since: since ?? null,
    hasMore: rows.length === limit,
    nextSince,
    deletedTaskIds,
    serverTime: new Date().toISOString(),
  });
});

app.post(
  '/api/v1/orgs/:orgId/tasks',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = taskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const taskId = parsed.data.id || createId('tsk');
    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
      .get(taskId, req.params.orgId);
    if (existing) {
      res.status(409).json({
        error: 'Task id already exists in this org.',
        code: 'TASK_ALREADY_EXISTS',
        serverTask: mapTaskRow(existing),
      });
      return;
    }

    const task = parsed.data;
    const scheduleStatus = task.status ?? (task.startDateTime ? 'scheduled' : 'inbox');
    const dayKey =
      scheduleStatus === 'scheduled' ? getWriteDayKey(task.startDateTime ?? null) : null;
    if (
      dayKey &&
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'day',
        targetId: dayKey,
        eventType: 'presence.lock_taken_over',
      })
    ) {
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO tasks (
         id, org_id, title, description, start_date_time, duration_minutes, time_zone,
         completed, color, type, assigned_to, status, focus, execution_status,
         actual_minutes, last_start_at, completed_at, last_end_prompt_at, last_prompt_at,
         execution_version, execution_updated_at, version, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        taskId,
        req.params.orgId,
        task.title,
        task.description,
        task.startDateTime || null,
        task.durationMinutes,
        task.timeZone || null,
        task.completed ? 1 : 0,
        task.color,
        task.type,
        resolveAssignableUserId(req.params.orgId, task.assignedTo),
        task.status,
        task.focus ? 1 : 0,
        normalizeExecutionStatus(task.executionStatus, Boolean(task.completed)),
        task.actualMinutes,
        task.lastStartAt || null,
        task.completedAt || null,
        task.lastEndPromptAt || task.lastPromptAt || null,
        task.lastPromptAt || null,
        typeof task.executionVersion === 'number' && task.executionVersion > 0
          ? Math.floor(task.executionVersion)
          : 1,
        task.executionUpdatedAt || nowSqlDate(),
        1,
        req.user.id
      );

      const subtaskStatement = db.prepare(
        'INSERT INTO subtasks (id, task_id, title, completed, sort_order) VALUES (?, ?, ?, ?, ?)'
      );

      task.subtasks.forEach((subtask, index) => {
        subtaskStatement.run(
          subtask.id || createId('sub'),
          taskId,
          subtask.title,
          subtask.completed ? 1 : 0,
          index
        );
      });
    });

    tx();

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId,
      actorUserId: req.user.id,
      eventType: 'task.created',
      payload: { title: task.title },
    });

    const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

    publishOrgEvent(req.params.orgId, 'task.changed', {
      type: 'created',
      task: mapTaskRow(created),
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.status(201).json({ task: mapTaskRow(created) });
  }
);

app.put(
  '/api/v1/orgs/:orgId/tasks/:taskId',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = taskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
      .get(req.params.taskId, req.params.orgId);

    if (!existing) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'task',
        targetId: req.params.taskId,
        eventType: 'presence.lock_taken_over',
        taskId: req.params.taskId,
      })
    ) {
      return;
    }

    const { ifVersion: rawIfVersion, conflictResolution, ...updates } = parsed.data;
    const ifVersion = parseIfVersion(rawIfVersion);
    const serverVersion = Number(existing.version) || 1;

    if (ifVersion !== undefined && ifVersion !== serverVersion) {
      sendVersionConflict(res, {
        orgId: req.params.orgId,
        taskRow: existing,
        actorUserId: req.user.id,
        clientVersion: ifVersion,
        operation: 'update',
      });
      return;
    }

    const nextTask = {
      title: updates.title ?? existing.title,
      description: updates.description ?? existing.description,
      startDateTime: updates.startDateTime ?? existing.start_date_time,
      durationMinutes: updates.durationMinutes ?? existing.duration_minutes,
      timeZone: updates.timeZone ?? existing.time_zone,
      completed: updates.completed ?? Boolean(existing.completed),
      color: updates.color ?? existing.color,
      type: updates.type ?? existing.type,
      assignedTo: updates.assignedTo ?? existing.assigned_to ?? undefined,
      status: updates.status ?? existing.status,
      focus: updates.focus ?? Boolean(existing.focus),
      executionStatus: normalizeExecutionStatus(
        updates.executionStatus ?? existing.execution_status,
        updates.completed ?? Boolean(existing.completed)
      ),
      actualMinutes:
        typeof updates.actualMinutes === 'number'
          ? updates.actualMinutes
          : Number(existing.actual_minutes) || 0,
      lastStartAt: updates.lastStartAt ?? existing.last_start_at,
      completedAt: updates.completedAt ?? existing.completed_at,
      lastEndPromptAt:
        updates.lastEndPromptAt ?? updates.lastPromptAt ?? existing.last_end_prompt_at,
      lastPromptAt: updates.lastPromptAt ?? updates.lastEndPromptAt ?? existing.last_prompt_at,
      subtasks: updates.subtasks,
    };
    const executionFieldsTouched =
      updates.executionStatus !== undefined ||
      updates.actualMinutes !== undefined ||
      updates.lastStartAt !== undefined ||
      updates.completedAt !== undefined ||
      updates.lastEndPromptAt !== undefined ||
      updates.lastPromptAt !== undefined ||
      updates.completed !== undefined;
    const nextExecutionVersion = executionFieldsTouched
      ? Math.max(1, (Number(existing.execution_version) || 1) + 1)
      : Math.max(1, Number(existing.execution_version) || 1);
    const nextExecutionUpdatedAt = executionFieldsTouched
      ? nowSqlDate()
      : existing.execution_updated_at || nowSqlDate();
    const existingDayKey =
      existing.status === 'scheduled' ? getWriteDayKey(existing.start_date_time ?? null) : null;
    const nextDayKey =
      nextTask.status === 'scheduled' ? getWriteDayKey(nextTask.startDateTime ?? null) : null;
    if (
      existingDayKey &&
      existingDayKey !== nextDayKey &&
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'day',
        targetId: existingDayKey,
        eventType: 'presence.lock_taken_over',
        taskId: req.params.taskId,
      })
    ) {
      return;
    }
    if (
      nextDayKey &&
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'day',
        targetId: nextDayKey,
        eventType: 'presence.lock_taken_over',
        taskId: req.params.taskId,
      })
    ) {
      return;
    }

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE tasks
       SET title = ?, description = ?, start_date_time = ?, duration_minutes = ?,
           time_zone = ?, completed = ?, color = ?, type = ?, assigned_to = ?, status = ?,
           focus = ?, execution_status = ?, actual_minutes = ?, last_start_at = ?,
           completed_at = ?, last_end_prompt_at = ?, last_prompt_at = ?,
           execution_version = ?, execution_updated_at = ?,
           version = version + 1, updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`
      ).run(
        nextTask.title,
        nextTask.description,
        nextTask.startDateTime || null,
        nextTask.durationMinutes,
        nextTask.timeZone || null,
        nextTask.completed ? 1 : 0,
        nextTask.color,
        nextTask.type,
        resolveAssignableUserId(req.params.orgId, nextTask.assignedTo),
        nextTask.status,
        nextTask.focus ? 1 : 0,
        nextTask.executionStatus,
        Math.max(0, nextTask.actualMinutes),
        nextTask.lastStartAt || null,
        nextTask.completedAt || null,
        nextTask.lastEndPromptAt || null,
        nextTask.lastPromptAt || null,
        nextExecutionVersion,
        nextExecutionUpdatedAt,
        req.params.taskId,
        req.params.orgId
      );

      if (Array.isArray(nextTask.subtasks)) {
        db.prepare('DELETE FROM subtasks WHERE task_id = ?').run(req.params.taskId);
        const insertSubtask = db.prepare(
          'INSERT INTO subtasks (id, task_id, title, completed, sort_order) VALUES (?, ?, ?, ?, ?)'
        );
        nextTask.subtasks.forEach((subtask, index) => {
          insertSubtask.run(
            subtask.id || createId('sub'),
            req.params.taskId,
            subtask.title,
            subtask.completed ? 1 : 0,
            index
          );
        });
      }
    });

    tx();

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      eventType: 'task.updated',
      payload: { ...updates, ifVersion: ifVersion ?? null },
    });

    if (conflictResolution) {
      writeAuditEvent({
        orgId: req.params.orgId,
        taskId: req.params.taskId,
        actorUserId: req.user.id,
        eventType: 'task.conflict_resolved',
        payload: {
          ...conflictResolution,
          via: 'task.update',
          ifVersion: ifVersion ?? null,
        },
      });
    }

    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);

    publishOrgEvent(req.params.orgId, 'task.changed', {
      type: 'updated',
      task: mapTaskRow(updated),
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.json({ task: mapTaskRow(updated) });
  }
);

app.post(
  '/api/v1/orgs/:orgId/tasks/:taskId/end-prompt',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = taskEndPromptAckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
      .get(req.params.taskId, req.params.orgId);
    if (!existing) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    const ifVersion = parseIfVersion(parsed.data.ifVersion);
    const serverVersion = Number(existing.version) || 1;
    if (ifVersion !== undefined && ifVersion !== serverVersion) {
      sendVersionConflict(res, {
        orgId: req.params.orgId,
        taskRow: existing,
        actorUserId: req.user.id,
        clientVersion: ifVersion,
        operation: 'end-prompt-ack',
      });
      return;
    }

    const executionStatus = normalizeExecutionStatus(
      existing.execution_status,
      Boolean(existing.completed)
    );
    if (executionStatus !== 'running') {
      res.json({
        accepted: false,
        reason: 'not_running',
        task: mapTaskRow(existing),
      });
      return;
    }

    const scheduledEndMs = Date.parse(parsed.data.scheduledEndAt);
    if (!Number.isFinite(scheduledEndMs)) {
      sendError(res, 400, 'INVALID_INPUT', 'Invalid scheduled end timestamp.');
      return;
    }

    const existingPromptMs = existing.last_end_prompt_at
      ? Date.parse(existing.last_end_prompt_at)
      : Number.NaN;
    if (Number.isFinite(existingPromptMs) && existingPromptMs >= scheduledEndMs) {
      res.json({
        accepted: false,
        reason: 'already_acknowledged',
        task: mapTaskRow(existing),
      });
      return;
    }

    db.prepare(
      `UPDATE tasks
       SET last_end_prompt_at = ?,
           last_prompt_at = ?,
           execution_version = execution_version + 1,
           execution_updated_at = ?,
           version = version + 1,
           updated_at = datetime('now')
       WHERE id = ? AND org_id = ?`
    ).run(
      parsed.data.scheduledEndAt,
      parsed.data.scheduledEndAt,
      nowSqlDate(),
      req.params.taskId,
      req.params.orgId
    );

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      eventType: 'task.end_prompt_acknowledged',
      payload: {
        scheduledEndAt: parsed.data.scheduledEndAt,
        ifVersion: ifVersion ?? null,
      },
    });

    const updated = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
      .get(req.params.taskId, req.params.orgId);

    publishOrgEvent(req.params.orgId, 'task.changed', {
      type: 'updated',
      task: mapTaskRow(updated),
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.json({
      accepted: true,
      task: mapTaskRow(updated),
    });
  }
);

app.delete(
  '/api/v1/orgs/:orgId/tasks/:taskId',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin']),
  (req, res) => {
    const ifVersion = parseIfVersion(req.query?.ifVersion);
    const existing = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?')
      .get(req.params.taskId, req.params.orgId);

    if (!existing) {
      res.status(404).json({ error: 'Task not found.' });
      return;
    }

    if (
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'task',
        targetId: req.params.taskId,
        eventType: 'presence.lock_taken_over',
        taskId: req.params.taskId,
      })
    ) {
      return;
    }
    const existingDayKey =
      existing.status === 'scheduled' ? getWriteDayKey(existing.start_date_time ?? null) : null;
    if (
      existingDayKey &&
      !enforcePresenceWriteGate({
        req,
        res,
        orgId: req.params.orgId,
        scope: 'day',
        targetId: existingDayKey,
        eventType: 'presence.lock_taken_over',
        taskId: req.params.taskId,
      })
    ) {
      return;
    }

    const serverVersion = Number(existing.version) || 1;
    if (ifVersion !== undefined && ifVersion !== serverVersion) {
      sendVersionConflict(res, {
        orgId: req.params.orgId,
        taskRow: existing,
        actorUserId: req.user.id,
        clientVersion: ifVersion,
        operation: 'delete',
      });
      return;
    }

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      eventType: 'task.deleted',
      payload: { ifVersion: ifVersion ?? null, taskId: req.params.taskId },
    });

    db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?').run(
      req.params.taskId,
      req.params.orgId
    );

    publishOrgEvent(req.params.orgId, 'task.changed', {
      type: 'deleted',
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.status(204).send();
  }
);

const conflictResolutionLogSchema = z.object({
  strategy: z.enum(['keep_mine', 'keep_theirs', 'merge']),
  clientVersion: z.number().int().positive().nullable().optional(),
  serverVersion: z.number().int().positive().nullable().optional(),
  fields: z.array(z.string().min(1).max(64)).max(32).optional(),
});

app.post(
  '/api/v1/orgs/:orgId/tasks/:taskId/conflict-resolution',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const parsed = conflictResolutionLogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      eventType: 'task.conflict_resolved',
      payload: parsed.data,
    });

    publishOrgEvent(req.params.orgId, 'task.conflict.resolved', {
      taskId: req.params.taskId,
      actorUserId: req.user.id,
      strategy: parsed.data.strategy,
      ts: Date.now(),
    });

    res.status(201).json({ logged: true });
  }
);

app.get('/api/v1/orgs/:orgId/activity', requireAuth, requireOrgAccess, (req, res) => {
  const parsed = activityQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendError(res, 400, 'INVALID_INPUT', 'Invalid activity query.', parsed.error.flatten());
    return;
  }

  const filters = parsed.data;
  const clauses = ['e.org_id = ?'];
  const params = [req.params.orgId];

  if (filters.userId) {
    clauses.push('e.actor_user_id = ?');
    params.push(filters.userId);
  }
  if (filters.taskId) {
    clauses.push('e.task_id = ?');
    params.push(filters.taskId);
  }
  if (filters.action) {
    clauses.push('e.event_type LIKE ?');
    params.push(`${filters.action}%`);
  }
  if (filters.from) {
    clauses.push('datetime(e.created_at) >= datetime(?)');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('datetime(e.created_at) <= datetime(?)');
    params.push(filters.to);
  }

  const limit = filters.limit ?? 200;
  const sql = `
    SELECT
      e.id,
      e.task_id,
      e.actor_user_id,
      e.event_type,
      e.payload_json,
      e.created_at,
      u.name AS actor_name,
      u.email AS actor_email
    FROM task_audit_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY e.created_at DESC
    LIMIT ?
  `;
  const events = db
    .prepare(sql)
    .all(...params, limit)
    .map((event) => ({
      ...event,
      created_at:
        typeof event.created_at === 'string' && !event.created_at.includes('T')
          ? `${event.created_at.replace(' ', 'T')}Z`
          : event.created_at,
      payload: event.payload_json ? JSON.parse(event.payload_json) : {},
    }));

  res.json({ events });
});

app.post(
  '/api/v1/orgs/:orgId/import-local',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const schema = z.object({
      tasks: z.array(
        taskInputSchema.extend({
          id: z.string().optional(),
          version: z.number().int().positive().optional(),
        })
      ),
      replaceAll: z.boolean().optional().default(true),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const runImport = db.transaction(() => {
      let count = 0;
      const replaceAll = parsed.data.replaceAll;
      const providedTaskIds = parsed.data.tasks
        .map((task) => task.id)
        .filter((taskId) => typeof taskId === 'string' && taskId.length > 0);

      if (replaceAll) {
        if (providedTaskIds.length === 0) {
          db.prepare('DELETE FROM tasks WHERE org_id = ?').run(req.params.orgId);
        } else {
          const placeholders = providedTaskIds.map(() => '?').join(', ');
          db.prepare(`DELETE FROM tasks WHERE org_id = ? AND id NOT IN (${placeholders})`).run(
            req.params.orgId,
            ...providedTaskIds
          );
        }
      }

      const insertTask = db.prepare(
        `INSERT OR REPLACE INTO tasks (
         id, org_id, title, description, start_date_time, duration_minutes, time_zone,
         completed, color, type, assigned_to, status, focus, execution_status,
         actual_minutes, last_start_at, completed_at, last_end_prompt_at, last_prompt_at,
         execution_version, execution_updated_at, version, created_by, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      );

      const deleteSubtasks = db.prepare('DELETE FROM subtasks WHERE task_id = ?');
      const insertSubtask = db.prepare(
        'INSERT INTO subtasks (id, task_id, title, completed, sort_order) VALUES (?, ?, ?, ?, ?)'
      );

      parsed.data.tasks.forEach((task) => {
        const taskId = task.id || createId('tsk');
        const existingTask = db
          .prepare('SELECT version FROM tasks WHERE id = ? AND org_id = ?')
          .get(taskId, req.params.orgId);
        const version = task.version ?? (existingTask ? Number(existingTask.version) + 1 : 1);
        insertTask.run(
          taskId,
          req.params.orgId,
          task.title,
          task.description,
          task.startDateTime || null,
          task.durationMinutes,
          task.timeZone || null,
          task.completed ? 1 : 0,
          task.color,
          task.type,
          resolveAssignableUserId(req.params.orgId, task.assignedTo),
          task.status,
          task.focus ? 1 : 0,
          normalizeExecutionStatus(task.executionStatus, Boolean(task.completed)),
          task.actualMinutes,
          task.lastStartAt || null,
          task.completedAt || null,
          task.lastEndPromptAt || task.lastPromptAt || null,
          task.lastPromptAt || null,
          typeof task.executionVersion === 'number' && task.executionVersion > 0
            ? Math.floor(task.executionVersion)
            : 1,
          task.executionUpdatedAt || nowSqlDate(),
          version,
          req.user.id
        );

        deleteSubtasks.run(taskId);
        task.subtasks.forEach((subtask, index) => {
          insertSubtask.run(
            subtask.id || createId('sub'),
            taskId,
            subtask.title,
            subtask.completed ? 1 : 0,
            index
          );
        });

        writeAuditEvent({
          orgId: req.params.orgId,
          taskId,
          actorUserId: req.user.id,
          eventType: 'task.imported',
          payload: { title: task.title },
        });

        count += 1;
      });

      return count;
    });

    const importedCount = runImport();

    publishOrgEvent(req.params.orgId, 'tasks.synced', {
      actorUserId: req.user.id,
      importedCount,
      ts: Date.now(),
    });

    res.status(201).json({ importedCount });
  }
);

app.post(
  '/api/v1/orgs/:orgId/inbox-from-email',
  requireAuth,
  requireOrgAccess,
  requireOrgRole(['owner', 'admin', 'member']),
  (req, res) => {
    const schema = z.object({
      subject: z.string().min(1),
      from: z.string().optional().default(''),
      receivedAt: z.string().optional(),
      webLink: z.string().url().optional(),
      source: z.string().optional().default('outlook'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { subject, from, receivedAt, webLink, source } = parsed.data;
    const taskId = createId('tsk');
    const descriptionParts = [
      from ? `From: ${from}` : '',
      receivedAt ? `Received: ${receivedAt}` : '',
      webLink ? `Link: ${webLink}` : '',
      `Source: ${source}`,
    ].filter(Boolean);

    db.prepare(
      `INSERT INTO tasks (
       id, org_id, title, description, start_date_time, duration_minutes, time_zone,
       completed, color, type, assigned_to, status, focus, execution_status,
       actual_minutes, last_start_at, completed_at, last_end_prompt_at, last_prompt_at,
       execution_version, execution_updated_at, version, created_by
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      req.params.orgId,
      subject,
      descriptionParts.join('\n'),
      null,
      60,
      null,
      0,
      '#ddb1c8',
      'quick',
      req.user.id,
      'inbox',
      0,
      'idle',
      0,
      null,
      null,
      null,
      null,
      1,
      nowSqlDate(),
      1,
      req.user.id
    );

    writeAuditEvent({
      orgId: req.params.orgId,
      taskId,
      actorUserId: req.user.id,
      eventType: 'task.created_from_email',
      payload: { source, hasLink: Boolean(webLink) },
    });

    const created = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

    publishOrgEvent(req.params.orgId, 'task.changed', {
      type: 'created',
      task: mapTaskRow(created),
      actorUserId: req.user.id,
      ts: Date.now(),
    });

    res.status(201).json({ task: mapTaskRow(created) });
  }
);

app.listen(PORT, () => {
  console.log(`Tareva server listening on http://localhost:${PORT}`);
});
