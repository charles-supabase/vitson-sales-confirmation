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
];

export const EMPTY_LOOKUPS = Object.fromEntries(LOOKUPS.map(([key]) => [key, []]));

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function friendlyError(err) {
  if (err?.code === "23503") return "This record is still linked to other records. Remove the linked records first.";
  if (err?.code === "42501") return `Not allowed by row level security: ${err.message}. Add a policy for this table (see the sql folder, files 04 and 05).`;
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
export async function searchJobOrders({ cusJoNo, customerId, date, from, to, jobTicket, dateRecipe, noRecipeOnly } = {}) {
  let salesIds = null;
  if (cusJoNo || customerId) {
    let q = supabase.from(T.confirmation).select("id");
    if (customerId) q = q.eq("customer_id", Number(customerId));
    if (cusJoNo) q = q.ilike("cus_jo_no", `%${likeEscape(cusJoNo.trim())}%`);
    salesIds = unwrap(await q).map((r) => r.id);
    if (salesIds.length === 0) return [];
  }
  let q = supabase.from(T.jobOrder).select("*").order("date_job_order", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (salesIds) q = q.in("sales_id", salesIds);
  if (jobTicket) q = q.ilike("job_ticket", `%${likeEscape(jobTicket.trim())}%`);
  if (date) q = q.eq("date_job_order", date);
  if (from) q = q.gte("date_job_order", from);
  if (to) q = q.lte("date_job_order", to);
  if (dateRecipe) q = q.eq("date_recipe", dateRecipe);
  if (noRecipeOnly) q = q.is("date_recipe", null);
  return unwrap(await q);
}
