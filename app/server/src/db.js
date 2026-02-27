import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../data');
const configuredDbPathRaw =
  typeof process.env.TASKABLE_DB_PATH === 'string' ? process.env.TASKABLE_DB_PATH.trim() : '';
const configuredDbPath = configuredDbPathRaw
  ? configuredDbPathRaw === ':memory:'
    ? configuredDbPathRaw
    : path.resolve(configuredDbPathRaw)
  : null;
const dbPath = configuredDbPath ?? path.join(dataDir, 'taskable.db');
const dbDir = dbPath === ':memory:' ? null : path.dirname(dbPath);

if (process.env.NODE_ENV === 'production' && !configuredDbPath) {
  console.warn(
    '[db] WARNING: TASKABLE_DB_PATH is not set. Data will not persist across restarts. Configure a persistent disk before production launch.'
  );
}

if (dbDir && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email_verified_at TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret TEXT,
    mfa_pending_secret TEXT,
    mfa_enrolled_at TEXT,
    password_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS org_members (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (org_id, user_id),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    start_date_time TEXT,
    duration_minutes INTEGER NOT NULL,
    time_zone TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    color TEXT NOT NULL,
    type TEXT NOT NULL,
    assigned_to TEXT,
    status TEXT NOT NULL,
    focus INTEGER NOT NULL DEFAULT 0,
    execution_status TEXT NOT NULL DEFAULT 'idle',
    actual_minutes REAL NOT NULL DEFAULT 0,
    last_start_at TEXT,
    completed_at TEXT,
    last_end_prompt_at TEXT,
    last_prompt_at TEXT,
    execution_version INTEGER NOT NULL DEFAULT 1,
    execution_updated_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_audit_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    task_id TEXT,
    actor_user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    replaced_by_session_id TEXT,
    user_agent TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (replaced_by_session_id) REFERENCES user_sessions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    rate_key TEXT PRIMARY KEY,
    attempt_count INTEGER NOT NULL,
    reset_at_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_type TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ops_events (
    id TEXT PRIMARY KEY,
    org_id TEXT,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    duration_ms REAL,
    value REAL,
    status INTEGER,
    code TEXT,
    source TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_reset ON auth_rate_limits(reset_at_ms);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type ON auth_tokens(user_id, token_type);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_expiry ON auth_tokens(expires_at);
  CREATE INDEX IF NOT EXISTS idx_ops_events_created_at ON ops_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_ops_events_org_type_created ON ops_events(org_id, event_type, created_at);
`);

const taskColumns = db.prepare('PRAGMA table_info(tasks)').all();
if (!taskColumns.some((column) => column.name === 'version')) {
  db.exec('ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1;');
}
if (!taskColumns.some((column) => column.name === 'execution_status')) {
  db.exec("ALTER TABLE tasks ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'idle';");
}
if (!taskColumns.some((column) => column.name === 'actual_minutes')) {
  db.exec('ALTER TABLE tasks ADD COLUMN actual_minutes REAL NOT NULL DEFAULT 0;');
}
if (!taskColumns.some((column) => column.name === 'last_start_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN last_start_at TEXT;');
}
if (!taskColumns.some((column) => column.name === 'completed_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN completed_at TEXT;');
}
if (!taskColumns.some((column) => column.name === 'last_end_prompt_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN last_end_prompt_at TEXT;');
}
if (!taskColumns.some((column) => column.name === 'last_prompt_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN last_prompt_at TEXT;');
}
if (!taskColumns.some((column) => column.name === 'execution_version')) {
  db.exec('ALTER TABLE tasks ADD COLUMN execution_version INTEGER NOT NULL DEFAULT 1;');
}
if (!taskColumns.some((column) => column.name === 'execution_updated_at')) {
  db.exec('ALTER TABLE tasks ADD COLUMN execution_updated_at TEXT;');
}
db.prepare(
  "UPDATE tasks SET execution_status = CASE WHEN completed = 1 THEN 'completed' ELSE 'idle' END WHERE execution_status IS NULL OR execution_status = ''"
).run();
db.prepare(
  'UPDATE tasks SET actual_minutes = 0 WHERE actual_minutes IS NULL OR actual_minutes < 0'
).run();
db.prepare(
  `UPDATE tasks
   SET last_end_prompt_at = COALESCE(last_end_prompt_at, last_prompt_at)
   WHERE last_end_prompt_at IS NULL AND last_prompt_at IS NOT NULL`
).run();
db.prepare(
  'UPDATE tasks SET execution_version = 1 WHERE execution_version IS NULL OR execution_version < 1'
).run();
db.prepare(
  `UPDATE tasks
   SET execution_updated_at = COALESCE(execution_updated_at, updated_at, datetime('now'))
   WHERE execution_updated_at IS NULL OR execution_updated_at = ''`
).run();

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT;');
}
if (!userColumns.some((column) => column.name === 'password_updated_at')) {
  db.exec('ALTER TABLE users ADD COLUMN password_updated_at TEXT;');
  db.prepare(
    'UPDATE users SET password_updated_at = created_at WHERE password_updated_at IS NULL'
  ).run();
}
if (!userColumns.some((column) => column.name === 'mfa_enabled')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;');
}
if (!userColumns.some((column) => column.name === 'mfa_secret')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT;');
}
if (!userColumns.some((column) => column.name === 'mfa_pending_secret')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_pending_secret TEXT;');
}
if (!userColumns.some((column) => column.name === 'mfa_enrolled_at')) {
  db.exec('ALTER TABLE users ADD COLUMN mfa_enrolled_at TEXT;');
}
db.prepare(
  'UPDATE users SET mfa_enabled = 0 WHERE mfa_enabled IS NULL OR mfa_enabled NOT IN (0, 1)'
).run();

db.prepare(
  "UPDATE org_members SET role = 'member' WHERE role NOT IN ('owner', 'admin', 'member', 'viewer') OR role IS NULL"
).run();

function normalizeOrgScope(orgIds) {
  if (!Array.isArray(orgIds)) return [];
  const normalized = orgIds
    .map((orgId) => (typeof orgId === 'string' ? orgId.trim() : ''))
    .filter((orgId) => orgId.length > 0);
  return Array.from(new Set(normalized));
}

function buildInClause(values) {
  return values.map(() => '?').join(', ');
}

export function getOwnedOrgIdsForUser(userId) {
  if (!userId) return [];
  return db
    .prepare(
      `SELECT org_id
       FROM org_members
       WHERE user_id = ? AND role = 'owner'
       ORDER BY joined_at ASC`
    )
    .all(userId)
    .map((row) => row.org_id);
}

export function summarizeScopedUsers({ orgIds, activeSessionAfterIso }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return {
      totalUsers: 0,
      verifiedCount: 0,
      mfaEnabledCount: 0,
      activeSessionsCount: 0,
    };
  }

  const inClause = buildInClause(scope);
  const usersSummaryRow = db
    .prepare(
      `WITH scoped_users AS (
         SELECT DISTINCT user_id
         FROM org_members
         WHERE org_id IN (${inClause})
       )
       SELECT
         COUNT(*) AS totalUsers,
         SUM(CASE WHEN u.email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verifiedCount,
         SUM(CASE WHEN u.mfa_enabled = 1 THEN 1 ELSE 0 END) AS mfaEnabledCount
       FROM users u
       JOIN scoped_users su ON su.user_id = u.id`
    )
    .get(...scope);

  const activeSessionsRow = db
    .prepare(
      `SELECT COUNT(DISTINCT s.id) AS count
       FROM user_sessions s
       JOIN org_members m ON m.user_id = s.user_id
       WHERE m.org_id IN (${inClause})
         AND s.revoked_at IS NULL
         AND s.expires_at > ?`
    )
    .get(...scope, activeSessionAfterIso);

  return {
    totalUsers: usersSummaryRow?.totalUsers ?? 0,
    verifiedCount: usersSummaryRow?.verifiedCount ?? 0,
    mfaEnabledCount: usersSummaryRow?.mfaEnabledCount ?? 0,
    activeSessionsCount: activeSessionsRow?.count ?? 0,
  };
}

export function summarizeScopedOrgs({ orgIds }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return {
      totalOrgs: 0,
      totalMembers: 0,
      totalTasks: 0,
    };
  }

  const inClause = buildInClause(scope);
  const totalMembersRow = db
    .prepare(`SELECT COUNT(*) AS count FROM org_members WHERE org_id IN (${inClause})`)
    .get(...scope);
  const totalTasksRow = db
    .prepare(`SELECT COUNT(*) AS count FROM tasks WHERE org_id IN (${inClause})`)
    .get(...scope);

  return {
    totalOrgs: scope.length,
    totalMembers: totalMembersRow?.count ?? 0,
    totalTasks: totalTasksRow?.count ?? 0,
  };
}

export function listScopedUsersForAdmin({
  orgIds,
  query = '',
  limit = 50,
  offset = 0,
  resendSinceIso,
}) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return { total: 0, users: [] };
  }

  const inClause = buildInClause(scope);
  const normalizedQuery = query.trim().toLowerCase();
  const likePattern = normalizedQuery ? `%${normalizedQuery}%` : '';

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT DISTINCT u.id
         FROM users u
         JOIN org_members m ON m.user_id = u.id
         WHERE m.org_id IN (${inClause})
           AND (? = '' OR lower(u.email) LIKE ?)
       )`
    )
    .get(...scope, likePattern, likePattern);

  const users = db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.created_at AS createdAt,
         u.email_verified_at AS emailVerifiedAt,
         u.mfa_enabled AS mfaEnabled,
         MAX(s.last_used_at) AS lastLoginAt,
         COUNT(DISTINCT m.org_id) AS orgCount,
         (
           SELECT COUNT(*)
           FROM ops_events oe
           WHERE oe.event_type = 'email.verification.resend'
             AND oe.code = ('target:' || u.id)
             AND oe.created_at >= ?
         ) AS resendVerificationCountLast24h
       FROM users u
       JOIN org_members m ON m.user_id = u.id
       LEFT JOIN user_sessions s ON s.user_id = u.id
       WHERE m.org_id IN (${inClause})
         AND (? = '' OR lower(u.email) LIKE ?)
       GROUP BY u.id
       ORDER BY COALESCE(MAX(s.last_used_at), u.created_at) DESC, u.email ASC
       LIMIT ? OFFSET ?`
    )
    .all(resendSinceIso, ...scope, likePattern, likePattern, limit, offset);

  return {
    total: totalRow?.count ?? 0,
    users,
  };
}

export function listScopedOrgsForAdmin({ orgIds, limit = 50, offset = 0, conflictSinceIso }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return { total: 0, orgs: [] };
  }

  const inClause = buildInClause(scope);
  const orgs = db
    .prepare(
      `SELECT
         o.id AS orgId,
         o.name,
         o.created_at AS createdAt,
         (
           SELECT COUNT(*)
           FROM org_members m
           WHERE m.org_id = o.id
         ) AS memberCount,
         (
           SELECT COUNT(*)
           FROM tasks t
           WHERE t.org_id = o.id
         ) AS taskCount,
         (
           SELECT COUNT(*)
           FROM ops_events oe
           WHERE oe.org_id = o.id
             AND oe.event_type = 'conflict_entered'
             AND oe.created_at >= ?
         ) AS conflictCountLast7d,
         (
           SELECT MAX(updated_at)
           FROM tasks tx
           WHERE tx.org_id = o.id
         ) AS lastTaskActivityAt,
         (
           SELECT MAX(created_at)
           FROM ops_events ox
           WHERE ox.org_id = o.id
         ) AS lastOpsActivityAt
       FROM orgs o
       WHERE o.id IN (${inClause})
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(conflictSinceIso, ...scope, limit, offset);

  return {
    total: scope.length,
    orgs,
  };
}

export function fetchScopedConflictEvents({ orgIds, sinceIso = null }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return [];
  }

  const inClause = buildInClause(scope);
  const args = [...scope];
  let where = `org_id IN (${inClause}) AND event_type IN ('conflict_entered', 'conflict_resolved')`;
  if (sinceIso) {
    where += ' AND created_at >= ?';
    args.push(sinceIso);
  }

  return db
    .prepare(
      `SELECT org_id, user_id, event_type, metadata_json, created_at
       FROM ops_events
       WHERE ${where}
       ORDER BY created_at ASC
       LIMIT 10000`
    )
    .all(...args);
}

export function fetchScopedOperationalEvents({ orgIds, sinceIso, eventTypes = [] }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return [];
  }

  const orgInClause = buildInClause(scope);
  const args = [...scope, sinceIso];
  let where = `org_id IN (${orgInClause}) AND created_at >= ?`;

  if (Array.isArray(eventTypes) && eventTypes.length > 0) {
    const eventScope = eventTypes
      .map((eventType) => (typeof eventType === 'string' ? eventType.trim() : ''))
      .filter((eventType) => eventType.length > 0);
    if (eventScope.length > 0) {
      const eventInClause = buildInClause(eventScope);
      where += ` AND event_type IN (${eventInClause})`;
      args.push(...eventScope);
    }
  }

  return db
    .prepare(
      `SELECT org_id, user_id, event_type, duration_ms, value, status, code, source, metadata_json, created_at
       FROM ops_events
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 10000`
    )
    .all(...args);
}

