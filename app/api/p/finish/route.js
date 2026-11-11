import { withParticipant } from "@/lib/papi";
import { endSession, participantState } from "@/lib/session";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ p, s }) => {
    if (s && s.status === "active") s = await endSession(s, "participant_finished");
    return json(await participantState(p, s));
  });
}
