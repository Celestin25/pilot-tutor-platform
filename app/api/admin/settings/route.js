import { adminRoute } from "@/lib/auth";
import { activeConfig, saveConfig, CONFIG_FIELDS } from "@/lib/config";
import { all, one } from "@/lib/db";
import { json, logEvent } from "@/lib/util";
import { normalizeFlow, estimateSeconds } from "@/lib/flow";

export const dynamic = "force-dynamic";

export const GET = adminRoute(async (req) => {
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const old = await one(`SELECT * FROM study_config WHERE config_id=?`, [Number(id)]);
    return old ? json({ config: old }) : json({ error: "Not found" }, 404);
  }
  const cfg = await activeConfig();
  const history = await all(`SELECT config_id, prompt_version, created_at, created_by FROM study_config ORDER BY config_id DESC LIMIT 30`);
  const est = estimateSeconds(normalizeFlow(cfg.flow_json).flow);
  return json({ config: cfg, history, estimated_seconds: est, anthropic_key_set: !!process.env.ANTHROPIC_API_KEY, mock: process.env.LLM_MOCK === "1" });
});

export const POST = adminRoute(async (req, _ctx, admin) => {
  const body = await req.json().catch(() => ({}));
  const input = {};
  for (const k of CONFIG_FIELDS) if (k in body) input[k] = body[k];
  if (input.flow_json !== undefined) {
    const { errors } = normalizeFlow(input.flow_json);
    if (errors.length) return json({ error: "Please fix the study design: " + errors.join(" ") }, 400);
  }
  const v = await saveConfig(input, admin);
  await logEvent({ type: "config_saved", details: { prompt_version: v }, admin });
  return json({ ok: true, prompt_version: v });
});
