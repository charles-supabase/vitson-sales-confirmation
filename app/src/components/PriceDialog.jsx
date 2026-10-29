import { useEffect, useState } from "react";
import Modal from "./Modal.jsx";
import { CURRENCY } from "../lib/format.js";

/**
 * Asked when a job order's customer / tone / fabric / dye process combination has no price in tbl_customer_price.
 * onAnswer(number)    = create the price record with this unit price
 * onAnswer(null)      = no price record, save the job order without a price
 * onAnswer(undefined) = go back to the form, nothing is saved
 */
export default function PriceDialog({ ask, onAnswer }) {
  const [step, setStep] = useState("ask"); // ask -> enter
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (ask) {
      setStep("ask");
      setText("");
      setError("");
    }
  }, [ask]);

  const save = (e) => {
    e.preventDefault();
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n < 0) return setError("Enter the unit price as a number.");
    onAnswer(n);
  };

  return (
    <Modal
      open={Boolean(ask)}
      title="No price for this combination"
      size="sm"
      layer="top"
      onClose={() => onAnswer(undefined)}
      footer={
        step === "ask" ? (
          <>
            <button type="button" className="btn" onClick={() => onAnswer(undefined)}>Back to form</button>
            <button type="button" className="btn" onClick={() => onAnswer(null)}>No, save without price</button>
            <button type="button" className="btn btn-primary" onClick={() => setStep("enter")}>Yes, create it</button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => setStep("ask")}>Back</button>
            <button type="submit" form="price-form" className="btn btn-primary">Save price</button>
          </>
        )
      }
    >
      <ul className="price-combo">
        <li><span>Customer</span><b>{ask?.names.customer}</b></li>
        <li><span>Tone</span><b>{ask?.names.tone}</b></li>
        <li><span>Fabric</span><b>{ask?.names.fabric}</b></li>
        <li><span>Dye process</span><b>{ask?.names.dye}</b></li>
      </ul>
      {step === "ask" ? (
        <p className="modal-text">This combination isn't in the customer price list yet. Create a price record for it?</p>
      ) : (
        <form id="price-form" onSubmit={save} noValidate>
          <div className={`field ${error ? "has-error" : ""}`}>
            <label htmlFor="price-unit">Unit price ({CURRENCY})</label>
            <input id="price-unit" type="number" inputMode="decimal" min="0" step="any" autoFocus value={text} onChange={(e) => { setText(e.target.value); setError(""); }} />
            {error && <p className="field-error">{error}</p>}
          </div>
        </form>
      )}
    </Modal>
  );
}