export function summarizeScopedEmailEvents({ orgIds, sinceIso }) {
  const scope = normalizeOrgScope(orgIds);
  if (scope.length === 0) {
    return {
      verification: { attempted: 0, sent: 0, failed: 0, skipped: 0 },
      reset: { attempted: 0, sent: 0, failed: 0, skipped: 0 },
      available: true,
    };
  }

  const inClause = buildInClause(scope);
  const rows = db
    .prepare(
      `SELECT event_type, code, COUNT(*) AS count
       FROM ops_events
       WHERE created_at >= ?
         AND event_type IN ('email.verification.send', 'email.reset.send')
         AND user_id IN (
           SELECT DISTINCT user_id
           FROM org_members
           WHERE org_id IN (${inClause})
         )
       GROUP BY event_type, code`
    )
    .all(sinceIso, ...scope);

  const summary = {
    verification: { attempted: 0, sent: 0, failed: 0, skipped: 0 },
    reset: { attempted: 0, sent: 0, failed: 0, skipped: 0 },
    available: true,
  };

  rows.forEach((row) => {
    const target =
      row.event_type === 'email.verification.send' ? summary.verification : summary.reset;
    target.attempted += row.count ?? 0;
    if (row.code === 'sent') target.sent += row.count ?? 0;
    if (row.code === 'failed') target.failed += row.count ?? 0;
    if (row.code === 'skipped') target.skipped += row.count ?? 0;
  });

  return summary;
}

