import { withParticipant } from "@/lib/papi";
import { ensureRun, startRun, participantState } from "@/lib/run";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ p, run }) => {
    if (p.access_status !== "ready") return json(await participantState(p, run), 403);
    if (!run) run = await ensureRun(p);
    if (run.status === "ready") run = await startRun(run);
    return json(await participantState(p, run));
  });
}
