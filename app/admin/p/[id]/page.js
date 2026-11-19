"use client";
import { use, useCallback, useEffect, useState } from "react";
import AdminShell, { aapi, fmtTime, fmtLeft } from "@/components/AdminShell";

export default function Page({ params }) {
  const { id } = use(params);
  return <AdminShell><Detail id={decodeURIComponent(id)} /></AdminShell>;
}

function Detail({ id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [stop, setStop] = useState({ end_reason: "researcher_stopped", reason: "" });
  const [adj, setAdj] = useState({ add_seconds: 60, reason: "" });
  const [, setTick] = useState(0);
  const [base, setBase] = useState({ server: 0, perf: 0 });

  const load = useCallback(async () => {
    const { status, data } = await aapi(`/api/admin/participant/${encodeURIComponent(id)}`);
    if (status === 200) { setD(data); setBase({ server: Date.parse(data.server_now), perf: performance.now() }); } else setErr(data.error || "Failed");
  }, [id]);
  useEffect(() => { load(); const t = setInterval(load, 5000); const u = setInterval(() => setTick((x) => x + 1), 1000); return () => { clearInterval(t); clearInterval(u); }; }, [load]);

  async function post(body) {
    const { status, data } = await aapi(`/api/admin/participant/${encodeURIComponent(id)}`, body);
    if (status === 200) { setD(data); setErr(""); } else setErr(data.error || "Failed");
  }

  if (!d) return <p className="muted">{err || "Loading..."}</p>;
  const run = d.run;
  const now = base.server + (performance.now() - base.perf);
  const activeChat = d.chats.find((c) => c.status === "active");
  const byStep = {};
  for (const r of d.responses) (byStep[r.step_key] = byStep[r.step_key] || []).push(r);

  return (
    <>
      <p style={{ margin: "0 0 14px" }}><a className="linkish" href="/admin">All participants</a></p>
      <p className="eyebrow">Participant detail</p>
      <h1 className="title">Participant {id} {Number(d.participant.is_test) ? <span className="pill">test</span> : null}</h1>
      <hr className="rule" />
      {err && <p className="error">{err}</p>}
      {!run ? <p className="muted">This participant has not opened their link yet.</p> : (
      <>
      <div className="grid2">
        <div className="panel">
          <h3>Progress</h3>
          <div className="kv">
            <div>Condition order</div><div><b>{run.condition_order.split(",").join(" > ")}</b> (slot #{run.allocation_seq ?? "fixed"})</div>
            <div>Status</div><div><span className={`pill ${run.status}`}>{run.status}</span> {run.end_reason ? `(${run.end_reason})` : ""} {Number(run.error_flag) ? <span className="pill err">tutor error</span> : null}</div>
            <div>Page</div><div>{run.status === "ended" && run.end_reason === "completed" ? d.steps.length : Number(run.current_step) + 1} of {d.steps.length}</div>
            <div>Started</div><div>{fmtTime(run.started_at)}</div>
            <div>Ended</div><div>{fmtTime(run.ended_at)}</div>
            <div>Total time</div><div>{run.started_at ? fmtLeft((run.ended_at ? Date.parse(run.ended_at) : now) - Date.parse(run.started_at)) : "-"}</div>
            <div>Settings version</div><div>{run.prompt_version}</div>
            <div>Model</div><div className="mono">{d.model ? `${d.model.provider} / ${d.model.model_id}` : "-"}</div>
            <div>Access verified</div><div>{fmtTime(d.participant.preliminary_stage_verified_at)} {d.participant.verified_by ? `by ${d.participant.verified_by}` : ""}</div>
          </div>
          <p style={{ margin: "18px 0 0" }}><a className="linkish" href={`/api/admin/export/transcript?participant_id=${encodeURIComponent(id)}`}>Download transcripts (.txt)</a></p>
        </div>
        <div className="panel">
          <h3>Researcher controls</h3>
          {run.status === "ended" ? <p className="muted">This participant has finished. Records are read-only.</p> : (
            <>
              {activeChat && (
                <>
                  <label>Chat running: part {activeChat.position} ({activeChat.condition}), {fmtLeft(Date.parse(activeChat.expires_at) - now)} left</label>
                  <div className="row">
                    <input type="number" style={{ width: 110 }} value={adj.add_seconds} onChange={(e) => setAdj({ ...adj, add_seconds: e.target.value })} />
                    <span className="small muted">seconds to add (negative removes)</span>
                  </div>
                  <input style={{ marginTop: 8 }} placeholder="Reason (required)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="secondary small" onClick={() => post({ action: "adjust", ...adj })}>Adjust chat time</button>
                    <button className="danger small" onClick={() => adj.reason ? confirm("End this chat now? The participant moves on to the questions.") && post({ action: "end_chat", reason: adj.reason }) : setErr("Type a reason first.")}>End this chat now</button>
                  </div>
                </>
              )}
              <label style={{ marginTop: 22 }}>Stop the whole study for this participant</label>
              <select value={stop.end_reason} onChange={(e) => setStop({ ...stop, end_reason: e.target.value })} style={{ width: 220 }}>
                <option value="researcher_stopped">researcher_stopped</option><option value="technical_failure">technical_failure</option><option value="withdrawn">withdrawn</option>
              </select>
              <input style={{ marginTop: 8 }} placeholder="Reason (required)" value={stop.reason} onChange={(e) => setStop({ ...stop, reason: e.target.value })} />
              <div style={{ marginTop: 8 }}><button className="danger small" onClick={() => confirm("Stop the study for this participant?") && post({ action: "stop", ...stop })}>Stop study</button></div>
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Pages and answers</h3>
        <div className="table-wrap" style={{ maxHeight: "none" }}><table>
          <thead><tr><th>#</th><th>Block</th><th>Page</th><th>Question</th><th>Answer</th><th>Page time</th></tr></thead>
          <tbody>
            {d.steps.map((s) => {
              const ans = byStep[s.key] || [];
              const done = run.status === "ended" && run.end_reason === "completed" ? true : s.index < Number(run.current_step);
              const label = `${s.block}${s.condition ? ` (${s.condition}${s.position ? `, ${s.position}` : ""})` : ""}`;
              if (!ans.length) return (
                <tr key={s.key}><td>{s.index + 1}</td><td>{label}</td><td>{s.page_id}</td>
                  <td className="muted">{s.items.map((i) => i.type).join(", ")}</td><td className="muted">{done ? "(no answers on this page)" : s.index === Number(run.current_step) && run.status === "active" ? "current page" : "not reached"}</td><td></td></tr>
              );
              return ans.map((a, i) => (
                <tr key={a.response_id}>{i === 0 && <><td rowSpan={ans.length}>{s.index + 1}</td><td rowSpan={ans.length}>{label}</td><td rowSpan={ans.length}>{s.page_id}</td></>}
                  <td><span className="mono small">{a.item_id}</span><div className="small muted">{a.item_text}</div></td>
                  <td><b>{a.value}</b></td>{i === 0 && <td rowSpan={ans.length}>{a.page_seconds != null ? `${a.page_seconds} s` : "-"}</td>}</tr>
              ));
            })}
          </tbody>
        </table></div>
      </div>

      {d.chats.map((c) => (
        <div className="panel" key={c.chat_id}>
          <h3>Chat, part {c.position}: {c.condition} ({c.status}{c.end_reason ? `, ${c.end_reason}` : ""})</h3>
          <p className="small muted">Started {fmtTime(c.started_at)}. Ended {fmtTime(c.ended_at)}. {Number(c.error_flag) ? "Had tutor errors." : ""}</p>
          <details><summary className="small">System prompt used for this chat</summary><pre className="prompt">{c.system_prompt}</pre></details>
          <div className="table-wrap" style={{ maxHeight: "none", marginTop: 10 }}><table>
            <thead><tr><th>#</th><th>Speaker</th><th>Time</th><th>Status</th><th>Text</th></tr></thead>
            <tbody>{c.messages.map((m) => (
              <tr key={m.message_id}><td>{m.seq}</td><td><b style={{ color: m.role === "user" ? "var(--navy)" : "var(--brand)" }}>{m.role === "user" ? "Participant" : "Tutor"}</b></td>
                <td className="small">{fmtTime(m.received_at)}</td><td className="small">{m.delivery_status}</td><td style={{ whiteSpace: "pre-wrap" }}>{m.text}</td></tr>
            ))}</tbody>
          </table></div>
        </div>
      ))}
      </>
      )}

      <div className="panel">
        <h3>Event log</h3>
        <div className="table-wrap" style={{ maxHeight: 400 }}><table>
          <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>Admin</th></tr></thead>
          <tbody>{d.events.map((e) => <tr key={e.event_id}><td className="small">{fmtTime(e.ts)}</td><td>{e.event_type}</td><td className="mono">{e.details}</td><td>{e.admin_identity || ""}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  );
}
