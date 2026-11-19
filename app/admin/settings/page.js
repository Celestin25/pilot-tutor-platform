"use client";
import { useEffect, useState } from "react";
import AdminShell, { aapi, fmtTime } from "@/components/AdminShell";

export default function Page() {
  return <AdminShell><Settings /></AdminShell>;
}

const TEXT = [
  ["common_prompt", "Common teaching prompt (same in every condition: tutor role, tone, reply length, off-topic handling). The language rule and the topic for each part are set in Study design.", 12],
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
    const { status, data } = await aapi("/api/admin/settings", cfg);
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
          <h3>Study and access</h3>
          <label>Study ID</label><input value={cfg.study_id} onChange={set("study_id")} />
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={!!Number(cfg.require_ready_mark)} onChange={set("require_ready_mark")} /> Require a researcher to mark each participant ready before they can start</label>
        </div>
        <div className="panel">
          <h3>Tutor model</h3>
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
          <label>Participant ID parameter name (added to the optional end link)</label><input value={cfg.id_param_name} onChange={set("id_param_name")} />
          <p className="small muted">Chat length, questions and conditions are set on the Study design page.</p>
        </div>
      </div>
      <div className="panel">
        <h3>Tutor prompt</h3>
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
