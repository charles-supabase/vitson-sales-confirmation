import { useEffect, useMemo, useState } from "react";
import RecipeGroup from "./RecipeGroup.jsx";
import { formatTicket } from "../lib/format.js";
import RecipeReport from "./RecipeReport.jsx";
import {
  bodyRollCountOf,
  bodyWeightOf,
  buildItemGroups,
  computeQuantity,
  effectiveRatio,
  hasBothValues,
  isIncomplete,
  itemsForGroup,
  ratioKey,
  rowSignature,
  sectionVolume,
} from "../lib/recipeUtils.js";
import {
  deleteTempRow,
  finalizeRecipe,
  friendlyError,
  insertTempRow,
  listActiveDye,
  listActiveFinishing,
  listRatios,
  listTempRecipe,
  loadRecipeGroup,
  saveRecipeGroup,
  setRecipeRatio,
  updateTempRow,
} from "../lib/salesApi.js";

// Layout: dye recipe on the left; color reference above finishing on the right.
const SECTIONS = {
  1: { n: 1, title: "Dye recipe", tone: "dye", short: "dye recipe" },
  2: { n: 2, title: "Finishing recipe", tone: "finishing", short: "finishing recipe" },
  3: { n: 3, title: "Color reference recipe", tone: "color", short: "color reference recipe" },
};

