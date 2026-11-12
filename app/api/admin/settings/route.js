import { adminRoute } from "@/lib/auth";
import { activeConfig, saveConfig, CONFIG_FIELDS } from "@/lib/config";
import { all, one } from "@/lib/db";
import { json, logEvent } from "@/lib/util";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const old = await one(`SELECT * FROM study_config WHERE config_id=?`, [Number(id)]);
    return old ? json({ config: old }) : json({ error: "Not found" }, 404);
  }
  const cfg = await activeConfig();
  const history = await all(`SELECT config_id, prompt_version, created_at, created_by FROM study_config ORDER BY config_id DESC LIMIT 30`);
  return json({ config: cfg, history, anthropic_key_set: !!process.env.ANTHROPIC_API_KEY, mock: process.env.LLM_MOCK === "1" });
});

export const POST = adminRoute(async (req, _ctx, admin) => {
  const body = await req.json().catch(() => ({}));
  const input = {};
  for (const k of CONFIG_FIELDS) if (k in body) input[k] = body[k];
  if (![600, 900].includes(Number(input.duration_seconds))) {
    // brief: choose 600 or 900; allow other values only for rehearsal
    if (!body.allow_custom_duration) return json({ error: "Duration must be 600 or 900 seconds." }, 400);
  }
  try { new URL(input.final_assessment_url); } catch { return json({ error: "Final assessment URL must be a full URL (https://...)." }, 400); }
  if (input.pretest_url) { try { new URL(input.pretest_url); } catch { return json({ error: "Pre-test URL must be a full URL (https://...) or empty." }, 400); } }
  const v = await saveConfig(input, admin);
  await logEvent({ type: "config_saved", details: { prompt_version: v }, admin });
  return json({ ok: true, prompt_version: v });
});
