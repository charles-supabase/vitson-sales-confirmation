import { useMemo, useState } from "react";
import Combobox from "./Combobox.jsx";
import { STATUSES } from "../lib/salesApi.js";
import { formatMoney } from "../lib/format.js";

const today = () => new Date().toISOString().slice(0, 10);

const blank = {
  customer_id: "",
  confirmation_date: today(),
  po_number: "",
  description: "",
  quantity: "",
  unit_price: "",
  delivery_date: "",
  status: "Draft",
  remarks: "",
};

export default function SalesForm({ formId, initial, customers, onSubmit }) {
  const [values, setValues] = useState(() =>
    initial
      ? {
          customer_id: initial.customer_id,
          confirmation_date: initial.confirmation_date,
          po_number: initial.po_number ?? "",
          description: initial.description,
          quantity: String(initial.quantity),
          unit_price: String(initial.unit_price),
          delivery_date: initial.delivery_date ?? "",
          status: initial.status,
          remarks: initial.remarks ?? "",
        }
      : blank
  );
  const [errors, setErrors] = useState({});

  // Inactive (deleted at source) customers stay selectable only on records that already use them
  const options = useMemo(
    () =>
      customers
        .filter((c) => c.is_active || c.id === initial?.customer_id)
        .map((c) => ({ value: c.id, label: c.is_active ? c.customer_name : `${c.customer_name} (inactive)` })),
    [customers, initial]
  );

  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const total = (Number(values.quantity) || 0) * (Number(values.unit_price) || 0);

  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!values.customer_id) next.customer_id = "Select a customer.";
    if (!values.confirmation_date) next.confirmation_date = "Enter the confirmation date.";
    if (!values.description.trim()) next.description = "Describe what was sold.";
    if (!(Number(values.quantity) > 0)) next.quantity = "Quantity must be greater than 0.";
    if (values.unit_price === "" || Number(values.unit_price) < 0) next.unit_price = "Enter a unit price of 0 or more.";
    if (values.delivery_date && values.delivery_date < values.confirmation_date)
      next.delivery_date = "Delivery can't be before the confirmation date.";
    setErrors(next);
    if (Object.keys(next).length) return;

    onSubmit({
      customer_id: values.customer_id,
      confirmation_date: values.confirmation_date,
      po_number: values.po_number.trim() || null,
      description: values.description.trim(),
      quantity: Number(values.quantity),
      unit_price: Number(values.unit_price),
      delivery_date: values.delivery_date || null,
      status: values.status,
      remarks: values.remarks.trim() || null,
    });
  };

  // A render helper (not a component) so inputs keep focus between keystrokes
  const field = (name, label, props = {}, custom) => (
    <div className={`field ${errors[name] ? "has-error" : ""}`}>
      <label htmlFor={`${formId}-${name}`}>{label}</label>
      {custom ?? (
        <input id={`${formId}-${name}`} value={values[name]} onChange={set(name)} {...props} />
      )}
      {errors[name] && <p className="field-error">{errors[name]}</p>}
    </div>
  );

  return (
    <form id={formId} className="form-grid" onSubmit={submit} noValidate>
      <div className="span-2">
        <Combobox
          label="Customer"
          options={options}
          value={values.customer_id}
          onChange={(v) => setValues((s) => ({ ...s, customer_id: v }))}
          placeholder="Search customers"
          error={errors.customer_id}
          hint={options.length === 0 ? "No customers yet. They appear here once the sync has run." : undefined}
        />
      </div>

      <div className="field">
        <label htmlFor={`${formId}-no`}>Confirmation no.</label>
        <input id={`${formId}-no`} value={initial?.confirmation_no ?? "Assigned when saved"} readOnly disabled />
      </div>
      {field("confirmation_date", "Confirmation date", { type: "date" })}

      {field("po_number", "Customer PO no.", { placeholder: "Optional" })}
      {field(
        "status",
        "Status",
        {},
        <select id={`${formId}-status`} value={values.status} onChange={set("status")}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      )}

      <div className="span-2">
        {field("description", "Description", { placeholder: "Item or service confirmed" })}
      </div>

      {field("quantity", "Quantity", { type: "number", min: "0", step: "0.01", inputMode: "decimal" })}
      {field("unit_price", "Unit price", { type: "number", min: "0", step: "0.01", inputMode: "decimal" })}

      {field("delivery_date", "Delivery date", { type: "date" })}
      <div className="field">
        <span className="label-like">Total</span>
        <div className="total-box" aria-live="polite">{formatMoney(total)}</div>
      </div>

      <div className="span-2 field">
        <label htmlFor={`${formId}-remarks`}>Remarks</label>
        <textarea id={`${formId}-remarks`} rows={3} value={values.remarks} onChange={set("remarks")} />
      </div>
    </form>
  );
}
