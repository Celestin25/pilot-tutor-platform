"use client";
import { useEffect, useState } from "react";
import AdminShell, { aapi, fmtTime } from "@/components/AdminShell";

export default function Page() {
  return <AdminShell><Settings /></AdminShell>;
}

const TEXT = [
  ["task_title", "Task title (shown to participants)", 1],
  ["task_instructions", "Task instructions (shown to both groups, keep neutral)", 5],
  ["common_prompt", "Common teaching prompt (same for both groups: topic, objectives, examples, tone, length, off-topic handling)", 16],
  ["control_instruction", "Control language instruction (English only)", 4],
  ["treatment_instruction", "Treatment language instruction (agreed English-French rule)", 5],
  ["opening_message_control", "Opening tutor message: control", 3],
  ["opening_message_treatment", "Opening tutor message: treatment", 4],
];

function Settings() {
  const [cfg, setCfg] = useState(null);
  const [meta, setMeta] = useState({});
  const [msg, setMsg] = useState("");
  async function load() {
    const { data } = await aapi("/api/admin/settings");
    setCfg(data.config); setMeta(data);
  }
  useEffect(() => { load(); }, []);
  if (!cfg) return <p className="muted">Loading...</p>;
  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.type === "checkbox" ? (e.target.checked ? 1 : 0) : e.target.value });

  async function restore(h) {
    const { status, data } = await aapi(`/api/admin/settings?id=${h.config_id}`);
    if (status !== 200) return setMsg(data.error || "Could not load that version.");
    setCfg(data.config);
    setMsg(`Loaded ${h.prompt_version} into the form. Click "Save new version" to make it the active version.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!confirm("Save as a new configuration version? Existing sessions keep the settings they started with; only NEW sessions use this version.")) return;
    const { status, data } = await aapi("/api/admin/settings", { ...cfg, allow_custom_duration: ![600, 900].includes(Number(cfg.duration_seconds)) && confirm("Duration is not 600 or 900 seconds. Allow it (e.g. for a rehearsal)?") });
    setMsg(status === 200 ? `Saved as ${data.prompt_version}.` : data.error || "Failed");
    if (status === 200) load();
  }

  return (
    <>
      <p className="eyebrow">Configuration</p>
      <h1 className="title">Study settings</h1>
      <hr className="rule" />
      {msg && <p className="notice">{msg}</p>}
      <p className="muted">Current version: <b>{meta.config?.prompt_version}</b> (saved {fmtTime(meta.config?.created_at)} by {meta.config?.created_by}). Each save creates a new frozen version; sessions copy their settings when created, so changes never affect sessions already allocated.</p>
      {!meta.anthropic_key_set && cfg.provider === "anthropic" && !meta.mock && <p className="error">ANTHROPIC_API_KEY is not set on the server. The tutor cannot reply until it is added in Vercel (Settings, Environment Variables).</p>}
      {meta.mock && <p className="warn">LLM_MOCK=1 is set: the tutor returns simulated replies (for testing only).</p>}
      <div className="grid2">
        <div className="panel">
          <h3>Study & timing</h3>
          <label>Study ID</label><input value={cfg.study_id} onChange={set("study_id")} />
          <label>Topic ID</label><input value={cfg.topic_id} onChange={set("topic_id")} />
          <label>Session duration (seconds)</label>
          <select value={String(cfg.duration_seconds)} onChange={set("duration_seconds")}>
            <option value="600">600 (10 minutes)</option><option value="900">900 (15 minutes)</option>
            {![600, 900].includes(Number(cfg.duration_seconds)) && <option value={String(cfg.duration_seconds)}>{cfg.duration_seconds} (custom)</option>}
            <option value="120">120 (2 min, rehearsal only)</option>
          </select>
          <label>Allocation method</label><input value={cfg.allocation_method} disabled />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={!!Number(cfg.require_ready_mark)} onChange={set("require_ready_mark")} /> Require a researcher to mark each participant ready before they can start</label>
        </div>
        <div className="panel">
          <h3>Model & final assessment</h3>
          <label>Provider</label>
          <select value={cfg.provider} onChange={set("provider")}>
            <option value="anthropic">anthropic (Claude API)</option>
            <option value="openai_compatible">openai_compatible (e.g. hosted Llama; set LLM_BASE_URL / LLM_API_KEY)</option>
            <option value="mock">mock (testing only)</option>
          </select>
          <label>Model ID (fixed for the whole pilot, no automatic fallback)</label><input value={cfg.model_id} onChange={set("model_id")} />
          <div className="row">
            <div style={{ width: 160 }}><label>Max reply tokens</label><input type="number" value={cfg.max_tokens} onChange={set("max_tokens")} /></div>
            <div style={{ width: 160 }}><label>Temperature (Llama only)</label><input type="number" step="0.1" value={cfg.temperature} onChange={set("temperature")} /></div>
          </div>
          <label>Final assessment URL</label><input value={cfg.final_assessment_url} onChange={set("final_assessment_url")} />
          <label>Participant ID parameter name (agreed with questionnaire team)</label><input value={cfg.id_param_name} onChange={set("id_param_name")} />
          <p className="small muted">Participants are sent to: {cfg.final_assessment_url}{cfg.final_assessment_url.includes("?") ? "&" : "?"}{cfg.id_param_name}=P001</p>
        </div>
      </div>
      <div className="panel">
        <h3>Prompts and participant text</h3>
        {TEXT.map(([k, l, rows]) => (
          <div key={k}><label>{l}</label><textarea rows={rows} value={cfg[k]} onChange={set(k)} /></div>
        ))}
      </div>
      <div className="row savebar">
        <button className="arrow" onClick={save}>Save new version</button>{msg && <span>{msg}</span>}
      </div>
      <div className="panel" style={{ marginTop: 18 }}>
        <h3>Version history</h3>
        <p className="small muted">The newest version is always the active one. To go back to an older version, click Restore, check the form, then click Save new version.</p>
        <table><thead><tr><th>Version</th><th>Saved</th><th>By</th><th></th></tr></thead>
          <tbody>{(meta.history || []).map((h, i) => <tr key={h.config_id}><td>{h.prompt_version}{i === 0 ? <span className="pill active" style={{ marginLeft: 8 }}>active</span> : null}</td><td>{fmtTime(h.created_at)}</td><td>{h.created_by}</td>
            <td>{i === 0 ? "" : <button className="secondary small" onClick={() => restore(h)}>Restore</button>}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
