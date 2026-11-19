import { withParticipant } from "@/lib/papi";
import { activeConfig } from "@/lib/config";
import { ensureRun, participantState } from "@/lib/run";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    const cfg = await activeConfig();
    if (p.access_status === "pending" && !Number(cfg.require_ready_mark)) {
      await q(`UPDATE participants SET access_status='ready', preliminary_stage_verified_at=?, verification_method='not_required' WHERE participant_id=? AND access_status='pending'`, [nowIso(), p.participant_id]);
      p.access_status = "ready";
    }
    if (!run && p.access_status === "ready") run = await ensureRun(p);
    if (body.reconnect && run && run.status === "active") {
      await logEvent({ participant_id: p.participant_id, type: "reconnect", details: { step: Number(run.current_step) } });
    }
    return json(await participantState(p, run));
  });
}
