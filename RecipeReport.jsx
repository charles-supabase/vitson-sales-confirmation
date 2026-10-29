import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { fmtNum, groupRowsByStep } from "../lib/recipeUtils.js";
import { friendlyError, listActiveDye, listActiveFinishing } from "../lib/salesApi.js";
import { formatDate, formatMoney, formatVolume, formatWeight } from "../lib/format.js";

function RecipeBlocks({ title, note, rows, stepsById, itemsById }) {
  const blocks = useMemo(() => groupRowsByStep(rows, stepsById), [rows, stepsById]);
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {note && <p className="report-note">{note}</p>}
      {blocks.length === 0 && <p className="report-muted">No rows.</p>}
      {blocks.map((b) => (
        <div className="report-step" key={`${b.stepId}`}>
          <h3>{b.name}</h3>
          <table>
            <thead>
              <tr>
                <th className="r-order">Order</th>
                <th>Item</th>
                <th className="num">Grm</th>
                <th className="num">% OWF</th>
                <th className="num">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) =>
                !r.item_id ? (
                  <tr key={r.id} className="report-blank" aria-hidden="true">
                    <td colSpan={5}>&nbsp;</td>
                  </tr>
                ) : (
                <tr key={r.id}>
                  <td className="r-order">{r.order ?? ""}</td>
                  <td>{itemsById.get(r.item_id)?.item_name ?? "Unknown item"}</td>
                  <td className="num">{fmtNum(r.grm, 3)}</td>
                  <td className="num">{fmtNum(r.percent_OWF, 3)}</td>
                  <td className="num">{fmtNum(r.quantity, 3)}</td>
                </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

export default function RecipeReport({ onClose, confirmation, customerName, jobOrder, lookups, rolls, ratios = {}, notify }) {
  const [dye, setDye] = useState(null);
  const [fin, setFin] = useState(null);
  const [qr, setQr] = useState(null); // { ticket, info } data URLs
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Print only the report: the app root is hidden by the print stylesheet while this is open
  useEffect(() => {
    document.body.classList.add("is-printing-report");
    const onKey = (e) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-printing-report");
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listActiveDye(jobOrder.id), listActiveFinishing(jobOrder.id)])
      .then(([d, f]) => {
        if (cancelled) return;
        setDye(d);
        setFin(f);
      })
      .catch((err) => {
        notify("error", "Couldn't load the saved recipe", friendlyError(err));
        closeRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [jobOrder.id, notify]);

  // QR 1 (top right): the job ticket only.
  // QR 2 (bottom right): job details as JSON, with every id replaced by its name.
  const detailsText = useMemo(() => {
    const nameOf = (list, key, id) => list.find((r) => r.id === id)?.[key] ?? null;
    const customer = lookups.customers.find((c) => c.id === confirmation?.customer_id);
    return JSON.stringify({
      customer_no: customer?.customer_no ?? null,
      cus_jo_no: confirmation?.cus_jo_no ?? null,
      dye_process_name: nameOf(lookups.dyeProcesses, "dye_process_name", jobOrder.dye_process_id),
      fabric_name: nameOf(lookups.fabrics, "fabric_name", jobOrder.fabric_id),
      tone_name: nameOf(lookups.tones, "tone_name", jobOrder.tone_id),
      color_name: nameOf(lookups.colors, "color_name", jobOrder.color_id),
      body_touch_name: nameOf(lookups.touches, "touch_name", jobOrder.body_touch_id),
      body_size: jobOrder.body_size ?? null,
      "1x1_size": jobOrder["1x1_size"] ?? null,
      greigh_yld: jobOrder.greigh_yld ?? null,
      required_yld: jobOrder.required_yld ?? null,
      color_ref_code: nameOf(lookups.colorRefs, "color_ref_code", jobOrder.color_ref_id),
    });
  }, [lookups, confirmation, jobOrder]);

  useEffect(() => {
    let cancelled = false;
    const options = { errorCorrectionLevel: "M", margin: 1, width: 400 };
    Promise.all([QRCode.toDataURL(String(jobOrder.job_ticket ?? ""), options), QRCode.toDataURL(detailsText, options)])
      .then(([ticket, info]) => !cancelled && setQr({ ticket, info }))
      .catch(() => !cancelled && setQr({ ticket: null, info: null })); // the report still prints without the codes
    return () => {
      cancelled = true;
    };
  }, [jobOrder.job_ticket, detailsText]);

  const maps = useMemo(
    () => ({
      steps: new Map(lookups.dyeSteps.map((r) => [r.id, r])),
      items: new Map(lookups.items.map((r) => [r.id, r])),
      name: (list, key, id) => list.find((r) => r.id === id)?.[key] ?? "None",
    }),
    [lookups]
  );

  const rollGroups = useMemo(
    () =>
      lookups.rollTypes
        .map((t) => {
          const rs = rolls.filter((r) => r.roll_type_id === t.id);
          return { id: t.id, name: t.roll_name, rolls: rs, weight: rs.reduce((n, r) => n + Number(r.roll_wt || 0), 0) };
        })
        .filter((g) => g.rolls.length > 0),
    [lookups.rollTypes, rolls]
  );
  const totalWeight = rolls.reduce((n, r) => n + Number(r.roll_wt || 0), 0);
  // "Dye: 1,500 L (150.00 kg x 10)" for every section that has a ratio
  const volumeNote = (parts) =>
    parts
      .filter(([, group]) => ratios[group] && totalWeight > 0)
      .map(([label, group]) => `${label} dye volume: ${formatVolume(totalWeight * ratios[group])} (${formatWeight(totalWeight)} \u00d7 ${fmtNum(ratios[group], 3)})`)
      .join("; ");

  const touch = (id, size) => `${maps.name(lookups.touches, "touch_name", id)}${size ? `, size ${size}` : ""}`;
  const jo = jobOrder;
  const fields = [
    ["Date", formatDate(jo.date_job_order)],
    ["Dye process", maps.name(lookups.dyeProcesses, "dye_process_name", jo.dye_process_id)],
    ["Fabric", maps.name(lookups.fabrics, "fabric_name", jo.fabric_id)],
    ["Tone", maps.name(lookups.tones, "tone_name", jo.tone_id)],
    ["Color", maps.name(lookups.colors, "color_name", jo.color_id)],
    ["Color reference", maps.name(lookups.colorRefs, "color_ref_code", jo.color_ref_id)],
    ["Stock no.", jo.stock_no ?? "None"],
    ["SPI", jo.spi ?? "None"],
    ["Mercerize", jo.mercerize ? "Yes" : "No"],
    ["Reprocessed", jo.reprocessed ? `Yes, ${maps.name(lookups.reprocessReasons, "defect_names", jo.reprocess_id)}` : "No"],
    ["Greige yield", jo.greigh_yld ?? "None"],
    ["Required yield", jo.required_yld ?? "None"],
    ["Grouping", jo.grouping ?? "None"],
    ["Unit price", formatMoney(jo.unit_price)],
    ["Body", touch(jo.body_touch_id, jo.body_size)],
    ["1x1", touch(jo["1x1_touch_id"], jo["1x1_size"])],
    ["Collar and cuffs", touch(jo.cc_touch_id, jo.cc_size)],
  ];

  return createPortal(
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Recipe report">
      <div className="report-toolbar">
        <span className="strong">Recipe report, job ticket {jo.job_ticket}</span>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={dye === null || qr === null}>Print</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <article className="report-page">
        <header className="report-head">
          <div>
            <p className="report-kicker">Vitson</p>
            <h1>Dye and finishing recipe</h1>
          </div>
          <div className="report-ticket">
            <div>
              <span>Job ticket</span>
              <strong>{jo.job_ticket}</strong>
            </div>
            {qr?.ticket && <img className="report-qr report-qr-sm" src={qr.ticket} alt={`QR code of job ticket ${jo.job_ticket}`} />}
          </div>
        </header>

        <section className="report-section">
          <h2>Sales confirmation</h2>
          <dl className="report-dl">
            <div><dt>Sales confirmation no.</dt><dd>{confirmation?.sales_confirm_no}</dd></div>
            <div><dt>Date</dt><dd>{formatDate(confirmation?.confirmation_date)}</dd></div>
            <div><dt>Customer</dt><dd>{customerName ?? "Unknown customer"}</dd></div>
            <div><dt>Customer job order no.</dt><dd>{confirmation?.cus_jo_no}</dd></div>
          </dl>
        </section>

        <section className="report-section">
          <h2>Job order</h2>
          <dl className="report-dl cols-3">
            {fields.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </section>

        <section className="report-section">
          <h2>Fabric info</h2>
          {rollGroups.length === 0 ? (
            <p className="report-muted">No fabric rolls recorded.</p>
          ) : (
            <table>
              <thead>
                <tr><th>Roll type</th><th className="num">Rolls</th><th className="num">Weight</th><th>Roll weights</th></tr>
              </thead>
              <tbody>
                {rollGroups.map((g) => (
                  <tr key={g.id}>
                    <td className="strong">{g.name}</td>
                    <td className="num">{g.rolls.length}</td>
                    <td className="num">{formatWeight(g.weight)}</td>
                    <td className="report-weights">{g.rolls.map((r) => Number(r.roll_wt).toFixed(2)).join(", ")}</td>
                  </tr>
                ))}
                <tr className="report-total">
                  <td>Total</td>
                  <td className="num">{rolls.length}</td>
                  <td className="num">{formatWeight(totalWeight)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {dye === null ? (
          <p className="report-muted">Loading recipe...</p>
        ) : (
          <>
            <RecipeBlocks title="Dye recipe" note={volumeNote([["Dye", 1], ["Color reference", 3]])} rows={dye} stepsById={maps.steps} itemsById={maps.items} />
            <RecipeBlocks title="Finishing recipe" note={volumeNote([["Finishing", 2]])} rows={fin} stepsById={maps.steps} itemsById={maps.items} />
          </>
        )}

        <footer className="report-foot">
          <span>Printed {new Date().toLocaleString("en-GB")}</span>
          {qr?.info && (
            <figure className="report-qr-fig">
              <img className="report-qr report-qr-lg" src={qr.info} alt="QR code of the job details" />
              <figcaption>Job details</figcaption>
            </figure>
          )}
        </footer>
      </article>
    </div>,
    document.body
  );
}
