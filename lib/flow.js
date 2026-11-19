// Study flow (Qualtrics-like): an ordered list of elements.
//   { type: "block", id, name, condition: null | "L1" | ..., pages: [...] }
//   { type: "group", id, name, order: "counterbalanced" | "fixed", blocks: [block, ...] }
// A block linked to a condition runs its chats in that condition's language. A group shows its blocks
// in an order that is balanced across participants (every possible order used equally), or as listed.
// Page: { id, time_limit_seconds?, items: [...] }. Item types: info, slider, mc, text, chat.

export const ITEM_TYPES = ["info", "slider", "mc", "text", "chat"];
export const SECONDS_PER = { info: 15, slider: 8, mc: 8, text: 20 };

const COND = [
  { id: "L1", label: "English only",
    tutor_instruction: "LANGUAGE RULE: Write every reply entirely in English. Do not use French. If the learner writes in another language, reply in English and gently remind them to write in English.",
    opening_message: "Hello! I'm your tutor for this part. Let's work on the topic together. To start, what do you already know about it?" },
  { id: "L2", label: "French only",
    tutor_instruction: "RÈGLE DE LANGUE : Rédigez chaque réponse entièrement en français. N'utilisez pas l'anglais. Si l'apprenant écrit dans une autre langue, répondez en français et rappelez-lui gentiment d'écrire en français.",
    opening_message: "Bonjour ! Je suis votre tuteur pour cette partie. Travaillons ensemble sur le sujet. Pour commencer, que savez-vous déjà à ce sujet ?" },
  { id: "MIX", label: "English and French (mixed)",
    tutor_instruction: "LANGUAGE RULE (translanguaging): Write each reply by alternating complete sentences in English and French. Each sentence adds new content; do not translate the previous sentence. The learner may write in English, French or both.",
    opening_message: "Hello! I'm your tutor for this part. Aujourd'hui, nous allons travailler ensemble sur le sujet. To start, what do you already know about it? Vous pouvez répondre en anglais ou en français." },
];

function conditionBlock(c, topic, q) {
  return {
    type: "block", id: `task_${c.id}`, name: `Task: ${c.label}`, condition: c.id,
    pages: [
      { id: "chat", items: [{ id: "chat", type: "chat", duration_seconds: 240,
        text: q.chat, tutor_task: topic }] },
      { id: "ratings", items: [
        { id: "understanding", type: "slider", text: q.understanding, min: 0, max: 10, start: 5, step: 1, left_label: q.low, right_label: q.high, required: true },
        { id: "effort", type: "slider", text: q.effort, min: 0, max: 10, start: 5, step: 1, left_label: q.low2, right_label: q.high2, required: true },
      ] },
    ],
  };
}

const EN = { chat: "Chat with the tutor about the topic. Ask questions and explain ideas in your own words. The chat closes automatically when the time is up.",
  understanding: "How well did you understand the tutor's explanations?", effort: "How much mental effort did this part require?",
  low: "Not at all", high: "Completely", low2: "Very little", high2: "Very much" };

export const DEFAULT_FLOW = {
  version: 2,
  conditions: COND,
  elements: [
    { type: "block", id: "intro", name: "Introduction", condition: null, pages: [
      { id: "welcome", items: [{ id: "welcome_text", type: "info", text: "Welcome, and thank you for taking part.\n\nThis study has three short parts. In each part you will chat with an AI tutor for a few minutes and then answer a few quick questions. At the end there are some questions about you.\n\nThe whole study takes about 20 minutes. Please stay focused and answer honestly. There are no right or wrong answers." }] },
    ] },
    { type: "group", id: "tasks", name: "Language conditions", order: "counterbalanced", blocks: [
      conditionBlock(COND[0], "Topic for this part: [REPLACE: topic A]", EN),
      conditionBlock(COND[1], "Sujet de cette partie : [REPLACE: topic B]", { ...EN,
        chat: "Discutez avec le tuteur du sujet. Posez des questions et expliquez les idées avec vos propres mots. La discussion se ferme automatiquement à la fin du temps.",
        understanding: "Dans quelle mesure avez-vous compris les explications du tuteur ?", effort: "Quel effort mental cette partie vous a-t-elle demandé ?",
        low: "Pas du tout", high: "Complètement", low2: "Très peu", high2: "Énormément" }),
      conditionBlock(COND[2], "Topic for this part: [REPLACE: topic C]", EN),
    ] },
    { type: "block", id: "demographics", name: "Demographics", condition: null, pages: [
      { id: "about_you", items: [
        { id: "demo_intro", type: "info", text: "Almost done. A few questions about you." },
        { id: "age", type: "mc", text: "Your age", options: ["18-21", "22-25", "26-30", "31-40", "41 or older", "Prefer not to say"], required: true },
        { id: "gender", type: "mc", text: "Your gender", options: ["Woman", "Man", "Other", "Prefer not to say"], required: true },
        { id: "first_language", type: "text", text: "Your first language(s)", required: true },
        { id: "english_level", type: "slider", text: "How would you rate your English?", min: 0, max: 10, start: 5, step: 1, left_label: "Beginner", right_label: "Native-like", required: true },
        { id: "french_level", type: "slider", text: "How would you rate your French?", min: 0, max: 10, start: 5, step: 1, left_label: "Beginner", right_label: "Native-like", required: true },
      ] },
    ] },
  ],
  end_message: "Thank you! You have completed the study. You can now close this page.",
  end_url: "",
};

