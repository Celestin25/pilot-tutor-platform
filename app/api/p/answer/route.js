import { withParticipant, currentStep } from "@/lib/papi";
import { runData, getChat, getRun, participantState } from "@/lib/run";
import { resolve } from "@/lib/flow";
import { db, q } from "@/lib/db";
import { json, logEvent, nowIso, uid } from "@/lib/util";

export const dynamic = "force-dynamic";

function check(it, v) {
  const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
  if (empty) return it.required ? "Please answer this question." : null;
  if (it.type === "slider") {
    const n = Number(v);
    if (!Number.isFinite(n) || n < it.min || n > it.max) return "Invalid value.";
  }
  if (it.type === "mc") {
    const vals = Array.isArray(v) ? v : [v];
    if (!it.multiple && vals.length > 1) return "Choose one option.";
    if (vals.some((x) => !it.options.includes(x))) return "Invalid option.";
  }
  if (it.type === "text" && String(v).length > 5000) return "Answer is too long.";
  return null;
}

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    if (!run || run.status !== "active") return json({ error: "not_active", state: await participantState(p, run) }, 409);
    const d = runData(run);
    const idx = Number(run.current_step);
    const step = currentStep(run, d);
    if (body.step_key !== step.key) return json({ error: "stale", state: await participantState(p, run) }, 409);

    const chatItem = step.page.items.find((i) => i.type === "chat");
    if (chatItem) {
      const chat = await getChat(p.participant_id, step.key);
      if (!chat || chat.status !== "ended") return json({ error: "chat_open", message: "Please finish the chat first." }, 409);
    }
    const answers = body.answers || {};
    const errors = {};
    const items = step.page.items.filter((i) => !["info", "chat"].includes(i.type));
    for (const it of items) { const e = check(it, answers[it.id]); if (e) errors[it.id] = e; }
    if (Object.keys(errors).length) return json({ error: "invalid", errors }, 400);

    const now = nowIso();
    const secs = Number(body.page_seconds);
    const stmts = items.filter((it) => answers[it.id] !== undefined && answers[it.id] !== null && answers[it.id] !== "").map((it) => {
      const v = answers[it.id];
      return {
        sql: `INSERT INTO responses (response_id, participant_id, step_key, step_index, section, condition, position, page_id, item_id, item_type, item_text, value, page_seconds, answered_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(participant_id, step_key, item_id) DO UPDATE SET value=excluded.value, page_seconds=excluded.page_seconds, answered_at=excluded.answered_at`,
        args: [uid("r_"), p.participant_id, step.key, idx, step.section, step.condition, step.position, step.page.id, it.id, it.type,
               resolve(it.text, step.condition), Array.isArray(v) ? JSON.stringify(v) : String(v), Number.isFinite(secs) ? secs : null, now],
      };
    });
    const last = idx + 1 >= d.steps.length;
    stmts.push(last
      ? { sql: `UPDATE runs SET status='ended', end_reason='completed', ended_at=?, current_step=? WHERE participant_id=? AND current_step=? AND status='active'`, args: [now, idx, p.participant_id, idx] }
      : { sql: `UPDATE runs SET current_step=current_step+1, step_entered_at=? WHERE participant_id=? AND current_step=? AND status='active'`, args: [now, p.participant_id, idx] });
    const c = await db();
    const res = await c.batch(stmts, "write");
    if (res[res.length - 1].rowsAffected) {
      await logEvent({ participant_id: p.participant_id, type: last ? "run_completed" : "page_completed", details: { step_key: step.key, page_seconds: Number.isFinite(secs) ? secs : null } });
    }
    return json({ ok: true, state: await participantState(p, await getRun(p.participant_id)) });
  });
}
