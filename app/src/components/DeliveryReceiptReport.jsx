import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatTicket } from "../lib/format.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();
const mdy = (iso) => {
  const [y, m, d] = String(iso ?? "").slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
};
const kg = (n) => Number(n).toFixed(2);
const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out.length ? out : [[]];
};

/**
 * Printed delivery receipt in the layout of the paper forms: BIG (type 1) shows the alias (name, TIN, address) and the
 * Quantity / Weight / Description / Color / J.O. / FW / Remarks table; SMALL (type 2) shows the customer name only and the
 * Roll / Weight / Stock / Fabric / Process / Shade / Job Order table. Both end with the packing list (roll weights per roll type).
 * "Data only" hides the form's own text and lines, for printing on the pre-printed paper.
 */
export default function DeliveryReceiptReport({ data, big, lookups, onClose }) {
  const [dataOnly, setDataOnly] = useState(false);
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

  const model = useMemo(() => {
    const byId = (list) => new Map(list.map((r) => [r.id, r]));
    const jobs = byId(data.jobs);
    const sales = byId(data.sales);
    const rollType = byId(lookups.rollTypes);
    const first = data.deliveries[0];
    const firstSales = sales.get(jobs.get(first?.job_order_id)?.sales_id);
    const customer = lookups.customers.find((c) => c.id === firstSales?.customer_id);
    const alias = first?.alias_id ? lookups.aliases.find((a) => a.id === first.alias_id) : null;
    // BIG: the alias on the delivery; with no alias the customer's own details are used
    const bill = big
      ? alias
        ? { name: alias.alias_name, tin: alias.TIN_number, address: alias.alias_address }
        : { name: customer?.customer_name, tin: customer?.customer_TIN, address: customer?.address }
      : { name: customer?.customer_name };

    const rank = (name) => {
      const n = norm(name);
      if (big) return n === "1x1" ? 0 : n === "body" ? 1 : 2;
      return n === "body" ? 0 : n === "1x1" ? 1 : 2;
    };
    const blocks = data.deliveries.map((d) => {
      const job = jobs.get(d.job_order_id) ?? {};
      const sc = sales.get(job.sales_id) ?? {};
      const tone = lookups.tones.find((t) => t.id === job.tone_id);
      const color = lookups.colors.find((c) => c.id === job.color_id);
      const shade = [tone?.tone_code, color?.color_name].filter(Boolean).join(" ");
      const types = new Map();
      for (const r of data.rolls.filter((x) => x.delivery_id === d.id)) {
        if (!types.has(r.roll_type_id)) types.set(r.roll_type_id, []);
        types.get(r.roll_type_id).push(Number(r.roll_wt || 0));
      }
      const lines = [...types.entries()]
        .map(([typeId, weights]) => {
          const name = rollType.get(typeId)?.roll_name ?? "";
          const n = norm(name);
          const size = n === "body" ? job.body_size : n === "1x1" ? job["1x1_size"] : n === "collar" || n === "cuffs" ? job.cc_size : null;
          return {
            typeId,
            name,
            weights,
            total: weights.reduce((a, b) => a + b, 0),
            // roll type as printed: Body, 1x1, CC for every other type (collar, cuffs, ...)
            kind: n === "body" ? "Body" : n === "1x1" ? "1x1" : "CC",
            size: size ?? "",
          };
        })
        .sort((a, b) => rank(a.name) - rank(b.name) || a.typeId - b.typeId);
      return {
        key: d.id,
        shade,
        ticket: formatTicket(job.job_ticket), // A#-#####-#-AA-#
        cusJo: sc.cus_jo_no ?? "",
        fabric: lookups.fabrics.find((f) => f.id === job.fabric_id)?.fabric_name ?? "",
        process: lookups.dyeProcesses.find((p) => p.id === job.dye_process_id)?.dye_process_name ?? "",
        lines,
      };
    });
    return { bill, blocks, date: mdy(first?.date_delivery), no: first?.delivery_receipt ?? "" };
  }, [data, big, lookups]);

  const rows = model.blocks.flatMap((b) => b.lines.map((l) => ({ b, l })));

  return createPortal(
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Delivery receipt">
      <div className="report-toolbar">
        <span className="strong">Delivery receipt {model.no} ({big ? "BIG" : "SMALL"})</span>
        <div className="dr-toolbar-right">
          <label className="check">
            <input type="checkbox" checked={dataOnly} onChange={(e) => setDataOnly(e.target.checked)} />
            <span>Data only (pre-printed form)</span>
          </label>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <article className={`dr-page ${big ? "dr-big" : "dr-small"} ${dataOnly ? "dr-data-only" : ""}`}>
        {big ? (
          <>
            <header className="dr-head">
              <div className="dr-company dr-static">
                <b>VITSON INTERNATIONAL INCORPORATED</b>
                <span>VAT REG. TIN - 000-379-853-00000</span>
                <span>254 Sto. Domingo Street, Manresa 1, 1115 Quezon City, Philippines</span>
              </div>
              <div className="dr-title dr-static">DELIVERY RECEIPT</div>
            </header>
            <section className="dr-top">
              <div className="dr-customer dr-ln">
                <p><span className="dr-static">CUSTOMER:</span> <b>{model.bill.name}</b></p>
                <p><span className="dr-static">TIN:</span> <b>{model.bill.tin}</b></p>
                <p><span className="dr-static">ADDRESS:</span> <b>{model.bill.address}</b></p>
              </div>
              <div className="dr-meta">
                <p><span className="dr-static">Date:</span> <b>{model.date}</b></p>
                <p><span className="dr-static">Ref. No.:</span> <b /></p>
                <p><span className="dr-static">Approved By:</span> <b /></p>
                <p><span className="dr-static">Checked By:</span> <b /></p>
                <p><span className="dr-static">Delivered By:</span> <b /></p>
                <p><span className="dr-static">Truck No.:</span> <b /></p>
                <p className="dr-serial"><span className="dr-static">C No.</span> <b className="dr-no">{model.no}</b></p>
              </div>
            </section>
            <table className="dr-table dr-ln">
              <thead className="dr-static">
                <tr><th>Quantity</th><th>Weight/Kgs.</th><th>DESCRIPTION</th><th>Color</th><th>J.O.</th><th>FW</th><th>Remarks</th></tr>
              </thead>
              <tbody>
                {rows.map(({ b, l }) => (
                  <tr key={`${b.key}-${l.typeId}`}>
                    <td className="num">{l.weights.length}</td>
                    <td className="num">{kg(l.total)}</td>
                    <td className="dr-desc"><span>{l.kind}</span><span>{b.fabric}</span><span>{b.process}</span></td>
                    <td>{b.shade}</td>
                    <td>{b.cusJo}</td>
                    <td className="num">{l.size}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="dr-inspect dr-static">INSPECT &nbsp; BEFORE &nbsp; CUTTING</p>
            <p className="dr-liable dr-static">* WE SHALL NOT BE RESPONSIBLE / LIABLE ON: A) Any Fabric Cut if Found Defective &nbsp; B) TEN (10) Days After Delivery Date</p>
          </>
        ) : (
          <>
            <section className="dr-top dr-top-small">
              <p><span className="dr-static">Customer</span> <b className="dr-cust">{model.bill.name}</b></p>
              <div className="dr-meta">
                <p><span className="dr-static">Date</span> <b>{model.date}</b></p>
                <p><span className="dr-static">Ref</span> <b /></p>
                <p><span className="dr-static">Truck</span> <b className="dr-no">{model.no}</b></p>
                <p><span className="dr-static">Driver</span> <b /></p>
              </div>
            </section>
            <table className="dr-table dr-ln">
              <thead className="dr-static">
                <tr><th>Roll</th><th>Weight</th><th>Stock</th><th>Fabric</th><th>Process</th><th>Shade</th><th>Job Order</th><th>FW</th><th>Remark</th><th>Ref</th></tr>
              </thead>
              <tbody>
                {rows.map(({ b, l }) => (
                  <tr key={`${b.key}-${l.typeId}`}>
                    <td className="num">{l.weights.length}</td>
                    <td className="num">{kg(l.total)} kls</td>
                    <td>{l.kind}</td>
                    <td>{b.fabric}</td>
                    <td>{b.process}</td>
                    <td>{b.shade}</td>
                    <td>JO {b.cusJo}</td>
                    <td className="num">{l.size}</td>
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 className="dr-packing dr-static">{big ? "PACKING LIST" : ""}</h3>
        {model.blocks.map((b) => (
          <div className="dr-pack" key={b.key}>
            <div className="dr-pack-head">
              <span className="dr-tag dr-ln">{b.shade}</span>
              <span className="dr-tag dr-ln">{b.ticket}</span>
            </div>
            {b.lines.map((l) =>
              chunk(l.weights, 6).map((part, i, all) => (
                <div className="dr-roll-line dr-ln" key={`${l.typeId}-${i}`}>
                  <span className="dr-roll-name dr-static">{i === 0 ? l.name.toUpperCase() : ""}</span>
                  <span className="dr-roll-wts">
                    {part.map((w, k) => (
                      <b key={k}>{kg(w)}</b>
                    ))}
                  </span>
                  <span className="dr-roll-total">{i === all.length - 1 ? <><i className="dr-static">-</i><b className="dr-ln">{kg(l.total)}</b></> : null}</span>
                </div>
              ))
            )}
          </div>
        ))}

        <footer className="dr-foot dr-static">
          {big ? (
            <>
              <span>Received the above goods in good order and condition.</span>
              <span>By: ____________________ &nbsp; Authorized Signature</span>
              <em>THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES</em>
            </>
          ) : (
            <span>RECEIVED BY &nbsp; ____________________</span>
          )}
        </footer>
      </article>
    </div>,
    document.body
  );
}
