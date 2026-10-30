import { supabase } from "./supabase.js";

const T = {
  confirmation: "tbl_Sales_Confirmation",
  jobOrder: "tbl_job_order",
  fabricInfo: "tbl_fabric_info",
};

// key in the lookups object, table, column to sort by
const LOOKUPS = [
  ["customers", "tbl_Customer_Sync", "customer_name"],
  ["dyeProcesses", "tbl_dye_process_type_sync", "dye_process_name"],
  ["fabrics", "tbl_Fabric_Sync", "fabric_name"],
  ["tones", "tbl_tone_sync", "tone_name"],
  ["colors", "tbl_color", "color_name"],
  ["colorRefs", "tbl_color_ref", "color_ref_code"],
  ["touches", "tbl_touch", "touch_name"],
  ["reprocessReasons", "tbl_reprocess_reasons", "defect_names"],
  ["rollTypes", "tbl_roll_type", "id"],
  ["prices", "tbl_price_list", "id"],
  ["dyeSteps", "tbl_dyeing_steps", "dye_step_name"],
  ["procedures", "tbl_default_dyeing_procedure", "id"],
  ["items", "tbl_Item_Sync", "item_name"],
  ["itemBounds", "tbl_Item_Bound_Sync", "sorting_id"],
  ["machines", "tbl_machine", "machine_name"],
  ["aliases", "tbl_Alias_Sync", "alias_name"],
  ["receivableTypes", "tbl_receivable_type", "id"],
];

export const EMPTY_LOOKUPS = Object.fromEntries(LOOKUPS.map(([key]) => [key, []]));

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function friendlyError(err) {
  if (err?.code === "23503") return "This record is still linked to other records. Remove the linked records first.";
  if (err?.code === "42501") return "You are not allowed to do this, or your session has ended. Sign in again, or ask Charles or Susan for access.";
  return err?.message ?? "Something went wrong.";
}

async function fetchAll(table, order) {
  const pageSize = 1000;
  const all = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(order)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all.push(...data);
    if (data.length < pageSize) return { data: all, error: null };
  }
}

/** Loads every dropdown list. A missing list doesn't stop the rest; it is reported as a warning. */
export async function loadLookups() {
  const results = await Promise.all(LOOKUPS.map(([, table, order]) => fetchAll(table, order)));
  const lookups = {};
  const warnings = [];
  results.forEach(({ data, error }, i) => {
    const [key, table] = LOOKUPS[i];
    if (error) {
      lookups[key] = [];
      warnings.push(`${table}: ${error.message}`);
    } else {
      lookups[key] = data;
    }
  });
  return { lookups, warnings };
}

async function save(table, { id, ...fields }) {
  const query = id ? supabase.from(table).update(fields).eq("id", id) : supabase.from(table).insert(fields);
  return unwrap(await query.select().single());
}

async function remove(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) throw error;
}

// Section 1: Sales Confirmation
export async function listConfirmations() {
  return unwrap(
    await supabase
      .from(T.confirmation)
      .select("*")
      .order("confirmation_date", { ascending: false })
      .order("id", { ascending: false })
  );
}
export const saveConfirmation = (row) => save(T.confirmation, row);
export const deleteConfirmation = (id) => remove(T.confirmation, id);

// Section 2: Job Order
export async function listJobOrderStubs() {
  return unwrap(await supabase.from(T.jobOrder).select("id, sales_id"));
}
export async function listJobOrders(salesId) {
  return unwrap(
    await supabase
      .from(T.jobOrder)
      .select("*")
      .eq("sales_id", salesId)
      .order("date_job_order", { ascending: true })
      .order("id", { ascending: true })
  );
}
export const saveJobOrder = (row) => save(T.jobOrder, row);
export const deleteJobOrder = (id) => remove(T.jobOrder, id);

/** Adds a color reference code to tbl_color_ref (or returns the existing one with the same code). */
export async function createColorRef(code) {
  const escaped = code.replace(/[\\%_]/g, "\\$&");
  const existing = unwrap(await supabase.from("tbl_color_ref").select("*").ilike("color_ref_code", escaped).limit(1));
  if (existing.length) return existing[0];
  return unwrap(await supabase.from("tbl_color_ref").insert({ color_ref_code: code }).select().single());
}

/** The price of a customer / tone / fabric / dye process combination in tbl_customer_price, or null when there is none. */
export async function findCustomerPrice({ customerId, toneId, fabricId, dyeProcessId }) {
  const rows = unwrap(
    await supabase
      .from("tbl_customer_price")
      .select("*")
      .eq("customer_id", customerId)
      .eq("tone_id", toneId)
      .eq("fabric_id", fabricId)
      .eq("dye_process_id", dyeProcessId)
      .order("id")
      .limit(1)
  );
  return rows[0] ?? null;
}

