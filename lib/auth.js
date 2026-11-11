import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "pilot_admin";

function secret() {
  return process.env.ADMIN_SESSION_SECRET || "s:" + (process.env.ADMIN_PASSWORD || "");
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expect = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export function checkPassword(pw) {
  const real = process.env.ADMIN_PASSWORD;
  if (!real) return false;
  const a = crypto.createHash("sha256").update(String(pw)).digest();
  const b = crypto.createHash("sha256").update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function setAdminCookie(name) {
  const jar = await cookies();
  jar.set(COOKIE, sign({ name, exp: Date.now() + 12 * 3600 * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.VERCEL === "1",
    path: "/",
    maxAge: 12 * 3600,
  });
}
export async function clearAdminCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Returns admin identity string, or null. */
export async function getAdmin() {
  const jar = await cookies();
  const p = verify(jar.get(COOKIE)?.value);
  return p ? p.name : null;
}

export async function requireAdmin() {
  const a = await getAdmin();
  if (!a) throw new Response(JSON.stringify({ error: "Not authorised" }), { status: 401 });
  return a;
}

/** Wrap an admin route handler so thrown Responses are returned. */
export function adminRoute(fn) {
  return async (req, ctx) => {
    try {
      const admin = await requireAdmin();
      return await fn(req, ctx, admin);
    } catch (e) {
      if (e instanceof Response) return e;
      console.error(e);
      return Response.json({ error: "Server error" }, { status: 500 });
    }
  };
}
