import { withParticipant, currentStep } from "@/lib/papi";
import { runData, startChat, participantState } from "@/lib/run";
import { json } from "@/lib/util";

export const dynamic = "force-dynamic";

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    if (!run || run.status !== "active") return json({ error: "not_active", state: await participantState(p, run) }, 409);
    const step = currentStep(run, runData(run));
    if (body.step_key !== step.key || !step.page.items.some((i) => i.type === "chat")) return json({ error: "stale", state: await participantState(p, run) }, 409);
    await startChat(run, step);
    return json(await participantState(p, run));
  });
}
