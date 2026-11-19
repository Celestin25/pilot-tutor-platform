import { withParticipant } from "@/lib/papi";
import { runData } from "@/lib/run";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ p, run }) => {
    if (!run || run.status !== "ended") return json({ error: "The study has not ended yet." }, 409);
    const d = runData(run);
    if (!d.end_url) return json({ error: "No link configured." }, 404);
    await q(`UPDATE runs SET end_link_opened_at=COALESCE(end_link_opened_at, ?) WHERE participant_id=?`, [nowIso(), p.participant_id]);
    await logEvent({ participant_id: p.participant_id, type: "end_link_opened" });
    const u = new URL(d.end_url);
    u.searchParams.set(d.id_param_name || "pid", p.participant_id);
    return json({ url: u.toString() });
  });
}
