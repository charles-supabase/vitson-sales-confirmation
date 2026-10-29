import { useEffect, useId, useMemo, useState } from "react";
import { computeQuantity, fmtNum, groupRowsByStep, quantityMode } from "../lib/recipeUtils.js";
import { formatVolume, formatWeight } from "../lib/format.js";

function NumberCell({ value, onCommit, label, integer = false, width, disabled = false }) {
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
      style={width ? { width } : undefined}
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

function RatioBox({ ratio, weight, volume, onCommit, disabled }) {
  const id = useId();
  const [draft, setDraft] = useState(ratio ?? "");
  useEffect(() => setDraft(ratio ?? ""), [ratio]);

  const commit = () => {
    const text = String(draft).trim();
    const next = text === "" ? null : Number(text);
    if (next !== null && (!Number.isFinite(next) || next <= 0)) {
      setDraft(ratio ?? ""); // the ratio must be a number above 0
      return;
    }
    if (next !== (ratio ?? null)) onCommit(next);
  };

  let message;
  if (!(weight > 0)) message = "No fabric rolls yet, so there is no dye volume.";
  else if (volume === null) message = `Total roll weight ${formatWeight(weight)}. Enter a ratio to get the dye volume.`;
  else message = `Dye volume: ${formatWeight(weight)} \u00d7 ${fmtNum(ratio, 3)} = ${formatVolume(volume)}`;

  return (
    <div className="ratio-row">
      <label htmlFor={id}>Dye volume ratio</label>
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
      <span className="ratio-message" aria-live="polite">{message}</span>
    </div>
  );
}

function RecipeRow({ row, stepOptions, itemGroups, calc, onCommit, onDelete }) {
  const mode = quantityMode(row);
  const computed = calc(row);
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
            onCommit(
              row,
              e.target.value
                ? { item_id: Number(e.target.value) }
                : { item_id: null, grm: null, percent_OWF: null, quantity: null }
            )
          }
        >
          <option value="">Blank row (no item)</option>
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
        <td
          className="num computed-cell"
          title={mode === "grm" ? "Grm \u00d7 dye volume" : "% OWF \u00d7 total roll weight"}
        >
          {computed !== null ? fmtNum(computed, 3) : <span className="muted">{mode === "grm" ? "needs ratio" : "needs rolls"}</span>}
        </td>
      ) : (
        <td><NumberCell label="Quantity" disabled={mode === "blank"} value={row.quantity} onCommit={(v) => onCommit(row, { quantity: v })} /></td>
      )}
      <td><NumberCell label="Order" integer width="64px" value={row.order} onCommit={(v) => onCommit(row, { order: v })} /></td>
      <td className="actions-col">
        <button type="button" className="roll-x" aria-label="Delete row" onClick={() => onDelete(row)}>&times;</button>
      </td>
    </tr>
  );
}

export default function RecipeGroup({
  title,
  description,
  status,
  rows,
  stepsById,
  stepOptions,
  itemGroups,
  busy,
  onAdd,
  onAddBlank,
  onCommit,
  onDelete,
  onReload,
  onSave,
  saveLabel,
  ratio,
  weight,
  volume,
  onRatio,
}) {
  const blocks = useMemo(() => groupRowsByStep(rows, stepsById), [rows, stepsById]);
  const calc = (row) => computeQuantity(row, weight, volume);

  return (
    <section className="recipe-group">
      <header className="recipe-group-head">
        <div>
          <h3>{title}</h3>
          <p className="section-sub">{description}</p>
        </div>
        <div className="recipe-group-actions">
          <button type="button" className="btn" onClick={onAdd} disabled={busy}>Add row</button>
          <button type="button" className="btn" onClick={onReload} disabled={busy}>Reload defaults</button>
          <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>{saveLabel}</button>
        </div>
      </header>

      <p className={`recipe-status recipe-status-${status.tone}`} role="status">{status.text}</p>

      <RatioBox ratio={ratio} weight={weight} volume={volume} onCommit={onRatio} disabled={busy} />

      <div className="table-scroll">
        <table className="recipe-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Item</th>
              <th className="num" title="Quantity = Grm × dye volume">Grm</th>
              <th className="num" title="Quantity = % OWF × total roll weight">% OWF</th>
              <th className="num">Quantity</th>
              <th className="num">Order</th>
              <th className="actions-col"><span className="sr-only">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="state-cell">No rows. Use Add row to start this recipe. A row with a step and no item is a blank spacing row; its order sets where it sits.</td></tr>
            )}
            {blocks.map((block) => [
              <tr className="step-band" key={`band-${block.stepId ?? "none"}`}>
                <th colSpan={6} scope="colgroup">{block.name}</th>
                <th className="actions-col">
                  {block.stepId && (
                    <button type="button" className="link-btn" onClick={() => onAddBlank(block.stepId)} disabled={busy}>
                      Add blank row
                    </button>
                  )}
                </th>
              </tr>,
              ...block.rows.map((row) => (
                <RecipeRow key={row.id} row={row} stepOptions={stepOptions} itemGroups={itemGroups} calc={calc} onCommit={onCommit} onDelete={onDelete} />
              )),
            ])}
          </tbody>
        </table>
      </div>
    </section>
  );
}
