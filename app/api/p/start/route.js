import { withParticipant } from "@/lib/papi";
import { ensureSession, startSession, participantState } from "@/lib/session";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ p, s }) => {
    if (p.access_status !== "ready") return json(await participantState(p, s), 403);
    if (!s) s = await ensureSession(p);
    if (s.status === "ready") s = await startSession(s);
    return json(await participantState(p, s));
  });
}
