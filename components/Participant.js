"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import TopNav from "@/components/TopNav";

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
  const [st, setSt] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (reconnect = false) => {
    const { data } = await api("/api/p/state", { code, reconnect });
    setSt(data);
    return data;
  }, [code]);

  useEffect(() => { refresh(true).catch(() => setNote("Cannot reach the server. Check your connection.")); }, [refresh]);
  useEffect(() => {
    if (st?.phase !== "waiting") return;
    const t = setInterval(() => refresh(false).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [st?.phase, refresh]);
  useEffect(() => {
    const off = () => api("/api/p/event", { code, type: "connection_lost", client_time: new Date().toISOString() }).catch(() => {});
    const on = () => { api("/api/p/event", { code, type: "connection_restored" }).catch(() => {}); refresh(true).catch(() => {}); };
    window.addEventListener("offline", off); window.addEventListener("online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); };
  }, [code, refresh]);

  async function start() {
    setBusy(true);
    const { data } = await api("/api/p/start", { code });
    setSt(data); setBusy(false);
  }
  async function openEndLink() {
    setBusy(true);
    const { status, data } = await api("/api/p/end-link", { code });
    setBusy(false);
    if (status === 200 && data.url) window.location.href = data.url; else setNote(data.error || "Could not open the link.");
  }

  if (!st) return <Shell><p className="muted">Loading...</p>{note && <p className="error">{note}</p>}</Shell>;
  if (st.phase === "invalid") return <Shell><p className="eyebrow">Access</p><h1>Code not recognised</h1><hr className="rule" /><p className="error">{st.error}</p><a className="linkish" href="/">Enter a different code</a></Shell>;
  if (st.phase === "blocked") return <Shell><p className="eyebrow">Access</p><h1>Access not available</h1><hr className="rule" /><p>Your access to this study is not active. Please speak to a researcher.</p></Shell>;
  if (st.phase === "waiting") return (
    <Shell><p className="eyebrow">Waiting for the researcher</p><h1>Almost ready</h1><hr className="rule" />
      <p className="notice">Your code is valid. Please wait. A researcher will confirm that you can start. This page updates automatically.</p>
      <p className="muted small">Participant ID: {st.participant_id}</p></Shell>
  );
  if (st.phase === "ready") return (
    <Shell wide><p className="eyebrow">Before you begin</p><h1>Welcome</h1><hr className="rule" />
      <p>This study takes about <b>{st.estimated_minutes} minutes</b>. Please find a quiet moment and stay on this page until you finish.</p>
      <p className="notice">Your answers are saved as you go. If the page closes, open the same link again to continue where you stopped.</p>
      <div style={{ marginTop: 22 }}><button onClick={start} disabled={busy}>Start the study</button></div></Shell>
  );
  if (st.phase === "ended") return (
    <Shell wide><p className="eyebrow">Finished</p><h1>Thank you</h1><hr className="rule" />
      <p style={{ whiteSpace: "pre-wrap" }}>{st.end_reason === "completed" ? st.end_message : "This study session has been closed. Thank you for your time."}</p>
      {st.has_end_link && <div style={{ marginTop: 18 }}><button onClick={openEndLink} disabled={busy}>Continue</button></div>}
      {note && <p className="error small">{note}</p>}</Shell>
  );
  if (st.phase !== "active" || !st.page) return <Shell><p className="error">{st.error || "Something went wrong. Please refresh the page."}</p></Shell>;
  return <ActivePage key={st.page.key} code={code} st={st} setSt={setSt} refresh={refresh} />;
}

function ActivePage({ code, st, setSt, refresh }) {
  const page = st.page;
  const [answers, setAnswers] = useState(() => {
    const a = {};
    for (const it of page.items) {
      const v = page.saved?.[it.id];
      if (v === undefined) continue;
      a[it.id] = it.type === "slider" ? Number(v) : it.type === "mc" && it.multiple ? JSON.parse(v) : v;
    }
    return a;
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const entered = useRef(performance.now());
  const chat = page.chat;
  const chatItem = page.items.find((i) => i.type === "chat");
  const chatDone = !chat || chat.status === "ended";
  const questions = page.items.filter((i) => i.type !== "chat");
  const progress = Math.round((page.index / page.total) * 100);

  if (chat && chat.status === "active") {
    return <ChatPage code={code} page={page} chatItem={chatItem} chat={chat} setSt={setSt} refresh={refresh} />;
  }

  async function next() {
    setBusy(true); setNote("");
    const { status, data } = await api("/api/p/answer", { code, step_key: page.key, answers, page_seconds: Math.round((performance.now() - entered.current) / 100) / 10 });
    setBusy(false);
    if (status === 200) { window.scrollTo({ top: 0 }); setSt(data.state); return; }
    if (status === 400 && data.errors) { setErrors(data.errors); setNote("Please answer the highlighted questions."); return; }
    if (data.state) setSt(data.state); else setNote(data.message || data.error || "Something went wrong. Please try again.");
  }
  async function startChat() {
    setBusy(true);
    const { data } = await api("/api/p/chat-start", { code, step_key: page.key });
    setBusy(false);
    setSt(data.state || data);
  }

  return (
    <div className="page">
      <TopNav title="Learning session" right={<div className="navblock">Page {page.index + 1}<br />of {page.total}</div>} />
      <div className="progress"><div style={{ width: `${progress}%` }} /></div>
      <main className="survey">
        {chatItem && (
          <div className="q-card">
            {chat.status === "not_started" ? (
              <>
                <p className="eyebrow">Chat with the tutor</p>
                <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{chatItem.text}</p>
                <p className="notice small">You will have <b>{fmt(chatItem.duration_seconds * 1000)}</b> minutes. The timer starts when you press Start chat.</p>
                <button disabled={busy} onClick={startChat}>Start chat</button>
              </>
            ) : (
              <p className="notice" style={{ margin: 0 }}><b>The chat is finished.</b> Your conversation has been saved.{questions.length ? " Please answer the questions below." : " Click Next to continue."}</p>
            )}
          </div>
        )}
        {chatDone && questions.map((it) => (
          <Item key={it.id} it={it} value={answers[it.id]} error={errors[it.id]}
                onChange={(v) => { setAnswers((a) => ({ ...a, [it.id]: v })); setErrors((e) => ({ ...e, [it.id]: undefined })); }} />
        ))}
        {note && <p className="error">{note}</p>}
        {chatDone && <div className="survey-nav"><button onClick={next} disabled={busy}>{page.index + 1 === page.total ? "Finish" : "Next"}</button></div>}
      </main>
    </div>
  );
}

function Item({ it, value, error, onChange }) {
  if (it.type === "info") return <div className="q-card info"><p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{it.text}</p></div>;
  return (
    <div className={"q-card" + (error ? " has-error" : "")}>
      <p className="q-text">{it.text}{it.required && <span className="req"> *</span>}</p>
      {it.type === "slider" && <Slider it={it} value={value} onChange={onChange} />}
      {it.type === "mc" && (
        <div className="options">
          {it.options.map((o) => {
            const checked = it.multiple ? (value || []).includes(o) : value === o;
            return (
              <label key={o} className={"option" + (checked ? " checked" : "")}>
                <input type={it.multiple ? "checkbox" : "radio"} name={it.id} checked={checked}
                       onChange={() => onChange(it.multiple ? (checked ? (value || []).filter((x) => x !== o) : [...(value || []), o]) : o)} />
                <span>{o}</span>
              </label>
            );
          })}
        </div>
      )}
      {it.type === "text" && (it.multiline
        ? <textarea rows={4} value={value || ""} maxLength={5000} onChange={(e) => onChange(e.target.value)} />
        : <input value={value || ""} maxLength={500} onChange={(e) => onChange(e.target.value)} />)}
      {error && <p className="q-error">{error}</p>}
    </div>
  );
}

/** Slider: a single dot on a plain track, starting in the middle. It counts as answered only once moved or clicked. */
function Slider({ it, value, onChange }) {
  const touched = value !== undefined && value !== null && value !== "";
  const v = touched ? Number(value) : it.start;
  const ticks = [];
  if ((it.max - it.min) / it.step <= 20) for (let x = it.min; x <= it.max + 1e-9; x += it.step) ticks.push(Math.round(x * 100) / 100);
  const mark = (e) => onChange(Number(e.target.value));
  return (
    <div className={"slider" + (touched ? " touched" : "")}>
      <input type="range" min={it.min} max={it.max} step={it.step} value={v}
             onChange={mark} onPointerUp={mark} onKeyUp={mark} aria-label={it.text} />
      {ticks.length > 0 && <div className="ticks">{ticks.map((t) => <span key={t}>{t}</span>)}</div>}
      <div className="slider-labels"><span>{it.left_label}</span><span>{it.right_label}</span></div>
      <p className="slider-value">{touched ? <>Your answer: <b>{v}</b></> : "Move or click the dot to answer."}</p>
    </div>
  );
}

function ChatPage({ code, page, chatItem, chat, setSt, refresh }) {
  const [msgs, setMsgs] = useState(chat.messages || []);
  const [pending, setPending] = useState(null);
  const [failed, setFailed] = useState(null);
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [left, setLeft] = useState(chat.remaining_ms);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const deadline = useRef(performance.now() + chat.remaining_ms);
  const pendingRef = useRef(null);
  pendingRef.current = pending;
  const endRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      const l = deadline.current - performance.now();
      setLeft(l);
      if (l <= 0) { clearInterval(t); setTimeout(() => refresh(false).catch(() => {}), 400); }
    }, 250);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    // periodic sync picks up researcher stops or time adjustments
    const t = setInterval(async () => {
      if (pendingRef.current) return;
      const { data } = await api("/api/p/state", { code });
      if (data?.page?.key === page.key && data.page.chat?.status === "active") deadline.current = performance.now() + data.page.chat.remaining_ms;
      else if (data?.phase) setSt(data);
    }, 20000);
    return () => clearInterval(t);
  }, [code, page.key, setSt]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending, failed]);

  const timeUp = left <= 0;
  function applyState(s) {
    if (!s) return;
    if (s.page?.key === page.key && s.page.chat?.status === "active") {
      setMsgs(s.page.chat.messages);
      deadline.current = performance.now() + s.page.chat.remaining_ms;
    } else setSt(s);
  }

  async function send(retry) {
    if (pending || timeUp) return;
    const item = retry || { request_id: rid(), text: input.trim() };
    if (!item.text) return;
    setNote(""); setFailed(null); setPending(item);
    if (!retry) { setInput(""); setMsgs((m) => [...m, { seq: 1e9, role: "user", text: item.text, request_id: item.request_id }]); }
    try {
      const { status, data } = await api("/api/p/chat", { code, step_key: page.key, request_id: item.request_id, text: item.text });
      setPending(null);
      if (status === 200 && data.ok) {
        if (deadline.current - performance.now() > 0) { applyState(data.state); api("/api/p/event", { code, type: "displayed", request_id: item.request_id }).catch(() => {}); }
        else await refresh(false);
      } else if (status === 409) applyState(data.state);
      else if (status === 429) setNote(data.message || "Please wait for the tutor's reply.");
      else { setFailed(item); setNote(data.message || "The tutor could not reply. Please press Retry. The timer keeps running."); }
    } catch {
      setPending(null); setFailed(item); setNote("Connection problem. Please press Retry. The timer keeps running.");
    }
  }

  async function finish() {
    setConfirmFinish(false);
    const { data } = await api("/api/p/chat-finish", { code, step_key: page.key });
    setSt(data);
  }

  return (
    <div className="chat-page">
      <TopNav title="Learning session" right={<div className={"timer-block" + (left < 60000 ? " low" : "")} aria-live="polite"><small>Time left</small><b>{fmt(left)}</b></div>} />
      <div className="progress"><div style={{ width: `${Math.round((page.index / page.total) * 100)}%` }} /></div>
      <div className="chat-wrap">
        <div className="chat-sub">
          <h2>Chat with the tutor</h2>
          {!timeUp && <button className="linkish" onClick={() => setConfirmFinish(true)}>Finish chat</button>}
        </div>
        <details className="instr"><summary>Instructions</summary><p style={{ whiteSpace: "pre-wrap" }}>{chatItem.text}</p></details>
        <div className="msgs">
          {msgs.map((m, i) => (
            <div key={m.request_id ? m.request_id + m.role : i} className={`msg ${m.role}` + (failed && m.request_id === failed.request_id && m.role === "user" ? " failed" : "")}>
              <div className="who">{m.role === "user" ? "You" : "Tutor"}</div>{m.text}
            </div>
          ))}
          {pending && <div className="typing"><span /><span /><span /> Tutor is writing...</div>}
          {failed && !timeUp && <div><button className="danger small" onClick={() => send(failed)}>Retry</button></div>}
          <div ref={endRef} />
        </div>
        {note && <div style={{ padding: "0 22px 8px" }}><div className="warn small">{note}</div></div>}
        {!timeUp ? (
          <>
            <div className="composer">
              <textarea rows={2} value={input} placeholder="Type your message..." maxLength={4000} disabled={!!pending}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button onClick={() => send()} disabled={!!pending || !input.trim() || !!failed}>Send</button>
            </div>
            <div className="foot muted small">Press Enter to send, Shift+Enter for a new line.</div>
          </>
        ) : (
          <div className="ended-bar"><b style={{ fontFamily: "var(--serif)", fontSize: 19 }}>Time is up.</b><span className="small">Saving your conversation...</span></div>
        )}
      </div>
      {confirmFinish && (
        <div className="modal-bg" role="dialog">
          <div className="card">
            <p className="eyebrow">Confirm</p><h2 style={{ marginTop: 0 }}>Finish the chat?</h2>
            <p>You will not be able to send more messages in this part.</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="secondary" onClick={() => setConfirmFinish(false)}>Keep chatting</button>
              <button onClick={finish}>Yes, finish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({ children, wide }) {
  return (
    <div className="page">
      <TopNav title="Learning session" right={<div className="navblock">Pilot<br />study</div>} />
      <main className="split">
        <div className="center"><div className="card" style={wide ? { maxWidth: 700 } : undefined}>{children}</div></div>
        <div className="side-red" />
      </main>
    </div>
  );
}
