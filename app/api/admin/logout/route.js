import { clearAdminCookie } from "@/lib/auth";
import { json } from "@/lib/util";
export async function POST() {
  await clearAdminCookie();
  return json({ ok: true });
}
