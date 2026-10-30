// Deploy to: vitson-recipe (NOT charles-supabase).
// Called by the delivery form's "Set default" button. It writes the customer's default alias to
// charles-supabase's tbl_Customer (the source of truth), then updates the local mirror right away.
// The customer webhook (sync-reference-data) mirrors the same value back a moment later, so both stay equal.
//
// Secrets to set on vitson-recipe:
//   CHARLES_SUPABASE_URL        https://xsknxirraveijgvbdfxs.supabase.co
//   CHARLES_SERVICE_ROLE_KEY    charles-supabase's service role (secret) key
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to the function automatically.

import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Only a signed-in user with the deliveries module may use this (the session is checked by the database, public.app_can)
  const check = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/app_can`, {
    method: "POST",
    headers: {
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") ?? ""}`,
      "x-app-token": req.headers.get("x-app-token") ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_module: "deliveries" }),
  }).catch(() => null);
  if (!check || !check.ok || (await check.json().catch(() => false)) !== true) return json({ error: "Sign in again: this needs a valid session." }, 401);

  const url = Deno.env.get("CHARLES_SUPABASE_URL");
  const key = Deno.env.get("CHARLES_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "CHARLES_SUPABASE_URL / CHARLES_SERVICE_ROLE_KEY are not set on this function." }, 500);

  const body = await req.json().catch(() => null);
  const customerId = body?.customer_id;
  const aliasId = body?.alias_id;
  if (!isId(customerId) || !isId(aliasId)) return json({ error: "customer_id and alias_id must be positive whole numbers." }, 400);

  const source = createClient(url, key, { auth: { persistSession: false } });

  // only an alias that exists can become a default
  const alias = await source.from("tbl_Alias").select("id").eq("id", aliasId).maybeSingle();
  if (alias.error) return json({ error: alias.error.message }, 500);
  if (!alias.data) return json({ error: `Alias ${aliasId} does not exist in charles-supabase.` }, 404);

  // the one column this function may change
  const updated = await source.from("tbl_Customer").update({ default_alias_id: aliasId }).eq("id", customerId).select("id, default_alias_id");
  if (updated.error) return json({ error: updated.error.message }, 500);
  if (!updated.data || updated.data.length === 0) return json({ error: `Customer ${customerId} does not exist in charles-supabase.` }, 404);

  // local mirror, so the form is right immediately (the webhook writes the same value)
  const local = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const mirrored = await local
    .from("tbl_Customer_Sync")
    .update({ default_alias_id: aliasId, synced_at: new Date().toISOString() })
    .eq("id", customerId);
  if (mirrored.error) return json({ ok: true, customer_id: customerId, default_alias_id: aliasId, warning: mirrored.error.message });

  return json({ ok: true, customer_id: customerId, default_alias_id: aliasId });
});
