import { checkPassword, setAdminCookie } from "@/lib/auth";
import { json, logEvent } from "@/lib/util";

export async function POST(req) {
  const { name, password } = await req.json().catch(() => ({}));
  const who = String(name || "").trim().slice(0, 60);
  if (!who) return json({ error: "Enter your name (it is recorded with admin actions)." }, 400);
  if (!checkPassword(password || "")) {
    await logEvent({ type: "admin_login_failed", details: { name: who } });
    return json({ error: "Wrong password." }, 401);
  }
  await setAdminCookie(who);
  await logEvent({ type: "admin_login", admin: who });
  return json({ ok: true, name: who });
}
