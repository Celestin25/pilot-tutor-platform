// LLM call for a fixed model. No automatic fallback model: a fallback would change the experimental condition.

export class LlmError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.kind = kind; // rate_limit | connection | timeout | provider | config
    this.status = status;
  }
}

/** history: [{role:'user'|'assistant', text}] in order (opening message excluded; it lives in the system prompt). */
export async function generate({ provider, model_id, system, history, max_tokens, temperature, signal }) {
  // Merge consecutive same-role turns (e.g. a user retry after a failed reply) so every request is well-formed.
  const msgs = [];
  for (const m of history) {
    const last = msgs[msgs.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.text;
    else msgs.push({ role: m.role, content: m.text });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  if (provider === "mock" || process.env.LLM_MOCK === "1") {
    const delay = Number(process.env.LLM_MOCK_DELAY_MS || 600);
    await new Promise((res, rej) => {
      const t = setTimeout(res, delay);
      signal?.addEventListener("abort", () => { clearTimeout(t); rej(new LlmError("aborted", "timeout")); });
    });
    const lastUser = msgs[msgs.length - 1]?.content || "";
    const fr = system.includes('starting with "FR:"') ? `\nFR: (traduction simulée) Vous avez écrit : « ${lastUser.slice(0, 60)} »` : "";
    return `(mock tutor) You wrote: "${lastUser.slice(0, 80)}". Can you tell me more?${fr}`;
  }

  try {
    if (provider === "openai_compatible") {
      const base = process.env.LLM_BASE_URL;
      const key = process.env.LLM_API_KEY;
      if (!base || !key) throw new LlmError("LLM_BASE_URL / LLM_API_KEY not set", "config");
      const r = await fetch(base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: model_id, max_tokens, temperature, messages: [{ role: "system", content: system }, ...msgs] }),
      });
      if (!r.ok) throw httpErr(r.status, await r.text());
      const j = await r.json();
      return j.choices?.[0]?.message?.content?.trim() || "";
    }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new LlmError("ANTHROPIC_API_KEY not set", "config");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model_id, max_tokens, temperature, system, messages: msgs }),
    });
    if (!r.ok) throw httpErr(r.status, await r.text());
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e?.name === "AbortError" || e?.name === "TimeoutError") throw new LlmError("Request aborted or timed out", "timeout");
    throw new LlmError(String(e?.message || e).slice(0, 300), "connection");
  }
}

function httpErr(status, body) {
  const kind = status === 429 || status === 529 ? "rate_limit" : "provider";
  // keep error details non-secret and short
  return new LlmError(`HTTP ${status}: ${String(body).slice(0, 300)}`, kind, status);
}
