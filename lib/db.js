import { createClient } from "@libsql/client";

let _client;
let _ready;

export function client() {
  if (!_client) {
    const url = process.env.TURSO_DATABASE_URL || "file:local.db";
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS study_config (
    config_id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    task_title TEXT NOT NULL,
    task_instructions TEXT NOT NULL,
    common_prompt TEXT NOT NULL,
    control_instruction TEXT NOT NULL,
    treatment_instruction TEXT NOT NULL,
    opening_message_control TEXT NOT NULL,
    opening_message_treatment TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    max_tokens INTEGER NOT NULL,
    temperature REAL NOT NULL,
    prompt_version TEXT NOT NULL,
    allocation_method TEXT NOT NULL,
    final_assessment_url TEXT NOT NULL,
    id_param_name TEXT NOT NULL,
    require_ready_mark INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    created_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
    participant_id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    access_code TEXT NOT NULL,
    access_status TEXT NOT NULL DEFAULT 'pending',
    preliminary_stage_verified_at TEXT,
    verification_method TEXT,
    verified_by TEXT,
    is_test INTEGER NOT NULL DEFAULT 0,
    batch_label TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS allocation (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    stream TEXT NOT NULL,
    block_no INTEGER NOT NULL,
    condition TEXT NOT NULL,
    consumed_by TEXT UNIQUE,
    consumed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    participant_id TEXT NOT NULL UNIQUE,
    condition TEXT NOT NULL,
    allocation_seq INTEGER,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    started_at TEXT,
    expires_at TEXT,
    ended_at TEXT,
    end_reason TEXT,
    config_id INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    opening_message TEXT NOT NULL,
    max_tokens INTEGER NOT NULL,
    temperature REAL NOT NULL,
    final_assessment_url TEXT NOT NULL,
    id_param_name TEXT NOT NULL,
    test_session INTEGER NOT NULL DEFAULT 0,
    final_assessment_link_opened INTEGER NOT NULL DEFAULT 0,
    final_assessment_link_opened_at TEXT,
    error_flag INTEGER NOT NULL DEFAULT 0,
    inflight_request_id TEXT,
    inflight_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    message_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    received_at TEXT NOT NULL,
    displayed_at TEXT,
    request_id TEXT,
    delivery_status TEXT NOT NULL,
    UNIQUE(session_id, seq),
    UNIQUE(session_id, request_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    session_id TEXT,
    participant_id TEXT,
    event_type TEXT NOT NULL,
    ts TEXT NOT NULL,
    details TEXT,
    admin_identity TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id, seq)`,
  `CREATE INDEX IF NOT EXISTS idx_evt_session ON events(session_id, ts)`,
];

// Columns added after first release. ALTER fails harmlessly if the column already exists.
const MIGRATIONS = [
  `ALTER TABLE study_config ADD COLUMN pretest_url TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE study_config ADD COLUMN pretest_required INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE participants ADD COLUMN pretest_opened_at TEXT`,
];

async function migrate(c) {
  await c.batch(SCHEMA, "write");
  for (const m of MIGRATIONS) {
    try { await c.execute(m); } catch (e) { if (!/duplicate column/i.test(String(e?.message))) throw e; }
  }
}

export async function db() {
  const c = client();
  if (!_ready) {
    _ready = migrate(c).catch((e) => {
      _ready = null;
      throw e;
    });
  }
  await _ready;
  return c;
}

export async function q(sql, args = []) {
  const c = await db();
  return c.execute({ sql, args });
}

export async function one(sql, args = []) {
  const r = await q(sql, args);
  return r.rows[0] ? { ...r.rows[0] } : null;
}

export async function all(sql, args = []) {
  const r = await q(sql, args);
  return r.rows.map((x) => ({ ...x }));
}
