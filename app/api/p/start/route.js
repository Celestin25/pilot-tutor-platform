import { withParticipant } from "@/lib/papi";
import { ensureSession, startSession, participantState } from "@/lib/session";
import { json } from "@/lib/util";
import { activeConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ p, s }) => {
    if (p.access_status !== "ready") return json(await participantState(p, s), 403);
    const cfg = await activeConfig();
    if (cfg.pretest_url && Number(cfg.pretest_required) && !p.pretest_opened_at && (!s || s.status === "ready")) {
      return json({ ...(await participantState(p, s, cfg)), error: "Please open the pre-test first." }, 403);
    }
    if (!s) s = await ensureSession(p);
    if (s.status === "ready") s = await startSession(s);
    return json(await participantState(p, s));
  });
}
