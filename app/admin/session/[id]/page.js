"use client";
import { use, useCallback, useEffect, useState } from "react";
import AdminShell, { aapi, fmtTime, fmtLeft } from "@/components/AdminShell";

export default function Page({ params }) {
  const { id } = use(params);
  return <AdminShell><Detail id={id} /></AdminShell>;
}

function Detail({ id }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [stop, setStop] = useState({ end_reason: "researcher_stopped", reason: "" });
  const [adj, setAdj] = useState({ add_seconds: 60, reason: "" });
  const [, setTick] = useState(0);
  const [base, setBase] = useState({ server: 0, perf: 0 });

  const load = useCallback(async () => {
    const { status, data } = await aapi(`/api/admin/session/${id}`);
    if (status === 200) { setD(data); setBase({ server: Date.parse(data.server_now), perf: performance.now() }); } else setErr(data.error || "Failed");
  }, [id]);
  useEffect(() => { load(); const t = setInterval(load, 5000); const u = setInterval(() => setTick((x) => x + 1), 1000); return () => { clearInterval(t); clearInterval(u); }; }, [load]);

  async function post(body) {
    const { status, data } = await aapi(`/api/admin/session/${id}`, body);
    if (status === 200) { setD(data); setErr(""); } else setErr(data.error || "Failed");
  }

  if (!d) return <p className="muted">{err || "Loading..."}</p>;
  const s = d.session;
  const now = base.server + (performance.now() - base.perf);
  const rem = s.status === "active" ? Date.parse(s.expires_at) - now : null;

  return (
    <>
      <p style={{ margin: "0 0 14px" }}><a className="linkish" href="/admin">All sessions</a></p>
      <p className="eyebrow">Session detail</p>
      <h1 className="title">Participant {s.participant_id} {Number(s.test_session) ? <span className="pill">test</span> : null}</h1>
      <hr className="rule" />
      {err && <p className="error">{err}</p>}
      <div className="grid2">
        <div className="panel">
          <h3>Session</h3>
          <div className="kv">
            <div>Session ID</div><div className="mono">{s.session_id}</div>
            <div>Group</div><div><b>{s.condition}</b> (allocation #{s.allocation_seq})</div>
            <div>Status</div><div><span className={`pill ${s.status}`}>{s.status}</span>{Number(s.error_flag) ? <span className="pill err" style={{ marginLeft: 6 }}>error</span> : null}</div>
            <div>Started</div><div>{fmtTime(s.started_at)}</div>
            <div>Deadline</div><div>{fmtTime(s.expires_at)}</div>
            <div>Remaining</div><div className="mono">{rem !== null ? fmtLeft(rem) : "-"}</div>
            <div>Ended</div><div>{fmtTime(s.ended_at)} {s.end_reason ? `(${s.end_reason})` : ""}</div>
            <div>Duration</div><div>{s.duration_seconds} s</div>
            <div>Model</div><div className="mono">{s.provider} / {s.model_id}</div>
            <div>Prompt version</div><div>{s.prompt_version} (config #{s.config_id})</div>
            <div>Final link opened</div><div>{Number(s.final_assessment_link_opened) ? fmtTime(s.final_assessment_link_opened_at) : "no"}. Completion: unknown</div>
            <div>Access verified</div><div>{fmtTime(d.participant?.preliminary_stage_verified_at)} {d.participant?.verification_method ? `(${d.participant.verification_method}${d.participant.verified_by ? " by " + d.participant.verified_by : ""})` : ""}</div>
          </div>
          <p style={{ margin: "18px 0" }}><a className="linkish" href={`/api/admin/export/transcript?session_id=${s.session_id}`}>Download transcript (.txt)</a></p>
          <details><summary className="small">System prompt used for this session</summary><pre className="prompt">{s.system_prompt}</pre></details>
        </div>
        <div className="panel">
          <h3>Researcher controls</h3>
          {s.status === "ended" ? <p className="muted">Session has ended. Records are read-only.</p> : (
            <>
              <label>Stop session</label>
              <div className="row">
                <select value={stop.end_reason} onChange={(e) => setStop({ ...stop, end_reason: e.target.value })} style={{ width: 200 }}>
                  <option value="researcher_stopped">researcher_stopped</option>
                  <option value="technical_failure">technical_failure</option>
                  <option value="withdrawn">withdrawn</option>
                </select>
              </div>
              <input style={{ marginTop: 8 }} placeholder="Reason (required)" value={stop.reason} onChange={(e) => setStop({ ...stop, reason: e.target.value })} />
              <div style={{ marginTop: 8 }}><button className="danger" onClick={() => confirm("Stop this session now?") && post({ action: "stop", ...stop })}>Stop session</button></div>
              {s.status === "active" && (
                <>
                  <label style={{ marginTop: 22 }}>Adjust deadline (authorised adjustment, logged with old/new deadline)</label>
                  <div className="row">
                    <input type="number" style={{ width: 120 }} value={adj.add_seconds} onChange={(e) => setAdj({ ...adj, add_seconds: e.target.value })} />
                    <span className="small muted">seconds (negative removes time)</span>
                  </div>
                  <input style={{ marginTop: 8 }} placeholder="Reason (required)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
                  <div style={{ marginTop: 8 }}><button className="secondary" onClick={() => post({ action: "adjust", ...adj })}>Apply adjustment</button></div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Transcript ({d.messages.length} messages, read-only)</h3>
        <div className="table-wrap" style={{ maxHeight: "none" }}><table>
          <thead><tr><th>#</th><th>Speaker</th><th>Time</th><th>Status</th><th>Text</th></tr></thead>
          <tbody>
            {d.messages.map((m) => (
              <tr key={m.message_id}>
                <td>{m.seq}</td>
                <td><b style={{ color: m.role === "user" ? "var(--navy)" : "var(--brand)" }}>{m.role === "user" ? "Participant" : "Tutor"}</b></td>
                <td className="small">{fmtTime(m.received_at)}{m.displayed_at ? <div className="muted">shown {fmtTime(m.displayed_at)}</div> : null}</td>
                <td className="small">{m.delivery_status}</td>
                <td style={{ whiteSpace: "pre-wrap" }}>{m.text}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="panel">
        <h3>Event log</h3>
        <table>
          <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>Admin</th></tr></thead>
          <tbody>
            {d.events.map((e) => (
              <tr key={e.event_id}><td className="small">{fmtTime(e.ts)}</td><td>{e.event_type}</td><td className="mono">{e.details}</td><td>{e.admin_identity || ""}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
