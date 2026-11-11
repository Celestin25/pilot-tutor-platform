import { findParticipant, getSession, lazyExpire } from "./session";
import { json, logEvent } from "./util";

/** Resolve participant from request body; every participant request is validated against its own code. */
export async function withParticipant(req, fn) {
  try {
    const body = await req.json().catch(() => ({}));
    const p = await findParticipant(body.code);
    if (!p) {
      await logEvent({ type: "access_denied", details: { reason: "unknown_code" } });
      return json({ phase: "invalid", error: "This access code is not valid. Please check it or ask a researcher." }, 404);
    }
    let s = await getSession(p.participant_id);
    s = await lazyExpire(s);
    return await fn({ body, p, s });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Server error. Please tell a researcher." }, 500);
  }
}