/** Saves the price of a combination: updates the record when the combination exists without a price, else adds it. */
export async function createCustomerPrice(keys, unitPrice) {
  const existing = await findCustomerPrice(keys);
  if (existing) {
    return unwrap(await supabase.from("tbl_customer_price").update({ unit_price: unitPrice }).eq("id", existing.id).select().single());
  }
  return unwrap(
    await supabase
      .from("tbl_customer_price")
      .insert({ customer_id: keys.customerId, tone_id: keys.toneId, fabric_id: keys.fabricId, dye_process_id: keys.dyeProcessId, unit_price: unitPrice })
      .select()
      .single()
  );
}

/** Which of these job orders have a delivery that was copied (tbl_Delivery.copied = true)? Returns a Set of job order ids. */
export async function copiedJobOrderIds(jobOrderIds) {
  const out = new Set();
  for (let i = 0; i < jobOrderIds.length; i += 150) {
    const rows = unwrap(
      await supabase.from("tbl_Delivery").select("job_order_id").eq("copied", true).in("job_order_id", jobOrderIds.slice(i, i + 150))
    );
    rows.forEach((r) => out.add(r.job_order_id));
  }
  return out;
}

// Section 3: Fabric Info
export async function listRolls(jobOrderId) {
  return unwrap(await supabase.from(T.fabricInfo).select("*").eq("job_order_id", jobOrderId).order("id"));
}
export async function listRollsForJobOrders(ids) {
  if (ids.length === 0) return [];
  return unwrap(await supabase.from(T.fabricInfo).select("job_order_id, roll_wt").in("job_order_id", ids));
}
export async function addRolls(jobOrderId, rollTypeId, weights) {
  const rows = weights.map((roll_wt) => ({ job_order_id: jobOrderId, roll_type_id: rollTypeId, roll_wt }));
  return unwrap(await supabase.from(T.fabricInfo).insert(rows).select());
}
export const deleteRoll = (id) => remove(T.fabricInfo, id);

// Section 4: Recipe
const RECIPE = {
  temp: "tbl_temp_recipe",
  activeDye: "tbl_active_dye_recipe",
  activeFinishing: "tbl_active_finishing_recipe",
};

export async function listTempRecipe(jobOrderId) {
  return unwrap(await supabase.from(RECIPE.temp).select("*").eq("job_order_id", jobOrderId).order("id"));
}
export async function insertTempRow(row) {
  return unwrap(await supabase.from(RECIPE.temp).insert(row).select().single());
}
export async function updateTempRow(id, patch) {
  return unwrap(await supabase.from(RECIPE.temp).update(patch).eq("id", id).select().single());
}
export const deleteTempRow = (id) => remove(RECIPE.temp, id);

export async function listActiveDye(jobOrderId) {
  return unwrap(await supabase.from(RECIPE.activeDye).select("*").eq("job_order_id", jobOrderId).order("id"));
}
export async function listActiveFinishing(jobOrderId) {
  return unwrap(await supabase.from(RECIPE.activeFinishing).select("*").eq("job_order_id", jobOrderId).order("id"));
}

// These run inside the database (see sql/04_recipe_module.sql), one transaction per call.
const rpc = async (fn, args) => unwrap(await supabase.rpc(fn, args));
export const loadRecipeGroup = (jobOrderId, group, procedureId = null) =>
  rpc("recipe_load_group", { p_job_order_id: jobOrderId, p_group: group, p_procedure_id: procedureId });
export const saveRecipeGroup = (jobOrderId, group, procedureId = null) =>
  rpc("recipe_save_group", { p_job_order_id: jobOrderId, p_group: group, p_procedure_id: procedureId });
export const finalizeRecipe = (jobOrderId) => rpc("recipe_finalize", { p_job_order_id: jobOrderId });

// Dye volume ratio per job order and section. Setting it also recomputes that section's quantities in the database.
export async function listRatios(jobOrderId) {
  return unwrap(await supabase.from("tbl_recipe_ratio").select("*").eq("job_order_id", jobOrderId));
}
export const setRecipeRatio = (jobOrderId, group, ratio) =>
  rpc("recipe_set_ratio", { p_job_order_id: jobOrderId, p_group: group, p_ratio: ratio });

