"use client";
import { useEffect, useState } from "react";

export async function aapi(path, body, method) {
  const r = await fetch(path, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

export function fmtTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtLeft(ms) {
  if (ms == null) return "–";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Login({ onDone }) {
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    const { status, data } = await aapi("/api/admin/login", { name, password: pw });
    if (status === 200) onDone(); else setErr(data.error || "Login failed");
  }
  return (
    <main className="split">
      <div className="center">
        <form className="card" onSubmit={submit}>
          <div className="brand"><span className="dot" /> Researcher access</div>
          <h1>Administrator login</h1>
          <label>Your name (recorded with admin actions)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <label>Password</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {err && <p className="error small">{err}</p>}
          <div style={{ marginTop: 18 }}><button type="submit">Log in</button></div>
        </form>
      </div>
      <div className="side-red" />
    </main>
  );
}

export default function AdminShell({ children }) {
  const [ok, setOk] = useState(null);
  async function check() {
    const { status } = await aapi("/api/admin/settings");
    setOk(status === 200);
  }
  useEffect(() => { check(); }, []);
  if (ok === null) return <div className="admin muted">Loading…</div>;
  if (!ok) return <Login onDone={check} />;
  async function logout() { await aapi("/api/admin/logout", {}); setOk(false); }
  return (
    <>
      <div className="redband" style={{ padding: "14px 22px" }}>
        <div className="admin-nav" style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div className="serif" style={{ color: "#fff", fontWeight: 700, fontSize: 20 }}>Pilot study · Researcher dashboard</div>
          <div className="links">
            <a href="/admin" style={{ color: "#fff" }}>Sessions</a>
            <a href="/admin/settings" style={{ color: "#fff" }}>Study settings</a>
            <button className="secondary small" style={{ background: "transparent", color: "#fff", borderColor: "#fff" }} onClick={logout}>Log out</button>
          </div>
        </div>
      </div>
      <div className="admin">{children}</div>
    </>
  );
}
