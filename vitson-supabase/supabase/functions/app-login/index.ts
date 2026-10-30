// Deploy to: vitson-recipe.   supabase functions deploy app-login --no-verify-jwt
// The only door into the app: it checks user + password (public.app_login) and the office rule (super admins anywhere, everybody else
// only from OFFICE_PUBLIC_IP), and later re-checks the session (public.app_verify) when the app opens and every few minutes.
//
// Secret to set on vitson-recipe:
//   OFFICE_PUBLIC_IP    136.158.62.199      (IPv4 only; never put it in the app code)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to the function automatically.
//
// Actions (POST JSON):  { action: "login", username, password }   { action: "verify" } (token in the x-app-token header)
//                       { action: "ip-check" }  -> what address the function sees, to test the office rule before relying on it

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The caller's address. cf-connecting-ip is set by Cloudflare in front of the platform and cannot be forged by the caller;
// the others are fall-backs. When in doubt the answer simply won't match the office address (the safe direction).
function clientIp(req: Request) {
  const cf = req.headers.get("cf-connecting-ip");
  const real = req.headers.get("x-real-ip");
  const xff = req.headers.get("x-forwarded-for");
  const lastXff = xff ? xff.split(",").map((s) => s.trim()).filter(Boolean).pop() ?? null : null;
  return { ip: (cf ?? real ?? lastXff ?? "").trim(), seen: { "cf-connecting-ip": cf, "x-real-ip": real, "x-forwarded-for": xff } };
}
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/^::ffff:/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, code: "method" }, 405);

  const office = Deno.env.get("OFFICE_PUBLIC_IP") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const { ip, seen } = clientIp(req);

  if (body?.action === "ip-check") {
    return json({ ok: true, ip, seen, office_configured: office !== "", in_office: office !== "" && norm(ip) === norm(office) });
  }

  if (body?.action === "login") {
    const username = String(body.username ?? "").slice(0, 60);
    const password = String(body.password ?? "").slice(0, 200);
    if (!username || !password) return json({ ok: false, code: "bad_credentials" });
    const { data, error } = await db.rpc("app_login", { p_username: username, p_password: password, p_ip: ip, p_office_ip: office });
    if (error) return json({ ok: false, code: "server", message: error.message }, 500);
    return json(data);
  }

  if (body?.action === "verify") {
    const token = req.headers.get("x-app-token") ?? "";
    if (!token) return json({ ok: false, code: "expired" });
    const { data, error } = await db.rpc("app_verify", { p_token: token, p_ip: ip, p_office_ip: office });
    if (error) return json({ ok: false, code: "server", message: error.message }, 500);
    return json(data);
  }

  return json({ ok: false, code: "unknown_action" }, 400);
});
