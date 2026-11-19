"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell, { aapi, fmtTime, fmtLeft } from "@/components/AdminShell";

export default function Page() {
  return <AdminShell><Dashboard /></AdminShell>;
}

function Dashboard() {
  const [rows, setRows] = useState([]);
  const [serverNow, setServerNow] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [tick, setTick] = useState(0);
    const [fStatus, setFStatus] = useState("");
  const [fTest, setFTest] = useState("participants");
  const [sel, setSel] = useState({});
  const [gen, setGen] = useState({ count: 10, is_test: false, label: "", custom_ids: "" });
  const [created, setCreated] = useState(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { status, data } = await aapi("/api/admin/sessions");
    if (status === 200) { setRows(data.rows); setServerNow(Date.parse(data.server_now)); setFetchedAt(performance.now()); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const nowServer = serverNow ? serverNow + (performance.now() - fetchedAt) : Date.now();

  const statusOf = (r) => (r.access_status === "blocked" ? "blocked" : r.status === "ready" ? "ready (not started)" : r.status === "ended" && r.end_reason === "completed" ? "completed" : r.status ? r.status : r.access_status === "ready" ? "approved (not opened)" : "pending approval");

  const filtered = useMemo(() => rows.filter((r) => {
    if (fTest === "participants" && Number(r.is_test)) return false;
    if (fTest === "test" && !Number(r.is_test)) return false;
    if (fStatus) {
      const s = statusOf(r);
      if (fStatus === "pending" ? !s.startsWith("pending") : s !== fStatus) return false;
    }
    return true;
  }), [rows, fStatus, fTest]);

  const stats = useMemo(() => {
    const main = rows.filter((r) => (fTest === "test" ? Number(r.is_test) : fTest === "participants" ? !Number(r.is_test) : true));
    const c = (f) => main.filter(f).length;
    return {
      invited: main.length,
      pending: c((r) => r.access_status === "pending"),
      started: c((r) => r.status === "active" || r.status === "ended"),
      active: c((r) => r.status === "active"),
      completed: c((r) => r.end_reason === "completed"),
      stopped: c((r) => r.status === "ended" && r.end_reason !== "completed"),
      errors: c((r) => Number(r.error_flag)),
      orders: Object.entries(main.filter((r) => r.condition_order).reduce((m, r) => ((m[r.condition_order] = (m[r.condition_order] || 0) + 1), m), {})),
    };
  }, [rows, fTest]);

  const selectedIds = Object.keys(sel).filter((k) => sel[k]);

  async function act(action, ids, extra = {}) {
    const { status, data } = await aapi("/api/admin/participants", { action, ids, ...extra });
    setMsg(status !== 200 ? data.error || "Failed"
      : data.deleted ? `Deleted ${data.deleted.length}.${data.kept.length ? ` Not deleted: ${data.kept.join(", ")}` : ""}`
      : `Done${data.updated !== undefined ? `: ${data.updated} updated` : ""}.`);
    setSel({});
    load();
  }

  async function generate() {
    const { status, data } = await aapi("/api/admin/participants", { action: "generate", ...gen });
    if (status === 200) { setCreated(data.created); setMsg(`${data.created.length} invitations created.`); load(); }
    else setMsg(data.error || "Failed");
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkOf = (code) => `${origin}/p/${String(code).replace(/-/g, "")}`;

  return (
    <>
      <p className="eyebrow">Pilot study</p>
      <h1 className="title">Participants overview</h1>
      <hr className="rule" />
      <div className="stats">
        <div className="stat"><b>{stats.invited}</b>invited</div>
        <div className="stat"><b>{stats.pending}</b>awaiting approval</div>
        <div className="stat"><b>{stats.started}</b>started</div>
        <div className="stat"><b>{stats.active}</b>in progress now</div>
        <div className="stat"><b>{stats.completed}</b>completed</div>
        <div className="stat"><b>{stats.stopped}</b>stopped / withdrawn</div>
        <div className="stat"><b style={{ color: stats.errors ? "var(--red)" : undefined }}>{stats.errors}</b>with tutor errors</div>
        <div className="stat" style={{ gridColumn: "span 2" }}>condition orders used<div className="small" style={{ marginTop: 4 }}>{stats.orders.length ? stats.orders.map(([o, n]) => <span key={o} className="pill ready" style={{ marginRight: 6, marginBottom: 4 }}>{o.split(",").join(" > ")}: {n}</span>) : "none yet"}</div></div>
      </div>

      <div className="panel">
        <h3>Participants</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={fTest} onChange={(e) => setFTest(e.target.value)} style={{ width: 190 }}>
            <option value="participants">Participant data</option>
            <option value="test">Test participants only</option>
            <option value="all">All</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={{ width: 210 }}>
            <option value="">All statuses</option><option value="pending">Pending approval</option><option value="approved (not opened)">Approved, not opened</option>
            <option value="ready (not started)">Ready, not started</option><option value="active">In progress</option><option value="completed">Completed</option><option value="ended">Stopped</option><option value="blocked">Blocked</option>
          </select>
          <span className="muted small">Auto-refreshes every 5 s. {filtered.length} rows.</span>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="small" disabled={!selectedIds.length} onClick={() => act("ready", selectedIds)}>Mark selected ready</button>
          <button className="small secondary" onClick={() => {
            const ids = filtered.filter((r) => r.access_status === "pending").map((r) => r.participant_id);
            if (ids.length && confirm(`Mark ${ids.length} pending participant(s) in this view as ready?`)) act("ready", ids);
          }}>Mark all pending in view ready</button>
          <button className="small danger" disabled={!selectedIds.length} onClick={() => {
            const reason = prompt("Reason for blocking / withdrawing the selected participants:");
            if (reason) act("block", selectedIds, { reason });
          }}>Block / withdraw selected</button>
          <button className="small secondary" disabled={!selectedIds.length} onClick={() => act("unblock", selectedIds)}>Unblock selected</button>
          <button className="small danger" disabled={!selectedIds.length} onClick={() => {
            const started = rows.filter((r) => sel[r.participant_id] && r.status).map((r) => r.participant_id);
            if (!started.length) {
              if (confirm(`Delete ${selectedIds.length} participant(s)? Their code stops working. This cannot be undone.`)) act("delete", selectedIds, { reason: "deleted by researcher" });
              return;
            }
            const reason = prompt(`${started.join(", ")} already started. Deleting PERMANENTLY erases their answers and chat transcripts (their condition-order slot stays used).\n\nTip: download a backup first. Type a reason to continue:`);
            if (!reason) return;
            if (prompt('Type DELETE to confirm') !== "DELETE") return setMsg("Delete cancelled.");
            act("delete", selectedIds, { reason, force: true });
          }}>Delete selected</button>
          {msg && <span className="small muted">{msg}</span>}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" style={{ width: "auto" }} onChange={(e) => { const v = e.target.checked; const n = {}; filtered.forEach((r) => (n[r.participant_id] = v)); setSel(n); }} /></th>
                <th>Participant</th><th>Access code</th><th>Condition order</th><th>Status</th><th>Progress</th><th>Now on</th><th>Chat time left</th>
                <th>Started</th><th>Answers</th><th>End reason</th><th>Error</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const s = statusOf(r);
                const ac = r.active_chat ? r.active_chat.split("|") : null;
                const rem = ac ? Date.parse(ac[2]) - nowServer : null;
                const pill = r.status === "ended" && r.end_reason === "completed" ? "ready" : r.status || r.access_status;
                return (
                  <tr key={r.participant_id}>
                    <td><input type="checkbox" style={{ width: "auto" }} checked={!!sel[r.participant_id]} onChange={(e) => setSel({ ...sel, [r.participant_id]: e.target.checked })} /></td>
                    <td><b>{r.participant_id}</b>{Number(r.is_test) ? <span className="pill" style={{ marginLeft: 6 }}>test</span> : null}</td>
                    <td className="mono">{r.access_code} <a className="small" href="#" onClick={(e) => { e.preventDefault(); navigator.clipboard?.writeText(linkOf(r.access_code)); setMsg(`Link for ${r.participant_id} copied.`); }}>copy link</a></td>
                    <td className="small">{r.condition_order ? r.condition_order.split(",").join(" > ") : "-"}</td>
                    <td><span className={`pill ${pill}`}>{s}</span></td>
                    <td className="mono">{r.total_steps ? `${r.status === "ended" && r.end_reason === "completed" ? r.total_steps : Number(r.current_step)} / ${r.total_steps}` : "-"}</td>
                    <td className="small">{r.current_where || "-"}</td>
                    <td className="mono">{rem !== null ? `${fmtLeft(rem)} (${ac[0]})` : "-"}</td>
                    <td>{fmtTime(r.started_at)}</td>
                    <td>{r.status ? r.answers : "-"}</td>
                    <td>{r.end_reason || "-"}</td>
                    <td>{Number(r.error_flag) ? <span className="pill err">error</span> : ""}</td>
                    <td>{r.status ? <a className="linkish" style={{ fontSize: 12.5 }} href={`/admin/p/${encodeURIComponent(r.participant_id)}`}>Open</a> : ""}</td>
                  </tr>
                );
              })}
              {!filtered.length && <tr><td colSpan={13} className="muted">No rows. Generate invitations below.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="small muted">Progress = pages finished / total pages. Condition order is assigned automatically and balanced across all possible orders.</p>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Generate invitations</h3>
          <div className="row">
            <div style={{ width: 120 }}><label>How many</label><input type="number" min={1} max={500} value={gen.count} onChange={(e) => setGen({ ...gen, count: e.target.value })} /></div>
            <div style={{ width: 200 }}><label>Batch label (optional)</label><input value={gen.label} onChange={(e) => setGen({ ...gen, label: e.target.value })} /></div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 38 }}><input type="checkbox" style={{ width: "auto" }} checked={gen.is_test} onChange={(e) => setGen({ ...gen, is_test: e.target.checked })} /> Test participants</label>
          </div>
          <label>Or paste participant IDs agreed with the questionnaire team (one per line; this overrides "How many")</label>
          <textarea rows={3} value={gen.custom_ids} onChange={(e) => setGen({ ...gen, custom_ids: e.target.value })} placeholder={"e.g.\nS001\nS002"} />
          <div style={{ marginTop: 14 }}><button className="arrow" onClick={generate}>Generate invitations</button></div>
          {created && (
            <div style={{ marginTop: 14 }}>
              <p className="notice small">Created {created.length}. Download the full list below ("Invitation list").</p>
              <div style={{ maxHeight: 200, overflow: "auto" }}>
                <table><tbody>{created.map((c) => <tr key={c.participant_id}><td>{c.participant_id}</td><td className="mono">{c.access_code}</td><td className="mono small">{linkOf(c.access_code)}</td></tr>)}</tbody></table>
              </div>
            </div>
          )}
        </div>
        <div className="panel">
          <h3>Exports (UTF-8, administrators only)</h3>
          <p className="small muted">Scope follows the first filter above: <b>{fTest === "participants" ? "participant data only" : fTest === "test" ? "test sessions only" : "all"}</b>.</p>
          <ul className="export-list">
            <li><a className="linkish" href={`/api/admin/export/responses-wide?scope=${fTest}`}>Answers, one row per participant (CSV)</a></li>
            <li><a className="linkish" href={`/api/admin/export/responses?scope=${fTest}`}>Answers, one row per answer (CSV)</a></li>
            <li><a className="linkish" href={`/api/admin/export/runs?scope=${fTest}`}>Participant summary (CSV)</a></li>
            <li><a className="linkish" href={`/api/admin/export/chats?scope=${fTest}`}>Chats summary (CSV)</a></li>
            <li><a className="linkish" href={`/api/admin/export/messages?scope=${fTest}`}>Chat messages (CSV)</a></li>
            <li><a className="linkish" href={`/api/admin/export/messages-json?scope=${fTest}`}>Chat messages (JSON)</a></li>
            <li><a className="linkish" href="/api/admin/export/events">Event log (CSV)</a></li>
            <li><a className="linkish navy" href="/api/admin/export/invitations">Invitation list (codes + links) (CSV)</a></li>
            <li><a className="linkish navy" href="/api/admin/export/backup">Full database backup (JSON)</a></li>
          </ul>
          <p className="small muted">Readable chat transcripts: open a participant, then click "Download transcripts".</p>
        </div>
      </div>
      <span style={{ display: "none" }}>{tick}</span>
    </>
  );
}
