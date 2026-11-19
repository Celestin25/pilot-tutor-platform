import crypto from "crypto";
import { db, one, all, q } from "./db";
import { activeConfig, getFlow, buildChatPrompt } from "./config";
import { expandSteps, permutations, resolve } from "./flow";
import { nowIso, uid, tokenHash, logEvent } from "./util";

export async function findParticipant(code) {
  if (!code) return null;
  return one(`SELECT * FROM participants WHERE token_hash = ?`, [tokenHash(code)]);
}

export async function getRun(participant_id) {
  return one(`SELECT * FROM runs WHERE participant_id=?`, [participant_id]);
}

// ---------- counterbalanced condition orders ----------
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Make sure at least `needed` unused order slots exist. Each block contains every order once, shuffled. */
export async function ensureOrderCapacity(stream, needed, condIds) {
  const key = `order:${stream}:${condIds.join(",")}`;
  const r = await one(`SELECT COUNT(*) AS n FROM allocation WHERE stream=? AND consumed_by IS NULL`, [key]);
  let free = Number(r.n);
  if (free >= needed) return;
  const mb = await one(`SELECT COALESCE(MAX(block_no),0) AS m FROM allocation WHERE stream=?`, [key]);
  let blockNo = Number(mb.m);
  const stmts = [];
  while (free < needed) {
    blockNo++;
    for (const order of shuffle(permutations(condIds))) {
      stmts.push({ sql: `INSERT INTO allocation (stream, block_no, condition) VALUES (?,?,?)`, args: [key, blockNo, order.join(",")] });
      free++;
    }
  }
  const c = await db();
  await c.batch(stmts, "write");
}

/** Create the participant's run exactly once: consumes the next condition order atomically. */
export async function ensureRun(p) {
  let run = await getRun(p.participant_id);
  if (run) return run;
  const cfg = await activeConfig();
  const flow = getFlow(cfg);
  const condIds = flow.conditions.map((c) => c.id);
  const stream = Number(p.is_test) ? "test" : "main";
  const key = `order:${stream}:${condIds.join(",")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (flow.order_mode === "counterbalanced") await ensureOrderCapacity(stream, 1, condIds);
    const now = nowIso();
    const c = await db();
    if (flow.order_mode === "counterbalanced") {
      await c.batch([
        { sql: `UPDATE allocation SET consumed_by=?, consumed_at=? WHERE seq = (SELECT MIN(seq) FROM allocation WHERE stream=? AND consumed_by IS NULL) AND NOT EXISTS (SELECT 1 FROM allocation WHERE consumed_by=?)`,
          args: [p.participant_id, now, key, p.participant_id] },
      ], "write");
      const slot = await one(`SELECT seq, condition FROM allocation WHERE consumed_by=?`, [p.participant_id]);
      if (!slot) continue;
      const order = slot.condition.split(",");
      await insertRun(p, cfg, flow, order, Number(slot.seq));
    } else {
      await insertRun(p, cfg, flow, condIds, null);
    }
    run = await getRun(p.participant_id);
    if (run) return run;
  }
  throw new Error("Could not create run");
}

async function insertRun(p, cfg, flow, order, seq) {
  const steps = expandSteps(flow, order).map((s) => ({ ...s, conditionInfo: flow.conditions.find((c) => c.id === s.condition) || null }));
  const r = await q(
    `INSERT OR IGNORE INTO runs (participant_id, allocation_seq, condition_order, status, current_step, config_id, prompt_version, steps_json, created_at, test_run)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [p.participant_id, seq, order.join(","), "ready", 0, cfg.config_id, cfg.prompt_version,
     JSON.stringify({ steps, end_message: flow.end_message, end_url: flow.end_url, model: { provider: cfg.provider, model_id: cfg.model_id, max_tokens: cfg.max_tokens, temperature: cfg.temperature, common_prompt: cfg.common_prompt }, id_param_name: cfg.id_param_name }),
     nowIso(), Number(p.is_test) ? 1 : 0]
  );
  if (r.rowsAffected) await logEvent({ participant_id: p.participant_id, type: "run_created", details: { order, allocation_seq: seq, prompt_version: cfg.prompt_version } });
}