export default function RecipeSection({ jobOrder, confirmation, lookups, rolls, rollsLoading, onNeedFabric, notify, confirmAction }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [procedureId, setProcedureId] = useState("");
  const [meta, setMeta] = useState({}); // result of the last defaults lookup per group, this session only
  const [busy, setBusy] = useState(null); // "start" | "final" | group number
  const [activeCounts, setActiveCounts] = useState({ dye: 0, fin: 0 });
  const [dirty, setDirty] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [ratios, setRatios] = useState({}); // stored ratios per section: { 1: 10, 2: 12 }. Missing = the default (8 / 15).
  const [baseline, setBaseline] = useState({}); // per group: Map(row id -> signature) as loaded from / saved to the defaults

  const jobOrderId = jobOrder?.id;
  // Total of ALL rolls drives the dye volume, the BODY rolls alone drive % OWF, and the number of Body rolls drives the finishing volume
  const totalWeight = rolls.reduce((n, r) => n + Number(r.roll_wt || 0), 0);
  const bodyWeight = bodyWeightOf(rolls, lookups.rollTypes);
  const bodyRolls = bodyRollCountOf(rolls, lookups.rollTypes);

  const stepsById = useMemo(() => new Map(lookups.dyeSteps.map((s) => [s.id, s])), [lookups.dyeSteps]);
  const stepOptions = useMemo(
    () => [...lookups.dyeSteps].sort((a, b) => a.dye_step_name.localeCompare(b.dye_step_name, undefined, { sensitivity: "base" })),
    [lookups.dyeSteps]
  );
  // Items offered per section, by bound: dye = all except 22-25, color reference = 22-25, finishing = 1, 4, 10, 11, 17, 19, 20
  const itemGroupsBy = useMemo(
    () => ({
      1: buildItemGroups(itemsForGroup(lookups.items, 1), lookups.itemBounds),
      2: buildItemGroups(itemsForGroup(lookups.items, 2), lookups.itemBounds),
      3: buildItemGroups(itemsForGroup(lookups.items, 3), lookups.itemBounds),
    }),
    [lookups.items, lookups.itemBounds]
  );
  const itemsById = useMemo(() => new Map(lookups.items.map((i) => [i.id, i])), [lookups.items]);

  const captureBaseline = (temp, groups) =>
    setBaseline((b) => {
      const next = { ...b };
      for (const g of groups) next[g] = new Map(temp.filter((r) => r.group_by === g).map((r) => [r.id, rowSignature(r)]));
      return next;
    });

  // Load the working copy (and what is already saved as the active recipe) for this job order
  useEffect(() => {
    if (!jobOrderId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setMeta({});
      setReportOpen(false);
      try {
        const [temp, dye, fin, ratioRows] = await Promise.all([
          listTempRecipe(jobOrderId),
          listActiveDye(jobOrderId),
          listActiveFinishing(jobOrderId),
          listRatios(jobOrderId),
        ]);
        if (cancelled) return;
        const dyeInTemp = temp.filter((r) => r.group_by !== 2).length;
        setRows(temp);
        captureBaseline(temp, [1, 2, 3]);
        setRatios(Object.fromEntries(ratioRows.filter((r) => r.group_by !== 3).map((r) => [r.group_by, r.dye_ratio])));
        setProcedureId(String(temp.find((r) => r.group_by === 1 && r.source_parent_id)?.source_parent_id ?? ""));
        setActiveCounts({ dye: dye.length, fin: fin.length });
        setDirty(dye.length + fin.length === 0 || dyeInTemp !== dye.length || temp.length - dyeInTemp !== fin.length);
      } catch (err) {
        if (!cancelled) notify("error", "Couldn't load the recipe", friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobOrderId, notify]);

  if (!jobOrder) {
    return (
      <section className="panel theme-recipe">
        <div className="empty-panel">
          <h2>Select a job order first</h2>
          <p>A recipe belongs to a job order. Choose one in the Job Order section.</p>
        </div>
      </section>
    );
  }

  // A recipe can only be created for a job order that has fabric info
  if (rollsLoading) {
    return (
      <section className="panel theme-recipe">
        <p className="msg state-cell">Loading...</p>
      </section>
    );
  }
  if (rolls.length === 0) {
    return (
      <section className="panel theme-recipe">
        <div className="empty-panel">
          <h2>Add fabric info first</h2>
          <p>A recipe can only be created for a job order that has fabric info.</p>
          <button type="button" className="btn btn-primary" onClick={onNeedFabric}>Go to Fabric Info</button>
        </div>
      </section>
    );
  }

  const procedureName = lookups.procedures.find((p) => String(p.id) === procedureId)?.procedure_name?.trim();
  const colorRefCode = lookups.colorRefs.find((c) => c.id === jobOrder.color_ref_id)?.color_ref_code;
  const started = rows.length > 0 || Boolean(procedureId);
  const rowsOf = (g) => rows.filter((r) => r.group_by === g);

  // withBaseline = these groups now match the defaults (after loading them or saving them), so "changed" starts again from here
  const refreshRows = async (withBaseline = null) => {
    const temp = await listTempRecipe(jobOrderId);
    setRows(temp);
    if (withBaseline) captureBaseline(temp, withBaseline);
    return temp;
  };

  // Step 1 + 2 + 3: dye defaults for the chosen procedure, then finishing defaults, then color reference defaults
  const buildFromDefaults = async (pid) => {
    setBusy("start");
    try {
      const results = {
        1: await loadRecipeGroup(jobOrderId, 1, Number(pid)),
        2: await loadRecipeGroup(jobOrderId, 2),
        3: await loadRecipeGroup(jobOrderId, 3),
      };
      setMeta(results);
      setProcedureId(String(pid));
      await refreshRows([1, 2, 3]);
      setDirty(true);
    } catch (err) {
      notify("error", "Couldn't build the recipe", friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const reloadGroup = async (group, pid) => {
    const result = await loadRecipeGroup(jobOrderId, group, group === 1 ? Number(pid) : null);
    setMeta((m) => ({ ...m, [group]: result }));
    if (group === 1) setProcedureId(String(pid));
    await refreshRows([group]);
    setDirty(true);
  };

  const onProcedureChange = (e) => {
    const pid = e.target.value;
    if (!pid || pid === procedureId) return;
    if (rows.length === 0) return buildFromDefaults(pid);
    const name = lookups.procedures.find((p) => String(p.id) === pid)?.procedure_name?.trim();
    confirmAction({
      title: "Replace the dye recipe?",
      message: `The rows in the dye recipe section will be replaced with the defaults of ${name}. Your edits in that section will be lost. The finishing and color reference sections stay as they are.`,
      confirmLabel: "Replace dye recipe",
      tone: "primary",
      onConfirm: () => reloadGroup(1, pid),
    });
  };

  const askReload = (group) => {
    if (group === 1 && !procedureId) return notify("error", "Select a dye procedure", "Choose the dye procedure first.");
    confirmAction({
      title: `Reload the ${SECTIONS[group].short}?`,
      message: "The rows in this section will be replaced with the saved defaults. Your edits here will be lost.",
      confirmLabel: "Reload defaults",
      tone: "primary",
      onConfirm: () => reloadGroup(group, procedureId),
    });
  };

  // Row editing: every change is kept in tbl_temp_recipe straight away.
  // stepId given = "+ blank" under that step: only the step and an order are set. The order starts right after
  // that step's last row; change it to move the blank row.
  const addRow = async (group, stepId = null) => {
    const inGroup = rowsOf(group);
    const sameStep = stepId ? inGroup.filter((r) => r.dyeing_steps_id === stepId) : [];
    const orderBase = sameStep.length ? sameStep : inGroup;
    const order = orderBase.reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;
    const parent =
      group === 1
        ? procedureId
          ? Number(procedureId)
          : null
        : group === 3
        ? jobOrder.color_ref_id ?? null
        : inGroup.find((r) => r.source_parent_id)?.source_parent_id ?? meta[2]?.parent_id ?? null;
    try {
      const row = await insertTempRow({ job_order_id: jobOrderId, group_by: group, dyeing_steps_id: stepId, order, source_parent_id: parent });
      setRows((rs) => [...rs, row]);
      setDirty(true);
    } catch (err) {
      notify("error", "Couldn't add the row", friendlyError(err));
    }
  };

  const commitRow = async (row, rawPatch) => {
    // average_price is looked up from tbl_Item_Sync when an item is put on a row (the same moment the defaults are appended)
    const basePatch =
      "item_id" in rawPatch
        ? { ...rawPatch, average_price: rawPatch.item_id ? itemsById.get(rawPatch.item_id)?.average_price ?? null : null }
        : rawPatch;
    // quantity follows Grm / % OWF (the database repeats this when saving)
    const volume = sectionVolume(row.group_by, effectiveRatio(ratios, row.group_by), totalWeight, bodyRolls);
    const q = computeQuantity({ ...row, ...basePatch }, bodyWeight, volume);
    const patch = q !== null ? { ...basePatch, quantity: q } : basePatch;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    setDirty(true);
    try {
      await updateTempRow(row.id, patch);
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? row : r)));
      notify("error", "Couldn't update the row", friendlyError(err));
    }
  };

  const changeRatio = async (group, value) => {
    setBusy(group);
    try {
      await setRecipeRatio(jobOrderId, group, value);
      // dye (1) and color reference (3) share one ratio
      const key = ratioKey(group);
      setRatios((r) => {
        const next = { ...r };
        if (value === null) delete next[key];
        else next[key] = value;
        return next;
      });
      await refreshRows(); // the database recomputed this section's quantities
      setDirty(true);
    } catch (err) {
      notify("error", "Couldn't set the ratio", friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (row) => {
    try {
      await deleteTempRow(row.id);
      setRows((rs) => rs.filter((r) => r.id !== row.id));
      setDirty(true);
    } catch (err) {
      notify("error", "Couldn't delete the row", friendlyError(err));
    }
  };

  // Is the section linked to a saved default, and has it changed since?
  const hasDefault = (g) => rowsOf(g).some((r) => r.source_id) || (meta[g]?.rows ?? 0) > 0;
  const changedFor = (g) => {
    const base = baseline[g];
    const cur = rowsOf(g);
    if (!base) return false;
    return cur.length !== base.size || cur.some((r) => base.get(r.id) !== rowSignature(r)); // rows added / deleted / edited
  };

  // Save one section as a default
  const askSave = (group) => {
    const inGroup = rowsOf(group);
    if (inGroup.length === 0) return notify("error", "Nothing to save", "Add at least one row to this section first.");
    if (inGroup.some(isIncomplete)) return notify("error", "Rows without a step", "Every row needs a dyeing step. Choose one for the highlighted rows, or delete them.");
    if (inGroup.some(hasBothValues)) return notify("error", "Grm and % OWF", "A row can have a Grm or a % OWF, not both. Clear one of them.");

    let title;
    let message;
    if (group === 1) {
      if (!procedureId) return notify("error", "Select a dye procedure", "Choose the dye procedure first.");
      title = hasDefault(1) ? "Update the default dye recipe?" : "Save the dye recipe as a default?";
      message = hasDefault(1)
        ? `This updates the default recipe of ${procedureName}. Every job order that uses this procedure will start from these rows.`
        : `This saves these rows as the default recipe of ${procedureName}.`;
    } else if (group === 2) {
      title = hasDefault(2) ? "Update the default finishing recipe?" : "Save the finishing recipe as a default?";
      message = hasDefault(2)
        ? "This updates the default finishing recipe that matches this job order."
        : "This creates a new default finishing entry for this customer, fabric, body touch, tone, mercerize, stock no., SPI and dye process, and saves these rows under it.";
    } else {
      if (!jobOrder.color_ref_id) return notify("error", "No color reference", "Select a color reference on the job order first.");
      title = hasDefault(3) ? "Update the default color reference recipe?" : "Save the color reference recipe as a default?";
      message = `This ${hasDefault(3) ? "updates" : "saves"} the default recipe of color reference ${colorRefCode}. Other job orders with this color reference will start from these rows.`;
    }

    confirmAction({
      title,
      message,
      confirmLabel: hasDefault(group) ? "Update default" : "Save default",
      tone: "primary",
      onConfirm: async () => {
        const res = await saveRecipeGroup(jobOrderId, group, group === 1 ? Number(procedureId) : null);
        await refreshRows([group]);
        setMeta((m) => ({ ...m, [group]: { group, parent_id: res.parent_id, rows: inGroup.length, reason: null } }));
        notify(
          "success",
          "Saved successfully",
          `${res.inserted} added, ${res.updated} updated, ${res.deleted} removed.${res.created_parent ? " A new default finishing entry was created." : ""}`
        );
      },
    });
  };

  // Final save: the active recipe for this job order
  const saveRecipe = async () => {
    if (rows.length === 0) return notify("error", "Nothing to save", "Build the recipe first.");
    if (rows.some(isIncomplete)) return notify("error", "Rows without a step", "Every row needs a dyeing step. Choose one for the highlighted rows, or delete them.");
    if (rows.some(hasBothValues)) return notify("error", "Grm and % OWF", "A row can have a Grm or a % OWF, not both. Clear one of them.");
    setBusy("final");
    try {
      const res = await finalizeRecipe(jobOrderId);
      setActiveCounts({ dye: res.dye, fin: res.finishing });
      setDirty(false);
      notify("success", "Recipe saved", `${res.dye} dye rows and ${res.finishing} finishing rows are now the active recipe for job ticket ${formatTicket(jobOrder.job_ticket)}.`);
    } catch (err) {
      notify("error", "Couldn't save the recipe", friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  // The only status messages kept: a red one when no saved default is linked to a section
  const finishingMissing = [
    [!confirmation?.customer_id, "customer"],
    [!jobOrder.fabric_id, "fabric"],
    [!jobOrder.body_touch_id, "body touch"],
    [!jobOrder.tone_id, "tone"],
    [!jobOrder.stock_no, "stock no."],
    [jobOrder.spi === null || jobOrder.spi === undefined, "SPI"],
    [!jobOrder.dye_process_id, "dye process"],
  ].filter(([missing]) => missing).map(([, name]) => name);

  const warningFor = (g) => {
    if (!started) return null;
    if (g === 1) return procedureId && !hasDefault(1) ? `No default recipe is linked to ${procedureName}.` : null;
    if (g === 2) {
      if (finishingMissing.length) return `The job order needs ${finishingMissing.join(", ")} before a default finishing recipe can be matched or saved.`;
      return hasDefault(2) ? null : "No default finishing recipe is linked to this job order.";
    }
    if (!jobOrder.color_ref_id) return "This job order has no color reference.";
    return hasDefault(3) ? null : `No default recipe is linked to color reference ${colorRefCode}.`;
  };

  const hasActive = activeCounts.dye + activeCounts.fin > 0;
  const printHint = !hasActive ? "Save the recipe first" : dirty ? "There are changes since the last save. Save the recipe first." : undefined;
  const lookupWarnings = [
    lookups.procedures.length === 0 && "No dye procedures loaded.",
    lookups.dyeSteps.length === 0 && "No dyeing steps loaded.",
    lookups.items.length === 0 && "No items loaded. Add tbl_Item and tbl_Item_Bound to the sync and run the backfill.",
  ].filter(Boolean);

  const groupProps = (g) => {
    const ratio = effectiveRatio(ratios, g);
    return {
      tone: SECTIONS[g].tone,
      title: SECTIONS[g].title,
      warning: warningFor(g),
      rows: rowsOf(g),
      stepsById,
      stepOptions,
      itemGroups: itemGroupsBy[g],
      itemsById,
      busy: busy !== null,
      finishing: g === 2,
      ratio,
      hasOverride: ratios[ratioKey(g)] !== undefined,
      grmVolume: sectionVolume(g, ratio, totalWeight, bodyRolls),
      bodyWeight,
      changed: changedFor(g),
      hasDefault: hasDefault(g),
      onAdd: () => addRow(g),
      onAddBlank: (stepId) => addRow(g, stepId),
      onCommit: commitRow,
      onDelete: removeRow,
      onReload: () => askReload(g),
      onSave: () => askSave(g),
      onRatio: (value) => changeRatio(g, value),
    };
  };

  return (
    <section className="panel theme-recipe" aria-labelledby="rc-title">
      <div className="section-head">
        <h2 id="rc-title">Recipe</h2>
        <div className="recipe-actions">
          <button type="button" className="btn" onClick={() => setReportOpen(true)} disabled={!hasActive || dirty} title={printHint}>Print</button>
          <button type="button" className="btn btn-primary" onClick={saveRecipe} disabled={busy !== null || rows.length === 0}>
            {busy === "final" ? "Saving..." : "Save recipe"}
          </button>
        </div>
      </div>

      {lookupWarnings.length > 0 && <div className="banner banner-warn" role="status"><span>{lookupWarnings.join(" ")}</span></div>}
      {rolls.length > 0 && bodyWeight === 0 && (
        <div className="banner banner-warn" role="status"><span>This job order has no Body rolls, so rows with a % OWF can't get a quantity.</span></div>
      )}

      <div className="proc-card">
        <label htmlFor="procedure">Dye procedure</label>
        <select id="procedure" value={procedureId} onChange={onProcedureChange} disabled={busy !== null || loading}>
          <option value="">Select a dye procedure</option>
          {lookups.procedures.map((p) => (
            <option key={p.id} value={p.id}>{p.procedure_name.trim()}</option>
          ))}
        </select>
      </div>

      {loading && <p className="msg state-cell">Loading recipe...</p>}

      {!loading && started && (
        <div className="recipe-cols">
          <div className="recipe-col">
            <RecipeGroup {...groupProps(1)} />
          </div>
          <div className="recipe-col">
            <RecipeGroup {...groupProps(3)} />
            <RecipeGroup {...groupProps(2)} />
          </div>
        </div>
      )}

      {reportOpen && (
        <RecipeReport
          onClose={() => setReportOpen(false)}
          confirmation={confirmation}
          jobOrder={jobOrder}
          lookups={lookups}
          rolls={rolls}
          ratios={ratios}
          notify={notify}
        />
      )}
    </section>
  );
}