export function findUserForScopedAdmin({ userId, orgIds }) {
  const scope = normalizeOrgScope(orgIds);
  if (!userId || scope.length === 0) return null;

  const inClause = buildInClause(scope);
  return db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.name,
         u.email_verified_at AS emailVerifiedAt,
         (
           SELECT om.org_id
           FROM org_members om
           WHERE om.user_id = u.id
             AND om.org_id IN (${inClause})
           ORDER BY om.joined_at ASC
           LIMIT 1
         ) AS scopedOrgId
       FROM users u
       WHERE u.id = ?
         AND EXISTS (
           SELECT 1
           FROM org_members om
           WHERE om.user_id = u.id
             AND om.org_id IN (${inClause})
         )`
    )
    .get(...scope, userId, ...scope);
}

export function countVerificationResendsForUser({ targetUserId, sinceIso }) {
  if (!targetUserId || !sinceIso) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM ops_events
       WHERE event_type = 'email.verification.resend'
         AND code = ?
         AND created_at >= ?`
    )
    .get(`target:${targetUserId}`, sinceIso);
  return row?.count ?? 0;
}

export function createId(prefix) {
  const entropyId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : crypto.randomBytes(16).toString('hex');
  return `${prefix}_${entropyId}`;
}

export function consumeAuthRateLimit({ key, nowMs, windowMs, maxAttempts }) {
  if (!key) {
    return { allowed: true, retryAfterSeconds: null };
  }

  const existing = db
    .prepare(
      `SELECT attempt_count AS attemptCount, reset_at_ms AS resetAtMs
       FROM auth_rate_limits
       WHERE rate_key = ?`
    )
    .get(key);

  if (!existing || existing.resetAtMs <= nowMs) {
    db.prepare(
      `INSERT INTO auth_rate_limits (rate_key, attempt_count, reset_at_ms, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(rate_key) DO UPDATE SET
         attempt_count = excluded.attempt_count,
         reset_at_ms = excluded.reset_at_ms,
         updated_at = datetime('now')`
    ).run(key, 1, nowMs + windowMs);
    return { allowed: true, retryAfterSeconds: null };
  }

  if (existing.attemptCount >= maxAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  db.prepare(
    `UPDATE auth_rate_limits
     SET attempt_count = ?, updated_at = datetime('now')
     WHERE rate_key = ?`
  ).run(existing.attemptCount + 1, key);

  return { allowed: true, retryAfterSeconds: null };
}

export function clearExpiredAuthRateLimits(nowMs = Date.now()) {
  db.prepare('DELETE FROM auth_rate_limits WHERE reset_at_ms <= ?').run(nowMs);
}
