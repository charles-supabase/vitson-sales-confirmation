import { useEffect, useId, useMemo, useState } from "react";
import { computeQuantity, fmtNum, groupRowsByStep, quantityMode } from "../lib/recipeUtils.js";
import { formatVolume, formatWeight } from "../lib/format.js";

function NumberCell({ value, onCommit, label, integer = false, disabled = false }) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);

  const commit = () => {
    const text = String(draft).trim();
    const next = text === "" ? null : Number(text);
    if (next !== null && (!Number.isFinite(next) || (integer && !Number.isInteger(next)))) {
      setDraft(value ?? ""); // not a valid number: put the old value back
      return;
    }
    if (next !== (value ?? null)) onCommit(next);
  };

  return (
    <input
      className="cell-input num"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={disabled ? "" : draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

// Ratio (default 8 for dye / color reference, 15 per Body roll for finishing), then the two volumes it drives.
function RatioBox({ ratio, hasOverride, finishing, grmVolume, bodyWeight, onCommit, disabled }) {
  const id = useId();
  const [draft, setDraft] = useState(ratio ?? "");
  useEffect(() => setDraft(ratio ?? ""), [ratio]);

  const commit = () => {
    const text = String(draft).trim();
    if (text === "") {
      setDraft(ratio ?? ""); // an empty box means "use the default"
      if (hasOverride) onCommit(null);
      return;
    }
    const next = Number(text);
    if (!Number.isFinite(next) || next <= 0) {
      setDraft(ratio ?? "");
      return;
    }
    if (next !== ratio) onCommit(next);
  };

  return (
    <div className="ratio-row">
      <label htmlFor={id}>Ratio</label>
      <input
        id={id}
        className="ratio-input"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <span className="ratio-vol" title={finishing ? "Body rolls x ratio" : "Total roll weight x ratio"}>
        Grm volume: <b>{grmVolume === null ? "-" : formatVolume(grmVolume)}</b>
      </span>
      <span className="ratio-vol" title="Quantity = % OWF x Body weight / 100">
        % OWF volume: <b>{bodyWeight > 0 ? formatWeight(bodyWeight) : "-"}</b>
      </span>
    </div>
  );
}

function RecipeRow({ row, stepOptions, itemGroups, allowedItemIds, itemsById, calc, volumeName, onCommit, onDelete }) {
  const mode = quantityMode(row);
  const computed = calc(row);
  const missingItem = row.item_id && !allowedItemIds.has(row.item_id) ? itemsById.get(row.item_id) : null; // keep an item that this section no longer lists
  return (
    <tr className={!row.dyeing_steps_id ? "row-incomplete" : !row.item_id ? "row-blank" : undefined}>
      <td>
        <select
          className="cell-input"
          aria-label="Dyeing step"
          value={row.dyeing_steps_id ?? ""}
          onChange={(e) => onCommit(row, { dyeing_steps_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Select step</option>
          {stepOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.dye_step_name}</option>
          ))}
        </select>
      </td>
      <td>
        <select
          className="cell-input"
          aria-label="Item"
          value={row.item_id ?? ""}
          onChange={(e) =>
            onCommit(row, e.target.value ? { item_id: Number(e.target.value) } : { item_id: null, grm: null, percent_OWF: null, quantity: null })
          }
        >
          <option value="">Blank row (no item)</option>
          {missingItem && <option value={missingItem.id}>{missingItem.item_name}</option>}
          {itemGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i.id} value={i.id}>{i.is_active === false ? `${i.item_name} (inactive)` : i.item_name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </td>
      <td><NumberCell label="Grm" disabled={!row.item_id} value={row.grm} onCommit={(v) => onCommit(row, v !== null ? { grm: v, percent_OWF: null } : { grm: v })} /></td>
      <td><NumberCell label="Percent OWF" disabled={!row.item_id} value={row.percent_OWF} onCommit={(v) => onCommit(row, v !== null ? { percent_OWF: v, grm: null } : { percent_OWF: v })} /></td>
      {mode === "grm" || mode === "pct" ? (
        <td className="num computed-cell" title={mode === "grm" ? `Grm \u00d7 ${volumeName} \u00f7 1000` : "% OWF \u00d7 body weight \u00f7 100"}>
          {computed !== null ? fmtNum(computed, 3) : <span className="msg-soft">{mode === "grm" ? "needs ratio" : "needs body rolls"}</span>}
        </td>
      ) : (
        <td><NumberCell label="Quantity" disabled={mode === "blank"} value={row.quantity} onCommit={(v) => onCommit(row, { quantity: v })} /></td>
      )}
      <td><NumberCell label="Order" integer value={row.order} onCommit={(v) => onCommit(row, { order: v })} /></td>
      <td className="actions-col">
        <button type="button" className="roll-x" aria-label="Delete row" onClick={() => onDelete(row)}>&times;</button>
      </td>
    </tr>
  );
}

export default function RecipeGroup({
  tone, // "dye" | "color" | "finishing": the section's background colour
  title,
  warning,
  rows,
  stepsById,
  stepOptions,
  itemGroups,
  itemsById,
  busy,
  finishing = false,
  ratio,
  hasOverride,
  grmVolume,
  bodyWeight,
  changed,
  hasDefault,
  onAdd,
  onAddBlank,
  onCommit,
  onDelete,
  onReload,
  onSave,
  onRatio,
}) {
  const blocks = useMemo(() => groupRowsByStep(rows, stepsById), [rows, stepsById]);
  const allowedItemIds = useMemo(() => new Set(itemGroups.flatMap((g) => g.items.map((i) => i.id))), [itemGroups]);
  const calc = (row) => computeQuantity(row, bodyWeight, grmVolume);
  const volumeName = finishing ? "finishing volume" : "dye volume";
  const update = changed && hasDefault;

  return (
    <section className={`recipe-group tone-${tone}`}>
      <header className="recipe-group-head">
        <h3>{title}</h3>
        <div className="recipe-group-actions">
          <button type="button" className="btn btn-small" onClick={onAdd} disabled={busy}>Add row</button>
          <button type="button" className="btn btn-small" onClick={onReload} disabled={busy}>Reload defaults</button>
          <button type="button" className={`btn btn-small ${update ? "btn-orange-strong" : "btn-orange"}`} onClick={onSave} disabled={busy}>
            {update ? "Update Default" : "Save default"}
          </button>
        </div>
      </header>

      {warning && <p className="msg-error" role="status">{warning}</p>}

      <RatioBox ratio={ratio} hasOverride={hasOverride} finishing={finishing} grmVolume={grmVolume} bodyWeight={bodyWeight} onCommit={onRatio} disabled={busy} />

      <div className="table-scroll">
        <table className="recipe-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Item</th>
              <th className="num" title={`Quantity = Grm \u00d7 ${volumeName} \u00f7 1000`}>Grm</th>
              <th className="num" title="Quantity = % OWF \u00d7 body weight \u00f7 100">% OWF</th>
              <th className="num">Qty</th>
              <th className="num">Order</th>
              <th className="actions-col"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="state-cell">No rows.</td></tr>}
            {blocks.map((block) => [
              <tr className="step-band" key={`band-${block.stepId ?? "none"}-${block.rows[0].id}`}>
                <th colSpan={6} scope="colgroup">{block.name}</th>
                <th className="actions-col">
                  {block.stepId && (
                    <button type="button" className="link-btn" onClick={() => onAddBlank(block.stepId)} disabled={busy} title="Add a blank spacing row under this step">
                      + blank
                    </button>
                  )}
                </th>
              </tr>,
              ...block.rows.map((row) => (
                <RecipeRow
                  key={row.id}
                  row={row}
                  stepOptions={stepOptions}
                  itemGroups={itemGroups}
                  allowedItemIds={allowedItemIds}
                  itemsById={itemsById}
                  calc={calc}
                  volumeName={volumeName}
                  onCommit={onCommit}
                  onDelete={onDelete}
                />
              )),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