export function resolve(field, cond) {
  if (field == null) return "";
  if (typeof field === "string") return field;
  return (cond && field.by && field.by[cond]) || field.all || "";
}

export function pageSeconds(page) {
  const est = (page.items || []).reduce((t, it) => t + (it.type === "chat" ? Number(it.duration_seconds) || 0 : SECONDS_PER[it.type] || 10), 0);
  const lim = Number(page.time_limit_seconds);
  return lim > 0 ? Math.min(lim, est) : est;
}
export const blockSeconds = (b) => (b.pages || []).reduce((t, p) => t + pageSeconds(p), 0);
export function estimateSeconds(flow) {
  return (flow.elements || []).reduce((t, el) => t + (el.type === "group" ? (el.blocks || []).reduce((u, b) => u + blockSeconds(b), 0) : blockSeconds(el)), 0);
}

export function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).forEach((p) => out.push([x, ...p])));
  return out;
}

/** Convert the earlier "sections" format (start / per_condition / end) into elements. */
function fromLegacy(f) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const resolvePage = (p, cond) => ({ ...clone(p), items: (p.items || []).map((it) => {
    const n = { ...clone(it) };
    for (const k of ["text", "tutor_task", "left_label", "right_label"]) if (k in n) n[k] = resolve(n[k], cond);
    return n;
  }) });
  const s = f.sections || {};
  const els = [];
  if ((s.start || []).length) els.push({ type: "block", id: "start", name: "Start", condition: null, pages: s.start.map((p) => resolvePage(p, null)) });
  if ((s.per_condition || []).length) {
    els.push({ type: "group", id: "conditions", name: "Language conditions", order: f.order_mode === "fixed" ? "fixed" : "counterbalanced",
      blocks: (f.conditions || []).map((c) => ({ type: "block", id: `task_${c.id}`, name: `Task: ${c.label || c.id}`, condition: c.id, pages: s.per_condition.map((p) => resolvePage(p, c.id)) })) });
  }
  if ((s.end || []).length) els.push({ type: "block", id: "end", name: "End", condition: null, pages: s.end.map((p) => resolvePage(p, null)) });
  return { version: 2, conditions: f.conditions || [], elements: els, end_message: f.end_message, end_url: f.end_url };
}

const clean = (x) => String(x || "").trim().replace(/[^A-Za-z0-9_]/g, "_");

