"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import TopNav from "@/components/TopNav";

const END_TEXT = {
  time_limit: "The time for this task is over.",
  participant_finished: "You have finished the task.",
  researcher_stopped: "This session was ended by a researcher.",
  technical_failure: "This session was ended because of a technical problem.",
  withdrawn: "This session has been closed.",
};

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  let data = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

function rid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function Participant({ code }) {
  const [st, setSt] = useState(null); // server state
  const [msgs, setMsgs] = useState([]);
  const [pending, setPending] = useState(null); // {request_id, text}
  const [failed, setFailed] = useState(null); // {request_id, text}
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [left, setLeft] = useState(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false);
  const deadline = useRef(null); // performance.now()-based, immune to clock changes
  const endRef = useRef(null);
  const pendingRef = useRef(null);
  pendingRef.current = pending;

  const apply = useCallback((s, { keepMsgs = false } = {}) => {
    if (!s) return;
    setSt(s);
    if (s.phase === "active" && typeof s.remaining_ms === "number") {
      deadline.current = performance.now() + s.remaining_ms;
      setLeft(s.remaining_ms);
    } else deadline.current = null;
    if (s.messages && !keepMsgs) setMsgs(s.messages);
  }, []);

  const refresh = useCallback(async (reconnect = false) => {
    const { data } = await api("/api/p/state", { code, reconnect });
    apply(data, { keepMsgs: !!pendingRef.current });
    return data;
  }, [code, apply]);

  // initial load
  useEffect(() => { refresh(true).catch(() => setNote("Cannot reach the server. Check your connection.")); }, [refresh]);

  // poll while waiting for approval; light sync while active
  useEffect(() => {
    if (!st) return;
    const ms = st.phase === "waiting" ? 4000 : st.phase === "active" ? 20000 : 0;
    if (!ms) return;
    const t = setInterval(() => refresh(false).catch(() => {}), ms);
    return () => clearInterval(t);
  }, [st?.phase, refresh]);

  // countdown
  useEffect(() => {
    if (st?.phase !== "active") return;
    const t = setInterval(() => {
      if (deadline.current == null) return;
      const l = deadline.current - performance.now();
      setLeft(l);
      if (l <= 0) { clearInterval(t); setTimeout(() => refresh(false).catch(() => {}), 400); }
    }, 250);
    return () => clearInterval(t);
  }, [st?.phase, refresh]);

  // connectivity logging
  useEffect(() => {
    const off = () => api("/api/p/event", { code, type: "connection_lost", client_time: new Date().toISOString() }).catch(() => {});
    const on = () => { api("/api/p/event", { code, type: "connection_restored" }).catch(() => {}); refresh(true).catch(() => {}); };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [code, refresh]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending, failed]);

  const timeUp = st?.phase === "active" && left !== null && left <= 0;

  async function start() {
    setBusy(true);
    const { data } = await api("/api/p/start", { code });
    apply(data);
    setBusy(false);
  }

  async function send(retry) {
    if (pending || timeUp || st?.phase !== "active") return;
    const item = retry || { request_id: rid(), text: input.trim() };
    if (!item.text) return;
    setNote("");
    setFailed(null);
    setPending(item);
    if (!retry) {
      setInput("");
      setMsgs((m) => [...m, { seq: 1e9, role: "user", text: item.text, request_id: item.request_id, status: "sending" }]);
    }
    try {
      const { status, data } = await api("/api/p/chat", { code, request_id: item.request_id, text: item.text });
      if (status === 200 && data.ok) {
        // Only display if our own clock also says time remains.
        if (deadline.current !== null && deadline.current - performance.now() > 0) {
          setPending(null);
          apply(data.state);
          api("/api/p/event", { code, type: "displayed", request_id: item.request_id }).catch(() => {});
        } else {
          setPending(null);
          await refresh(false);
        }
      } else if (status === 409) {
        setPending(null);
        apply(data.state);
      } else if (status === 429) {
        setPending(null);
        setNote(data.message || "Please wait for the tutor's reply.");
      } else {
        setPending(null);
        setFailed(item);
        setNote(data.message || "The tutor could not reply. Please press Retry. The timer keeps running.");
      }
    } catch {
      setPending(null);
      setFailed(item);
      setNote("Connection problem. Please press Retry. The timer keeps running.");
    }
  }

  async function finish() {
    setConfirmFinish(false);
    setBusy(true);
    const { data } = await api("/api/p/finish", { code });
    setPending(null);
    apply(data);
    setBusy(false);
  }

  async function openFinal() {
    setBusy(true);
    const { status, data } = await api("/api/p/final", { code });
    setBusy(false);
    if (status === 200 && data.url) window.location.href = data.url;
    else setNote(data.error || "Could not open the link. Please tell a researcher.");
  }

  // ---------- screens ----------
  if (!st) return <Shell><p className="muted">Loading…</p>{note && <p className="error">{note}</p>}</Shell>;

  if (st.phase === "invalid")
    return <Shell><p className="eyebrow">Access</p><h1>Code not recognised</h1><hr className="rule" /><p className="error">{st.error}</p><a className="linkish" href="/">Enter a different code</a></Shell>;

  if (st.phase === "blocked")
    return <Shell><p className="eyebrow">Access</p><h1>Access not available</h1><hr className="rule" /><p>Your access to this session is not active. Please speak to a researcher.</p></Shell>;

  if (st.phase === "waiting")
    return (
      <Shell>
        <p className="eyebrow"><span className="pulse" />Waiting for the researcher</p>
        <h1>Almost ready</h1>
        <hr className="rule" />
        <p className="notice">Your code is valid. Please wait — a researcher will confirm that you can start. This page updates automatically.</p>
        <p className="muted small">Participant ID: {st.participant_id}</p>
      </Shell>
    );

  if (st.phase === "ready")
    return (
      <Shell wide>
        <p className="eyebrow">Your task</p>
        <h1>{st.task_title}</h1>
        <hr className="rule" />
        <p style={{ whiteSpace: "pre-wrap" }}>{st.task_instructions}</p>
        <p className="notice">You will have <b>{Math.round(st.duration_seconds / 60)} minutes</b>. The timer starts when you press <b>Start task</b> and keeps running even if you close the page.</p>
        <div style={{ marginTop: 22 }}><button className="arrow" onClick={start} disabled={busy}>Start task</button></div>
      </Shell>
    );

  const active = st.phase === "active" && !timeUp;
  const ended = st.phase === "ended";

  return (
    <div className="chat-page">
      <TopNav
        title="Learning session"
        right={st.phase === "active"
          ? <div className={"timer-block" + (left < 60000 ? " low" : "")} aria-live="polite"><small>Time left</small><b>{fmt(left ?? 0)}</b></div>
          : <div className="navblock">Task<br />ended</div>}
      />
      <div className="chat-wrap">
      <div className="chat-sub">
        <h2>{st.task_title}</h2>
        {active && <button className="linkish" onClick={() => setConfirmFinish(true)} disabled={busy}>Finish task</button>}
      </div>
      <details className="instr">
        <summary>Task instructions</summary>
        <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{st.task_instructions}</p>
      </details>
      <div className="msgs">
        {msgs.map((m, i) => (
          <div key={m.request_id ? m.request_id + m.role : i} className={`msg ${m.role}` + (failed && m.request_id === failed.request_id && m.role === "user" ? " failed" : "")}>
            <div className="who">{m.role === "user" ? "You" : "Tutor"}</div>
            {m.text}
          </div>
        ))}
        {pending && <div className="typing"><span /><span /><span /> Tutor is writing…</div>}
        {failed && active && <div><button className="danger small" onClick={() => send(failed)}>Retry</button></div>}
        <div ref={endRef} />
      </div>
      {note && <div style={{ padding: "0 18px 8px" }}><div className="warn small">{note}</div></div>}
      {active && (
        <>
          <div className="composer">
            <textarea
              rows={2}
              value={input}
              placeholder="Type your message…"
              maxLength={4000}
              disabled={!!pending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="arrow" onClick={() => send()} disabled={!!pending || !input.trim() || !!failed}>Send</button>
          </div>
          <div className="foot muted small"><span>Press Enter to send, Shift+Enter for a new line.</span></div>
        </>
      )}
      {(ended || timeUp) && (
        <div className="ended-bar">
          <div><b style={{ fontFamily: "var(--serif)", fontSize: 19 }}>{ended ? END_TEXT[st.end_reason] || "The task has ended." : "Time is up."}</b><div className="small muted">Your conversation has been saved.</div></div>
          {ended && <button className="arrow" onClick={openFinal} disabled={busy}>Continue to final assessment</button>}
        </div>
      )}
      {confirmFinish && (
        <div className="modal-bg" role="dialog">
          <div className="card">
            <p className="eyebrow">Confirm</p><h2 style={{ marginTop: 0 }}>Finish the task?</h2>
            <p>You will not be able to send more messages. You will then continue to the final assessment.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="secondary" onClick={() => setConfirmFinish(false)}>Keep chatting</button>
              <button onClick={finish}>Yes, finish</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function Shell({ children, wide }) {
  return (
    <div className="page">
      <TopNav title="Learning session" right={<div className="navblock">Pilot<br />study</div>} />
      <main className="split">
        <div className="center">
          <div className="card" style={wide ? { maxWidth: 700 } : undefined}>{children}</div>
        </div>
        <div className="side-red" />
      </main>
    </div>
  );
}
