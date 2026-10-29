import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal.jsx";
import { Field, SelectField, TextField, toOptions } from "./FormFields.jsx";
import { IconButton } from "./Icons.jsx";
import { deleteConfirmation, friendlyError, saveConfirmation } from "../lib/salesApi.js";
import { formatDate, formatTicket, today, toId, toText } from "../lib/format.js";
import { unsavedPrompt } from "../lib/unsavedGuard.js";

const FORM_ID = "confirmation-form";

function ConfirmationForm({ initial, customers, confirmations, maxNo, onSubmit, onDirty }) {
  const [values, setValues] = useState({
    customer_id: initial?.customer_id ? String(initial.customer_id) : "",
    confirmation_date: initial?.confirmation_date ?? today(),
    sales_confirm_no: initial ? String(initial.sales_confirm_no) : "",
    cus_jo_no: initial?.cus_jo_no ?? "",
  });
  const [errors, setErrors] = useState({});
  const initialJson = useRef(JSON.stringify(values)).current;
  useEffect(() => onDirty(JSON.stringify(values) !== initialJson), [values, initialJson, onDirty]);

  const options = useMemo(() => toOptions(customers, "customer_name", { keepId: initial?.customer_id }), [customers, initial]);
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    const no = Number(values.sales_confirm_no);
    if (!values.customer_id) next.customer_id = "Select a customer.";
    if (!values.confirmation_date) next.confirmation_date = "Enter the confirmation date.";
    if (!values.sales_confirm_no || !Number.isInteger(no) || no <= 0) next.sales_confirm_no = "Enter the sales confirmation number.";
    else if (confirmations.some((c) => c.sales_confirm_no === no && c.id !== initial?.id))
      next.sales_confirm_no = "This sales confirmation number already exists.";
    if (!values.cus_jo_no.trim()) next.cus_jo_no = "Enter the customer job order number.";
    setErrors(next);
    if (Object.keys(next).length) return;

    onSubmit({
      customer_id: toId(values.customer_id),
      confirmation_date: values.confirmation_date,
      sales_confirm_no: no,
      cus_jo_no: toText(values.cus_jo_no),
    });
  };

  return (
    <form id={FORM_ID} className="form-grid" onSubmit={submit} noValidate>
      <div className="span-2">
        <SelectField
          label="Customer"
          placeholder="Select a customer"
          options={options}
          value={values.customer_id}
          onChange={set("customer_id")}
          error={errors.customer_id}
          hint={options.length === 0 ? "No customers loaded. Run the customer sync, and check that this session is allowed to read tbl_Customer_Sync." : undefined}
        />
      </div>
      <Field id="sc-no" label="Sales confirmation no." error={errors.sales_confirm_no}>
        <div className="input-with-max">
          <input
            id="sc-no"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            value={values.sales_confirm_no}
            onChange={set("sales_confirm_no")}
            onDoubleClick={() => setValues((v) => ({ ...v, sales_confirm_no: String(maxNo + 1) }))}
            title="Double-click to use the next number"
          />
          <output className="max-box max-box-lg" aria-label="Latest sales confirmation number" title="Latest sales confirmation number">
            {maxNo || "-"}
          </output>
        </div>
      </Field>
      <TextField label="Confirmation date" type="date" value={values.confirmation_date} onChange={set("confirmation_date")} error={errors.confirmation_date} />
      <div className="span-2">
        <TextField label="Customer job order no." value={values.cus_jo_no} onChange={set("cus_jo_no")} error={errors.cus_jo_no} />
      </div>
    </form>
  );
}