// Search job orders. Filters combine (AND). cusJoNo and customerId live on the sales confirmation, so they are
// resolved to its ids first. Returns the latest 500 matches.
const likeEscape = (v) => v.replace(/[\\%_]/g, "\\$&");
export async function searchJobOrders({ cusJoNo, customerId, date, from, to, jobTicket, dateRecipe, noRecipeOnly, status } = {}) {
  let salesIds = null;
  if (cusJoNo || customerId) {
    let q = supabase.from(T.confirmation).select("id");
    if (customerId) q = q.eq("customer_id", Number(customerId));
    if (cusJoNo) q = q.ilike("cus_jo_no", `%${likeEscape(cusJoNo.trim())}%`);
    salesIds = unwrap(await q).map((r) => r.id);
    if (salesIds.length === 0) return [];
  }
  // status conditions on the stage dates (see sql/10_status_filter.sql): the matching ids come from the database first
  const hasStatus = status && Object.keys(status).length > 0;
  const statusIds = hasStatus ? unwrap(await supabase.rpc("job_order_status_ids", { p_cond: status })) : null;
  if (statusIds && statusIds.length === 0) return [];
  const build = (idChunk) => {
  let q = supabase.from(T.jobOrder).select("*").order("date_job_order", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (idChunk) q = q.in("id", idChunk);
  if (salesIds) q = q.in("sales_id", salesIds);
  if (jobTicket) {
    // a ticket can be typed with or without its dashes
    const raw = jobTicket.trim();
    const compact = raw.replace(/[\s-]/g, "");
    if (compact && compact !== raw) {
      const terms = [raw, compact].map((t) => t.replace(/[%_,()*]/g, ""));
      q = q.or(terms.map((t) => `job_ticket.ilike.*${t}*`).join(","));
    } else {
      q = q.ilike("job_ticket", `%${likeEscape(raw)}%`);
    }
  }
  if (date) q = q.eq("date_job_order", date);
  if (from) q = q.gte("date_job_order", from);
  if (to) q = q.lte("date_job_order", to);
  if (dateRecipe) q = q.eq("date_recipe", dateRecipe);
  if (noRecipeOnly) q = q.is("date_recipe", null);
  return q;
  };

  if (!statusIds) return unwrap(await build(null));
  // many ids would make the request address too long: ask in chunks, then merge (newest first, 500 at most)
  const chunks = [];
  for (let i = 0; i < statusIds.length; i += 150) chunks.push(statusIds.slice(i, i + 150));
  const found = [];
  for (let i = 0; i < chunks.length; i += 6) {
    const parts = await Promise.all(chunks.slice(i, i + 6).map(async (c) => unwrap(await build(c))));
    parts.forEach((p) => found.push(...p));
  }
  found.sort((a, b) => String(b.date_job_order ?? "").localeCompare(String(a.date_job_order ?? "")) || b.id - a.id);
  return found.slice(0, 500);
}

/**
 * Stage dates for a list of job orders: Map(job_order_id -> { hydro, dryer, heatset, packed, delivered }).
 * Tracking comes from tbl_tracking, the delivered date from tbl_Delivery.
 */
export async function listStageDates(jobOrderIds) {
  const out = new Map();
  const put = (id, patch) => out.set(id, { ...(out.get(id) ?? {}), ...patch });
  for (let i = 0; i < jobOrderIds.length; i += 150) {
    const chunk = jobOrderIds.slice(i, i + 150);
    const [t, d] = await Promise.all([
      supabase.from("tbl_tracking").select("*").in("job_order_id", chunk),
      supabase.from("tbl_Delivery").select("job_order_id, date_delivery").in("job_order_id", chunk),
    ]);
    for (const r of unwrap(t)) put(r.job_order_id, { hydro: r.date_hydro, dryer: r.date_dryer, heatset: r.date_Heatset, packed: r.date_packed });
    for (const r of unwrap(d)) put(r.job_order_id, { delivered: r.date_delivery });
  }
  return out;
}

// Tracking: one tbl_tracking record per job order (stage dates and the machine of each stage)
export async function getTracking(jobOrderId) {
  const rows = unwrap(await supabase.from("tbl_tracking").select("*").eq("job_order_id", jobOrderId).limit(1));
  return rows[0] ?? null;
}
export const saveTracking = (row) => save("tbl_tracking", row);
export const deleteTracking = (id) => remove("tbl_tracking", id);
export async function listRecentTracking(limit = 25) {
  const rows = unwrap(await supabase.from("tbl_tracking").select("*").order("id", { ascending: false }).limit(limit));
  const ids = rows.map((r) => r.job_order_id).filter(Boolean);
  const jobs = ids.length
    ? unwrap(await supabase.from(T.jobOrder).select("id, job_ticket, sales_id, dye_process_id, color_id").in("id", ids))
    : [];
  return { rows, jobs };
}

// Tracking summary: total roll weight per dye process for the job orders whose date_hydro is in [from, to]
export async function trackingWeightSummary(from, to, status = {}) {
  return unwrap(await supabase.rpc("tracking_weight_summary", { p_from: from, p_to: to, p_cond: status ?? {} }));
}

// Deliveries: the local tables tbl_Delivery and tbl_fabric_info_delivered
export const findDeliveryCandidates = async (search = "") =>
  unwrap(await supabase.rpc("delivery_candidates", { p_search: search, p_limit: 50 }));

/** One transaction: the delivery and all of its delivered rolls (rolls: [{ roll_type_id, roll_wt }]). */
export const saveDelivery = (d) =>
  rpc("delivery_save", {
    p_id: d.id ?? null,
    p_job_order_id: d.job_order_id,
    p_delivery_receipt: d.delivery_receipt,
    p_receivable_type_id: d.receivable_type_id,
    p_date_delivery: d.date_delivery,
    p_alias_id: d.alias_id ?? null,
    p_shrinkage_length: d.shrinkage_length ?? null,
    p_shrinkage_width: d.shrinkage_width ?? null,
    p_acquired_density: d.acquired_density ?? null,
    p_rolls: d.rolls,
  });

/** The highest delivery receipt number used so far for a receivable type (1 BIG, 2 SMALL); 0 when there is none. */
export async function getMaxDeliveryReceipt(receivableTypeId) {
  const rows = unwrap(
    await supabase
      .from("tbl_Delivery")
      .select("delivery_receipt")
      .eq("receivable_type_id", receivableTypeId)
      .not("delivery_receipt", "is", null)
      .order("delivery_receipt", { ascending: false })
      .limit(1)
  );
  return rows.length ? Number(rows[0].delivery_receipt) : 0;
}

export async function listDeliveredRolls(deliveryId) {
  return unwrap(await supabase.from("tbl_fabric_info_delivered").select("*").eq("delivery_id", deliveryId).order("id"));
}
export const deleteDelivery = (id) => remove("tbl_Delivery", id);

/**
 * Everything the printed delivery receipt needs: all deliveries that share this receipt number and receivable type
 * (one receipt can carry several job tickets) with their job orders, sales confirmations and delivered rolls.
 */
export async function loadDeliveryReceipt(receivableTypeId, receiptNo) {
  const deliveries = unwrap(
    await supabase.from("tbl_Delivery").select("*").eq("receivable_type_id", receivableTypeId).eq("delivery_receipt", receiptNo).order("id")
  );
  if (deliveries.length === 0) return { deliveries, jobs: [], sales: [], rolls: [] };
  const jobs = unwrap(await supabase.from(T.jobOrder).select("*").in("id", deliveries.map((d) => d.job_order_id)));
  const sales = unwrap(await supabase.from(T.confirmation).select("*").in("id", [...new Set(jobs.map((j) => j.sales_id))]));
  const rolls = unwrap(await supabase.from("tbl_fabric_info_delivered").select("*").in("delivery_id", deliveries.map((d) => d.id)).order("id"));
  return { deliveries, jobs, sales, rolls };
}

export async function listRecentDeliveries(limit = 30) {
  const rows = unwrap(await supabase.from("tbl_Delivery").select("*").order("id", { ascending: false }).limit(limit));
  if (rows.length === 0) return { rows, rolls: [], jobs: [] };
  const [rolls, jobs] = await Promise.all([
    supabase.from("tbl_fabric_info_delivered").select("delivery_id, roll_wt").in("delivery_id", rows.map((r) => r.id)),
    supabase.from(T.jobOrder).select("*").in("id", rows.map((r) => r.job_order_id)),
  ]);
  return { rows, rolls: unwrap(rolls), jobs: unwrap(jobs) };
}

/**
 * Sets the customer's default alias. It is written to charles-supabase's tbl_Customer by the set-default-alias Edge
 * Function (vitson-recipe), which also updates the local mirror; the customer webhook then keeps both in step.
 * If that function isn't deployed yet, only the local mirror is updated and { localOnly: true } is returned.
 */
export async function setDefaultAlias(customerId, aliasId) {
  const { data, error } = await supabase.functions.invoke("set-default-alias", { body: { customer_id: customerId, alias_id: aliasId } });
  if (!error) return { ...data, localOnly: false };

  const notDeployed = error.name === "FunctionsFetchError" || error.context?.status === 404;
  if (!notDeployed) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }
  unwrap(await supabase.from("tbl_Customer_Sync").update({ default_alias_id: aliasId }).eq("id", customerId).select("id").single());
  return { ok: true, customer_id: customerId, default_alias_id: aliasId, localOnly: true };
}
