import jwt from 'jsonwebtoken';
import { db } from './db.js';
import { getValidatedEnv } from './env.js';

const serverEnv = getValidatedEnv();
const JWT_SECRET = serverEnv.jwtSecret;
const ACCESS_TOKEN_TTL = serverEnv.accessTokenTtl;
const ACCESS_TOKEN_COOKIE_NAME = 'taskable_access_token';
const ALLOW_QUERY_TOKEN_AUTH = serverEnv.allowQueryTokenAuth;

export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'];
const ROLE_RANK = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

function normalizeOrgRole(role) {
  return ORG_ROLES.includes(role) ? role : 'member';
}

function isExpressRequestShape(value) {
  return Boolean(value && typeof value === 'object' && 'headers' in value && 'method' in value);
}

function parseCookieToken(req) {
  const cookieHeader = req.headers.cookie || '';
  if (!cookieHeader) return '';
  const pair = cookieHeader
    .split(';')
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
  if (!pair) return '';
  return decodeURIComponent(pair.slice(`${ACCESS_TOKEN_COOKIE_NAME}=`.length));
}

function resolveAuthToken(req, { allowQueryToken } = {}) {
  const authHeader = req.headers.authorization || '';
  const [, bearerToken] = authHeader.split(' ');
  const queryEnabled =
    typeof allowQueryToken === 'boolean' ? allowQueryToken : ALLOW_QUERY_TOKEN_AUTH;
  const queryToken =
    queryEnabled && typeof req.query?.token === 'string' ? String(req.query.token) : '';
  const cookieToken = parseCookieToken(req);
  return bearerToken || queryToken || cookieToken;
}

function requireAuthHandler(options, req, res, next) {
  const token = resolveAuthToken(req, options);
  if (!token) {
    res.status(401).json({ error: 'Missing bearer token.', code: 'AUTH_TOKEN_MISSING' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload?.type && payload.type !== 'access') {
      res.status(401).json({ error: 'Invalid auth token.', code: 'INVALID_TOKEN_TYPE' });
      return;
    }
    const user = db
      .prepare(
        `SELECT id, email, name, created_at, email_verified_at, mfa_enabled, mfa_enrolled_at
         FROM users
         WHERE id = ?`
      )
      .get(payload.sub);

    if (!user) {
      res.status(401).json({ error: 'Invalid auth token.', code: 'INVALID_AUTH' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid auth token.', code: 'INVALID_AUTH' });
  }
}

export function signAuthToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, type: 'access' }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function requireAuth(optionsOrReq, maybeRes, maybeNext) {
  if (
    isExpressRequestShape(optionsOrReq) &&
    maybeRes &&
    typeof maybeRes.status === 'function' &&
    typeof maybeNext === 'function'
  ) {
    return requireAuthHandler({}, optionsOrReq, maybeRes, maybeNext);
  }

  const options =
    optionsOrReq && typeof optionsOrReq === 'object' && !isExpressRequestShape(optionsOrReq)
      ? optionsOrReq
      : {};

  return (req, res, next) => requireAuthHandler(options, req, res, next);
}

export function requireOrgAccess(req, res, next) {
  const { orgId } = req.params;

  const membership = db
    .prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?')
    .get(orgId, req.user.id);

  if (!membership) {
    res.status(403).json({ error: 'No access to this org.' });
    return;
  }

  req.orgMembership = {
    ...membership,
    role: normalizeOrgRole(membership.role),
  };
  next();
}

export function requireOrgRole(roles) {
  const allowedRoles = roles.map((role) => normalizeOrgRole(role));

  return (req, res, next) => {
    const memberRole = normalizeOrgRole(req.orgMembership?.role);
    const memberRank = ROLE_RANK[memberRole] ?? ROLE_RANK.member;
    const hasAccess = allowedRoles.some((role) => memberRank >= (ROLE_RANK[role] ?? 0));

    if (!hasAccess) {
      res.status(403).json({
        error: 'Insufficient permissions.',
        code: 'INSUFFICIENT_ROLE',
        requiredRoles: allowedRoles,
        role: memberRole,
      });
      return;
    }

    next();
  };
}
