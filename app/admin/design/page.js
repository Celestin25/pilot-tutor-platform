"use client";
import { useEffect, useMemo, useState } from "react";
import AdminShell, { aapi, fmtTime } from "@/components/AdminShell";
import { normalizeFlow, estimateSeconds, pageSeconds } from "@/lib/flow";

export default function Page() {
  return <AdminShell><Design /></AdminShell>;
}

const TYPE_LABEL = { info: "Information text", slider: "Slider", mc: "Multiple choice", text: "Text answer", chat: "Tutor chat" };
const NEW_ITEM = {
  info: () => ({ type: "info", text: "" }),
  slider: () => ({ type: "slider", text: "", min: 0, max: 10, start: 5, step: 1, left_label: "", right_label: "", required: true }),
  mc: () => ({ type: "mc", text: "", options: ["Option 1", "Option 2"], multiple: false, required: true }),
  text: () => ({ type: "text", text: "", multiline: false, required: true }),
  chat: () => ({ type: "chat", text: "Chat with the tutor about the topic.", duration_seconds: 240, tutor_task: "" }),
};
const SECTIONS = [
  ["start", "1. Start", "Shown once, before the tasks. Keep it short: instructions only."],
  ["per_condition", "2. Task block (repeated for each condition)", "Shown once per condition, in the participant's condition order. Put the chat and the questions about it here."],
  ["end", "3. End", "Shown once, after all tasks. Put demographic questions here."],
];
const mins = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
let uidc = 0;
const newId = (p) => `${p}_${Date.now().toString(36)}${(uidc++).toString(36)}`;

