// Study flow: a Qualtrics-like structure of sections > pages > items, repeated once per language condition.
//
// A "text-like" field can be a plain string (same for all conditions) or
// { all: "...", by: { L1: "...", L2: "...", MIX: "..." } } (different per condition).

export const ITEM_TYPES = ["info", "slider", "mc", "text", "chat"];

export const DEFAULT_FLOW = {
  conditions: [
    { id: "L1", label: "English only",
      tutor_instruction: "LANGUAGE RULE: Write every reply entirely in English. Do not use French. If the learner writes in another language, reply in English and gently remind them to write in English.",
      opening_message: "Hello! I'm your tutor for this part. Let's work on the topic together. To start, what do you already know about it?" },
    { id: "L2", label: "French only",
      tutor_instruction: "RÈGLE DE LANGUE : Rédigez chaque réponse entièrement en français. N'utilisez pas l'anglais. Si l'apprenant écrit dans une autre langue, répondez en français et rappelez-lui gentiment d'écrire en français.",
      opening_message: "Bonjour ! Je suis votre tuteur pour cette partie. Travaillons ensemble sur le sujet. Pour commencer, que savez-vous déjà à ce sujet ?" },
    { id: "MIX", label: "English and French (mixed)",
      tutor_instruction: "LANGUAGE RULE (translanguaging): Write each reply by alternating complete sentences in English and French. Each sentence adds new content; do not translate the previous sentence. The learner may write in English, French or both.",
      opening_message: "Hello! I'm your tutor for this part. Aujourd'hui, nous allons travailler ensemble sur le sujet. To start, what do you already know about it? Vous pouvez répondre en anglais ou en français." },
  ],
  order_mode: "counterbalanced", // or "fixed"
  sections: {
    start: [
      { id: "welcome", items: [
        { id: "welcome_text", type: "info", text: "Welcome, and thank you for taking part.\n\nThis study has three short parts. In each part you will chat with an AI tutor for a few minutes and then answer a few quick questions. At the end there are some questions about you.\n\nThe whole study takes about 20 minutes. Please stay focused and answer honestly. There are no right or wrong answers in the questions." },
      ] },
    ],
    per_condition: [
      { id: "task", items: [
        { id: "task_chat", type: "chat", duration_seconds: 240,
          text: "Chat with the tutor about the topic below. Ask questions and explain ideas in your own words. The chat closes automatically when the time is up.",
          tutor_task: { all: "", by: { L1: "Topic for this part: [REPLACE: topic A]", L2: "Sujet de cette partie : [REPLACE: topic B]", MIX: "Topic for this part: [REPLACE: topic C]" } } },
      ] },
      { id: "ratings", items: [
        { id: "understanding", type: "slider", text: "How well did you understand the tutor's explanations?", min: 0, max: 10, start: 5, left_label: "Not at all", right_label: "Completely", required: true },
        { id: "effort", type: "slider", text: "How much mental effort did this part require?", min: 0, max: 10, start: 5, left_label: "Very little", right_label: "Very much", required: true },
        { id: "confidence", type: "slider", text: "How confident do you feel about this topic now?", min: 0, max: 10, start: 5, left_label: "Not confident", right_label: "Very confident", required: true },
        { id: "language_used", type: "mc", text: "Which language did you mostly write in?", options: ["English", "French", "Both"], required: true },
      ] },
    ],
    end: [
      { id: "demographics", items: [
        { id: "demo_intro", type: "info", text: "Almost done. A few questions about you." },
        { id: "age", type: "mc", text: "Your age", options: ["18-21", "22-25", "26-30", "31-40", "41 or older", "Prefer not to say"], required: true },
        { id: "gender", type: "mc", text: "Your gender", options: ["Woman", "Man", "Other", "Prefer not to say"], required: true },
        { id: "first_language", type: "text", text: "Your first language(s)", required: true },
        { id: "english_level", type: "slider", text: "How would you rate your English?", min: 0, max: 10, start: 5, left_label: "Beginner", right_label: "Native-like", required: true },
        { id: "french_level", type: "slider", text: "How would you rate your French?", min: 0, max: 10, start: 5, left_label: "Beginner", right_label: "Native-like", required: true },
      ] },
    ],
  },
  end_message: "Thank you! You have completed the study. You can now close this page.",
  end_url: "",
};

export const SECONDS_PER = { info: 15, slider: 8, mc: 8, text: 20 };

export function resolve(field, cond) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  return (cond && field.by && field.by[cond]) || field.all || "";
}

