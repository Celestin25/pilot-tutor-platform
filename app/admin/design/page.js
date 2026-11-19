"use client";
import { useEffect, useMemo, useState } from "react";
import AdminShell, { aapi, fmtTime } from "@/components/AdminShell";
import { normalizeFlow, estimateSeconds, pageSeconds, blockSeconds } from "@/lib/flow";

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
const mins = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
let uidc = 0;
const rnd = () => `${Date.now().toString(36).slice(-4)}${(uidc++).toString(36)}`;
const newBlock = (cond = null, name = "New block") => ({ type: "block", id: `block_${rnd()}`, name, condition: cond, pages: [{ id: "page1", items: [NEW_ITEM.info()] }] });
const copyBlock = (b) => ({ ...structuredClone(b), id: `${b.id}_copy${rnd()}`.slice(0, 40), name: `${b.name} (copy)` });
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; arr.splice(j, 0, arr.splice(i, 1)[0]); };

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
  const conds = flow.conditions;

  async function save() {
    if (check.errors.length) { setMsg("Please fix the problems listed at the top first."); window.scrollTo({ top: 0, behavior: "smooth" }); return false; }
    if (!confirm("Save the study design as a new version? Participants who already opened their link keep their version; new participants get this one.")) return false;
    const { status, data } = await aapi("/api/admin/settings", { ...cfg, flow_json: JSON.stringify(check.flow) });
    if (status !== 200) { setMsg(data.error || "Save failed"); return false; }
    await load();
    setMsg(`Saved as ${data.prompt_version}. New participants will get this design.`);
    return true;
  }

  async function tryIt() {
    if (dirty && !confirm("You have unsaved changes. The test uses the last saved version. Continue anyway?")) return;
    const w = window.open("", "_blank");
    const g = await aapi("/api/admin/participants", { action: "generate", count: 1, is_test: true, label: "builder preview" });
    if (g.status !== 200) { w?.close(); return setMsg(g.data.error || "Could not create a test participant."); }
    const c = g.data.created[0];
    await aapi("/api/admin/participants", { action: "ready", ids: [c.participant_id] });
    const url = `/p/${c.access_code.replace(/-/g, "")}`;
    if (w) w.location.href = url; else window.location.href = url;
    setMsg(`Opened test participant ${c.participant_id} in a new tab. Test participants are kept out of the participant data exports.`);
  }

  const elActions = (i, el) => (
    <div className="row">
      <button className="secondary small" disabled={i === 0} onClick={() => update((f) => move(f.elements, i, -1))}>Up</button>
      <button className="secondary small" disabled={i === flow.elements.length - 1} onClick={() => update((f) => move(f.elements, i, 1))}>Down</button>
      {el.type === "block" && <button className="secondary small" onClick={() => update((f) => f.elements.splice(i + 1, 0, copyBlock(f.elements[i])))}>Duplicate</button>}
      <button className="danger small" onClick={() => confirm(`Delete "${el.name}" and everything in it?`) && update((f) => f.elements.splice(i, 1))}>Delete</button>
    </div>
  );

  return (
    <>
      <p className="eyebrow">Study builder</p>
      <h1 className="title">Study design</h1>
      <hr className="rule" />
      <p className="muted">Arrange the study from top to bottom. Use <b>blocks</b> for pages of questions, link a block to a <b>condition</b> to give it its own questions and tutor language, and put condition blocks in a <b>condition group</b> to control their order. Current version: <b>{cfg.prompt_version}</b> (saved {fmtTime(cfg.created_at)} by {cfg.created_by}).</p>

      <div className="stats">
        <div className="stat" style={{ borderLeftColor: est > 1200 ? "var(--red)" : "var(--navy)" }}><b style={{ color: est > 1200 ? "var(--red)" : undefined }}>{mins(est)}</b>estimated total time {est > 1200 ? "(over 20 min)" : "(target: 20 min or less)"}</div>
        <div className="stat"><b>{flow.elements.reduce((t, e) => t + (e.type === "group" ? e.blocks.length : 1), 0)}</b>blocks</div>
        <div className="stat"><b>{flow.elements.reduce((t, e) => t + (e.type === "group" ? e.blocks.reduce((u, b) => u + b.pages.length, 0) : e.pages.length), 0)}</b>pages per participant</div>
        <div className="stat"><b>{conds.length}</b>conditions</div>
      </div>
      <p className="small muted" style={{ marginTop: -10 }}>Estimate: chat time as set, a page's time limit if it has one, otherwise about 8 s per slider or multiple-choice question, 20 s per text answer, 15 s per information text.</p>
      {check.errors.length > 0 && <div className="error" style={{ marginBottom: 18 }}><b>Fix before saving:</b><ul style={{ margin: "6px 0 0 18px", padding: 0 }}>{check.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}

      <div className="panel">
        <h3>Conditions</h3>
        <p className="small muted" style={{ marginTop: -6 }}>The language rule and opening message are given to the tutor in every chat of a block linked to that condition.</p>
        {conds.map((c, ci) => (
          <details key={ci} className="q-card" style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer" }}><b>{c.id}</b>: {c.label}</summary>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <div style={{ width: 120 }}><label>ID</label><input value={c.id} onChange={(e) => update((f) => { f.conditions[ci].id = e.target.value; })} /></div>
                <div style={{ width: 300 }}><label>Name</label><input value={c.label} onChange={(e) => update((f) => { f.conditions[ci].label = e.target.value; })} /></div>
              </div>
              <button className="danger small" style={{ marginTop: 30 }} onClick={() => confirm(`Remove condition ${c.id}? Blocks linked to it must be changed.`) && update((f) => f.conditions.splice(ci, 1))}>Remove</button>
            </div>
            <label>Tutor language rule</label>
            <textarea rows={3} value={c.tutor_instruction || ""} onChange={(e) => update((f) => { f.conditions[ci].tutor_instruction = e.target.value; })} />
            <label>Tutor opening message</label>
            <textarea rows={2} value={c.opening_message || ""} onChange={(e) => update((f) => { f.conditions[ci].opening_message = e.target.value; })} />
          </details>
        ))}
        <div style={{ marginTop: 12 }}><button className="secondary small" onClick={() => update((f) => f.conditions.push({ id: `C${f.conditions.length + 1}`, label: "New condition", tutor_instruction: "", opening_message: "" }))}>Add condition</button></div>
      </div>

      <div className="panel">
        <h3>Study flow (top to bottom)</h3>
        {flow.elements.map((el, i) => el.type === "group" ? (
          <div key={i} className="q-card" style={{ marginTop: 14, borderLeft: "4px solid var(--navy)", background: "var(--navy-soft)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="row">
                <span className="pill ready">Condition group</span>
                <input style={{ width: 240 }} value={el.name} onChange={(e) => update((f) => { f.elements[i].name = e.target.value; })} />
                <span className="small muted">about {mins(el.blocks.reduce((t, b) => t + blockSeconds(b), 0))}</span>
              </div>
              {elActions(i, el)}
            </div>
            <label>Order of the blocks in this group</label>
            <select style={{ maxWidth: 560 }} value={el.order} onChange={(e) => update((f) => { f.elements[i].order = e.target.value; })}>
              <option value="counterbalanced">Counterbalanced: every possible order used equally across participants (recommended)</option>
              <option value="fixed">Fixed: everyone sees the blocks in the order listed below</option>
            </select>
            {el.blocks.map((b, bi) => (
              <BlockEditor key={b.id + bi} b={b} conds={conds} label={`Block ${bi + 1}`}
                set={(fn) => update((f) => fn(f.elements[i].blocks[bi]))}
                actions={
                  <div className="row">
                    <button className="secondary small" disabled={bi === 0} onClick={() => update((f) => move(f.elements[i].blocks, bi, -1))}>Up</button>
                    <button className="secondary small" disabled={bi === el.blocks.length - 1} onClick={() => update((f) => move(f.elements[i].blocks, bi, 1))}>Down</button>
                    <button className="secondary small" onClick={() => update((f) => f.elements[i].blocks.splice(bi + 1, 0, copyBlock(f.elements[i].blocks[bi])))}>Duplicate</button>
                    <button className="danger small" onClick={() => confirm(`Delete block "${b.name}"?`) && update((f) => f.elements[i].blocks.splice(bi, 1))}>Delete</button>
                  </div>} />
            ))}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="secondary small" onClick={() => update((f) => f.elements[i].blocks.push(newBlock(null)))}>Add block to this group</button>
              <button className="secondary small" onClick={() => update((f) => {
                const g = f.elements[i]; const used = new Set(g.blocks.map((b) => b.condition));
                const tpl = g.blocks[g.blocks.length - 1];
                for (const c of f.conditions) if (!used.has(c.id)) g.blocks.push(tpl ? { ...copyBlock(tpl), id: `task_${c.id}_${rnd()}`, name: `Task: ${c.label}`, condition: c.id } : newBlock(c.id, `Task: ${c.label}`));
              })}>Add a copy for each missing condition</button>
            </div>
          </div>
        ) : (
          <BlockEditor key={el.id + i} b={el} conds={conds} label="Block" set={(fn) => update((f) => fn(f.elements[i]))} actions={elActions(i, el)} top />
        ))}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="small" onClick={() => update((f) => f.elements.push(newBlock(null)))}>Add block</button>
          <button className="small secondary" onClick={() => update((f) => f.elements.push({ type: "group", id: `group_${rnd()}`, name: "Condition group", order: "counterbalanced",
            blocks: f.conditions.map((c) => newBlock(c.id, `Task: ${c.label}`)) }))}>Add condition group</button>
        </div>
      </div>

      <div className="panel">
        <h3>End of study</h3>
        <label>Thank-you message</label>
        <textarea rows={3} value={flow.end_message} onChange={(e) => update((f) => { f.end_message = e.target.value; })} />
        <label>Optional link at the end (leave empty for none)</label>
        <input value={flow.end_url || ""} placeholder="https://..." onChange={(e) => update((f) => { f.end_url = e.target.value; })} />
      </div>

      <div className="row savebar">
        <button onClick={save}>Save new version</button>
        <button className="secondary" onClick={tryIt}>Try it as a participant</button>
        <button className="secondary" onClick={() => (!dirty || confirm("Discard unsaved changes?")) && load()}>Discard changes</button>
        {dirty && <span className="small" style={{ color: "var(--amber)" }}>Unsaved changes</span>}
        {msg && <span>{msg}</span>}
      </div>
    </>
  );
}

function BlockEditor({ b, conds, label, set, actions, top }) {
  const [addType, setAddType] = useState({});
  const cond = conds.find((c) => c.id === b.condition);
  return (
    <details className="q-card" style={{ marginTop: 14, borderLeft: `4px solid ${b.condition ? "var(--brand)" : "#9aa9c0"}` }}>
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <b className="serif" style={{ fontSize: 18 }}>{b.name}</b>
            <span className={"pill " + (b.condition ? "active" : "")}>{b.condition ? `${b.condition}: ${cond?.label || "?"}` : "General"}</span>
            <span className="small muted">{b.pages.length} page{b.pages.length === 1 ? "" : "s"}, about {mins(blockSeconds(b))}</span>
          </div>
          <div onClick={(e) => e.preventDefault()}>{actions}</div>
        </div>
      </summary>
      <div className="row" style={{ marginTop: 8 }}>
        <div style={{ width: 260 }}><label>{label} name</label><input value={b.name} onChange={(e) => set((x) => { x.name = e.target.value; })} /></div>
        <div style={{ width: 170 }}><label>Block ID</label><input value={b.id} onChange={(e) => set((x) => { x.id = e.target.value; })} /></div>
        <div style={{ width: 260 }}><label>Condition</label>
          <select value={b.condition || ""} onChange={(e) => set((x) => { x.condition = e.target.value || null; })}>
            <option value="">General (no condition)</option>
            {conds.map((c) => <option key={c.id} value={c.id}>{c.id}: {c.label}</option>)}
          </select>
        </div>
      </div>
      {b.pages.map((p, pi) => (
        <div key={pi} style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 14, marginTop: 14, background: "#fff" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <b>Page {pi + 1}</b>
              <input style={{ width: 150 }} value={p.id} title="Page ID" onChange={(e) => set((x) => { x.pages[pi].id = e.target.value; })} />
              <span className="small muted">Time limit (seconds, optional)</span>
              <input style={{ width: 90 }} type="number" min={5} placeholder="none" value={p.time_limit_seconds || ""} disabled={p.items.some((it) => it.type === "chat")}
                     onChange={(e) => set((x) => { x.pages[pi].time_limit_seconds = e.target.value ? Number(e.target.value) : null; })} />
              <span className="small muted">about {Math.round(pageSeconds(p))} s</span>
            </div>
            <div className="row">
              <button className="secondary small" disabled={pi === 0} onClick={() => set((x) => move(x.pages, pi, -1))}>Up</button>
              <button className="secondary small" disabled={pi === b.pages.length - 1} onClick={() => set((x) => move(x.pages, pi, 1))}>Down</button>
              <button className="danger small" onClick={() => confirm("Delete this page?") && set((x) => x.pages.splice(pi, 1))}>Delete page</button>
            </div>
          </div>
          {p.items.map((it, ii) => (
            <ItemEditor key={ii} it={it} first={ii === 0} last={ii === p.items.length - 1}
              set={(fn) => set((x) => fn(x.pages[pi].items[ii]))}
              move={(d) => set((x) => move(x.pages[pi].items, ii, d))}
              remove={() => set((x) => x.pages[pi].items.splice(ii, 1))} />
          ))}
          <div className="row" style={{ marginTop: 12 }}>
            <select style={{ width: 200 }} value={addType[pi] || "slider"} onChange={(e) => setAddType({ ...addType, [pi]: e.target.value })}>
              {Object.entries(TYPE_LABEL).map(([t, l]) => <option key={t} value={t} disabled={t === "chat" && !b.condition}>{l}{t === "chat" && !b.condition ? " (link the block to a condition first)" : ""}</option>)}
            </select>
            <button className="small" onClick={() => { const t = addType[pi] || "slider"; set((x) => x.pages[pi].items.push({ id: `${t}_${rnd()}`, ...NEW_ITEM[t]() })); }}>Add question</button>
          </div>
        </div>
      ))}
      <button className="secondary small" style={{ marginTop: 12 }} onClick={() => set((x) => x.pages.push({ id: `page${x.pages.length + 1}`, items: [NEW_ITEM.slider()].map((i) => ({ id: `slider_${rnd()}`, ...i })) }))}>Add page</button>
    </details>
  );
}

function ItemEditor({ it, first, last, set, move, remove }) {
  const txt = (v) => (typeof v === "string" ? v : v?.all || "");
  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="row">
          <span className="pill ready">{TYPE_LABEL[it.type]}</span>
          <input style={{ width: 180 }} value={it.id} title="Question ID (column name in the export)" onChange={(e) => set((x) => { x.id = e.target.value; })} />
          {!["info", "chat"].includes(it.type) && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}><input type="checkbox" style={{ width: "auto" }} checked={it.required !== false} onChange={(e) => set((x) => { x.required = e.target.checked; })} /> Required</label>
          )}
        </div>
        <div className="row">
          <button className="secondary small" disabled={first} onClick={() => move(-1)}>Up</button>
          <button className="secondary small" disabled={last} onClick={() => move(1)}>Down</button>
          <button className="danger small" onClick={remove}>Remove</button>
        </div>
      </div>
      <label>{it.type === "info" ? "Text" : it.type === "chat" ? "Instructions shown to the participant" : "Question"}</label>
      <textarea rows={it.type === "info" ? 4 : 2} value={txt(it.text)} onChange={(e) => set((x) => { x.text = e.target.value; })} />
      {it.type === "slider" && (
        <>
          <div className="row">
            {[["min", "Minimum"], ["max", "Maximum"], ["start", "Dot starts at"], ["step", "Step"]].map(([k, l]) => (
              <div key={k} style={{ width: 110 }}><label>{l}</label><input type="number" value={it[k]} onChange={(e) => set((x) => { x[k] = e.target.value === "" ? "" : Number(e.target.value); })} /></div>
            ))}
            <button className="secondary small" style={{ marginTop: 34 }} onClick={() => set((x) => { x.start = (Number(x.min) + Number(x.max)) / 2; })}>Start in the middle</button>
          </div>
          <div className="row">
            <div style={{ flex: "1 1 220px" }}><label>Left label</label><input value={txt(it.left_label)} onChange={(e) => set((x) => { x.left_label = e.target.value; })} /></div>
            <div style={{ flex: "1 1 220px" }}><label>Right label</label><input value={txt(it.right_label)} onChange={(e) => set((x) => { x.right_label = e.target.value; })} /></div>
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
          <div style={{ width: 170 }}><label>Chat length (minutes)</label><input type="number" min={0.5} step={0.5} value={Number(it.duration_seconds) / 60} onChange={(e) => set((x) => { x.duration_seconds = Math.round(Number(e.target.value) * 60); })} /></div>
          <label>Task for the tutor (topic and goals for this chat)</label>
          <textarea rows={2} value={txt(it.tutor_task)} onChange={(e) => set((x) => { x.tutor_task = e.target.value; })} />
        </>
      )}
    </div>
  );
}
