import { adminRoute } from "@/lib/auth";
import { one, all, q } from "@/lib/db";
import { lazyExpire, endSession, getSession } from "@/lib/session";
import { json, logEvent } from "@/lib/util";

export const dynamic = "force-dynamic";

async function load(id) {
  let s = await one(`SELECT * FROM sessions WHERE session_id=?`, [id]);
  if (!s) return null;
  s = await lazyExpire(s);
  const p = await one(`SELECT participant_id, access_status, preliminary_stage_verified_at, pretest_opened_at, verification_method, verified_by, is_test, batch_label FROM participants WHERE participant_id=?`, [s.participant_id]);
  const messages = await all(`SELECT * FROM messages WHERE session_id=? ORDER BY seq`, [id]);
  const events = await all(`SELECT * FROM events WHERE session_id=? OR (session_id IS NULL AND participant_id=?) ORDER BY ts`, [id, s.participant_id]);
  delete s.inflight_request_id;
  return { session: s, participant: p, messages, events, server_now: new Date().toISOString() };
}

export const GET = adminRoute(async (_req, { params }) => {
  const { id } = await params;
  const d = await load(id);
  return d ? json(d) : json({ error: "Not found" }, 404);
});

export const POST = adminRoute(async (req, { params }, admin) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  let s = await one(`SELECT * FROM sessions WHERE session_id=?`, [id]);
  if (!s) return json({ error: "Not found" }, 404);
  s = await lazyExpire(s);
  const reason = String(body.reason || "").trim().slice(0, 500);

  if (body.action === "stop") {
    const endReason = ["researcher_stopped", "technical_failure", "withdrawn"].includes(body.end_reason) ? body.end_reason : "researcher_stopped";
    if (!reason) return json({ error: "A reason is required." }, 400);
    if (s.status === "ended") return json({ error: "Session already ended." }, 409);
    await endSession(s, endReason, admin, reason);
    return json(await load(id));
  }

  if (body.action === "adjust") {
    if (!reason) return json({ error: "A reason is required." }, 400);
    if (s.status !== "active") return json({ error: "Only active sessions can be adjusted." }, 409);
    const add = Number(body.add_seconds);
    if (!Number.isFinite(add) || add === 0 || Math.abs(add) > 3600) return json({ error: "Enter seconds to add (e.g. 60) or remove (e.g. -60)." }, 400);
    const oldExp = s.expires_at;
    const newExp = new Date(Date.parse(oldExp) + add * 1000).toISOString();
    const r = await q(`UPDATE sessions SET expires_at=? WHERE session_id=? AND status='active' AND expires_at=?`, [newExp, id, oldExp]);
    if (!r.rowsAffected) return json({ error: "Session changed; reload and try again." }, 409);
    await logEvent({ session_id: id, participant_id: s.participant_id, type: "deadline_adjusted", details: { old_expires_at: oldExp, new_expires_at: newExp, add_seconds: add, reason }, admin });
    await lazyExpire(await getSession(s.participant_id));
    return json(await load(id));
  }

  return json({ error: "Unknown action" }, 400);
});
