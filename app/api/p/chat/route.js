import { withParticipant } from "@/lib/papi";
import { lazyExpire, getSession, participantState } from "@/lib/session";
import { generate, LlmError } from "@/lib/llm";
import { json, logEvent, nowIso, uid } from "@/lib/util";
import { q, one, all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STALE_LOCK_MS = 90_000;

async function insertMessage(s, role, text, request_id, status) {
  const now = nowIso();
  await q(
    `INSERT INTO messages (message_id, session_id, seq, role, text, received_at, request_id, delivery_status)
     SELECT ?, ?, COALESCE(MAX(seq),0)+1, ?, ?, ?, ?, ? FROM messages WHERE session_id=?`,
    [uid("m_"), s.session_id, role, text, now, request_id, status, s.session_id]
  );
}

async function release(s, request_id) {
  await q(`UPDATE sessions SET inflight_request_id=NULL, inflight_at=NULL WHERE session_id=? AND inflight_request_id=?`, [s.session_id, request_id]);
}

export async function POST(req) {
  return withParticipant(req, async ({ body, p, s }) => {
    if (!s || s.status !== "active") {
      return json({ error: "not_active", state: await participantState(p, s) }, 409);
    }
    const request_id = String(body.request_id || "");
    const text = String(body.text || "").trim().slice(0, 4000);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(request_id) || !text) return json({ error: "bad_request" }, 400);

    // Duplicate click / retry with the same request id: never create a duplicate turn.
    const done = await one(`SELECT text FROM messages WHERE session_id=? AND request_id=? AND role='assistant' AND delivery_status='delivered'`, [s.session_id, request_id]);
    if (done) return json({ ok: true, reply: done.text, state: await participantState(p, s) });

    // Only one outstanding LLM request per session.
    const lock = await q(
      `UPDATE sessions SET inflight_request_id=?, inflight_at=? WHERE session_id=? AND status='active'
       AND (inflight_request_id IS NULL OR inflight_request_id=? OR inflight_at < ?)`,
      [request_id, nowIso(), s.session_id, request_id, new Date(Date.now() - STALE_LOCK_MS).toISOString()]
    );
    if (!lock.rowsAffected) return json({ error: "busy", message: "Please wait for the tutor's reply." }, 429);

    try {
      // Save the user message BEFORE calling the provider.
      const existingUser = await one(`SELECT message_id FROM messages WHERE session_id=? AND request_id=? AND role='user'`, [s.session_id, request_id]);
      if (!existingUser) await insertMessage(s, "user", text, request_id, "received");
      else await logEvent({ session_id: s.session_id, participant_id: p.participant_id, type: "retry", details: { request_id } });

      const hist = await all(
        `SELECT role, text, delivery_status, request_id FROM messages WHERE session_id=? ORDER BY seq`,
        [s.session_id]
      );
      const history = hist
        .filter((m) => m.request_id !== "opening" && (m.role === "user" || m.delivery_status === "delivered"))
        .map((m) => ({ role: m.role, text: m.text }));

      const remaining = Date.parse(s.expires_at) - Date.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), Math.max(1000, Math.min(remaining + 500, 55_000)));
      let reply;
      try {
        reply = await generate({
          provider: s.provider,
          model_id: s.model_id,
          system: s.system_prompt,
          history,
          max_tokens: Number(s.max_tokens),
          temperature: Number(s.temperature),
          signal: ac.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      // Expired while generating: do not display, log the discarded response.
      if (Date.now() >= Date.parse(s.expires_at)) {
        if (reply) await insertMessage(s, "assistant", reply, request_id, "discarded_after_expiry");
        await logEvent({ session_id: s.session_id, participant_id: p.participant_id, type: "response_discarded", details: { request_id, reason: "expired_during_generation" } });
        await release(s, request_id);
        const s2 = await lazyExpire(await getSession(p.participant_id));
        return json({ error: "expired", state: await participantState(p, s2) }, 409);
      }
      if (!reply) throw new LlmError("Empty reply", "provider");

      await insertMessage(s, "assistant", reply, request_id, "delivered");
      await q(`UPDATE messages SET delivery_status='answered' WHERE session_id=? AND request_id=? AND role='user'`, [s.session_id, request_id]);
      await release(s, request_id);
      return json({ ok: true, reply, state: await participantState(p, await getSession(p.participant_id)) });
    } catch (e) {
      const expired = Date.now() >= Date.parse(s.expires_at);
      await q(`UPDATE messages SET delivery_status=? WHERE session_id=? AND request_id=? AND role='user'`, [expired ? "answered_none_expired" : "reply_failed", s.session_id, request_id]);
      await release(s, request_id);
      if (expired) {
        await logEvent({ session_id: s.session_id, participant_id: p.participant_id, type: "response_discarded", details: { request_id, reason: "cancelled_at_expiry" } });
        const s2 = await lazyExpire(await getSession(p.participant_id));
        return json({ error: "expired", state: await participantState(p, s2) }, 409);
      }
      await q(`UPDATE sessions SET error_flag=1 WHERE session_id=?`, [s.session_id]);
      await logEvent({
        session_id: s.session_id,
        participant_id: p.participant_id,
        type: "llm_error",
        details: { request_id, kind: e.kind || "unknown", status: e.status || null, message: String(e.message || e).slice(0, 300) },
      });
      return json({ error: "llm_failed", message: "The tutor could not reply. Please press Retry. The timer keeps running." }, 502);
    }
  });
}
