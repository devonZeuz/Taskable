import crypto from 'node:crypto';

const MIN_PROD_JWT_SECRET_LENGTH = 32;
const WEAK_JWT_SECRET_VALUES = new Set([
  'taskable-dev-secret-change-me',
  'changeme',
  'change-me',
  'secret',
  'password',
  'jwt',
  'jwt-secret',
]);

function normalizeEnvValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOptionalBoolean(value) {
  const normalized = normalizeEnvValue(value).toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

export function isWeakJwtSecret(secret) {
  const normalized = normalizeEnvValue(secret);
  if (!normalized) return true;
  if (normalized.length < MIN_PROD_JWT_SECRET_LENGTH) return true;
  if (WEAK_JWT_SECRET_VALUES.has(normalized.toLowerCase())) return true;
  if (/^(.)\1+$/.test(normalized)) return true;
  return false;
}

export function validateServerEnv(env = process.env) {
  const nodeEnv = normalizeEnvValue(env.NODE_ENV) || 'development';
  const isProduction = nodeEnv === 'production';
  const jwtSecretFromEnv = normalizeEnvValue(env.JWT_SECRET);

  if (isProduction && isWeakJwtSecret(jwtSecretFromEnv)) {
    throw new Error(
      'ENV_VALIDATION_ERROR: JWT_SECRET is missing or weak. Set a strong secret (>=32 chars) before starting production.'
    );
  }

  const jwtSecret = jwtSecretFromEnv || crypto.randomBytes(48).toString('hex');
  const accessTokenTtl = normalizeEnvValue(env.ACCESS_TOKEN_TTL) || '7d';
  const allowQueryTokenAuth =
    !isProduction && normalizeEnvValue(env.ALLOW_QUERY_TOKEN_AUTH) === 'true';
  const adminApiOverride = parseOptionalBoolean(env.ENABLE_ADMIN_API);
  if (normalizeEnvValue(env.ENABLE_ADMIN_API) && adminApiOverride === null) {
    throw new Error(
      'ENV_VALIDATION_ERROR: ENABLE_ADMIN_API must be a boolean-like value (true/false, 1/0, on/off).'
    );
  }
  const enableAdminApi = adminApiOverride ?? !isProduction;

  return {
    nodeEnv,
    isProduction,
    jwtSecret,
    accessTokenTtl,
    allowQueryTokenAuth,
    enableAdminApi,
  };
}

let cachedValidatedEnv;

export function getValidatedEnv() {
  if (!cachedValidatedEnv) {
    cachedValidatedEnv = validateServerEnv(process.env);
  }
  return cachedValidatedEnv;
}
