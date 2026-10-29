import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatDateTime } from "../lib/format.js";

/**
 * A printable table report in a full-screen preview (same approach as the recipe report: the app is hidden while
 * printing). columns: [{ key, label, num }]; rows: [{ key, cells: { [column key]: text } }]; totals: { [column key]: text }.
 */
export default function ListReport({ title, lines = [], columns, rows, totals = null, landscape = false, note = "", onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    document.body.classList.add("is-printing-report");
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-printing-report");
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return createPortal(
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="report-toolbar">
        <span className="strong">{title}</span>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <article className={`lr-page ${landscape ? "lr-landscape" : ""}`}>
        <h1 className="lr-title">{title}</h1>
        {lines.map((l, i) => (
          <p className="lr-line" key={i}>{l}</p>
        ))}
        <table className="lr-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length}>No records.</td></tr>}
            {rows.map((r, i) => (
              <tr key={r.key ?? i}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? "num" : ""}>{r.cells[c.key] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.num ? "num" : ""}>{totals[c.key] ?? ""}</th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        <p className="lr-foot">{[note, `Printed ${formatDateTime(new Date())}`].filter(Boolean).join("  |  ")}</p>
      </article>
    </div>,
    document.body
  );
}
