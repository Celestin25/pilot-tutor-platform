import { adminRoute } from "@/lib/auth";
import { all, one } from "@/lib/db";
import { csv } from "@/lib/util";

export const dynamic = "force-dynamic";

function file(body, name, type) {
  return new Response(body, {
    headers: {
      "Content-Type": `${type}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

export const GET = adminRoute(async (req, { params }) => {
  const { kind } = await params;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "participants"; // participants | test | all
  const testClause = scope === "all" ? "1=1" : scope === "test" ? "s.test_session=1" : "s.test_session=0";
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

  if (kind === "sessions") {
    const rows = await all(`
      SELECT s.participant_id, s.session_id, s.condition, s.status, s.created_at, s.started_at, s.expires_at, s.ended_at, s.end_reason,
             s.duration_seconds, s.model_id, s.provider, s.prompt_version, s.config_id, s.allocation_seq, s.test_session, s.error_flag,
             s.final_assessment_link_opened, s.final_assessment_link_opened_at, 'unknown' AS final_assessment_completed,
             p.access_status, p.preliminary_stage_verified_at, p.verification_method,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.session_id AND m.role='user') AS participant_messages,
             (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.session_id AND m.role='assistant' AND m.delivery_status='delivered') AS tutor_messages,
             (SELECT COUNT(*) FROM events e WHERE e.session_id=s.session_id AND e.event_type='llm_error') AS llm_errors,
             (SELECT COUNT(*) FROM events e WHERE e.session_id=s.session_id AND e.event_type='reconnect') AS reconnects
      FROM sessions s JOIN participants p ON p.participant_id=s.participant_id
      WHERE ${testClause} ORDER BY s.created_at`);
    const cols = rows.length ? Object.keys(rows[0]) : ["participant_id", "session_id"];
    return file(csv(rows, cols), `sessions_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "messages" || kind === "messages-json") {
    const rows = await all(`
      SELECT s.participant_id, m.session_id, s.condition, m.message_id, m.seq AS sequence_number, m.role, m.text,
             m.received_at, m.displayed_at, m.request_id, m.delivery_status, s.test_session
      FROM messages m JOIN sessions s ON s.session_id=m.session_id
      WHERE ${testClause} ORDER BY s.participant_id, m.seq`);
    if (kind === "messages-json") return file(JSON.stringify(rows, null, 2), `messages_${scope}_${stamp}.json`, "application/json");
    const cols = ["participant_id", "session_id", "condition", "message_id", "sequence_number", "role", "text", "received_at", "displayed_at", "request_id", "delivery_status", "test_session"];
    return file(csv(rows, cols), `messages_${scope}_${stamp}.csv`, "text/csv");
  }

  if (kind === "events") {
    const rows = await all(`SELECT e.event_id, e.participant_id, e.session_id, e.event_type, e.ts, e.details, e.admin_identity FROM events e ORDER BY e.ts`);
    return file(csv(rows, ["event_id", "participant_id", "session_id", "event_type", "ts", "details", "admin_identity"]), `events_${stamp}.csv`, "text/csv");
  }

  if (kind === "invitations") {
    // Invitation list for researchers. This is the ONLY export containing access codes.
    const origin = url.origin;
    const rows = (await all(`SELECT participant_id, access_code, is_test, batch_label, access_status, created_at FROM participants ORDER BY is_test, participant_id`)).map((r) => ({
      ...r,
      invitation_link: `${origin}/p/${String(r.access_code).replace(/-/g, "")}`,
    }));
    return file(csv(rows, ["participant_id", "access_code", "invitation_link", "is_test", "batch_label", "access_status", "created_at"]), `invitations_${stamp}.csv`, "text/csv");
  }

  if (kind === "transcript") {
    const id = url.searchParams.get("session_id");
    const s = await one(`SELECT * FROM sessions WHERE session_id=?`, [id]);
    if (!s) return new Response("Not found", { status: 404 });
    const msgs = await all(`SELECT * FROM messages WHERE session_id=? ORDER BY seq`, [id]);
    const lines = [
      `Participant: ${s.participant_id}`, `Session: ${s.session_id}`, `Group: ${s.condition}`,
      `Model: ${s.model_id} (${s.provider})   Prompt version: ${s.prompt_version}`,
      `Started: ${s.started_at || "-"}   Deadline: ${s.expires_at || "-"}   Ended: ${s.ended_at || "-"} (${s.end_reason || "-"})`,
      `Test session: ${Number(s.test_session) ? "yes" : "no"}`, "", "-".repeat(60), "",
    ];
    for (const m of msgs) {
      const who = m.role === "user" ? "PARTICIPANT" : "TUTOR";
      const flag = m.delivery_status === "delivered" || m.delivery_status === "answered" ? "" : `  [${m.delivery_status}]`;
      lines.push(`[${m.seq}] ${who}  ${m.received_at}${flag}`, m.text, "");
    }
    return file("﻿" + lines.join("\r\n"), `transcript_${s.participant_id}_${s.session_id}.txt`, "text/plain");
  }

  if (kind === "backup") {
    const data = {};
    for (const t of ["study_config", "participants", "allocation", "sessions", "messages", "events"]) {
      data[t] = await all(`SELECT * FROM ${t}`);
      if (t === "participants") data[t] = data[t].map(({ access_code, ...r }) => r); // no plaintext codes in backups
    }
    return file(JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 1), `backup_${stamp}.json`, "application/json");
  }

  return new Response("Unknown export", { status: 404 });
});
