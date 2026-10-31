import { useId, useLayoutEffect, useRef } from "react";
import { typingTicket } from "../lib/format.js";

// Defined at module level on purpose: components created inside another component
// are remounted on every render and would drop input focus while typing.

export function Field({ id, label, error, hint, className = "", children }) {
  return (
    <div className={`field ${error ? "has-error" : ""} ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({ label, error, hint, className, ...input }) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <input id={id} {...input} />
    </Field>
  );
}

/**
 * Job ticket box that formats while the user types (xx-xxxxx-x-xx-x). The caret stays where it was, also when
 * a character is typed or deleted in the middle. `onValue` receives the formatted text.
 */
export function TicketInput({ value, onValue, onChange, strict = false, ...input }) {
  const ref = useRef(null);
  const caret = useRef(null);
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });
  const handle = (e) => {
    const raw = e.target.value;
    const pos = e.target.selectionStart ?? raw.length;
    const before = raw.slice(0, pos).replace(/[\s-]/g, "").length; // characters (not dashes) left of the caret
    const text = typingTicket(raw, strict);
    let seen = 0;
    let at = 0;
    while (at < text.length && seen < before) {
      if (text[at] !== "-") seen += 1;
      at += 1;
    }
    caret.current = at;
    onValue(text);
  };
  return <input ref={ref} value={value} onChange={handle} {...input} />;
}

export function TicketField({ label, error, hint, className, value, onValue, strict = false, ...input }) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <TicketInput id={id} value={value} onValue={onValue} strict={strict} inputMode="text" autoComplete="off" maxLength={15} {...input} />
    </Field>
  );
}

export function SelectField({ label, error, hint, className, options, placeholder = "Select", ...select }) {
  const id = useId();
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <select id={id} {...select}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({ label, ...input }) {
  return (
    <label className="check">
      <input type="checkbox" {...input} />
      <span>{label}</span>
    </label>
  );
}

export const toOptions = (rows, labelKey, { keepId } = {}) =>
  rows
    .filter((r) => r.is_active !== false || r.id === keepId)
    .map((r) => ({
      value: r.id,
      label: r.is_active === false ? `${r[labelKey]} (inactive)` : String(r[labelKey]),
    }));
