import { withParticipant } from "@/lib/papi";
import { json, logEvent, nowIso } from "@/lib/util";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["displayed", "connection_lost", "connection_restored", "page_hidden", "page_visible"]);

export async function POST(req) {
  return withParticipant(req, async ({ body, p, run }) => {
    if (!run || !ALLOWED.has(body.type)) return json({ ok: false });
    if (body.type === "displayed" && body.request_id) {
      await q(`UPDATE messages SET displayed_at=? WHERE session_id IN (SELECT chat_id FROM chats WHERE participant_id=?) AND request_id=? AND role='assistant' AND displayed_at IS NULL`, [nowIso(), p.participant_id, String(body.request_id)]);
      return json({ ok: true });
    }
    await logEvent({ participant_id: p.participant_id, type: body.type, details: { client_time: body.client_time || null } });
    return json({ ok: true });
  });
}
