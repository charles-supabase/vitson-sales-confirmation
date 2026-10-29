import { useEffect, useMemo, useState } from "react";
import RecipeGroup from "./RecipeGroup.jsx";
import RecipeReport from "./RecipeReport.jsx";
import { GROUPS, buildItemGroups, computeQuantity, dyeVolume, hasBothValues, isIncomplete } from "../lib/recipeUtils.js";
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

const DESCRIPTIONS = {
  1: "Copied from the default recipe of the selected dye procedure.",
  2: "Copied from the default finishing recipe that matches this job order.",
  3: "Copied from the default recipe of this job order's color reference.",
};

export default function RecipeSection({ jobOrder, confirmation, customerName, lookups, rolls, notify, confirmAction }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [procedureId, setProcedureId] = useState("");
  const [meta, setMeta] = useState({}); // result of the last defaults lookup per group, this session only
  const [busy, setBusy] = useState(null); // "start" | "final" | group number
  const [activeCounts, setActiveCounts] = useState({ dye: 0, fin: 0 });
  const [dirty, setDirty] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [ratios, setRatios] = useState({}); // dye volume ratio per section: { 1: 10, 2: 8 }

  const jobOrderId = jobOrder?.id;
  // Body + 1x1 + Collar + Cuffs + any other roll of this job order
  const totalWeight = rolls.reduce((n, r) => n + Number(r.roll_wt || 0), 0);

  const stepsById = useMemo(() => new Map(lookups.dyeSteps.map((s) => [s.id, s])), [lookups.dyeSteps]);
  const stepOptions = useMemo(
    () => [...lookups.dyeSteps].sort((a, b) => a.dye_step_name.localeCompare(b.dye_step_name, undefined, { sensitivity: "base" })),
    [lookups.dyeSteps]
  );
  const itemGroups = useMemo(() => buildItemGroups(lookups.items, lookups.itemBounds), [lookups.items, lookups.itemBounds]);
  const itemsById = useMemo(() => new Map(lookups.items.map((i) => [i.id, i])), [lookups.items]);

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
        setRatios(Object.fromEntries(ratioRows.map((r) => [r.group_by, r.dye_ratio])));
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
      <section>
        <div className="empty-panel">
          <h2>Select a job order first</h2>
          <p>A recipe belongs to a job order. Choose one in the Job Order section.</p>
        </div>
      </section>
    );
  }

  const procedureName = lookups.procedures.find((p) => String(p.id) === procedureId)?.procedure_name?.trim();
  const colorRefCode = lookups.colorRefs.find((c) => c.id === jobOrder.color_ref_id)?.color_ref_code;
  const started = rows.length > 0 || Boolean(procedureId);
  const rowsOf = (g) => rows.filter((r) => r.group_by === g);

  const refreshRows = async () => setRows(await listTempRecipe(jobOrderId));

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
      await refreshRows();
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
    await refreshRows();
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
    const title = GROUPS.find((g) => g.n === group).title.toLowerCase();
    confirmAction({
      title: `Reload the ${title}?`,
      message: "The rows in this section will be replaced with the saved defaults. Your edits here will be lost.",
      confirmLabel: "Reload defaults",
      tone: "primary",
      onConfirm: () => reloadGroup(group, procedureId),
    });
  };

  // Row editing: every change is kept in tbl_temp_recipe straight away
  // stepId given = "Add blank row" under that step: only the step and an order are set. The order starts
  // right after that step's last row; change it to move the blank row.
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
    // average_price is looked up from tbl_Item_Sync when an item is put on a row (the same moment the
    // defaults are appended), and stays as it was until the item changes again
    const basePatch =
      "item_id" in rawPatch
        ? { ...rawPatch, average_price: rawPatch.item_id ? itemsById.get(rawPatch.item_id)?.average_price ?? null : null }
        : rawPatch;
    // quantity = Grm x dye volume, or % OWF x total roll weight (the database repeats this when saving)
    const q = computeQuantity({ ...row, ...basePatch }, totalWeight, dyeVolume(totalWeight, ratios[row.group_by] ?? null));
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
      setRatios((r) => {
        const next = { ...r };
        if (value === null) delete next[group];
        else next[group] = value;
        return next;
      });
      await refreshRows(); // the database recomputed this section's quantities
      setDirty(true);
    } catch (err) {
      notify("error", "Couldn't set the dye volume ratio", friendlyError(err));
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
      const existing = inGroup.some((r) => r.source_id);
      title = "Save the dye recipe as a default?";
      message = existing
        ? `This updates the default recipe of ${procedureName}. Every job order that uses this procedure will start from these rows.`
        : `This saves these rows as the default recipe of ${procedureName}.`;
    } else if (group === 2) {
      const existing = inGroup.some((r) => r.source_parent_id) || meta[2]?.parent_id;
      title = "Save the finishing recipe as a default?";
      message = existing
        ? "This updates the default finishing recipe that matches this job order."
        : "This creates a new default finishing entry for this customer, fabric, body touch, tone, mercerize, stock no., SPI and dye process, and saves these rows under it.";
    } else {
      if (!jobOrder.color_ref_id) return notify("error", "No color reference", "Select a color reference on the job order first.");
      title = "Save the color reference recipe as a default?";
      message = `This saves these rows as the default recipe of color reference ${colorRefCode}. Other job orders with this color reference will start from them.`;
    }

    confirmAction({
      title,
      message,
      confirmLabel: "Save default",
      tone: "primary",
      onConfirm: async () => {
        const res = await saveRecipeGroup(jobOrderId, group, group === 1 ? Number(procedureId) : null);
        await refreshRows();
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
      notify("success", "Recipe saved", `${res.dye} dye rows and ${res.finishing} finishing rows are now the active recipe for job ticket ${jobOrder.job_ticket}.`);
    } catch (err) {
      notify("error", "Couldn't save the recipe", friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  // Status line under each section title
  const finishingMissing = [
    [!confirmation?.customer_id, "customer"],
    [!jobOrder.fabric_id, "fabric"],
    [!jobOrder.body_touch_id, "body touch"],
    [!jobOrder.tone_id, "tone"],
    [!jobOrder.stock_no, "stock no."],
    [jobOrder.spi === null || jobOrder.spi === undefined, "SPI"],
    [!jobOrder.dye_process_id, "dye process"],
  ].filter(([missing]) => missing).map(([, name]) => name);

  const statusFor = (group) => {
    const m = meta[group];
    const inGroup = rowsOf(group);
    if (group === 1) {
      if (!procedureId) return { tone: "idle", text: "Select a dye procedure to load its default recipe." };
      if (m) return m.rows > 0 ? { tone: "ok", text: `Loaded ${m.rows} rows from the default recipe of ${procedureName}.` } : { tone: "warn", text: `${procedureName} has no default recipe yet. Add rows, then save to create it.` };
      return inGroup.some((r) => r.source_id) ? { tone: "ok", text: `Copied from the default recipe of ${procedureName}.` } : { tone: "warn", text: `Not saved as a default of ${procedureName} yet.` };
    }
    if (group === 2) {
      if (finishingMissing.length) return { tone: "warn", text: `The job order needs ${finishingMissing.join(", ")} before a default finishing recipe can be matched or saved.` };
      if (m) {
        if (m.reason === "no_match") return { tone: "warn", text: "No default finishing recipe matches this job order. Add rows, then save to create one." };
        if (m.reason === "no_default") return { tone: "warn", text: "A matching default finishing entry exists but has no rows yet." };
        return { tone: "ok", text: `Loaded ${m.rows} rows from the matching default finishing recipe.` };
      }
      return inGroup.some((r) => r.source_parent_id) ? { tone: "ok", text: "Copied from the matching default finishing recipe." } : { tone: "warn", text: "No default finishing recipe is linked to these rows yet." };
    }
    if (!jobOrder.color_ref_id) return { tone: "warn", text: "This job order has no color reference. Select one on the job order to use a color reference recipe." };
    if (m) return m.rows > 0 ? { tone: "ok", text: `Loaded ${m.rows} rows from the default recipe of color reference ${colorRefCode}.` } : { tone: "warn", text: `Color reference ${colorRefCode} has no default recipe yet. Add rows, then save to create it.` };
    return inGroup.some((r) => r.source_id) ? { tone: "ok", text: `Copied from the default recipe of color reference ${colorRefCode}.` } : { tone: "warn", text: `Not saved as a default of color reference ${colorRefCode} yet.` };
  };

  const hasActive = activeCounts.dye + activeCounts.fin > 0;
  const printHint = !hasActive ? "Save the recipe first" : dirty ? "There are changes since the last save. Save the recipe first." : undefined;
  const lookupWarnings = [
    lookups.procedures.length === 0 && "No dye procedures loaded.",
    lookups.dyeSteps.length === 0 && "No dyeing steps loaded.",
    lookups.items.length === 0 && "No items loaded. Add tbl_Item and tbl_Item_Bound to the sync and run the backfill.",
  ].filter(Boolean);

  return (
    <section aria-labelledby="rc-title">
      <div className="section-head">
        <div>
          <h2 id="rc-title">Recipe</h2>
          <p className="section-sub">
            Job ticket {jobOrder.job_ticket}, sales confirmation {confirmation?.sales_confirm_no}, {customerName ?? "unknown customer"}.
          </p>
        </div>
        <div className="recipe-actions">
          <button type="button" className="btn" onClick={() => setReportOpen(true)} disabled={!hasActive || dirty} title={printHint}>Print</button>
          <button type="button" className="btn btn-primary" onClick={saveRecipe} disabled={busy !== null || rows.length === 0}>
            {busy === "final" ? "Saving..." : "Save recipe"}
          </button>
        </div>
      </div>

      {lookupWarnings.length > 0 && <div className="banner banner-warn" role="status"><span>{lookupWarnings.join(" ")}</span></div>}
      {rolls.length === 0 && <div className="banner banner-warn" role="status"><span>This job order has no fabric rolls yet. You can still build the recipe.</span></div>}

      <div className="proc-card">
        <label htmlFor="procedure">1. Dye procedure</label>
        <select id="procedure" value={procedureId} onChange={onProcedureChange} disabled={busy !== null || loading}>
          <option value="">Select a dye procedure</option>
          {lookups.procedures.map((p) => (
            <option key={p.id} value={p.id}>{p.procedure_name.trim()}</option>
          ))}
        </select>
        <p className="field-hint">
          {busy === "start"
            ? "Building the recipe..."
            : "Choosing a procedure loads its default dye recipe, then looks up the default finishing recipe and the default color reference recipe for this job order."}
        </p>
      </div>

      {loading && <p className="state-cell">Loading recipe...</p>}

      {!loading && started && (
        <div className="recipe-groups">
          {GROUPS.map((g) => (
            <RecipeGroup
              key={g.n}
              title={`${g.n}. ${g.title}`}
              description={DESCRIPTIONS[g.n]}
              status={statusFor(g.n)}
              rows={rowsOf(g.n)}
              stepsById={stepsById}
              stepOptions={stepOptions}
              itemGroups={itemGroups}
              busy={busy !== null}
              onAdd={() => addRow(g.n)}
              onAddBlank={(stepId) => addRow(g.n, stepId)}
              onCommit={commitRow}
              onDelete={removeRow}
              onReload={() => askReload(g.n)}
              onSave={() => askSave(g.n)}
              saveLabel={`Save ${g.short.toLowerCase()} default`}
              ratio={ratios[g.n] ?? null}
              weight={totalWeight}
              volume={dyeVolume(totalWeight, ratios[g.n] ?? null)}
              onRatio={(value) => changeRatio(g.n, value)}
            />
          ))}
        </div>
      )}

      {reportOpen && (
        <RecipeReport
          onClose={() => setReportOpen(false)}
          confirmation={confirmation}
          customerName={customerName}
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
