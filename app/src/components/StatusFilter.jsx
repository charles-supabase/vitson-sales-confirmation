import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";

// A status condition is { recipe, hydro, dryer, heatset, packed, delivered }: true = the date is filled in, false = it is not.
export const STATUS_FIELDS = [
  ["recipe", "Recipe date"],
  ["hydro", "Hydro date"],
  ["dryer", "Dryer date"],
  ["heatset", "Heatset date"],
  ["packed", "Packed date"],
  ["delivered", "Delivered date"],
];

const PRESETS = [
  { label: "Hydro done, not delivered", cond: { hydro: true, delivered: false } },
  { label: "No recipe yet", cond: { recipe: false } },
  { label: "Recipe done, no hydro", cond: { recipe: true, hydro: false } },
  { label: "Packed, not delivered", cond: { packed: true, delivered: false } },
];

export const hasStatus = (cond) => Object.keys(cond ?? {}).length > 0;

/** "Hydro date: filled in; Delivered date: empty" */
export function describeStatus(cond, hide = []) {
  return STATUS_FIELDS.filter(([key]) => cond?.[key] !== undefined && !hide.includes(key))
    .map(([key, label]) => `${label}: ${cond[key] ? "filled in" : "empty"}`)
    .join(";  ");
}

/** Pop-up to combine conditions on the stage dates. `hide` lists fields that don't apply (the summary is always about the Hydro date). */
export default function StatusFilterDialog({ open, value, hide = [], onApply, onClose }) {
  const [draft, setDraft] = useState({});
  useEffect(() => {
    if (open) setDraft({ ...value });
  }, [open, value]);

  const fields = STATUS_FIELDS.filter(([key]) => !hide.includes(key));
  const set = (key, v) =>
    setDraft((d) => {
      const next = { ...d };
      if (v === "any") delete next[key];
      else next[key] = v === "yes";
      return next;
    });
  const current = (key) => (draft[key] === undefined ? "any" : draft[key] ? "yes" : "no");

  // presets that need a hidden field to be empty can't apply; a hidden field that must be filled in is already true
  const presets = PRESETS.map((p) => {
    const cond = {};
    for (const [k, v] of Object.entries(p.cond)) {
      if (hide.includes(k)) {
        if (v === false) return null;
        continue;
      }
      cond[k] = v;
    }
    return { label: p.label, cond };
  }).filter(Boolean);

  return (
    <Modal
      open={open}
      title="Status filter"
      size="md"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => setDraft({})}>Clear all</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onApply(draft)}>Apply</button>
        </>
      }
    >
      <p className="msg">Combine the conditions: a record must meet all of them.</p>
      <div className="status-presets">
        {presets.map((p) => (
          <button key={p.label} type="button" className="btn btn-small" onClick={() => setDraft(p.cond)}>{p.label}</button>
        ))}
      </div>
      <div className="status-grid" role="group" aria-label="Conditions">
        {fields.map(([key, label]) => (
          <div className="status-row" key={key}>
            <span className="status-label">{label}</span>
            {[["any", "Any"], ["yes", "Filled in"], ["no", "Empty"]].map(([v, text]) => (
              <label className="check" key={v}>
                <input type="radio" name={`status-${key}`} checked={current(key) === v} onChange={() => set(key, v)} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
}
