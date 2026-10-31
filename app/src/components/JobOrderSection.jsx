import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./Icons.jsx";
import Modal from "./Modal.jsx";
import { CheckField, SelectField, TextField, TicketField, toOptions } from "./FormFields.jsx";
import { createColor, createColorRef, createCustomerPrice, deleteJobOrder, findCustomerPrice, friendlyError, saveJobOrder } from "../lib/salesApi.js";
import { formatDate, formatMoney, formatTicket, formatWeight, isTicket, rawTicket, today, toId, toInt, toText } from "../lib/format.js";
import PriceDialog from "./PriceDialog.jsx";
import { LockBanner, useJobOrderLocks } from "../lib/lock.jsx";
import { unsavedPrompt } from "../lib/unsavedGuard.js";

const FORM_ID = "job-order-form";
const str = (v) => (v === null || v === undefined ? "" : String(v));

const TOUCH_GROUPS = [
  { key: "body", label: "Body", touch: "body_touch_id", size: "body_size" },
  { key: "x1", label: "1x1", touch: "1x1_touch_id", size: "1x1_size" },
  { key: "cc", label: "Collar and cuffs", touch: "cc_touch_id", size: "cc_size" },
];

const isNA = (s) => /^n\s*\/\s*a$/i.test(String(s).trim());

