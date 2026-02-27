import { cloudRequest } from './cloudApi';

interface AdminBaseParams {
  orgId?: string;
}

interface AdminPaginationParams extends AdminBaseParams {
  limit?: number;
  offset?: number;
}

export interface AdminOverviewResponse {
  usersSummary: {
    totalUsers: number;
    verifiedCount: number;
    mfaEnabledCount: number;
    activeSessionsCount: number;
  };
  orgsSummary: {
    totalOrgs: number;
    totalMembers: number;
    totalTasks: number;
  };
  conflictsSummary: {
    unresolvedCountLast7d: number;
    longestUnresolvedDurationMs: number;
    topOrgsByConflicts: Array<{
      orgId: string;
      orgName: string;
      count: number;
    }>;
  };
  syncSummary: {
    sync: {
      total: number;
      success: number;
      failures: number;
      errorRate: number;
      latencyMs: {
        count: number;
        average: number | null;
        p50: number | null;
        p95: number | null;
      };
    };
    realtime: {
      sseConnectedEvents: number;
      sseReconnectEvents: number;
      sseConnectedRatio: number;
    };
    imports: {
      outlookSuccess: number;
      outlookFailure: number;
    };
  };
  emailSummary: {
    providerMode: string;
    verification: {
      attempted: number;
      sent: number;
      failed: number;
      skipped: number;
    };
    reset: {
      attempted: number;
      sent: number;
      failed: number;
      skipped: number;
    };
  };
}

export interface AdminUserRecord {
  id: string;
  email: string;
  createdAt: string | null;
  emailVerifiedAt: string | null;
  emailVerified: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  orgCount: number;
  resendVerificationCountLast24h: number;
}

export interface AdminUsersResponse {
  total: number;
  limit: number;
  offset: number;
  users: AdminUserRecord[];
}

export interface AdminOrgRecord {
  orgId: string;
  name: string;
  createdAt: string | null;
  memberCount: number;
  taskCount: number;
  conflictCountLast7d: number;
  lastActivityAt: string | null;
}

export interface AdminOrgsResponse {
  total: number;
  limit: number;
  offset: number;
  orgs: AdminOrgRecord[];
}

export interface AdminConflictRecord {
  orgId: string;
  taskId: string;
  userId: string | null;
  enteredAt: string;
  resolvedAt: string | null;
  durationMs: number;
  strategy: string | null;
  title: string | null;
}

export interface AdminConflictsResponse {
  total: number;
  limit: number;
  offset: number;
  conflicts: AdminConflictRecord[];
}

export interface AdminSyncHealthResponse {
  generatedAt: string;
  syncErrors: {
    last24h: number;
    last7d: number;
  };
  sseConnectedRatio: number;
  slo: {
    sync: {
      total: number;
      success: number;
      failures: number;
      errorRate: number;
      latencyMs: {
        count: number;
        average: number | null;
        p50: number | null;
        p95: number | null;
      };
    };
    realtime: {
      sseConnectedEvents: number;
      sseReconnectEvents: number;
      sseConnectedRatio: number;
    };
    imports: {
      outlookSuccess: number;
      outlookFailure: number;
    };
  };
  alerts: Array<{
    code: string;
    severity: string;
    message: string;
    value?: number;
    threshold?: number;
    windowMinutes?: number;
  }>;
  windowMinutes: number;
}

export interface AdminEmailHealthResponse {
  generatedAt: string;
  providerMode: string;
  availability: 'available' | 'unknown' | 'disabled';
  explanation: string | null;
  windowDays: number;
  verification: {
    attempted: number;
    sent: number;
    failed: number;
    skipped: number;
  };
  reset: {
    attempted: number;
    sent: number;
    failed: number;
    skipped: number;
  };
}

export interface AdminResendVerificationResponse {
  ok: boolean;
  alreadyVerified?: boolean;
  userId: string;
  delivery?: {
    queued: boolean;
    skipped: boolean;
    provider: string;
  };
}

function toQueryString<T extends object>(params: T): string {
  const search = new URLSearchParams();
  Object.entries(params as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      search.set(key, String(value));
    }
  });
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export async function getAdminOverview(token: string, params: AdminBaseParams = {}) {
  return cloudRequest<AdminOverviewResponse>(`/api/v1/admin/overview${toQueryString(params)}`, {
    token,
  });
}

export async function getAdminUsers(
  token: string,
  params: AdminPaginationParams & { query?: string } = {}
) {
  return cloudRequest<AdminUsersResponse>(`/api/v1/admin/users${toQueryString(params)}`, {
    token,
  });
}

export async function resendVerification(token: string, userId: string) {
  return cloudRequest<AdminResendVerificationResponse>(
    `/api/v1/admin/users/${encodeURIComponent(userId)}/resend-verification`,
    {
      method: 'POST',
      token,
    }
  );
}

export async function getAdminOrgs(token: string, params: AdminPaginationParams = {}) {
  return cloudRequest<AdminOrgsResponse>(`/api/v1/admin/orgs${toQueryString(params)}`, {
    token,
  });
}

export async function getAdminConflicts(
  token: string,
  params: AdminPaginationParams & { status?: 'unresolved' | 'all' } = {}
) {
  return cloudRequest<AdminConflictsResponse>(`/api/v1/admin/conflicts${toQueryString(params)}`, {
    token,
  });
}

export async function getAdminSyncHealth(token: string, params: AdminBaseParams = {}) {
  return cloudRequest<AdminSyncHealthResponse>(`/api/v1/admin/sync-health${toQueryString(params)}`, {
    token,
  });
}

export async function getAdminEmailHealth(token: string, params: AdminBaseParams = {}) {
  return cloudRequest<AdminEmailHealthResponse>(`/api/v1/admin/email-health${toQueryString(params)}`, {
    token,
  });
}
