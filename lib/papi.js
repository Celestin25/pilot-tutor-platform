import { findParticipant, getRun } from "./run";
import { json, logEvent } from "./util";

/** Resolve participant + run from the request body; every participant request is checked against its own code. */
export async function withParticipant(req, fn) {
  try {
    const body = await req.json().catch(() => ({}));
    const p = await findParticipant(body.code);
    if (!p) {
      await logEvent({ type: "access_denied", details: { reason: "unknown_code" } });
      return json({ phase: "invalid", error: "This access code is not valid. Please check it or ask a researcher." }, 404);
    }
    const run = await getRun(p.participant_id);
    return await fn({ body, p, run });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Server error. Please tell a researcher." }, 500);
  }
}

export function currentStep(run, data) {
  return data.steps[Number(run.current_step)];
}