function JobOrderForm({ initial, customerId, lookups, onSubmit, onDirty, onNewEntry, readOnly = false }) {
  const [values, setValues] = useState(() => ({
    job_ticket: formatTicket(initial?.job_ticket),
    date_job_order: initial?.date_job_order ?? today(),
    stock_no: str(initial?.stock_no),
    dye_process_id: str(initial?.dye_process_id),
    fabric_id: str(initial?.fabric_id),
    tone_id: str(initial?.tone_id),
    color_name: lookups.colors.find((c) => c.id === initial?.color_id)?.color_name ?? "",
    color_ref_code: lookups.colorRefs.find((c) => c.id === initial?.color_ref_id)?.color_ref_code ?? "",
    spi: str(initial?.spi),
    greigh_yld: str(initial?.greigh_yld),
    required_yld: str(initial?.required_yld),
    grouping: str(initial?.grouping),
    mercerize: Boolean(initial?.mercerize),
    reprocessed: Boolean(initial?.reprocessed),
    reprocess_id: str(initial?.reprocess_id),
    body_touch_id: str(initial?.body_touch_id),
    body_size: str(initial?.body_size),
    "1x1_touch_id": str(initial?.["1x1_touch_id"]),
    "1x1_size": str(initial?.["1x1_size"]),
    cc_touch_id: str(initial?.cc_touch_id),
    cc_size: str(initial?.cc_size),
  }));
  const [errors, setErrors] = useState({});
  // New tickets must follow A#-#####-#-AA-#; an old ticket that doesn't fit the pattern stays editable as it is
  const strictTicket = !initial || isTicket(initial.job_ticket);
  const initialJson = useRef(JSON.stringify(values)).current;
  useEffect(() => onDirty(JSON.stringify(values) !== initialJson), [values, initialJson, onDirty]);

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  // The body touch is the default of the 1x1 and the collar and cuffs touch: they follow it until someone picks their own
  const setBodyTouch = (e) => {
    const v = e.target.value;
    setValues((s) => {
      const follow = (cur) => (cur === "" || cur === s.body_touch_id ? v : cur);
      return { ...s, body_touch_id: v, "1x1_touch_id": follow(s["1x1_touch_id"]), cc_touch_id: follow(s.cc_touch_id) };
    });
  };
  // A new color / color reference is offered for saving as soon as the user leaves the box (or presses Enter in it),
  // so the form stays open and the rest of the data can be entered. N/A needs no question.
  const isNewEntry = (kind) => {
    const text = (kind === "color" ? values.color_name : values.color_ref_code).trim();
    if (!text || isNA(text)) return null;
    const known = kind === "color"
      ? lookups.colors.some((c) => c.color_name.trim().toLowerCase() === text.toLowerCase())
      : lookups.colorRefs.some((c) => c.color_ref_code.trim().toLowerCase() === text.toLowerCase());
    return known ? null : text;
  };
  const checkNew = (kind) => {
    const text = isNewEntry(kind);
    if (text) onNewEntry?.(kind, text);
  };
  // Moving to a button (Save job order, Cancel) is not "carrying on": Save asks at submit, Cancel asks nothing
  const leaveField = (e, kind) => {
    if (!e.relatedTarget?.closest?.("button")) checkNew(kind);
  };
  const enterNew = (kind) => (e) => {
    if (e.key === "Enter" && isNewEntry(kind)) {
      e.preventDefault(); // don't save the whole job order yet
      checkNew(kind);
    }
  };
  const setCheck = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.checked }));

  const opt = useMemo(
    () => ({
      dye: toOptions(lookups.dyeProcesses, "dye_process_name", { keepId: initial?.dye_process_id }),
      fabric: toOptions(lookups.fabrics, "fabric_name", { keepId: initial?.fabric_id }),
      tone: toOptions(lookups.tones, "tone_name", { keepId: initial?.tone_id }),
      touch: toOptions(lookups.touches, "touch_name"),
      reason: toOptions(lookups.reprocessReasons, "defect_names"),
    }),
    [lookups, initial]
  );

  const submit = (e) => {
    e.preventDefault();
    if (readOnly) return;
    const next = {};
    if (!values.job_ticket.trim()) next.job_ticket = "Enter the job ticket.";
    else if (strictTicket && !isTicket(values.job_ticket)) next.job_ticket = "The job ticket needs at least A#-##### (a letter or digit, then 6 digits), for example A1-23456.";
    if (!values.date_job_order) next.date_job_order = "Enter the job order date.";
    if (!values.dye_process_id) next.dye_process_id = "Select a dye process.";
    if (!values.fabric_id) next.fabric_id = "Select a fabric.";
    if (!values.tone_id) next.tone_id = "Select a tone.";
    if (values.reprocessed && !values.reprocess_id) next.reprocess_id = "Select the reason for reprocessing.";
    for (const key of ["spi", "greigh_yld", "required_yld", "grouping", "body_size", "1x1_size", "cc_size"]) {
      if (values[key] !== "" && !(Number.isInteger(Number(values[key])) && Number(values[key]) >= 0)) next[key] = "Enter a whole number.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    // Existing code (case-insensitive) -> its id. A code that isn't in the list yet is confirmed before it is added.
    // "N/A" is accepted as it is: no lookup and no question (its record is created silently the first time).
    const typedRef = values.color_ref_code.trim();
    const knownRef = typedRef ? lookups.colorRefs.find((c) => c.color_ref_code.trim().toLowerCase() === typedRef.toLowerCase()) : null;
    const typedColor = values.color_name.trim();
    const knownColor = typedColor ? lookups.colors.find((c) => c.color_name.trim().toLowerCase() === typedColor.toLowerCase()) : null;
    const extras = {};
    if (typedColor && !knownColor) extras[isNA(typedColor) ? "naColor" : "newColor"] = typedColor;
    if (typedRef && !knownRef) extras[isNA(typedRef) ? "naColorRef" : "newColorRef"] = typedRef;

    onSubmit({
      job_ticket: toText(rawTicket(values.job_ticket)), // stored without dashes
      date_job_order: values.date_job_order,
      stock_no: toText(values.stock_no),
      dye_process_id: toId(values.dye_process_id),
      fabric_id: toId(values.fabric_id),
      tone_id: toId(values.tone_id),
      color_id: knownColor ? knownColor.id : null,
      color_ref_id: knownRef ? knownRef.id : null,
      spi: toInt(values.spi),
      greigh_yld: toInt(values.greigh_yld),
      required_yld: toInt(values.required_yld),
      grouping: toInt(values.grouping),
      mercerize: values.mercerize,
      reprocessed: values.reprocessed,
      reprocess_id: values.reprocessed ? toId(values.reprocess_id) : null,
      body_touch_id: toId(values.body_touch_id),
      body_size: toInt(values.body_size),
      "1x1_touch_id": toId(values["1x1_touch_id"]),
      "1x1_size": toInt(values["1x1_size"]),
      cc_touch_id: toId(values.cc_touch_id),
      cc_size: toInt(values.cc_size),
    }, extras);
  };

  return (
    <form id={FORM_ID} onSubmit={submit} noValidate>
      <fieldset className="lock-wrap" disabled={readOnly}>
      <fieldset className="group">
        <legend>Job order</legend>
        <div className="form-grid cols-3">
          <TicketField label="Job ticket" strict={strictTicket} value={values.job_ticket} onValue={(v) => setValues((s) => ({ ...s, job_ticket: v }))} error={errors.job_ticket} />
          <TextField label="Date" type="date" value={values.date_job_order} onChange={set("date_job_order")} error={errors.date_job_order} />
          <TextField label="Stock no." value={values.stock_no} onChange={set("stock_no")} />
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Fabric and colour</legend>
        <div className="form-grid cols-3">
          <SelectField label="Dye process" options={opt.dye} value={values.dye_process_id} onChange={set("dye_process_id")} error={errors.dye_process_id} />
          <SelectField label="Fabric" options={opt.fabric} value={values.fabric_id} onChange={set("fabric_id")} error={errors.fabric_id} />
          <SelectField label="Tone" options={opt.tone} value={values.tone_id} onChange={set("tone_id")} error={errors.tone_id} />
          <TextField label="Color" list="color-list" autoComplete="off" placeholder="Pick one or type a new color" value={values.color_name} onChange={set("color_name")} onBlur={(e) => leaveField(e, "color")} onKeyDown={enterNew("color")} />
          <datalist id="color-list">
            {lookups.colors.map((c) => (
              <option key={c.id} value={c.color_name} />
            ))}
          </datalist>
          <TextField
            label="Color reference"
            list="color-ref-list"
            autoComplete="off"
            placeholder="Pick one or type a new code"
            value={values.color_ref_code}
            onChange={set("color_ref_code")}
            onBlur={(e) => leaveField(e, "colorRef")}
            onKeyDown={enterNew("colorRef")}
          />
          <datalist id="color-ref-list">
            {lookups.colorRefs.map((c) => (
              <option key={c.id} value={c.color_ref_code} />
            ))}
          </datalist>
        </div>
      </fieldset>

      <div className="jo-split">
      <fieldset className="group">
        <legend>Specifications</legend>
        <div className="form-grid cols-1">
          <TextField label="SPI" type="number" min="0" step="1" value={values.spi} onChange={set("spi")} error={errors.spi} />
          <TextField label="Greige yield" type="number" min="0" step="1" value={values.greigh_yld} onChange={set("greigh_yld")} error={errors.greigh_yld} />
          <TextField label="Required yield" type="number" min="0" step="1" value={values.required_yld} onChange={set("required_yld")} error={errors.required_yld} />
          <TextField label="Grouping" type="number" min="0" step="1" value={values.grouping} onChange={set("grouping")} error={errors.grouping} />
          <div className="check-row span-2">
            <CheckField label="Mercerize" checked={values.mercerize} onChange={setCheck("mercerize")} />
            <CheckField label="Reprocessed" checked={values.reprocessed} onChange={setCheck("reprocessed")} />
          </div>
          {values.reprocessed && (
            <div className="span-3">
              <SelectField label="Reason for reprocessing" options={opt.reason} value={values.reprocess_id} onChange={set("reprocess_id")} error={errors.reprocess_id} />
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Touch and size</legend>
        <div className="touch-grid">
          {TOUCH_GROUPS.map((g) => (
            <div className="touch-row" key={g.key}>
              <span className="touch-label">{g.label}</span>
              <SelectField label="Touch" options={opt.touch} value={values[g.touch]} onChange={g.key === "body" ? setBodyTouch : set(g.touch)} />
              <TextField label="Size" type="number" min="0" step="1" value={values[g.size]} onChange={set(g.size)} error={errors[g.size]} />
            </div>
          ))}
        </div>
      </fieldset>
      </div>
      </fieldset>
    </form>
  );
}

export default function JobOrderSection({
  confirmation,
  customerName,
  lookups,
  jobOrders,
  jobTotals,
  selectedId,
  onSelect,
  onOpenFabric,
  onChanged,
  onCreated,
  openNewRequest,
  reloadLookups,
  notify,
  confirmDelete,
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const markDirty = useCallback((d) => setFormDirty(d), []);
  const [priceAsk, setPriceAsk] = useState(null); // { names, resolve } while the "no price for this combination" question is open
  const locks = useJobOrderLocks(jobOrders.map((j) => j.id)); // job orders whose delivery was copied are view-only
  const readOnly = Boolean(editing) && locks.isLocked(editing.id);

  // Cancel, the x, Esc and a click outside all ask first when something was typed
  const requestClose = () => {
    if (saving) return;
    if (!formDirty) return setFormOpen(false);
    confirmDelete(unsavedPrompt(() => setFormOpen(false)));
  };

  const names = useMemo(
    () => ({
      dye: new Map(lookups.dyeProcesses.map((r) => [r.id, r.dye_process_name])),
      fabric: new Map(lookups.fabrics.map((r) => [r.id, r.fabric_name])),
      tone: new Map(lookups.tones.map((r) => [r.id, r.tone_name])),
      color: new Map(lookups.colors.map((r) => [r.id, r.color_name])),
    }),
    [lookups]
  );

  // A new sales confirmation was just created: open the empty job order form for input
  const handledRequest = useRef(openNewRequest);
  useEffect(() => {
    if (openNewRequest !== handledRequest.current && confirmation) {
      handledRequest.current = openNewRequest;
      setEditing(null);
      setFormError("");
      setFormDirty(false);
      setFormOpen(true);
    }
  }, [openNewRequest, confirmation]);

  if (!confirmation) {
    return (
      <section className="panel theme-job">
        <div className="empty-panel">
          <h2>Select a sales confirmation first</h2>
          <p>Job orders belong to a sales confirmation. Choose one in the Sales Confirmation section.</p>
        </div>
      </section>
    );
  }

  const openForm = (row) => {
    setEditing(row);
    setFormError("");
    setFormDirty(false);
    setFormOpen(true);
  };

  // Adds what is new to the lookup tables (N/A silently, other new names only after the user agreed), then saves the job order
  const saveWithLookups = async (fields, extras) => {
    const patch = {};
    if (extras.newColor) patch.color_id = (await createColor(extras.newColor)).id;
    if (extras.naColor) patch.color_id = (await createColor("N/A")).id;
    if (extras.newColorRef) patch.color_ref_id = (await createColorRef(extras.newColorRef)).id;
    if (extras.naColorRef) patch.color_ref_id = (await createColorRef("N/A")).id;
    if (Object.keys(patch).length) await reloadLookups();
    await doSave({ ...fields, ...patch });
  };

  // Offered while the form is still open: saving adds the name to the list and the user carries on entering data
  const askNewEntry = (kind, text) => {
    const label = kind === "color" ? "color" : "color reference";
    confirmDelete({
      title: `Save a new ${label}?`,
      message: `"${text}" isn't in the ${label} list yet. Save it to the list for future lookups?`,
      confirmLabel: `Save ${label}`,
      tone: "primary",
      onConfirm: async () => {
        if (kind === "color") await createColor(text);
        else await createColorRef(text);
        await reloadLookups();
      },
    });
  };

  const handleSave = (fields, extras = {}) => {
    const asked = [];
    if (extras.newColor) asked.push(`the color "${extras.newColor}"`);
    if (extras.newColorRef) asked.push(`the color reference "${extras.newColorRef}"`);
    if (asked.length === 0) {
      saveWithLookups(fields, extras).catch((err) => {
        setFormError(friendlyError(err));
        setSaving(false);
      });
      return;
    }
    // Back to the form = nothing saved; the job order is saved only together with the new entries.
    const plural = asked.length > 1;
    confirmDelete({
      title: extras.newColor && extras.newColorRef ? "Save a new color and color reference?" : extras.newColor ? "Save a new color?" : "Save a new color reference?",
      message: `${asked.join(" and ")} ${plural ? "are" : "is"} not in the list yet. Save ${plural ? "them" : "it"} for future lookups and use ${plural ? "them" : "it"} for this job order?`,
      confirmLabel: "Save and continue",
      tone: "primary",
      onConfirm: () => saveWithLookups(fields, extras),
    });
  };

  // Price lookup in tbl_customer_price: for a new job order, and when the tone, fabric or dye process changed.
  // Returns { apply, value } for the unit price to store, or undefined when the user went back to the form.
  const resolveUnitPrice = async (fields) => {
    const changed = !editing || ["tone_id", "fabric_id", "dye_process_id"].some((k) => editing[k] !== fields[k]);
    if (!changed) return { apply: false };
    const keys = { customerId: confirmation.customer_id, toneId: fields.tone_id, fabricId: fields.fabric_id, dyeProcessId: fields.dye_process_id };
    const found = await findCustomerPrice(keys);
    if (found && found.unit_price !== null && found.unit_price !== undefined) return { apply: true, value: Number(found.unit_price) };

    const answer = await new Promise((resolve) =>
      setPriceAsk({
        resolve,
        names: {
          customer: customerName ?? "",
          tone: names.tone.get(fields.tone_id) ?? "",
          fabric: names.fabric.get(fields.fabric_id) ?? "",
          dye: names.dye.get(fields.dye_process_id) ?? "",
        },
      })
    );
    setPriceAsk(null);
    if (answer === undefined) return undefined;
    if (answer === null) return { apply: true, value: null };
    await createCustomerPrice(keys, answer);
    return { apply: true, value: answer };
  };

  const doSave = async (fields) => {
    setSaving(true);
    setFormError("");
    try {
      const priced = await resolveUnitPrice(fields);
      if (priced === undefined) return; // back to the form, nothing saved
      const saved = await saveJobOrder({ id: editing?.id, sales_id: confirmation.id, ...fields, ...(priced.apply ? { unit_price: priced.value } : {}) });
      setFormOpen(false);
      await onChanged(saved);
      if (editing) {
        const priceNote = priced.apply ? (priced.value === null ? " No unit price is set." : ` Unit price ${formatMoney(priced.value)}.`) : "";
        notify("success", "Saved successfully", `Job ticket ${formatTicket(saved.job_ticket)} has been updated.${priceNote}`);
      } else onCreated(saved); // a new job order goes straight on to its fabric rolls
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  // A locked (copied) job order asks for the password first
  const askDelete = (row) => (locks.isLocked(row.id) ? locks.unlock(row.id, () => confirmRemove(row)) : confirmRemove(row));
  const confirmRemove = (row) =>
    confirmDelete({
      title: "Delete this job order?",
      message: `Job ticket ${formatTicket(row.job_ticket)} will be removed. A job order that already has fabric rolls can't be deleted until its rolls are removed.`,
      confirmLabel: "Delete job order",
      onConfirm: async () => {
        await deleteJobOrder(row.id);
        await onChanged(null, row.id);
        notify("success", "Deleted", `Job ticket ${formatTicket(row.job_ticket)} has been deleted.`);
      },
    });

  return (
    <section className="panel theme-job" aria-labelledby="jo-title">
      <div className="section-head">
        <h2 id="jo-title">Job orders</h2>
        <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>New job order</button>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Job ticket</th>
                <th>Date</th>
                <th>Dye process</th>
                <th>Fabric</th>
                <th>Tone</th>
                <th>Color</th>
                <th className="num">Rolls</th>
                <th className="num">Weight</th>
                <th className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {jobOrders.length === 0 && (
                <tr><td colSpan={9} className="state-cell">No job orders for this confirmation yet. Select New job order to add one.</td></tr>
              )}
              {jobOrders.map((j) => {
                const t = jobTotals[j.id];
                return (
                  <tr
                    key={j.id}
                    className={`is-clickable ${j.id === selectedId ? "is-selected" : ""}`}
                    onClick={() => onSelect(j.id)}
                    onDoubleClick={() => openForm(j)}
                  >
                    <td className="strong">
                      {formatTicket(j.job_ticket)}
                      {j.reprocessed && <span className="chip chip-cancelled tag">Reprocess</span>}
                      {locks.isLocked(j.id) && <span className="chip chip-lock tag" title="Copied: view only">Locked</span>}
                    </td>
                    <td>{formatDate(j.date_job_order)}</td>
                    <td>{names.dye.get(j.dye_process_id) ?? "None"}</td>
                    <td>{names.fabric.get(j.fabric_id) ?? "None"}</td>
                    <td>{names.tone.get(j.tone_id) ?? "None"}</td>
                    <td>{names.color.get(j.color_id) ?? "None"}</td>
                    <td className="num">{t?.rolls ?? 0}</td>
                    <td className="num">{formatWeight(t?.weight ?? 0)}</td>
                    <td className="actions-col" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      <button type="button" className="row-btn row-btn-go" onClick={() => onOpenFabric(j)}>Fabric info</button>
                      <IconButton kind="edit" label={`Edit job ticket ${formatTicket(j.job_ticket)}`} onClick={() => openForm(j)} />
                      <IconButton kind="delete" label={`Delete job ticket ${formatTicket(j.job_ticket)}`} onClick={() => askDelete(j)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {jobOrders.length > 0 && (
          <div className="table-foot">
            <span>{jobOrders.length} {jobOrders.length === 1 ? "job order" : "job orders"}</span>
            <span className="strong">
              {Object.values(jobTotals).reduce((n, t) => n + t.rolls, 0)} rolls, {formatWeight(Object.values(jobTotals).reduce((n, t) => n + t.weight, 0))}
            </span>
          </div>
        )}
      </div>

      <Modal
        open={formOpen}
        title={editing ? `Edit job ticket ${formatTicket(editing.job_ticket)}` : "New job order"}
        size="xl"
        onClose={requestClose}
        footer={
          <>
            <button type="button" className="btn" onClick={requestClose} disabled={saving}>{readOnly ? "Close" : "Cancel"}</button>
            {!readOnly && <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save job order"}</button>}
          </>
        }
      >
        {formError && <div className="banner banner-error" role="alert">{formError}</div>}
        {readOnly && <LockBanner onUnlock={() => locks.unlock(editing.id)} />}
        <JobOrderForm initial={editing} customerId={confirmation.customer_id} lookups={lookups} onSubmit={handleSave} onDirty={markDirty} onNewEntry={askNewEntry} readOnly={readOnly} />
      </Modal>

      <PriceDialog ask={priceAsk} onAnswer={(v) => priceAsk?.resolve(v)} />
    </section>
  );
}
