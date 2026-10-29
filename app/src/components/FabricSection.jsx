import { useEffect, useMemo, useRef, useState } from "react";
import { addRolls, deleteRoll, friendlyError } from "../lib/salesApi.js";
import { formatWeight } from "../lib/format.js";
import { useUnsavedGuard } from "../lib/unsavedGuard.js";
import { LockBanner, useJobOrderLocks } from "../lib/lock.jsx";

const norm = (name) => String(name ?? "").trim().toLowerCase();

// One column per roll type: label, its own weight box, then the rolls entered so far.
// Enter adds the roll(s). Clicking a label focuses its box, and the focused column is highlighted.
export default function FabricSection({ jobOrder, lookups, rolls, loading, onChanged, notify, focusRequest }) {
  const rollTypes = lookups.rollTypes;
  const [drafts, setDrafts] = useState({}); // { [rollTypeId]: "text" }
  const [errors, setErrors] = useState({}); // { [rollTypeId]: "message" }
  const [busy, setBusy] = useState(false);
  const inputs = useRef({});
  const locks = useJobOrderLocks([jobOrder?.id]); // a copied job order is view-only until unlocked
  const locked = locks.isLocked(jobOrder?.id);

  // A weight that was typed but not added (Enter) is an unsaved change
  useUnsavedGuard(Object.values(drafts).some((v) => v && v.trim() !== ""));
  useEffect(() => {
    setDrafts({});
    setErrors({});
  }, [jobOrder?.id]);

  const columns = useMemo(() => {
    const byType = new Map(rollTypes.map((t) => [t.id, { type: t, rolls: [] }]));
    const orphan = { type: { id: "none", roll_name: "No roll type" }, rolls: [] };
    for (const r of rolls) (byType.get(r.roll_type_id) ?? orphan).rolls.push(r);
    const cols = [...byType.values()];
    if (orphan.rolls.length) cols.push(orphan);
    return cols.map((c) => ({ ...c, weight: c.rolls.reduce((n, r) => n + Number(r.roll_wt || 0), 0) }));
  }, [rollTypes, rolls]);

  // Put the cursor in the first box (Body) when the tab opens, and when asked to after a "saved" popup
  const firstId = rollTypes[0]?.id;
  useEffect(() => {
    if (jobOrder && firstId !== undefined) inputs.current[firstId]?.focus();
  }, [jobOrder?.id, firstId, focusRequest]);

  if (!jobOrder) {
    return (
      <section className="panel theme-fabric">
        <div className="empty-panel">
          <h2>Select a job order first</h2>
          <p>Fabric rolls belong to a job order. Choose one in the Job Order section.</p>
        </div>
      </section>
    );
  }

  const body = columns.find((c) => norm(c.type.roll_name) === "body")?.weight ?? 0;
  const x1 = columns.find((c) => norm(c.type.roll_name) === "1x1")?.weight ?? 0;
  const total = columns.reduce((n, c) => n + c.weight, 0);
  const others = total - body - x1;

  const add = async (typeId) => {
    if (locked) return;
    const tokens = (drafts[typeId] ?? "").split(/[\s,;]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const weights = tokens.map(Number);
    const bad = tokens.filter((_, i) => !Number.isFinite(weights[i]) || weights[i] <= 0);
    if (bad.length) return setErrors((e) => ({ ...e, [typeId]: `Not a valid weight: ${bad.join(", ")}` }));

    setBusy(true);
    setErrors((e) => ({ ...e, [typeId]: "" }));
    try {
      await addRolls(jobOrder.id, typeId, weights);
      setDrafts((d) => ({ ...d, [typeId]: "" }));
      await onChanged();
    } catch (err) {
      setErrors((e) => ({ ...e, [typeId]: friendlyError(err) }));
    } finally {
      setBusy(false);
      inputs.current[typeId]?.focus();
    }
  };

  const removeRoll = async (roll) => {
    if (locked) return;
    try {
      await deleteRoll(roll.id);
      await onChanged();
    } catch (err) {
      notify("error", "Couldn't remove the roll", friendlyError(err));
    }
  };

  return (
    <section className="panel theme-fabric" aria-labelledby="fi-title">
      <div className="section-head">
        <h2 id="fi-title">Fabric info</h2>
      </div>

      {locked && <LockBanner onUnlock={() => locks.unlock(jobOrder.id)} />}

      <div className="weight-summary" role="status">
        <span><b>Body</b> {formatWeight(body)}</span>
        <i>+</i>
        <span><b>1x1</b> {formatWeight(x1)}</span>
        <i>+</i>
        <span><b>Others</b> {formatWeight(others)}</span>
        <i>=</i>
        <span className="weight-total"><b>Total</b> {formatWeight(total)}</span>
      </div>

      {loading && <p className="msg state-cell">Loading rolls...</p>}

      <div className="roll-cols">
        {columns.map(({ type, rolls: list, weight }) => (
          <div className="roll-col" key={type.id}>
            <label className="roll-col-head" htmlFor={`roll-${type.id}`}>{type.roll_name}</label>
            {type.id !== "none" && (
              <input
                id={`roll-${type.id}`}
                ref={(el) => {
                  inputs.current[type.id] = el;
                }}
                className="roll-input"
                inputMode="decimal"
                autoComplete="off"
                aria-label={`${type.roll_name} roll weight`}
                value={drafts[type.id] ?? ""}
                readOnly={busy || locked}
                onChange={(e) => setDrafts((d) => ({ ...d, [type.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add(type.id);
                  }
                }}
              />
            )}
            {errors[type.id] && <p className="msg-error">{errors[type.id]}</p>}
            <div className="roll-col-meta">
              <span>{list.length} {list.length === 1 ? "roll" : "rolls"}</span>
              <span>{formatWeight(weight)}</span>
            </div>
            <ul className="roll-col-list">
              {list.map((r, i) => (
                <li key={r.id}>
                  <span className="roll-no">{i + 1}</span>
                  <span className="roll-wt">{Number(r.roll_wt).toFixed(2)}</span>
                  <button type="button" className="roll-x" aria-label={`Remove ${type.roll_name} roll ${i + 1}, ${Number(r.roll_wt).toFixed(2)}`} onClick={() => removeRoll(r)} disabled={locked}>
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
