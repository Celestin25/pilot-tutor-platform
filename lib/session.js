import crypto from "crypto";
import { db, one, all, q } from "./db";
import { activeConfig, buildSystemPrompt } from "./config";
import { nowIso, uid, tokenHash, logEvent } from "./util";

export async function findParticipant(code) {
  if (!code) return null;
  return one(`SELECT * FROM participants WHERE token_hash = ?`, [tokenHash(code)]);
}

function shuffledBlock() {
  const b = ["control", "control", "treatment", "treatment"];
  for (let i = b.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Make sure at least `needed` unconsumed allocation slots exist in a stream (main or test). */
export async function ensureAllocationCapacity(stream, needed) {
  const r = await one(`SELECT COUNT(*) AS n FROM allocation WHERE stream=? AND consumed_by IS NULL`, [stream]);
  let free = Number(r.n);
  if (free >= needed) return;
  const mb = await one(`SELECT COALESCE(MAX(block_no),0) AS m FROM allocation WHERE stream=?`, [stream]);
  let blockNo = Number(mb.m);
  const stmts = [];
  while (free < needed) {
    blockNo++;
    for (const cond of shuffledBlock()) {
      stmts.push({ sql: `INSERT INTO allocation (stream, block_no, condition) VALUES (?,?,?)`, args: [stream, blockNo, cond] });
      free++;
    }
  }
  const c = await db();
  await c.batch(stmts, "write");
}

export async function getSession(participant_id) {
  return one(`SELECT * FROM sessions WHERE participant_id=?`, [participant_id]);
}

/** Server is the only authority on expiry. Ends an overdue active session. */
export async function lazyExpire(s) {
  if (!s || s.status !== "active" || !s.expires_at) return s;
  if (Date.now() < Date.parse(s.expires_at)) return s;
  const r = await q(
    `UPDATE sessions SET status='ended', end_reason='time_limit', ended_at=expires_at, inflight_request_id=NULL WHERE session_id=? AND status='active'`,
    [s.session_id]
  );
  if (r.rowsAffected) await logEvent({ session_id: s.session_id, participant_id: s.participant_id, type: "session_ended", details: { end_reason: "time_limit" } });
  return getSession(s.participant_id);
}

/** Allocate a group and create exactly one session, atomically. Returns the session. */
export async function ensureSession(p) {
  let s = await getSession(p.participant_id);
  if (s) return lazyExpire(s);
  const cfg = await activeConfig();
  const stream = Number(p.is_test) ? "test" : "main";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sid = uid("s_");
    const now = nowIso();
    const c = await db();
    await c.batch(
      [
        {
          sql: `UPDATE allocation SET consumed_by=?, consumed_at=?
                WHERE seq = (SELECT MIN(seq) FROM allocation WHERE stream=? AND consumed_by IS NULL)
                AND NOT EXISTS (SELECT 1 FROM allocation WHERE consumed_by=?)`,
          args: [p.participant_id, now, stream, p.participant_id],
        },
        {
          sql: `INSERT OR IGNORE INTO sessions (session_id, participant_id, condition, allocation_seq, status, created_at,
                  config_id, duration_seconds, model_id, provider, prompt_version, system_prompt, opening_message,
                  max_tokens, temperature, final_assessment_url, id_param_name, test_session)
                SELECT ?, ?, condition, seq, 'ready', ?, ?, ?, ?, ?, ?,
                  CASE condition WHEN 'treatment' THEN ? ELSE ? END,
                  CASE condition WHEN 'treatment' THEN ? ELSE ? END,
                  ?, ?, ?, ?, ?
                FROM allocation WHERE consumed_by=?`,
          args: [
            sid, p.participant_id, now, cfg.config_id, cfg.duration_seconds, cfg.model_id, cfg.provider, cfg.prompt_version,
            buildSystemPrompt(cfg, "treatment"), buildSystemPrompt(cfg, "control"),
            cfg.opening_message_treatment, cfg.opening_message_control,
            cfg.max_tokens, cfg.temperature, cfg.final_assessment_url, cfg.id_param_name, Number(p.is_test) ? 1 : 0,
            p.participant_id,
          ],
        },
      ],
      "write"
    );
    s = await getSession(p.participant_id);
    if (s) {
      if (s.session_id === sid) await logEvent({ session_id: sid, participant_id: p.participant_id, type: "session_created", details: { allocation_seq: s.allocation_seq, stream } });
      return s;
    }
    await ensureAllocationCapacity(stream, 4); // sequence exhausted: extend with a new shuffled block, retry
  }
  throw new Error("Could not allocate session");
}

/** First authorised entry into the chatbot: record server start time + deadline, save opening message. */
export async function startSession(s) {
  if (s.status !== "ready") return s;
  const start = new Date();
  const exp = new Date(start.getTime() + Number(s.duration_seconds) * 1000);
  const c = await db();
  const r = await c.batch(
    [
      {
        sql: `UPDATE sessions SET status='active', started_at=?, expires_at=? WHERE session_id=? AND status='ready'`,
        args: [start.toISOString(), exp.toISOString(), s.session_id],
      },
      {
        sql: `INSERT OR IGNORE INTO messages (message_id, session_id, seq, role, text, received_at, displayed_at, request_id, delivery_status)
              SELECT ?, ?, 1, 'assistant', opening_message, ?, ?, 'opening', 'delivered' FROM sessions WHERE session_id=? AND started_at=?`,
        args: [uid("m_"), s.session_id, start.toISOString(), start.toISOString(), s.session_id, start.toISOString()],
      },
    ],
    "write"
  );
  if (r[0].rowsAffected) {
    await logEvent({ session_id: s.session_id, participant_id: s.participant_id, type: "session_started", details: { started_at: start.toISOString(), expires_at: exp.toISOString() } });
  }
  return getSession(s.participant_id);
}

export async function endSession(s, reason, admin = null, note = null) {
  const r = await q(
    `UPDATE sessions SET status='ended', end_reason=?, ended_at=?, inflight_request_id=NULL WHERE session_id=? AND status IN ('ready','active','blocked')`,
    [reason, nowIso(), s.session_id]
  );
  if (r.rowsAffected) await logEvent({ session_id: s.session_id, participant_id: s.participant_id, type: "session_ended", details: { end_reason: reason, note }, admin });
  return getSession(s.participant_id);
}

export async function visibleMessages(session_id) {
  const rows = await all(
    `SELECT seq, role, text, received_at, delivery_status, request_id FROM messages WHERE session_id=? ORDER BY seq`,
    [session_id]
  );
  return rows
    .filter((m) => m.role === "user" || m.delivery_status === "delivered")
    .map((m) => ({ seq: Number(m.seq), role: m.role, text: m.text, at: m.received_at, status: m.delivery_status, request_id: m.request_id }));
}

/** Everything the participant browser is allowed to know. Never includes condition or prompts. */
export async function participantState(p, s, cfg) {
  cfg = cfg || (await activeConfig());
  const base = {
    participant_id: p.participant_id,
    server_now: nowIso(),
    pretest: cfg.pretest_url ? { required: !!Number(cfg.pretest_required), opened: !!p.pretest_opened_at } : null,
  };
  if (p.access_status === "blocked") return { ...base, phase: "blocked" };
  if (!s) return { ...base, phase: "waiting" };
  const common = {
    ...base,
    task_title: cfg.task_title,
    task_instructions: cfg.task_instructions,
    duration_seconds: Number(s.duration_seconds),
    started_at: s.started_at,
    expires_at: s.expires_at,
  };
  if (s.status === "blocked") return { ...base, phase: "blocked" };
  if (s.status === "ready") return { ...common, phase: "ready" };
  const messages = await visibleMessages(s.session_id);
  if (s.status === "active") {
    return { ...common, phase: "active", remaining_ms: Math.max(0, Date.parse(s.expires_at) - Date.now()), messages };
  }
  return { ...common, phase: "ended", end_reason: s.end_reason, messages };
}
