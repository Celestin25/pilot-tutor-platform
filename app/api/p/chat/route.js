import { withParticipant, currentStep } from "@/lib/papi";
import { runData, getChat, lazyExpireChat, participantState, getRun } from "@/lib/run";
import { generate, LlmError } from "@/lib/llm";
import { json, logEvent, nowIso, uid } from "@/lib/util";
import { q, one, all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_LOCK_MS = 90_000;

async function insertMessage(chat, role, text, request_id, status) {
  await q(
    `INSERT INTO messages (message_id, session_id, seq, role, text, received_at, request_id, delivery_status)
     SELECT ?, ?, COALESCE(MAX(seq),0)+1, ?, ?, ?, ?, ? FROM messages WHERE session_id=?`,
    [uid("m_"), chat.chat_id, role, text, nowIso(), request_id, status, chat.chat_id]
  );
}
async function release(chat, request_id) {
  await q(`UPDATE chats SET inflight_request_id=NULL, inflight_at=NULL WHERE chat_id=? AND inflight_request_id=?`, [chat.chat_id, request_id]);
}

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    const state = async () => participantState(p, await getRun(p.participant_id));
    if (!run || run.status !== "active") return json({ error: "not_active", state: await state() }, 409);
    const step = currentStep(run, runData(run));
    if (body.step_key !== step.key) return json({ error: "stale", state: await state() }, 409);
    const chat = await getChat(p.participant_id, step.key);
    if (!chat || chat.status !== "active") return json({ error: "chat_closed", state: await state() }, 409);

    const request_id = String(body.request_id || "");
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(request_id) || !text) return json({ error: "bad_request" }, 400);

    const done = await one(`SELECT text FROM messages WHERE session_id=? AND request_id=? AND role='assistant' AND delivery_status='delivered'`, [chat.chat_id, request_id]);
    if (done) return json({ ok: true, reply: done.text, state: await state() });

    const lock = await q(
      `UPDATE chats SET inflight_request_id=?, inflight_at=? WHERE chat_id=? AND status='active'
       AND (inflight_request_id IS NULL OR inflight_request_id=? OR inflight_at < ?)`,
      [request_id, nowIso(), chat.chat_id, request_id, new Date(Date.now() - STALE_LOCK_MS).toISOString()]
    );
    if (!lock.rowsAffected) return json({ error: "busy", message: "Please wait for the tutor's reply." }, 429);

    const ev = (type, details) => logEvent({ session_id: chat.chat_id, participant_id: p.participant_id, type, details: { condition: chat.condition, ...details } });
    try {
      const existingUser = await one(`SELECT message_id FROM messages WHERE session_id=? AND request_id=? AND role='user'`, [chat.chat_id, request_id]);
      if (!existingUser) await insertMessage(chat, "user", text, request_id, "received");
      else await ev("retry", { request_id });

      const hist = await all(`SELECT role, text, delivery_status, request_id FROM messages WHERE session_id=? ORDER BY seq`, [chat.chat_id]);
      const history = hist.filter((m) => m.request_id !== "opening" && (m.role === "user" || m.delivery_status === "delivered")).map((m) => ({ role: m.role, text: m.text }));

      const remaining = Date.parse(chat.expires_at) - Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.max(1000, Math.min(remaining + 500, 55_000)));
      let reply;
      try {
        reply = await generate({ provider: chat.provider, model_id: chat.model_id, system: chat.system_prompt, history,
                                 max_tokens: Number(chat.max_tokens), temperature: Number(chat.temperature), signal: ac.signal });
      } finally { clearTimeout(timer); }

      if (Date.now() >= Date.parse(chat.expires_at)) {
        if (reply) await insertMessage(chat, "assistant", reply, request_id, "discarded_after_expiry");
        await ev("response_discarded", { request_id, reason: "expired_during_generation" });
        await release(chat, request_id);
        await lazyExpireChat(chat);
        return json({ error: "expired", state: await state() }, 409);
      }
      if (!reply) throw new LlmError("Empty reply", "provider");
      await insertMessage(chat, "assistant", reply, request_id, "delivered");
      await q(`UPDATE messages SET delivery_status='answered' WHERE session_id=? AND request_id=? AND role='user'`, [chat.chat_id, request_id]);
      await release(chat, request_id);
      return json({ ok: true, reply, state: await state() });
    } catch (e) {
      const expired = Date.now() >= Date.parse(chat.expires_at);
      await q(`UPDATE messages SET delivery_status=? WHERE session_id=? AND request_id=? AND role='user'`, [expired ? "answered_none_expired" : "reply_failed", chat.chat_id, request_id]);
      await release(chat, request_id);
      if (expired) {
        await ev("response_discarded", { request_id, reason: "cancelled_at_expiry" });
        await lazyExpireChat(chat);
        return json({ error: "expired", state: await state() }, 409);
      }
      await q(`UPDATE chats SET error_flag=1 WHERE chat_id=?`, [chat.chat_id]);
      await q(`UPDATE runs SET error_flag=1 WHERE participant_id=?`, [p.participant_id]);
      await ev("llm_error", { request_id, kind: e.kind || "unknown", status: e.status || null, message: String(e.message || e).slice(0, 300) });
      return json({ error: "llm_failed", message: "The tutor could not reply. Please press Retry. The timer keeps running." }, 502);
    }
  });
}
