// Deploy to: charles-supabase's Project
// Triggered by a Database Webhook on tbl_Customer (INSERT / UPDATE / DELETE).
// Mirrors each change into vitson-recipe.tbl_Customer_Sync using that project's service role key.
//
// It also supports a one-time / repair backfill:  POST {"backfill": true}

import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Adjust these two if your source table differs ------------------------
const SOURCE_TABLE = "tbl_Customer";
const toMirrorRow = (r: Record<string, unknown>) => ({
  id: r.id as bigint,
  customer_name: r.customer_name as string, // <- change to the real name column
  address: r.address as string,
  customer_TIN: r.customer_TIN as bigint,
  customer_no: r.customer_no as string,
  is_active: true,
  synced_at: new Date().toISOString(),
});
// ---------------------------------------------------------------------------

const TARGET_URL = Deno.env.get("TARGET_SUPABASE_URL")!;
const TARGET_KEY = Deno.env.get("TARGET_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const TARGET_TABLE = "tbl_Customer_Sync";

// Service-role client for vitson-recipe (never exposed to the browser)
const target = createClient(TARGET_URL, TARGET_KEY, { auth: { persistSession: false } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function upsertRows(rows: ReturnType<typeof toMirrorRow>[]) {
  const { error } = await target.from(TARGET_TABLE).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

async function deactivate(id: string) {
  // Soft delete: tbl_Sales_Confirmation rows may still reference this customer.
  const { error } = await target
    .from(TARGET_TABLE)
    .update({ is_active: false, synced_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

async function backfill() {
  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected into every Edge Function automatically.
  const source = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const page = 1000;
  let from = 0;
  let total = 0;
  while (true) {
    const { data, error } = await source.from(SOURCE_TABLE).select("*").order("id").range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    await upsertRows(data.map(toMirrorRow));
    total += data.length;
    if (data.length < page) break;
    from += page;
  }
  return { backfilled: total };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!WEBHOOK_SECRET || !safeEqual(provided, WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  try {
    if (body.backfill === true) return json(await backfill());

    switch (body.type) {
      case "INSERT":
      case "UPDATE":
        await upsertRows([toMirrorRow(body.record)]);
        return json({ ok: true, action: "upsert", id: body.record.id });
      case "DELETE":
        await deactivate(body.old_record.id);
        return json({ ok: true, action: "deactivate", id: body.old_record.id });
      default:
        return json({ error: `Unsupported event: ${body.type}` }, 400);
    }
  } catch (err) {
    console.error("sync-customer failed:", err);
    return json({ error: (err as { message?: string }).message ?? "Sync failed" }, 500);
  }
});
