// Deploy to: charles-supabase's Project
// One function for every mirrored table. Each Database Webhook (INSERT / UPDATE / DELETE)
// on a source table calls it; the payload's `table` field picks the mapping below.
// Writes into vitson-recipe with that project's service role key.
//
// Repair / first load:  POST {"backfill": true}                      -> every table
//                       POST {"backfill": true, "table": "tbl_tone"} -> one table

import { createClient } from "npm:@supabase/supabase-js@2";

type Spec = { target: string; columns: string[] };

// source table -> mirror table + the columns to copy (names exactly as in the source)
const TABLES: Record<string, Spec> = {
  tbl_Customer: {
    target: "tbl_Customer_Sync",
    columns: ["id", "customer_name", "address", "customer_TIN", "customer_no", "default_alias_id"],
  },
  tbl_Alias: {
    target: "tbl_Alias_Sync",
    columns: ["id", "alias_name", "TIN_number", "associated_customer", "alias_address"],
  },
  tbl_Fabric: { target: "tbl_Fabric_Sync", columns: ["id", "fabric_name"] },
  tbl_tone: { target: "tbl_tone_sync", columns: ["id", "tone_name", "tone_code"] },
  tbl_dye_process_type: {
    target: "tbl_dye_process_type_sync",
    columns: ["id", "dye_process_name"],
  },
  // Keep tbl_Item_Bound before tbl_Item: tbl_Item_Sync.bound_id points at it (matters for the backfill order)
  tbl_Item_Bound: {
    target: "tbl_Item_Bound_Sync",
    columns: ["id", "bound_name", "sorting_id"],
  },
  tbl_Item: {
    target: "tbl_Item_Sync",
    columns: ["id", "item_name", "Price", "bound_id", "Shade_id", "average_price"],
  },
};

const TARGET_URL = Deno.env.get("TARGET_SUPABASE_URL")!;
const TARGET_KEY = Deno.env.get("TARGET_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;

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

function mirrorRow(spec: Spec, record: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const col of spec.columns) row[col] = record[col] ?? null;
  return { ...row, is_active: true, synced_at: new Date().toISOString() };
}

async function upsertRows(spec: Spec, rows: Record<string, unknown>[]) {
  const { error } = await target.from(spec.target).upsert(rows, { onConflict: "id" });
  if (error) throw error;
}

// Soft delete: job orders and other records may still point at this row.
async function deactivate(spec: Spec, ids: unknown[]) {
  if (ids.length === 0) return;
  const { error } = await target
    .from(spec.target)
    .update({ is_active: false, synced_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
}

async function backfillTable(name: string) {
  const spec = TABLES[name];
  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected into every Edge Function automatically.
  const source = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const page = 1000;
  const seen = new Set<unknown>();
  let from = 0;
  while (true) {
    const { data, error } = await source.from(name).select("*").order("id").range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    await upsertRows(spec, data.map((r) => mirrorRow(spec, r)));
    data.forEach((r) => seen.add(r.id));
    if (data.length < page) break;
    from += page;
  }
  // Anything still active in the mirror but gone from the source was deleted while the webhook was off.
  const { data: mirrored, error } = await target.from(spec.target).select("id").eq("is_active", true);
  if (error) throw error;
  const stale = (mirrored ?? []).map((r) => r.id).filter((id) => !seen.has(id));
  await deactivate(spec, stale);
  return { table: name, synced: seen.size, deactivated: stale.length };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const provided = req.headers.get("x-webhook-secret") ?? "";
  if (!WEBHOOK_SECRET || !safeEqual(provided, WEBHOOK_SECRET)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  try {
    if (body.backfill === true) {
      const names = body.table ? [body.table as string] : Object.keys(TABLES);
      const unknown = names.find((n) => !TABLES[n]);
      if (unknown) return json({ error: `Unknown table: ${unknown}` }, 400);
      const results = [];
      for (const name of names) results.push(await backfillTable(name));
      return json({ ok: true, results });
    }

    const spec = TABLES[body.table as string];
    if (!spec) return json({ error: `Table not mirrored: ${body.table}` }, 400);

    switch (body.type) {
      case "INSERT":
      case "UPDATE":
        await upsertRows(spec, [mirrorRow(spec, body.record)]);
        return json({ ok: true, action: "upsert", table: body.table, id: body.record.id });
      case "DELETE":
        await deactivate(spec, [body.old_record.id]);
        return json({ ok: true, action: "deactivate", table: body.table, id: body.old_record.id });
      default:
        return json({ error: `Unsupported event: ${body.type}` }, 400);
    }
  } catch (err) {
    console.error("sync-reference-data failed:", err);
    return json({ error: (err as { message?: string }).message ?? "Sync failed" }, 500);
  }
});