export function pageSeconds(page) {
  return (page.items || []).reduce((t, it) => t + (it.type === "chat" ? Number(it.duration_seconds) || 0 : SECONDS_PER[it.type] || 10), 0);
}

export function estimateSeconds(flow) {
  const s = flow.sections || {};
  const sum = (pages) => (pages || []).reduce((t, p) => t + pageSeconds(p), 0);
  return sum(s.start) + sum(s.per_condition) * (flow.conditions || []).length + sum(s.end);
}

export function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach((p) => out.push([x, ...p])));
  return out;
}

/** Validate and normalise a flow. Returns { flow, errors }. */
export function normalizeFlow(input) {
  const errors = [];
  let f;
  try { f = typeof input === "string" ? JSON.parse(input) : JSON.parse(JSON.stringify(input)); } catch { return { flow: null, errors: ["Flow is not valid JSON."] }; }
  f.conditions = (f.conditions || []).filter((c) => c && c.id);
  if (f.conditions.length < 1) errors.push("Add at least one condition.");
  const condIds = new Set();
  for (const c of f.conditions) {
    c.id = String(c.id).trim().replace(/[^A-Za-z0-9_]/g, "");
    if (!c.id) errors.push("Every condition needs an ID (letters and numbers).");
    if (condIds.has(c.id)) errors.push(`Condition ID ${c.id} is used twice.`);
    condIds.add(c.id);
    c.label = c.label || c.id;
  }
  f.order_mode = f.order_mode === "fixed" ? "fixed" : "counterbalanced";
  f.sections = f.sections || {};
  const ids = new Set();
  for (const sec of ["start", "per_condition", "end"]) {
    f.sections[sec] = (f.sections[sec] || []).map((p, pi) => {
      p.id = String(p.id || `${sec}_p${pi + 1}`).replace(/[^A-Za-z0-9_]/g, "_");
      p.items = (p.items || []).map((it, ii) => {
        it.id = String(it.id || `${p.id}_q${ii + 1}`).replace(/[^A-Za-z0-9_]/g, "_");
        if (!ITEM_TYPES.includes(it.type)) errors.push(`Unknown item type "${it.type}" in page ${p.id}.`);
        if (ids.has(it.id)) errors.push(`Question ID "${it.id}" is used more than once. Each question needs a unique ID.`);
        ids.add(it.id);
        if (it.type === "slider") {
          it.min = Number.isFinite(Number(it.min)) ? Number(it.min) : 0;
          it.max = Number.isFinite(Number(it.max)) ? Number(it.max) : 10;
          if (it.max <= it.min) errors.push(`Slider "${it.id}": maximum must be greater than minimum.`);
          const mid = (it.min + it.max) / 2;
          it.start = Number.isFinite(Number(it.start)) && it.start !== "" ? Number(it.start) : mid;
          it.step = Number(it.step) > 0 ? Number(it.step) : 1;
        }
        if (it.type === "mc") {
          it.options = (it.options || []).map((o) => String(o).trim()).filter(Boolean);
          if (it.options.length < 2) errors.push(`Multiple choice "${it.id}" needs at least 2 options.`);
        }
        if (it.type === "chat") {
          it.duration_seconds = Math.max(30, Math.min(3600, Number(it.duration_seconds) || 240));
          if (sec !== "per_condition") errors.push(`Chat "${it.id}" must be inside the per-condition block (it uses the condition's language).`);
        }
        it.required = it.type === "info" || it.type === "chat" ? false : it.required !== false;
        return it;
      });
      if (p.items.filter((i) => i.type === "chat").length > 1) errors.push(`Page ${p.id} has more than one chat. Put each chat on its own page.`);
      if (!p.items.length) errors.push(`Page ${p.id} is empty.`);
      return p;
    });
  }
  f.end_message = f.end_message || "Thank you! You have completed the study.";
  f.end_url = String(f.end_url || "").trim();
  if (f.end_url) { try { new URL(f.end_url); } catch { errors.push("End link must be a full URL (https://...) or empty."); } }
  return { flow: f, errors };
}

/** Expand a flow into the linear list of pages one participant sees, for a given condition order. */
export function expandSteps(flow, order) {
  const steps = [];
  for (const p of flow.sections.start || []) steps.push({ key: `start.${p.id}`, section: "start", condition: null, position: null, page: p });
  order.forEach((cond, i) => {
    for (const p of flow.sections.per_condition || []) steps.push({ key: `c${i + 1}.${cond}.${p.id}`, section: "condition", condition: cond, position: i + 1, page: p });
  });
  for (const p of flow.sections.end || []) steps.push({ key: `end.${p.id}`, section: "end", condition: null, position: null, page: p });
  return steps;
}