function Design() {
  const [cfg, setCfg] = useState(null);
  const [flow, setFlow] = useState(null);
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  async function load() {
    const { data } = await aapi("/api/admin/settings");
    setCfg(data.config);
    setFlow(normalizeFlow(data.config.flow_json).flow);
    setDirty(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const check = useMemo(() => (flow ? normalizeFlow(flow) : { errors: [] }), [flow]);
  const est = useMemo(() => (check.flow ? estimateSeconds(check.flow) : 0), [check]);
  if (!flow) return <p className="muted">Loading...</p>;

  const update = (fn) => { setFlow((f) => { const n = structuredClone(f); fn(n); return n; }); setDirty(true); setMsg(""); };

  async function save() {
    if (check.errors.length) { setMsg("Please fix the problems listed at the top first."); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (!confirm("Save the study design as a new version? Participants who already opened their link keep their version; new participants get this one.")) return;
    const { status, data } = await aapi("/api/admin/settings", { ...cfg, flow_json: JSON.stringify(check.flow) });
    if (status === 200) { setMsg(`Saved as ${data.prompt_version}.`); await load(); setMsg(`Saved as ${data.prompt_version}. New participants will get this design.`); }
    else setMsg(data.error || "Save failed");
  }

  const conds = flow.conditions;
  return (
    <>
      <p className="eyebrow">Study builder</p>
      <h1 className="title">Study design</h1>
      <hr className="rule" />
      <p className="muted">Build what participants see: pages of questions (sliders, multiple choice, text) and tutor chats. The task block is repeated once for every condition. Current version: <b>{cfg.prompt_version}</b> (saved {fmtTime(cfg.created_at)} by {cfg.created_by}).</p>

      <div className="stats">
        <div className="stat" style={{ borderLeftColor: est > 1200 ? "var(--red)" : "var(--navy)" }}><b style={{ color: est > 1200 ? "var(--red)" : undefined }}>{mins(est)}</b>estimated total time {est > 1200 ? "(over 20 min)" : "(target: 20 min or less)"}</div>
        <div className="stat"><b>{conds.length}</b>conditions</div>
        <div className="stat"><b>{(flow.sections.start.length + flow.sections.per_condition.length * conds.length + flow.sections.end.length)}</b>pages per participant</div>
      </div>
      <p className="small muted" style={{ marginTop: -10 }}>Estimate: chat time as set, about 8 s per slider or multiple-choice question, 20 s per text answer, 15 s per information text.</p>
      {check.errors.length > 0 && <div className="error" style={{ marginBottom: 18 }}><b>Fix before saving:</b><ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

      <div className="panel">
        <h3>Conditions</h3>
        <p className="small muted" style={{ marginTop: -6 }}>Every participant does the task block once in each condition. The language rule and opening message are given to the tutor in that condition.</p>
        <label style={{ marginTop: 0 }}>Condition order</label>
        <select style={{ maxWidth: 520 }} value={flow.order_mode} onChange={(e) => update((f) => { f.order_mode = e.target.value; })}>
          <option value="counterbalanced">Counterbalanced: all possible orders used equally (recommended)</option>
          <option value="fixed">Fixed: everyone gets the order listed below</option>
        </select>
        {conds.map((c, ci) => (
          <div key={ci} className="q-card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <div style={{ width: 120 }}><label>ID</label><input value={c.id} onChange={(e) => update((f) => { f.conditions[ci].id = e.target.value; })} /></div>
                <div style={{ width: 300 }}><label>Name</label><input value={c.label} onChange={(e) => update((f) => { f.conditions[ci].label = e.target.value; })} /></div>
              </div>
              <div className="row">
                <button className="secondary small" disabled={ci === 0} onClick={() => update((f) => { const x = f.conditions.splice(ci, 1)[0]; f.conditions.splice(ci - 1, 0, x); })}>Up</button>
                <button className="danger small" disabled={conds.length <= 1} onClick={() => confirm(`Remove condition ${c.id}?`) && update((f) => { f.conditions.splice(ci, 1); })}>Remove</button>
              </div>
            </div>
            <label>Tutor language rule</label>
            <textarea rows={3} value={c.tutor_instruction || ""} onChange={(e) => update((f) => { f.conditions[ci].tutor_instruction = e.target.value; })} />
            <label>Tutor opening message</label>
            <textarea rows={2} value={c.opening_message || ""} onChange={(e) => update((f) => { f.conditions[ci].opening_message = e.target.value; })} />
          </div>
        ))}
        <div style={{ marginTop: 12 }}><button className="secondary small" onClick={() => update((f) => { f.conditions.push({ id: `C${f.conditions.length + 1}`, label: "New condition", tutor_instruction: "", opening_message: "" }); })}>Add condition</button></div>
      </div>

      {SECTIONS.map(([sec, title, help]) => (
        <div className="panel" key={sec}>
          <h3>{title}</h3>
          <p className="small muted" style={{ marginTop: -6 }}>{help} {sec === "per_condition" && `Time per block: ${mins(flow.sections.per_condition.reduce((t, p) => t + pageSeconds(p), 0))}, repeated ${conds.length} times.`}</p>
          {flow.sections[sec].map((page, pi) => (
            <PageEditor key={pi} sec={sec} page={page} pi={pi} count={flow.sections[sec].length} conds={conds} update={update} />
          ))}
          <button className="secondary small" style={{ marginTop: 10 }} onClick={() => update((f) => { f.sections[sec].push({ id: newId("page"), items: [NEW_ITEM.info()] }); })}>Add page</button>
        </div>
      ))}

      <div className="panel">
        <h3>End of study</h3>
        <label>Thank-you message</label>
        <textarea rows={3} value={flow.end_message} onChange={(e) => update((f) => { f.end_message = e.target.value; })} />
        <label>Optional link at the end (for example credit or payment form; leave empty for none)</label>
        <input value={flow.end_url || ""} placeholder="https://..." onChange={(e) => update((f) => { f.end_url = e.target.value; })} />
      </div>

      <div className="row savebar">
        <button onClick={save}>Save new version</button>
        <button className="secondary" onClick={() => !dirty || confirm("Discard unsaved changes?") ? load() : null}>Discard changes</button>
        {dirty && <span className="small" style={{ color: "var(--amber)" }}>Unsaved changes</span>}
        {msg && <span>{msg}</span>}
      </div>
    </>
  );
}

function PageEditor({ sec, page, pi, count, conds, update }) {
  const [addType, setAddType] = useState("slider");
  const P = (fn) => update((f) => fn(f.sections[sec][pi], f));
  return (
    <div className="q-card" style={{ marginTop: 14, borderLeft: "4px solid var(--brand)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <b className="serif" style={{ fontSize: 18 }}>Page {pi + 1}</b>
          <input style={{ width: 200 }} value={page.id} title="Page ID (used in exports)" onChange={(e) => P((p) => { p.id = e.target.value; })} />
          <span className="small muted">about {Math.round(pageSeconds(page))} s</span>
        </div>
        <div className="row">
          <button className="secondary small" disabled={pi === 0} onClick={() => update((f) => { const a = f.sections[sec]; a.splice(pi - 1, 0, a.splice(pi, 1)[0]); })}>Up</button>
          <button className="secondary small" disabled={pi === count - 1} onClick={() => update((f) => { const a = f.sections[sec]; a.splice(pi + 1, 0, a.splice(pi, 1)[0]); })}>Down</button>
          <button className="danger small" onClick={() => confirm("Delete this page and its questions?") && update((f) => { f.sections[sec].splice(pi, 1); })}>Delete page</button>
        </div>
      </div>
      {page.items.map((it, ii) => (
        <ItemEditor key={ii} it={it} ii={ii} n={page.items.length} conds={conds} sec={sec}
          set={(fn) => P((p) => fn(p.items[ii]))}
          move={(d) => P((p) => { p.items.splice(ii + d, 0, p.items.splice(ii, 1)[0]); })}
          remove={() => P((p) => { p.items.splice(ii, 1); })} />
      ))}
      <div className="row" style={{ marginTop: 12 }}>
        <select style={{ width: 200 }} value={addType} onChange={(e) => setAddType(e.target.value)}>
          {Object.entries(TYPE_LABEL).filter(([t]) => t !== "chat" || sec === "per_condition").map(([t, l]) => <option key={t} value={t}>{l}</option>)}
        </select>
        <button className="small" onClick={() => P((p) => { p.items.push({ id: newId(addType), ...NEW_ITEM[addType]() }); })}>Add question</button>
      </div>
    </div>
  );
}

function ItemEditor({ it, ii, n, conds, sec, set, move, remove }) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className="pill ready">{TYPE_LABEL[it.type]}</span>
          <input style={{ width: 190 }} value={it.id} title="Question ID (column name in exports)" onChange={(e) => set((x) => { x.id = e.target.value; })} />
          {!["info", "chat"].includes(it.type) && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}><input type="checkbox" style={{ width: "auto" }} checked={it.required !== false} onChange={(e) => set((x) => { x.required = e.target.checked; })} /> Required</label>
          )}
        </div>
        <div className="row">
          <button className="secondary small" disabled={ii === 0} onClick={() => move(-1)}>Up</button>
          <button className="secondary small" disabled={ii === n - 1} onClick={() => move(1)}>Down</button>
          <button className="danger small" onClick={remove}>Remove</button>
        </div>
      </div>
      <VariantText label={it.type === "info" ? "Text" : it.type === "chat" ? "Instructions shown to the participant" : "Question"} value={it.text} conds={conds} canVary={sec === "per_condition"}
                   onChange={(v) => set((x) => { x.text = v; })} rows={it.type === "info" ? 4 : 2} />
      {it.type === "slider" && (
        <>
          <div className="row">
            {[["min", "Minimum"], ["max", "Maximum"], ["start", "Dot starts at"], ["step", "Step"]].map(([k, l]) => (
              <div key={k} style={{ width: 110 }}><label>{l}</label><input type="number" value={it[k]} onChange={(e) => set((x) => { x[k] = e.target.value === "" ? "" : Number(e.target.value); })} /></div>
            ))}
            <button className="secondary small" style={{ marginTop: 34 }} onClick={() => set((x) => { x.start = (Number(x.min) + Number(x.max)) / 2; })}>Start in the middle</button>
          </div>
          <div className="row">
            <div style={{ flex: "1 1 220px" }}><label>Left label</label><input value={typeof it.left_label === "string" ? it.left_label : it.left_label?.all || ""} onChange={(e) => set((x) => { x.left_label = e.target.value; })} /></div>
            <div style={{ flex: "1 1 220px" }}><label>Right label</label><input value={typeof it.right_label === "string" ? it.right_label : it.right_label?.all || ""} onChange={(e) => set((x) => { x.right_label = e.target.value; })} /></div>
          </div>
        </>
      )}
      {it.type === "mc" && (
        <>
          <label>Options (one per line)</label>
          <textarea rows={Math.max(3, (it.options || []).length + 1)} value={(it.options || []).join("\n")} onChange={(e) => set((x) => { x.options = e.target.value.split("\n"); })} />
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={!!it.multiple} onChange={(e) => set((x) => { x.multiple = e.target.checked; })} /> Allow more than one answer</label>
        </>
      )}
      {it.type === "text" && (
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" style={{ width: "auto" }} checked={!!it.multiline} onChange={(e) => set((x) => { x.multiline = e.target.checked; })} /> Long answer (several lines)</label>
      )}
      {it.type === "chat" && (
        <>
          <div className="row">
            <div style={{ width: 160 }}><label>Chat length (minutes)</label><input type="number" min={0.5} step={0.5} value={Number(it.duration_seconds) / 60} onChange={(e) => set((x) => { x.duration_seconds = Math.round(Number(e.target.value) * 60); })} /></div>
          </div>
          <VariantText label="Task for the tutor (topic, goals). Use a different topic per condition so learning in one part does not carry over." value={it.tutor_task} conds={conds} canVary onChange={(v) => set((x) => { x.tutor_task = v; })} rows={2} />
        </>
      )}
    </div>
  );
}

/** A text field that can be the same for all conditions, or different per condition. */
function VariantText({ label, value, conds, onChange, rows = 2, canVary }) {
  const varied = value && typeof value === "object";
  const all = varied ? value.all || "" : value || "";
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <label>{label}</label>
        {canVary && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={!!varied}
                   onChange={(e) => onChange(e.target.checked ? { all, by: Object.fromEntries(conds.map((c) => [c.id, all])) } : all)} />
            Different text per condition
          </label>
        )}
      </div>
      {!varied ? <textarea rows={rows} value={all} onChange={(e) => onChange(e.target.value)} />
        : conds.map((c) => (
          <div key={c.id} style={{ marginTop: 6 }}>
            <span className="small" style={{ fontWeight: 700, color: "var(--brand)" }}>{c.id}: {c.label}</span>
            <textarea rows={rows} value={value.by?.[c.id] ?? ""} onChange={(e) => onChange({ ...value, by: { ...(value.by || {}), [c.id]: e.target.value } })} />
          </div>
        ))}
    </div>
  );
}