export default function ConfirmationSection({
  lookups,
  confirmations,
  jobCounts,
  loading,
  selectedId,
  filter,
  onClearFilter,
  onSelect,
  onOpenJobOrders,
  onChanged,
  onCreated,
  notify,
  confirmDelete,
}) {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formDirty, setFormDirty] = useState(false);
  const markDirty = useCallback((d) => setFormDirty(d), []);

  const customerName = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const maxNo = useMemo(() => confirmations.reduce((m, c) => Math.max(m, c.sales_confirm_no ?? 0), 0), [confirmations]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return confirmations.filter((c) => {
      if (filter && c.id !== filter.salesId) return false;
      if (!q) return true;
      return [String(c.sales_confirm_no), customerName.get(c.customer_id), c.cus_jo_no].filter(Boolean).some((v) => v.toLowerCase().includes(q));
    });
  }, [confirmations, search, customerName, filter]);

  const openForm = (row) => {
    setEditing(row);
    setFormError("");
    setFormDirty(false);
    setFormOpen(true);
  };

  // Cancel, the x, Esc and a click outside all ask first when something was typed
  const requestClose = () => {
    if (saving) return;
    if (!formDirty) return setFormOpen(false);
    confirmDelete(unsavedPrompt(() => setFormOpen(false)));
  };

  const handleSave = async (fields) => {
    setSaving(true);
    setFormError("");
    try {
      const saved = await saveConfirmation({ id: editing?.id, ...fields });
      setFormOpen(false);
      await onChanged(saved);
      if (editing) notify("success", "Saved successfully", `Sales confirmation ${saved.sales_confirm_no} has been updated.`);
      else onCreated(saved); // a new confirmation goes straight on to its job orders
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (row) =>
    confirmDelete({
      title: "Delete this sales confirmation?",
      message: `Sales confirmation ${row.sales_confirm_no} for ${customerName.get(row.customer_id) ?? "this customer"} will be removed. This can't be undone.`,
      confirmLabel: "Delete confirmation",
      onConfirm: async () => {
        await deleteConfirmation(row.id);
        await onChanged(null, row.id);
        notify("success", "Deleted", `Sales confirmation ${row.sales_confirm_no} has been deleted.`);
      },
    });

  return (
    <section className="panel theme-confirm" aria-labelledby="sc-title">
      <div className="section-head">
        <h2 id="sc-title">Sales confirmations</h2>
        <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>New confirmation</button>
      </div>

      {filter && (
        <div className="filter-chip" role="status">
          <span>Showing the confirmation of job ticket <b>{formatTicket(filter.jobTicket)}</b></span>
          <button type="button" className="btn btn-small" onClick={onClearFilter}>Show all</button>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <label htmlFor="sc-search" className="sr-only">Search sales confirmations</label>
          <input id="sc-search" type="search" placeholder="Search by number, customer or job order no." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">Sales conf. no.</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Customer job order no.</th>
                <th className="num">Job orders</th>
                <th className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="state-cell">Loading sales confirmations...</td></tr>}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="state-cell">
                    {search || filter ? "No sales confirmations match." : "No sales confirmations yet. Select New confirmation to add the first one."}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`is-clickable ${r.id === selectedId ? "is-selected" : ""}`}
                  onClick={() => onSelect(r.id)}
                  onDoubleClick={() => onOpenJobOrders(r)}
                >
                  <td className="num strong">{r.sales_confirm_no}</td>
                  <td>{formatDate(r.confirmation_date)}</td>
                  <td className="strong">{customerName.get(r.customer_id) ?? "Unknown customer"}</td>
                  <td>{r.cus_jo_no}</td>
                  <td className="num">{jobCounts[r.id] ?? 0}</td>
                  <td className="actions-col" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <button type="button" className="row-btn row-btn-go" onClick={() => onOpenJobOrders(r)}>Job orders</button>
                    <IconButton kind="edit" label={`Edit sales confirmation ${r.sales_confirm_no}`} onClick={() => openForm(r)} />
                    <IconButton kind="delete" label={`Delete sales confirmation ${r.sales_confirm_no}`} onClick={() => askDelete(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <div className="table-foot"><span>{rows.length} {rows.length === 1 ? "confirmation" : "confirmations"} shown</span></div>
        )}
      </div>

      <Modal
        open={formOpen}
        title={editing ? `Edit sales confirmation ${editing.sales_confirm_no}` : "New sales confirmation"}
        size="md"
        onClose={requestClose}
        footer={
          <>
            <button type="button" className="btn" onClick={requestClose} disabled={saving}>Cancel</button>
            <button type="submit" form={FORM_ID} className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save confirmation"}</button>
          </>
        }
      >
        {formError && <div className="banner banner-error" role="alert">{formError}</div>}
        <ConfirmationForm initial={editing} customers={lookups.customers} confirmations={confirmations} maxNo={maxNo} onSubmit={handleSave} onDirty={markDirty} />
      </Modal>
    </section>
  );
}
