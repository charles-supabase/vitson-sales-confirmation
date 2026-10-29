import { formatDate, formatMoney } from "../lib/format.js";

export default function SalesTable({ rows, loading, onEdit, onDelete, hasFilters, onClearFilters }) {
  const total = rows.reduce((sum, r) => sum + Number(r.total_amount), 0);

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Confirmation</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Unit price</th>
              <th className="num">Total</th>
              <th>Delivery</th>
              <th>Status</th>
              <th className="actions-col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={10} className="state-cell">Loading confirmations...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={10} className="state-cell">
                  {hasFilters ? (
                    <>
                      No confirmations match your filters.{" "}
                      <button type="button" className="link-btn" onClick={onClearFilters}>Clear filters</button>
                    </>
                  ) : (
                    "No sales confirmations yet. Select New confirmation to add the first one."
                  )}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="strong">{r.confirmation_no}</div>
                  {r.po_number && <div className="sub">PO {r.po_number}</div>}
                </td>
                <td>{formatDate(r.confirmation_date)}</td>
                <td className="strong">{r.customer?.customer_name ?? "Unknown customer"}</td>
                <td className="desc" title={r.description}>{r.description}</td>
                <td className="num">{Number(r.quantity).toLocaleString("en")}</td>
                <td className="num">{formatMoney(r.unit_price)}</td>
                <td className="num strong">{formatMoney(r.total_amount)}</td>
                <td>{formatDate(r.delivery_date)}</td>
                <td><span className={`chip chip-${r.status.toLowerCase()}`}>{r.status}</span></td>
                <td className="actions-col">
                  <button type="button" className="link-btn" onClick={() => onEdit(r)}>Edit</button>
                  <button type="button" className="link-btn danger" onClick={() => onDelete(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && rows.length > 0 && (
        <div className="table-foot">
          <span>{rows.length} {rows.length === 1 ? "confirmation" : "confirmations"} shown</span>
          <span className="strong">Total {formatMoney(total)}</span>
        </div>
      )}
    </div>
  );
}
