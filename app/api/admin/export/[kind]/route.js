import { adminRoute } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { csv } from "@/lib/util";

export const dynamic = "force-dynamic";

function file(body, name, type) {
  return new Response(body, {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

export const GET = adminRoute(async (req, { params }) => {
  const { kind } = await params;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "participants"; // participants | test | all
  const testClause = (col) => (scope === "all" ? "1=1" : scope === "test" ? `${col}=1` : `${col}=0`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  if (kind === "runs") {
    const rows = await all(`
      SELECT r.participant_id, r.condition_order, r.status, r.end_reason, r.created_at, r.started_at, r.ended_at,
             ROUND((julianday(COALESCE(r.ended_at, r.started_at)) - julianday(r.started_at)) * 86400) AS total_seconds,
             r.current_step, r.prompt_version, r.config_id, r.allocation_seq, r.test_run, r.error_flag, r.end_link_opened_at,
             p.access_status, p.preliminary_stage_verified_at, p.verification_method,
             (SELECT COUNT(*) FROM responses x WHERE x.participant_id=r.participant_id) AS answers,
             (SELECT COUNT(*) FROM chats c WHERE c.participant_id=r.participant_id) AS chats,
             (SELECT COUNT(*) FROM events e WHERE e.participant_id=r.participant_id AND e.event_type='llm_error') AS llm_errors
      FROM runs r JOIN participants p ON p.participant_id=r.participant_id
      WHERE ${testClause("r.test_run")} ORDER BY r.created_at`);
    const cols = rows.length ? Object.keys(rows[0]) : ["participant_id"];
    return file(csv(rows, cols), `participants_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "responses") {
    // long format: one row per answer
    const rows = await all(`
      SELECT x.participant_id, r.condition_order, x.section AS block, x.condition, x.position AS order_position, x.step_index, x.page_id,
             x.item_id, x.item_type, x.item_text, x.value, x.page_seconds, x.answered_at, r.test_run
      FROM responses x JOIN runs r ON r.participant_id=x.participant_id
      WHERE ${testClause("r.test_run")} ORDER BY x.participant_id, x.step_index, x.rowid`);
    const cols = ["participant_id", "condition_order", "block", "condition", "order_position", "step_index", "page_id", "item_id", "item_type", "item_text", "value", "page_seconds", "answered_at", "test_run"];
    return file(csv(rows, cols), `responses_long_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "responses-wide") {
    // wide format: one row per participant; per-condition questions become ITEM_CONDITION columns
    const rows = await all(`
      SELECT x.participant_id, r.condition_order, x.condition, x.item_id, x.value
      FROM responses x JOIN runs r ON r.participant_id=x.participant_id
      WHERE ${testClause("r.test_run")} ORDER BY x.participant_id, x.step_index, x.rowid`);
    const byP = new Map(); const cols = ["participant_id", "condition_order"];
    for (const r of rows) {
      const col = r.condition ? `${r.item_id}_${r.condition}` : r.item_id;
      if (!cols.includes(col)) cols.push(col);
      if (!byP.has(r.participant_id)) byP.set(r.participant_id, { participant_id: r.participant_id, condition_order: r.condition_order });
      byP.get(r.participant_id)[col] = r.value;
    }
    return file(csv([...byP.values()], cols), `responses_wide_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "messages" || kind === "messages-json") {
    const rows = await all(`
      SELECT c.participant_id, c.chat_id, c.condition, c.position AS condition_position, m.message_id, m.seq AS sequence_number, m.role, m.text,
             m.received_at, m.displayed_at, m.request_id, m.delivery_status, r.test_run
      FROM messages m JOIN chats c ON c.chat_id=m.session_id JOIN runs r ON r.participant_id=c.participant_id
      WHERE ${testClause("r.test_run")} ORDER BY c.participant_id, c.position, m.seq`);
    if (kind === "messages-json") return file(JSON.stringify(rows, null, 2), `messages_${scope}_${stamp}.json`, "application/json");
    const cols = ["participant_id", "chat_id", "condition", "condition_position", "message_id", "sequence_number", "role", "text", "received_at", "displayed_at", "request_id", "delivery_status", "test_run"];
    return file(csv(rows, cols), `messages_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "chats") {
    const rows = await all(`
      SELECT c.participant_id, c.chat_id, c.condition, c.position AS condition_position, c.status, c.started_at, c.expires_at, c.ended_at, c.end_reason,
             c.duration_seconds, c.model_id, c.error_flag,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id=c.chat_id AND m.role='user') AS participant_messages,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id=c.chat_id AND m.role='assistant' AND m.delivery_status='delivered') AS tutor_messages,
             r.test_run
      FROM chats c JOIN runs r ON r.participant_id=c.participant_id WHERE ${testClause("r.test_run")} ORDER BY c.participant_id, c.position`);
    const cols = rows.length ? Object.keys(rows[0]) : ["participant_id"];
    return file(csv(rows, cols), `chats_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "events") {
    const rows = await all(`SELECT event_id, participant_id, session_id AS chat_id, event_type, ts, details, admin_identity FROM events ORDER BY ts`);
    return file(csv(rows, ["event_id", "participant_id", "chat_id", "event_type", "ts", "details", "admin_identity"]), `events_${stamp}.csv`, "text/csv");
  }

  if (kind === "invitations") {
    const origin = url.origin;
    const rows = (await all(`SELECT participant_id, access_code, is_test, batch_label, access_status, created_at FROM participants ORDER BY is_test, participant_id`)).map((r) => ({
      ...r, invitation_link: `${origin}/p/${String(r.access_code).replace(/-/g, "")}`,
    }));
    return file(csv(rows, ["participant_id", "access_code", "invitation_link", "is_test", "batch_label", "access_status", "created_at"]), `invitations_${stamp}.csv`, "text/csv");
  }

  if (kind === "transcript") {
    const pid = url.searchParams.get("participant_id");
    const run = await one(`SELECT * FROM runs WHERE participant_id=?`, [pid]);
    if (!run) return new Response("Not found", { status: 404 });
    const chats = await all(`SELECT * FROM chats WHERE participant_id=? ORDER BY position`, [pid]);
    const lines = [`Participant: ${pid}`, `Condition order: ${run.condition_order}`, `Settings version: ${run.prompt_version}`, `Status: ${run.status} (${run.end_reason || "-"})`, ""];
    for (const c of chats) {
      lines.push("=".repeat(60), `Part ${c.position}: ${c.condition}   Model: ${c.model_id}`, `Started: ${c.started_at}   Ended: ${c.ended_at || "-"} (${c.end_reason || "-"})`, "");
      for (const m of await all(`SELECT * FROM messages WHERE session_id=? ORDER BY seq`, [c.chat_id])) {
        const flag = ["delivered", "answered"].includes(m.delivery_status) ? "" : `  [${m.delivery_status}]`;
        lines.push(`[${m.seq}] ${m.role === "user" ? "PARTICIPANT" : "TUTOR"}  ${m.received_at}${flag}`, m.text, "");
      }
    }
    return file("﻿" + lines.join("\r\n"), `transcript_${pid}.txt`, "text/plain");
  }

  if (kind === "backup") {
    const data = {};
    for (const t of ["study_config", "participants", "allocation", "runs", "responses", "chats", "messages", "events", "sessions"]) {
      data[t] = await all(`SELECT * FROM ${t}`);
      if (t === "participants") data[t] = data[t].map(({ access_code, ...r }) => r);
    }
    return file(JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 1), `backup_${stamp}.json`, "application/json");
  }

  return new Response("Unknown export", { status: 404 });
});
