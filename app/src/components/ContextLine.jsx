import { formatTicket } from "../lib/format.js";

// The line under the tabs that says what you are working on. Each tab shows a different one.
export default function ContextLine({ tab, confirmation, customerName, jobOrder, jobOrders, jobOrderId, typeName, colorName, onPickJob }) {
  if (tab === "fabric") {
    if (!jobOrder) return null;
    return (
      <div className="ctx ctx-fabric">
        <span>Job Ticket :</span>
        {jobOrders.length > 1 ? (
          <select className="ctx-select" aria-label="Job ticket" value={jobOrderId ?? ""} onChange={(e) => onPickJob(Number(e.target.value))}>
            {jobOrders.map((j) => (
              <option key={j.id} value={j.id}>{formatTicket(j.job_ticket)}</option>
            ))}
          </select>
        ) : (
          <b className="ctx-ticket">{formatTicket(jobOrder.job_ticket)}</b>
        )}
        <span className="ctx-gap">Type : <b>{typeName || "-"}</b></span>
        <span>Color : <b>{colorName || "-"}</b></span>
      </div>
    );
  }

  if (!confirmation) return null;
  const customer = customerName ?? "Unknown customer";

  if (tab === "recipe") {
    return (
      <div className="ctx ctx-recipe">
        <span className="ctx-pill ctx-c1">Customer : <b>{customer}</b></span>
        <span className="ctx-pill ctx-c2">Customer JO : <b>{confirmation.cus_jo_no}</b></span>
        {jobOrder && <span className="ctx-pill ctx-c3">Job Ticket : <b>{formatTicket(jobOrder.job_ticket)}</b></span>}
        {jobOrder && <span className="ctx-pill ctx-c4">Type : <b>{typeName || "-"}</b></span>}
        {jobOrder && <span className="ctx-pill ctx-c5">Color : <b>{colorName || "-"}</b></span>}
      </div>
    );
  }

  // Sales Confirmation and Job Order tabs
  return (
    <div className="ctx">
      <span>Customer : <b>{customer}</b></span>
      <span>Customer JO : <b>{confirmation.cus_jo_no}</b></span>
    </div>
  );
}
