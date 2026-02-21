import Database from 'better-sqlite3';
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

export function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
