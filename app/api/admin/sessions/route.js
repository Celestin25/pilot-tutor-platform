import { adminRoute } from "@/lib/auth";
import { all } from "@/lib/db";
import { lazyExpire } from "@/lib/session";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const overdue = await all(`SELECT * FROM sessions WHERE status='active' AND expires_at <= ?`, [new Date().toISOString()]);
  for (const s of overdue) await lazyExpire(s);
  const rows = await all(`
    SELECT p.participant_id, p.access_code, p.access_status, p.is_test, p.batch_label, p.preliminary_stage_verified_at,
           s.session_id, s.condition, s.status, s.started_at, s.expires_at, s.ended_at, s.end_reason, s.error_flag,
           s.final_assessment_link_opened, s.prompt_version, s.model_id,
           (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.session_id AND m.role='user') AS user_msgs,
           (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.session_id) AS msg_count
    FROM participants p LEFT JOIN sessions s ON s.participant_id=p.participant_id
    ORDER BY p.is_test, p.created_at, p.participant_id`);
  return json({ rows, server_now: new Date().toISOString() });
});
