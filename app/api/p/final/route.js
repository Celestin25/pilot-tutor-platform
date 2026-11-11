import { withParticipant } from "@/lib/papi";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

// Records that the link was OPENED (not that the external assessment was completed) and returns the URL.
export async function POST(req) {
  return withParticipant(req, async ({ p, s }) => {
    if (!s || s.status !== "ended") return json({ error: "The task has not ended yet." }, 409);
    await q(
      `UPDATE sessions SET final_assessment_link_opened=1, final_assessment_link_opened_at=COALESCE(final_assessment_link_opened_at, ?) WHERE session_id=?`,
      [nowIso(), s.session_id]
    );
    await logEvent({ session_id: s.session_id, participant_id: p.participant_id, type: "final_link_opened" });
    const u = new URL(s.final_assessment_url);
    u.searchParams.set(s.id_param_name || "pid", p.participant_id);
    return json({ url: u.toString() });
  });
}