export function runData(run) { return JSON.parse(run.steps_json); }

export async function startRun(run) {
  if (run.status !== "ready") return run;
  const now = nowIso();
  const r = await q(`UPDATE runs SET status='active', started_at=?, step_entered_at=? WHERE participant_id=? AND status='ready'`, [now, now, run.participant_id]);
  if (r.rowsAffected) await logEvent({ participant_id: run.participant_id, type: "run_started" });
  return getRun(run.participant_id);
}

export async function endRun(run, reason, admin = null, note = null) {
  const r = await q(`UPDATE runs SET status='ended', end_reason=?, ended_at=? WHERE participant_id=? AND status IN ('ready','active')`, [reason, nowIso(), run.participant_id]);
  if (r.rowsAffected) {
    await q(`UPDATE chats SET status='ended', end_reason=?, ended_at=?, inflight_request_id=NULL WHERE participant_id=? AND status='active'`, [reason === "completed" ? "time_limit" : reason, nowIso(), run.participant_id]);
    await logEvent({ participant_id: run.participant_id, type: "run_ended", details: { end_reason: reason, note }, admin });
  }
  return getRun(run.participant_id);
}

// ---------- chats (one per chat page per condition) ----------
export async function getChat(participant_id, step_key) {
  const c = await one(`SELECT * FROM chats WHERE participant_id=? AND step_key=?`, [participant_id, step_key]);
  return lazyExpireChat(c);
}

export async function lazyExpireChat(c) {
  if (!c || c.status !== "active" || !c.expires_at || Date.now() < Date.parse(c.expires_at)) return c;
  const r = await q(`UPDATE chats SET status='ended', end_reason='time_limit', ended_at=expires_at, inflight_request_id=NULL WHERE chat_id=? AND status='active'`, [c.chat_id]);
  if (r.rowsAffected) await logEvent({ session_id: c.chat_id, participant_id: c.participant_id, type: "chat_ended", details: { end_reason: "time_limit", condition: c.condition } });
  return one(`SELECT * FROM chats WHERE chat_id=?`, [c.chat_id]);
}

export async function startChat(run, step) {
  const existing = await getChat(run.participant_id, step.key);
  if (existing) return existing;
  const d = runData(run);
  const item = step.page.items.find((i) => i.type === "chat");
  const cond = step.conditionInfo || { id: step.condition, tutor_instruction: "", opening_message: "" };
  const start = new Date();
  const exp = new Date(start.getTime() + item.duration_seconds * 1000);
  const chat_id = uid("c_");
  const cfgLike = { common_prompt: d.model.common_prompt };
  const system = buildChatPrompt(cfgLike, cond, resolve(item.tutor_task, step.condition));
  const c = await db();
  const r = await c.batch([
    { sql: `INSERT OR IGNORE INTO chats (chat_id, participant_id, step_key, condition, position, status, started_at, expires_at, duration_seconds, model_id, provider, system_prompt, opening_message, max_tokens, temperature)
            VALUES (?,?,?,?,?,'active',?,?,?,?,?,?,?,?,?)`,
      args: [chat_id, run.participant_id, step.key, step.condition, step.position, start.toISOString(), exp.toISOString(), item.duration_seconds,
             d.model.model_id, d.model.provider, system, cond.opening_message || "", Number(d.model.max_tokens), Number(d.model.temperature)] },
    { sql: `INSERT OR IGNORE INTO messages (message_id, session_id, seq, role, text, received_at, displayed_at, request_id, delivery_status)
            SELECT ?, chat_id, 1, 'assistant', opening_message, started_at, started_at, 'opening', 'delivered' FROM chats WHERE chat_id=?`,
      args: [uid("m_"), chat_id] },
  ], "write");
  if (r[0].rowsAffected) await logEvent({ session_id: chat_id, participant_id: run.participant_id, type: "chat_started", details: { condition: step.condition, position: step.position, expires_at: exp.toISOString() } });
  return getChat(run.participant_id, step.key);
}

