import { withParticipant } from "@/lib/papi";
import { activeConfig } from "@/lib/config";
import { ensureSession, participantState } from "@/lib/session";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ body, p, s }) => {
    const cfg = await activeConfig();
    if (p.access_status === "pending" && !Number(cfg.require_ready_mark)) {
      await q(`UPDATE participants SET access_status='ready', preliminary_stage_verified_at=?, verification_method='not_required' WHERE participant_id=? AND access_status='pending'`, [nowIso(), p.participant_id]);
      p.access_status = "ready";
    }
    if (!s && p.access_status === "ready") s = await ensureSession(p);
    if (body.reconnect && s && s.status === "active") {
      await logEvent({ session_id: s.session_id, participant_id: p.participant_id, type: "reconnect", details: { remaining_ms: Date.parse(s.expires_at) - Date.now() } });
    }
    if (body.reconnect && p.access_status === "pending" && !s) {
      await logEvent({ participant_id: p.participant_id, type: "entry_waiting_for_approval" });
    }
    return json(await participantState(p, s, cfg));
  });
}
