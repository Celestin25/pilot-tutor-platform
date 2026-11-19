import { adminRoute } from "@/lib/auth";
import { all } from "@/lib/db";
import { lazyExpireChat } from "@/lib/run";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async () => {
  const overdue = await all(`SELECT * FROM chats WHERE status='active' AND expires_at <= ?`, [new Date().toISOString()]);
  for (const c of overdue) await lazyExpireChat(c);
  const rows = await all(`
    SELECT p.participant_id, p.access_code, p.access_status, p.is_test, p.batch_label,
           r.condition_order, r.status, r.current_step, r.started_at, r.ended_at, r.end_reason, r.error_flag, r.prompt_version,
           r.step_entered_at, r.steps_json IS NOT NULL AS has_run,
           (SELECT COUNT(*) FROM responses x WHERE x.participant_id=p.participant_id) AS answers,
           (SELECT c.condition || '|' || c.position || '|' || c.expires_at FROM chats c WHERE c.participant_id=p.participant_id AND c.status='active' LIMIT 1) AS active_chat
    FROM participants p LEFT JOIN runs r ON r.participant_id=p.participant_id
    ORDER BY p.is_test, p.created_at, p.participant_id`);
  for (const r of rows) {
    if (r.has_run) {
      const steps = JSON.parse((await all(`SELECT steps_json FROM runs WHERE participant_id=?`, [r.participant_id]))[0].steps_json).steps;
      r.total_steps = steps.length;
      const s = steps[Number(r.current_step)];
      r.current_where = r.status === "active" && s ? `${s.block_name || s.section}${s.condition ? ` (${s.condition})` : ""}: ${s.page.id}` : "";
    }
    delete r.has_run;
  }
  return json({ rows, server_now: new Date().toISOString() });
});
