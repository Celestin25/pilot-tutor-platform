import { adminRoute } from "@/lib/auth";
import { db, one, all, q } from "@/lib/db";
import { ensureAllocationCapacity, getSession, endSession } from "@/lib/session";
import { json, logEvent, newAccessCode, tokenHash, nowIso, normalizeCode } from "@/lib/util";

export const dynamic = "force-dynamic";

export const POST = adminRoute(async (req, _ctx, admin) => {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];

  if (body.action === "generate") {
    const isTest = body.is_test ? 1 : 0;
    const label = String(body.label || "").slice(0, 60) || null;
    let custom = String(body.custom_ids || "")
      .split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const count = custom.length ? custom.length : Math.min(500, Math.max(1, Number(body.count) || 0));
    if (!custom.length) {
      const prefix = isTest ? "T" : "P";
      const existing = await all(`SELECT participant_id FROM participants WHERE participant_id LIKE ?`, [prefix + "%"]);
      let max = 0;
      for (const r of existing) { const n = parseInt(String(r.participant_id).slice(1), 10); if (n > max) max = n; }
      custom = Array.from({ length: count }, (_, i) => prefix + String(max + i + 1).padStart(3, "0"));
    }
    for (const id of custom) if (!/^[A-Za-z0-9_.-]{1,40}$/.test(id)) return json({ error: `Invalid participant ID: ${id}` }, 400);
    const dup = await all(`SELECT participant_id FROM participants WHERE participant_id IN (${custom.map(() => "?").join(",")})`, custom);
    if (dup.length) return json({ error: "These IDs already exist: " + dup.map((d) => d.participant_id).join(", ") }, 400);

    const now = nowIso();
    const created = [];
    const stmts = custom.map((pid) => {
      const code = newAccessCode();
      created.push({ participant_id: pid, access_code: code });
      return {
        sql: `INSERT INTO participants (participant_id, token_hash, access_code, access_status, is_test, batch_label, created_at) VALUES (?,?,?,?,?,?,?)`,
        args: [pid, tokenHash(code), code, "pending", isTest, label, now],
      };
    });
    const c = await db();
    await c.batch(stmts, "write");
    const unstarted = await one(`SELECT COUNT(*) AS n FROM participants p WHERE is_test=? AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.participant_id=p.participant_id)`, [isTest]);
    await ensureAllocationCapacity(isTest ? "test" : "main", Number(unstarted.n) + 4);
    await logEvent({ type: "invitations_created", details: { count: created.length, is_test: isTest, label }, admin });
    return json({ created });
  }

  if (!ids.length) return json({ error: "No participants selected." }, 400);

  if (body.action === "ready") {
    const method = String(body.method || "researcher_marked_ready").slice(0, 60);
    let n = 0;
    for (const id of ids) {
      const r = await q(
        `UPDATE participants SET access_status='ready', preliminary_stage_verified_at=?, verification_method=?, verified_by=? WHERE participant_id=? AND access_status='pending'`,
        [nowIso(), method, admin, id]
      );
      if (r.rowsAffected) { n++; await logEvent({ participant_id: id, type: "marked_ready", details: { method }, admin }); }
    }
    return json({ updated: n });
  }

  if (body.action === "block") {
    const reason = String(body.reason || "").slice(0, 300);
    for (const id of ids) {
      await q(`UPDATE participants SET access_status='blocked' WHERE participant_id=?`, [id]);
      const s = await getSession(id);
      if (s && (s.status === "active" || s.status === "ready")) await endSession(s, "withdrawn", admin, reason);
      await logEvent({ participant_id: id, session_id: s?.session_id || null, type: "participant_blocked", details: { reason }, admin });
    }
    return json({ ok: true });
  }

  if (body.action === "unblock") {
    for (const id of ids) {
      const p = await one(`SELECT preliminary_stage_verified_at FROM participants WHERE participant_id=?`, [id]);
      await q(`UPDATE participants SET access_status=? WHERE participant_id=? AND access_status='blocked'`, [p?.preliminary_stage_verified_at ? "ready" : "pending", id]);
      await logEvent({ participant_id: id, type: "participant_unblocked", admin });
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
});
