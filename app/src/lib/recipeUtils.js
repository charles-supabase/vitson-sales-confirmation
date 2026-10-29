// Recipe display order: the FIRST LETTER of the step name ("A) Scouring" ... "Q) Finishing"),
// then the order field ascending. Steps that share a letter ("I) Cotton Dyeing", "I) Oxidation") are
// interleaved by order; the step name and id only break exact ties.

const NO_STEP = "\uffff";

export const GROUPS = [
  { n: 1, title: "Dye recipe", short: "Dye" },
  { n: 2, title: "Finishing recipe", short: "Finishing" },
  { n: 3, title: "Color reference recipe", short: "Color reference" },
];

export function stepName(stepsById, id) {
  return stepsById.get(id)?.dye_step_name ?? "";
}

export function sortRecipeRows(rows, stepsById) {
  const key = (r) => stepName(stepsById, r.dyeing_steps_id).trim() || NO_STEP;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return (
      ka.charAt(0).toLowerCase().localeCompare(kb.charAt(0).toLowerCase()) ||
      (a.order ?? 1e9) - (b.order ?? 1e9) ||
      ka.localeCompare(kb, undefined, { sensitivity: "base" }) ||
      a.id - b.id
    );
  });
}

/** Sorted rows, split into a block each time the step changes (the report's main header). */
export function groupRowsByStep(rows, stepsById) {
  const blocks = [];
  for (const row of sortRecipeRows(rows, stepsById)) {
    const last = blocks[blocks.length - 1];
    if (last && last.stepId === row.dyeing_steps_id) last.rows.push(row);
    else blocks.push({ stepId: row.dyeing_steps_id, name: stepName(stepsById, row.dyeing_steps_id) || "No step selected", rows: [row] });
  }
  return blocks;
}

/** Items grouped by their bound (category), in the bounds' own sorting order, for <optgroup>. */
export function buildItemGroups(items, bounds) {
  const boundInfo = new Map(bounds.map((b, i) => [b.id, { name: b.bound_name, sort: b.sorting_id ?? i }]));
  const groups = new Map();
  for (const item of items) {
    const key = boundInfo.has(item.bound_id) ? item.bound_id : "other";
    if (!groups.has(key)) groups.set(key, { label: boundInfo.get(key)?.name ?? "Other", sort: boundInfo.get(key)?.sort ?? 1e9, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()]
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map((g) => ({ ...g, items: g.items.sort((a, b) => String(a.item_name).localeCompare(String(b.item_name))) }));
}

// A row needs a dyeing step. A row with a step but no item is a blank (spacing) row.
export const isIncomplete = (row) => !row.dyeing_steps_id;

// ---- Quantities -------------------------------------------------------------------------------
//   dye volume = total weight of ALL rolls x dye volume ratio
//   a row with Grm       -> quantity = Grm x dye volume / 1000
//   a row with % OWF     -> quantity = % OWF x total weight of the BODY rolls only / 100
//   only one of Grm / % OWF may have a value; a row with neither keeps a typed quantity.
//   The dye (1) and color reference (3) sections share ONE ratio (volume = total roll weight x ratio).
//   Finishing (2) has its own "volume ratio per roll": volume = number of BODY rolls x ratio, and its Grm rows use
//   quantity = Grm x finishing volume / 1000.
// (The same rules run in the database: recipe_recalc_quantities in sql/04_recipe_module.sql.)
export const BODY_ROLL_NAME = "body"; // tbl_roll_type.roll_name of the Body rolls

// Default ratios while none is stored for the job order: dye and color reference 8, finishing 15 per Body roll.
export const DEFAULT_RATIO = { 1: 8, 2: 15 };
export const effectiveRatio = (ratios, group) => ratios[group === 3 ? 1 : group] ?? DEFAULT_RATIO[group === 3 ? 1 : group];

// Items offered in each section, by tbl_Item_Sync.bound_id
export const COLOR_REF_BOUNDS = [22, 23, 24, 25];
export const FINISHING_BOUNDS = [1, 4, 10, 11, 17, 19, 20];
export function itemsForGroup(items, group) {
  if (group === 3) return items.filter((i) => COLOR_REF_BOUNDS.includes(i.bound_id));
  if (group === 2) return items.filter((i) => FINISHING_BOUNDS.includes(i.bound_id));
  return items.filter((i) => !COLOR_REF_BOUNDS.includes(i.bound_id)); // dye: every bound except the color reference ones
}

/** What "changed" means for the Update Default button: step, item, Grm, % OWF, order (and a typed quantity). */
export const rowSignature = (row) =>
  JSON.stringify([row.dyeing_steps_id ?? null, row.item_id ?? null, row.grm ?? null, row.percent_OWF ?? null, row.order ?? null,
    row.item_id && row.grm == null && row.percent_OWF == null ? row.quantity ?? null : null]);
export const ratioKey = (group) => (group === 3 ? 1 : group);

export function bodyRollCountOf(rolls, rollTypes) {
  const body = rollTypes.find((t) => String(t.roll_name).trim().toLowerCase() === BODY_ROLL_NAME);
  return body ? rolls.filter((r) => r.roll_type_id === body.id).length : 0;
}

/** Volume of a section, or null while its basis (ratio, rolls) is missing. */
export function sectionVolume(group, ratio, totalWeight, bodyRolls) {
  if (ratio === null || ratio === undefined || ratio === "") return null;
  const basis = group === 2 ? bodyRolls : totalWeight;
  return basis > 0 ? basis * ratio : null;
}

export function bodyWeightOf(rolls, rollTypes) {
  const body = rollTypes.find((t) => String(t.roll_name).trim().toLowerCase() === BODY_ROLL_NAME);
  return body ? rolls.filter((r) => r.roll_type_id === body.id).reduce((n, r) => n + Number(r.roll_wt || 0), 0) : 0;
}
export const hasVal = (v) => v !== null && v !== undefined && v !== "";

export const dyeVolume = (weight, ratio) => (hasVal(ratio) && weight > 0 ? weight * ratio : null);

export function quantityMode(row) {
  if (!row.item_id) return "blank";
  if (hasVal(row.grm) && !hasVal(row.percent_OWF)) return "grm";
  if (hasVal(row.percent_OWF) && !hasVal(row.grm)) return "pct";
  return "manual";
}

/** The computed quantity, or null when the row isn't computed or its basis (ratio / rolls) is missing. */
export function computeQuantity(row, bodyWeight, volume) {
  const mode = quantityMode(row);
  if (mode === "grm") return volume === null ? null : (row.grm * volume) / 1000;
  if (mode === "pct") return bodyWeight > 0 ? (row.percent_OWF * bodyWeight) / 100 : null;
  return null;
}

export const hasBothValues = (row) => Boolean(row.item_id) && hasVal(row.grm) && hasVal(row.percent_OWF);
export const isBlankRow = (row) => !row.item_id;

export const fmtNum = (n, digits = 2) =>
  n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString("en", { maximumFractionDigits: digits });
