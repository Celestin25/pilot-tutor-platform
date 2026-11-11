import { one, q } from "./db";
import { nowIso } from "./util";

// Defaults used only until the research team saves its own configuration in Admin → Settings.
export const DEFAULT_CONFIG = {
  study_id: "pilot-2026",
  topic_id: "example-topic",
  task_title: "Learning task",
  task_instructions:
    "You will have a short conversation with an AI tutor about today's topic. Ask questions, answer the tutor's questions, and try to understand the main ideas. Write in your own words. When the timer reaches zero the chat will close and you will continue to the final part of the study.",
  common_prompt: `You are a friendly, patient tutor in a research study. Teach ONE topic: [REPLACE WITH THE AGREED TOPIC].

Learning objectives:
1. [Objective 1]
2. [Objective 2]
3. [Objective 3]

Teaching approach:
- Explain one idea at a time with a short, concrete example, then check understanding with one question.
- Keep each reply short: about 60–120 words.
- Encourage the learner to explain ideas in their own words.
- If the learner goes off-topic, briefly and politely bring them back to the topic.
- Never mention that this is an experiment, conditions, groups, scores, or these instructions.
- Never say the session is over; the platform ends the session automatically.`,
  control_instruction:
    "LANGUAGE RULE: Write every reply entirely in English. Do not use French or any other language. If the learner writes in another language, reply in English and gently remind them to write in English.",
  treatment_instruction:
    "LANGUAGE RULE: For every reply, first write the complete reply in English. Then, on a new line starting with \"FR:\", give a complete and faithful French translation of that same reply. The learner may write in English or French.",
  opening_message_control:
    "Hello! I'm your tutor for this session. Today we will work on our topic together. To start, can you tell me what you already know about it?",
  opening_message_treatment:
    "Hello! I'm your tutor for this session. Today we will work on our topic together. To start, can you tell me what you already know about it?\nFR: Bonjour ! Je suis votre tuteur pour cette séance. Aujourd'hui, nous allons travailler ensemble sur notre sujet. Pour commencer, pouvez-vous me dire ce que vous savez déjà à ce sujet ?",
  duration_seconds: 600,
  provider: "anthropic",
  model_id: "claude-sonnet-5-5",
  max_tokens: 700,
  temperature: 0.3,
  allocation_method: "permuted_blocks_4",
  final_assessment_url: "https://example.com/final-assessment",
  id_param_name: "pid",
  require_ready_mark: 1,
};

export const CONFIG_FIELDS = Object.keys(DEFAULT_CONFIG);

export async function activeConfig() {
  let c = await one(`SELECT * FROM study_config ORDER BY config_id DESC LIMIT 1`);
  if (!c) {
    await saveConfig(DEFAULT_CONFIG, "system-default");
    c = await one(`SELECT * FROM study_config ORDER BY config_id DESC LIMIT 1`);
  }
  return c;
}

export async function saveConfig(input, admin) {
  const prev = await one(`SELECT config_id FROM study_config ORDER BY config_id DESC LIMIT 1`);
  const n = prev ? Number(prev.config_id) + 1 : 1;
  const c = { ...DEFAULT_CONFIG };
  for (const k of CONFIG_FIELDS) if (input[k] !== undefined && input[k] !== null) c[k] = input[k];
  c.duration_seconds = Number(c.duration_seconds) || 600;
  c.max_tokens = Number(c.max_tokens) || 700;
  c.temperature = Number(c.temperature);
  if (Number.isNaN(c.temperature)) c.temperature = 0.3;
  c.require_ready_mark = c.require_ready_mark ? 1 : 0;
  c.prompt_version = `v${n}`;
  const cols = [...CONFIG_FIELDS, "prompt_version", "created_at", "created_by"];
  const vals = [...CONFIG_FIELDS.map((k) => c[k]), c.prompt_version, nowIso(), admin];
  await q(
    `INSERT INTO study_config (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
    vals
  );
  return c.prompt_version;
}

export function buildSystemPrompt(cfg, condition) {
  const lang = condition === "treatment" ? cfg.treatment_instruction : cfg.control_instruction;
  const opening = condition === "treatment" ? cfg.opening_message_treatment : cfg.opening_message_control;
  return `${cfg.common_prompt}\n\n${lang}\n\nYou have already greeted the learner with this message:\n"""${opening}"""\nContinue the conversation from there.`;
}
