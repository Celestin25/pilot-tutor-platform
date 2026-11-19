import { adminRoute } from "@/lib/auth";
import { one, all, q } from "@/lib/db";
import { getRun, runData, endRun, endChat, lazyExpireChat } from "@/lib/run";
import { json, logEvent } from "@/lib/util";

export const dynamic = "force-dynamic";

async function load(id) {
  const p = await one(`SELECT participant_id, access_status, preliminary_stage_verified_at, verification_method, verified_by, is_test, batch_label, created_at FROM participants WHERE participant_id=?`, [id]);
  if (!p) return null;
  const run = await getRun(id);
  let steps = [], d = null;
  if (run) {
    d = runData(run);
    steps = d.steps.map((s, i) => ({ index: i, key: s.key, section: s.section, condition: s.condition, position: s.position, page_id: s.page.id,
      items: s.page.items.map((it) => ({ id: it.id, type: it.type })) }));
  }
  const chatsRaw = await all(`SELECT * FROM chats WHERE participant_id=? ORDER BY started_at`, [id]);
  const chats = [];
  for (let c of chatsRaw) {
    c = await lazyExpireChat(c);
    delete c.inflight_request_id;
    c.messages = await all(`SELECT * FROM messages WHERE session_id=? ORDER BY seq`, [c.chat_id]);
    chats.push(c);
  }
  const responses = await all(`SELECT * FROM responses WHERE participant_id=? ORDER BY step_index, rowid`, [id]);
  const events = await all(`SELECT * FROM events WHERE participant_id=? ORDER BY ts`, [id]);
  if (run) delete run.steps_json;
  return { participant: p, run, steps, chats, responses, events, model: d?.model ? { provider: d.model.provider, model_id: d.model.model_id } : null, server_now: new Date().toISOString() };
}

export const GET = adminRoute(async (_req, { params }) => {
  const { id } = await params;
  const d = await load(id);
  return d ? json(d) : json({ error: "Not found" }, 404);
});

export const POST = adminRoute(async (req, { params }, admin) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason || "").trim().slice(0, 500);
  const run = await getRun(id);
  if (!run) return json({ error: "This participant has not started." }, 404);
  if (!reason) return json({ error: "A reason is required." }, 400);

  if (body.action === "stop") {
    if (run.status === "ended") return json({ error: "Already ended." }, 409);
    const endReason = ["researcher_stopped", "technical_failure", "withdrawn"].includes(body.end_reason) ? body.end_reason : "researcher_stopped";
    await endRun(run, endReason, admin, reason);
    return json(await load(id));
  }
  const chat = await one(`SELECT * FROM chats WHERE participant_id=? AND status='active'`, [id]);
  if (body.action === "end_chat") {
    if (!chat) return json({ error: "No chat is running." }, 409);
    await endChat(chat, "researcher_stopped", admin, reason);
    return json(await load(id));
  }
  if (body.action === "adjust") {
    if (!chat) return json({ error: "Time can only be adjusted while a chat is running." }, 409);
    const add = Number(body.add_seconds);
    if (!Number.isFinite(add) || add === 0 || Math.abs(add) > 3600) return json({ error: "Enter seconds to add (e.g. 60) or remove (e.g. -60)." }, 400);
    const newExp = new Date(Date.parse(chat.expires_at) + add * 1000).toISOString();
    const r = await q(`UPDATE chats SET expires_at=? WHERE chat_id=? AND status='active' AND expires_at=?`, [newExp, chat.chat_id, chat.expires_at]);
    if (!r.rowsAffected) return json({ error: "Chat changed; reload and try again." }, 409);
    await logEvent({ session_id: chat.chat_id, participant_id: id, type: "deadline_adjusted", details: { condition: chat.condition, old_expires_at: chat.expires_at, new_expires_at: newExp, add_seconds: add, reason }, admin });
    await lazyExpireChat({ ...chat, expires_at: newExp });
    return json(await load(id));
  }
  return json({ error: "Unknown action" }, 400);
});