export async function endChat(chat, reason, admin = null, note = null) {
  const r = await q(`UPDATE chats SET status='ended', end_reason=?, ended_at=?, inflight_request_id=NULL WHERE chat_id=? AND status='active'`, [reason, nowIso(), chat.chat_id]);
  if (r.rowsAffected) await logEvent({ session_id: chat.chat_id, participant_id: chat.participant_id, type: "chat_ended", details: { end_reason: reason, condition: chat.condition, note }, admin });
  return one(`SELECT * FROM chats WHERE chat_id=?`, [chat.chat_id]);
}

export async function chatMessages(chat_id) {
  const rows = await all(`SELECT seq, role, text, received_at, delivery_status, request_id FROM messages WHERE session_id=? ORDER BY seq`, [chat_id]);
  return rows.filter((m) => m.role === "user" || m.delivery_status === "delivered")
    .map((m) => ({ seq: Number(m.seq), role: m.role, text: m.text, at: m.received_at, request_id: m.request_id }));
}

// ---------- what the participant browser may see ----------
function publicItem(it, cond) {
  const base = { id: it.id, type: it.type, text: resolve(it.text, cond), required: !!it.required };
  if (it.type === "slider") Object.assign(base, { min: it.min, max: it.max, start: it.start, step: it.step, left_label: resolve(it.left_label, cond), right_label: resolve(it.right_label, cond) });
  if (it.type === "mc") Object.assign(base, { options: it.options, multiple: !!it.multiple });
  if (it.type === "text") Object.assign(base, { multiline: !!it.multiline });
  if (it.type === "chat") Object.assign(base, { duration_seconds: it.duration_seconds });
  return base;
}

export async function participantState(p, run) {
  const base = { participant_id: p.participant_id, server_now: nowIso() };
  if (p.access_status === "blocked") return { ...base, phase: "blocked" };
  if (!run) return { ...base, phase: "waiting" };
  const d = runData(run);
  const total = d.steps.length;
  if (run.status === "ready") {
    const est = d.steps.reduce((t, s) => t + s.page.items.reduce((u, i) => u + (i.type === "chat" ? i.duration_seconds : 10), 0), 0);
    return { ...base, phase: "ready", total, estimated_minutes: Math.max(1, Math.round(est / 60)) };
  }
  if (run.status === "ended") {
    const ended = { ...base, phase: "ended", end_reason: run.end_reason, end_message: d.end_message, has_end_link: !!d.end_url, total };
    return ended;
  }
  const idx = Number(run.current_step);
  const step = d.steps[idx];
  const page = { key: step.key, index: idx, total, items: step.page.items.map((it) => publicItem(it, step.condition)) };
  const chatItem = step.page.items.find((i) => i.type === "chat");
  if (chatItem) {
    const chat = await getChat(run.participant_id, step.key);
    page.chat = !chat ? { status: "not_started", duration_seconds: chatItem.duration_seconds }
      : { status: chat.status, end_reason: chat.end_reason, remaining_ms: chat.status === "active" ? Math.max(0, Date.parse(chat.expires_at) - Date.now()) : 0, messages: await chatMessages(chat.chat_id) };
  }
  // previously saved answers for this page (e.g. after a refresh)
  const saved = await all(`SELECT item_id, value FROM responses WHERE participant_id=? AND step_key=?`, [run.participant_id, step.key]);
  page.saved = Object.fromEntries(saved.map((r) => [r.item_id, r.value]));
  return { ...base, phase: "active", page };
}
