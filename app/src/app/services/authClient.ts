import { cloudRequest, CloudRequestError, type CloudUser } from './cloudApi';

export interface CloudAuthSession {
  defaultOrgId: string | null;
  user: CloudUser | null;
  verificationRequired: boolean;
}

interface CloudAuthPayload {
  defaultOrgId?: string;
  user?: CloudUser;
  verification?: {
    required?: boolean;
  };
}

function toCloudAuthSession(payload: CloudAuthPayload): CloudAuthSession {
  return {
    defaultOrgId: payload.defaultOrgId ?? null,
    user: payload.user ?? null,
    verificationRequired: Boolean(payload.verification?.required),
  };
}

export async function loginWithPassword(params: {
  email: string;
  password: string;
  mfaTicket?: string;
  mfaCode?: string;
}) {
  const payload = await cloudRequest<CloudAuthPayload>('/api/v1/auth/login', {
    method: 'POST',
    body: {
      email: params.email,
      password: params.password,
      ...(params.mfaTicket ? { mfaTicket: params.mfaTicket } : {}),
      ...(params.mfaCode ? { mfaCode: params.mfaCode } : {}),
    },
  });
  return toCloudAuthSession(payload);
}

export async function registerWithPassword(params: {
  name: string;
  email: string;
  password: string;
}) {
  const payload = await cloudRequest<CloudAuthPayload>('/api/v1/auth/register', {
    method: 'POST',
    body: {
      name: params.name,
      email: params.email,
      password: params.password,
    },
  });
  return toCloudAuthSession(payload);
}

export async function verifyEmailToken(token: string) {
  await cloudRequest('/api/v1/auth/verify-email', {
    method: 'POST',
    body: { token },
  });
}

export async function requestPasswordReset(email: string) {
  await cloudRequest('/api/v1/auth/request-password-reset', {
    method: 'POST',
    body: { email },
  });
}

export async function resetPassword(token: string, password: string) {
  await cloudRequest('/api/v1/auth/reset-password', {
    method: 'POST',
    body: { token, password },
  });
}

export function parseMfaChallenge(error: unknown): { ticket: string } | null {
  if (!(error instanceof CloudRequestError) || error.status !== 401) return null;
  if (!error.payload || typeof error.payload !== 'object') return null;
  const payload = error.payload as {
    code?: string;
    details?: { mfaRequired?: boolean; mfaTicket?: string };
  };
  if (
    payload.code !== 'MFA_REQUIRED' ||
    !payload.details?.mfaRequired ||
    !payload.details.mfaTicket
  ) {
    return null;
  }
  return { ticket: payload.details.mfaTicket };
}

export function isCloudUnreachableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof CloudRequestError) {
    return error.status >= 500;
  }
  return false;
}

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof CloudRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
