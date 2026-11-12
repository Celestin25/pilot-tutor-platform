import { withParticipant } from "@/lib/papi";
import { activeConfig } from "@/lib/config";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Records that the pre-test link was OPENED (not completed) and returns the URL with the participant ID.
export async function POST(req) {
  return withParticipant(req, async ({ p, s }) => {
    if (p.access_status === "blocked") return json({ error: "Access not available." }, 403);
    const cfg = await activeConfig();
    if (!cfg.pretest_url) return json({ error: "No pre-test is configured." }, 404);
    await q(`UPDATE participants SET pretest_opened_at=COALESCE(pretest_opened_at, ?) WHERE participant_id=?`, [nowIso(), p.participant_id]);
    await logEvent({ session_id: s?.session_id || null, participant_id: p.participant_id, type: "pretest_link_opened" });
    const u = new URL(cfg.pretest_url);
    u.searchParams.set(cfg.id_param_name || "pid", p.participant_id);
    return json({ url: u.toString() });
  });
}
