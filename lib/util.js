import crypto from "crypto";
import { q } from "./db";

export const nowIso = () => new Date().toISOString();
export const uid = (p = "") => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function newAccessCode() {
  const bytes = crypto.randomBytes(10);
  let s = "";
  for (const b of bytes) s += ALPHA[b % 32];
  return s.slice(0, 5) + "-" + s.slice(5);
}
export function normalizeCode(c) {
  return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const tokenHash = (code) => sha256("pilot:" + normalizeCode(code));

export async function logEvent({ session_id = null, participant_id = null, type, details = null, admin = null }) {
  try {
    await q(
      `INSERT INTO events (event_id, session_id, participant_id, event_type, ts, details, admin_identity) VALUES (?,?,?,?,?,?,?)`,
      [uid("e_"), session_id, participant_id, type, nowIso(), details ? JSON.stringify(details) : null, admin]
    );
  } catch (e) {
    console.error("event log failed", e);
  }
}

export function csv(rows, cols) {
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel keeps French accents
}

export function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