/** Validate and normalise a flow. Returns { flow, errors }. */
export function normalizeFlow(input) {
  const errors = [];
  let f;
  try { f = typeof input === "string" ? JSON.parse(input) : JSON.parse(JSON.stringify(input)); } catch { return { flow: null, errors: ["Study design is not valid JSON."] }; }
  if (!f.elements && f.sections) f = fromLegacy(f);
  f.version = 2;
  f.conditions = (f.conditions || []).filter(Boolean);
  const condIds = new Set();
  for (const c of f.conditions) {
    c.id = String(c.id || "").trim().replace(/[^A-Za-z0-9_]/g, "");
    if (!c.id) errors.push("Every condition needs an ID (letters and numbers).");
    else if (condIds.has(c.id)) errors.push(`Condition ID ${c.id} is used twice.`);
    condIds.add(c.id);
    c.label = c.label || c.id;
  }
  const blockIds = new Set();
  const itemScope = new Map(); // condition|"" -> Set(item ids)

  const normBlock = (b, where) => {
    b.type = "block";
    b.id = clean(b.id) || `block_${blockIds.size + 1}`;
    if (blockIds.has(b.id)) errors.push(`Block ID "${b.id}" is used twice. Each block needs a unique ID.`);
    blockIds.add(b.id);
    b.name = String(b.name || b.id);
    b.condition = b.condition ? String(b.condition) : null;
    if (b.condition && !condIds.has(b.condition)) errors.push(`Block "${b.name}" uses condition ${b.condition}, which does not exist.`);
    const scopeKey = b.condition || "";
    if (!itemScope.has(scopeKey)) itemScope.set(scopeKey, new Set());
    const scope = itemScope.get(scopeKey);
    const pageIds = new Set();
    b.pages = (b.pages || []).map((p, pi) => {
      p.id = clean(p.id) || `page${pi + 1}`;
      if (pageIds.has(p.id)) errors.push(`Block "${b.name}" has two pages with ID "${p.id}".`);
      pageIds.add(p.id);
      const lim = Number(p.time_limit_seconds);
      p.time_limit_seconds = lim > 0 ? Math.max(5, Math.round(lim)) : null;
      p.items = (p.items || []).map((it, ii) => {
        it.id = clean(it.id) || `${p.id}_q${ii + 1}`;
        if (!ITEM_TYPES.includes(it.type)) errors.push(`Unknown question type "${it.type}" in block "${b.name}".`);
        if (it.type !== "info") {
          if (scope.has(it.id)) errors.push(`Question ID "${it.id}" is used twice${b.condition ? ` in condition ${b.condition}` : " outside the condition blocks"}. IDs become column names in the export, so each must be unique.`);
          scope.add(it.id);
        }
        if (it.type === "slider") {
          it.min = Number.isFinite(Number(it.min)) && it.min !== "" ? Number(it.min) : 0;
          it.max = Number.isFinite(Number(it.max)) && it.max !== "" ? Number(it.max) : 10;
          if (it.max <= it.min) errors.push(`Slider "${it.id}": the maximum must be greater than the minimum.`);
          it.start = Number.isFinite(Number(it.start)) && it.start !== "" ? Number(it.start) : (it.min + it.max) / 2;
          it.step = Number(it.step) > 0 ? Number(it.step) : 1;
          if (it.start < it.min || it.start > it.max) errors.push(`Slider "${it.id}": the starting point must be between the minimum and maximum.`);
        }
        if (it.type === "mc") {
          it.options = (it.options || []).map((o) => String(o).trim()).filter(Boolean);
          if (it.options.length < 2) errors.push(`Multiple choice "${it.id}" needs at least 2 options.`);
        }
        if (it.type === "chat") {
          it.duration_seconds = Math.max(30, Math.min(3600, Number(it.duration_seconds) || 240));
          if (!b.condition) errors.push(`The chat in block "${b.name}" needs the block to be linked to a condition (the condition sets the tutor's language).`);
          if (p.time_limit_seconds) errors.push(`Page "${p.id}" in block "${b.name}" has a chat; set the time with the chat length, not a page time limit.`);
        }
        it.required = it.type === "info" || it.type === "chat" ? false : it.required !== false;
        return it;
      });
      if (p.items.filter((i) => i.type === "chat").length > 1) errors.push(`Page "${p.id}" in block "${b.name}" has more than one chat. Put each chat on its own page.`);
      if (!p.items.length) errors.push(`Page "${p.id}" in block "${b.name}" is empty.`);
      return p;
    });
    if (!b.pages.length) errors.push(`Block "${b.name}" has no pages.`);
    return b;
  };

  f.elements = (f.elements || []).map((el) => {
    if (el.type === "group") {
      el.id = clean(el.id) || "group";
      el.name = String(el.name || "Condition group");
      el.order = el.order === "fixed" ? "fixed" : "counterbalanced";
      el.blocks = (el.blocks || []).map((b) => normBlock(b, "group"));
      if (el.blocks.length < 2) errors.push(`Group "${el.name}" needs at least 2 blocks.`);
      if (el.blocks.length > 5) errors.push(`Group "${el.name}" can have at most 5 blocks.`);
      if (blockIds.has(`group:${el.id}`)) errors.push(`Two groups use the ID "${el.id}".`);
      blockIds.add(`group:${el.id}`);
      return el;
    }
    return normBlock(el, "top");
  });
  if (!f.elements.length) errors.push("The study is empty. Add at least one block.");
  f.end_message = f.end_message || "Thank you! You have completed the study.";
  f.end_url = String(f.end_url || "").trim();
  if (f.end_url) { try { new URL(f.end_url); } catch { errors.push("End link must be a full URL (https://...) or empty."); } }
  return { flow: f, errors };
}

export const groupsOf = (flow) => flow.elements.filter((e) => e.type === "group");

/** Linear list of pages one participant sees. `orders` maps group id -> ordered list of block ids. */
export function expandSteps(flow, orders = {}) {
  const steps = [];
  const pushBlock = (b, group, position) => {
    for (const p of b.pages) steps.push({ key: `${b.id}.${p.id}`, block_id: b.id, block_name: b.name, condition: b.condition, group: group?.id || null, position, page: p });
  };
  for (const el of flow.elements) {
    if (el.type !== "group") { pushBlock(el, null, null); continue; }
    const ids = orders[el.id] || el.blocks.map((b) => b.id);
    ids.forEach((id, i) => { const b = el.blocks.find((x) => x.id === id); if (b) pushBlock(b, el, i + 1); });
  }
  return steps;
}
