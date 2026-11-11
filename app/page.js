"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const router = useRouter();
  function go(e) {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 6) return setErr("Please enter the access code you were given.");
    router.push(`/p/${c}`);
  }
  return (
    <main className="hero">
      <section className="hero-left">
        <h1>Welcome to your<br />learning session</h1>
        <p>You will have a short, timed conversation with an AI tutor. Enter the access code a researcher gave you to begin.</p>
        <form className="hero-form" onSubmit={go}>
          <label htmlFor="code">Access code</label>
          <input id="code" autoComplete="off" autoFocus placeholder="XXXXX-XXXXX" value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }} />
          {err && <p className="error small" style={{ marginTop: 10 }}>{err}</p>}
          <div style={{ marginTop: 18 }}><button type="submit" className="linkish">Continue</button></div>
        </form>
      </section>
      <section className="hero-right">
        <div className="side"><strong>Learn by talking</strong>Ask questions, explain ideas in your own words, and work through the topic with your tutor.</div>
        <div className="badge"><b>1:1</b><span>a private session just for you</span></div>
      </section>
    </main>
  );
}
