import { withParticipant, currentStep } from "@/lib/papi";
import { runData, getChat, endChat, participantState } from "@/lib/run";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    if (!run || run.status !== "active") return json(await participantState(p, run));
    const step = currentStep(run, runData(run));
    if (body.step_key === step.key) {
      const chat = await getChat(p.participant_id, step.key);
      if (chat && chat.status === "active") await endChat(chat, "participant_finished");
    }
    return json(await participantState(p, run));
  });
}
