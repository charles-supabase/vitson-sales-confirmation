import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { bodyRollCountOf, effectiveRatio, fmtNum, groupRowsByStep, sortRecipeRows } from "../lib/recipeUtils.js";
import { friendlyError, listActiveDye, listActiveFinishing } from "../lib/salesApi.js";
import { formatDateUS, formatInt, formatTicket } from "../lib/format.js";

const nameOf = (list, key, id) => list.find((r) => r.id === id)?.[key] ?? null;
const dash = (v) => (v === null || v === undefined || v === "" ? "" : v);
const inches = (v) => (v === null || v === undefined ? "" : `${Number(v).toFixed(1)}"`);
const fixed = (v, d) => (v === null || v === undefined ? "" : Number(v).toFixed(d));

function Line({ wide }) {
  return <i className={`rp-line ${wide ? "rp-line-wide" : ""}`} />;
}

// One block per dyeing step (sorted by the first letter of the step name, then by order), as on the printed sheet
function DyeSteps({ rows, stepsById, itemsById, water }) {
  const blocks = useMemo(() => groupRowsByStep(rows, stepsById), [rows, stepsById]);
  if (blocks.length === 0) return <p className="rp-muted">No dye recipe saved.</p>;
  return blocks.map((b, i) => (
    <section className="rp-step" key={`${b.stepId}-${i}`}>
      <div className="rp-step-head">
        <h3>{b.name}</h3>
        <span className="rp-ph">pH <Line /></span>
        <span className="rp-water">Water <b>{water}</b></span>
      </div>
      <table className="rp-table">
        <thead>
          <tr><th className="rp-time">Time</th><th>Chemical</th><th className="num">Grm</th><th className="num">OWF %</th><th className="num">Quantity</th></tr>
        </thead>
        <tbody>
          {b.rows.map((r) =>
            r.item_id ? (
              <tr key={r.id}>
                <td className="rp-time" />
                <td>{itemsById.get(r.item_id)?.item_name ?? "Unknown item"}</td>
                <td className="num">{fmtNum(r.grm, 3)}</td>
                <td className="num">{fmtNum(r.percent_OWF, 3)}</td>
                <td className="num">{fixed(r.quantity, 3)}</td>
              </tr>
            ) : (
              <tr key={r.id} className="rp-blank" aria-hidden="true"><td className="rp-time" /><td /><td /><td /><td /></tr>
            )
          )}
        </tbody>
      </table>
    </section>
  ));
}

export default function RecipeReport({ onClose, confirmation, jobOrder, lookups, rolls, ratios = {}, notify }) {
  const [dye, setDye] = useState(null);
  const [fin, setFin] = useState(null);
  const [qr, setQr] = useState(null); // { ticket, info } data URLs
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const jo = jobOrder;

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
    Promise.all([listActiveDye(jo.id), listActiveFinishing(jo.id)])
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
  }, [jo.id, notify]);

  const customer = lookups.customers.find((c) => c.id === confirmation?.customer_id);
  const names = {
    dye: nameOf(lookups.dyeProcesses, "dye_process_name", jo.dye_process_id),
    fabric: nameOf(lookups.fabrics, "fabric_name", jo.fabric_id),
    tone: nameOf(lookups.tones, "tone_name", jo.tone_id),
    color: nameOf(lookups.colors, "color_name", jo.color_id),
    colorRef: nameOf(lookups.colorRefs, "color_ref_code", jo.color_ref_id),
    bodyTouch: nameOf(lookups.touches, "touch_name", jo.body_touch_id),
    x1Touch: nameOf(lookups.touches, "touch_name", jo["1x1_touch_id"]),
    ccTouch: nameOf(lookups.touches, "touch_name", jo.cc_touch_id),
  };

  // QR 1 (middle right): the job ticket only. QR 2 (bottom right): job details as JSON, every id shown as its name.
  const detailsText = useMemo(
    () =>
      JSON.stringify({
        customer_no: customer?.customer_no ?? null,
        cus_jo_no: confirmation?.cus_jo_no ?? null,
        dye_process_name: names.dye,
        fabric_name: names.fabric,
        tone_name: names.tone,
        color_name: names.color,
        body_touch_name: names.bodyTouch,
        body_size: jo.body_size ?? null,
        "1x1_size": jo["1x1_size"] ?? null,
        greigh_yld: jo.greigh_yld ?? null,
        required_yld: jo.required_yld ?? null,
        color_ref_code: names.colorRef,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups, confirmation, jo]
  );

  useEffect(() => {
    let cancelled = false;
    const options = { errorCorrectionLevel: "M", margin: 1, width: 400 };
    Promise.all([QRCode.toDataURL(String(jo.job_ticket ?? ""), options), QRCode.toDataURL(detailsText, options)])
      .then(([ticket, info]) => !cancelled && setQr({ ticket, info }))
      .catch(() => !cancelled && setQr({ ticket: null, info: null })); // the report still prints without the codes
    return () => {
      cancelled = true;
    };
  }, [jo.job_ticket, detailsText]);

  const maps = useMemo(
    () => ({ steps: new Map(lookups.dyeSteps.map((r) => [r.id, r])), items: new Map(lookups.items.map((r) => [r.id, r])) }),
    [lookups]
  );

  const totalWeight = rolls.reduce((n, r) => n + Number(r.roll_wt || 0), 0);
  const bodyRolls = bodyRollCountOf(rolls, lookups.rollTypes);
  const water = totalWeight > 0 ? formatInt(totalWeight * effectiveRatio(ratios, 1)) : "";
  const finVolume = bodyRolls > 0 ? formatInt(bodyRolls * effectiveRatio(ratios, 2)) : "";

  const rollColumns = lookups.rollTypes
    .map((t) => {
      const list = rolls.filter((r) => r.roll_type_id === t.id);
      return { id: t.id, name: t.roll_name, list, weight: list.reduce((n, r) => n + Number(r.roll_wt || 0), 0) };
    })
    .filter((c) => c.list.length > 0);

  const finRows = useMemo(() => (fin ? sortRecipeRows(fin, maps.steps) : []), [fin, maps.steps]);
  const showFinPercent = finRows.some((r) => r.percent_OWF !== null && r.percent_OWF !== undefined);

  return createPortal(
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Recipe report">
      <div className="report-toolbar">
        <span className="strong">Recipe report, job ticket {formatTicket(jo.job_ticket)}</span>
        <div>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={dye === null || qr === null}>Print</button>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <article className="rp-page">
        {/* header boxes */}
        <header className="rp-header">
          <div className="rp-hbox">
            <p>Ticket # : <b className="rp-boxed">{formatTicket(jo.job_ticket)}</b></p>
            <p>Customer No : <b>{customer?.customer_no ?? ""}</b></p>
            <p>Job Order # : <b>{confirmation?.cus_jo_no ?? ""}</b></p>
          </div>
          <div className="rp-hbox">
            <p>Type of Dye : <b>{names.dye ?? ""}</b></p>
            <p>Fabric Type : <b>{names.fabric ?? ""}</b></p>
            <p>Color Ref # : <b>{names.colorRef ?? ""}</b></p>
            <p>Shade : <b>{[names.tone, names.color].filter(Boolean).join(" ")}</b></p>
          </div>
          <div className="rp-hbox">
            <p>Stock # : <b>{jo.stock_no ?? ""}</b></p>
            <p>MES : <b>{jo.mercerize ? "Yes" : "No"}</b></p>
            <p>Tot. Weight : <b>{totalWeight.toFixed(2)}</b></p>
            <p>Tot. Rolls : <b>{rolls.length}</b></p>
          </div>
          <div className="rp-hbox">
            <p>BinNo : <Line /></p>
            <p>Date Issued : <b>{formatDateUS(jo.date_job_order)}</b></p>
            <p>Due Date : <Line /></p>
          </div>
        </header>

        <div className="rp-body">
          {/* left: dyeing recipe */}
          <div className="rp-left">
            <h2 className="rp-title">Dyeing Recipe</h2>
            {dye === null ? <p className="rp-muted">Loading recipe...</p> : <DyeSteps rows={dye} stepsById={maps.steps} itemsById={maps.items} water={water} />}
          </div>

          {/* right: finishing, yield, fabric record */}
          <div className="rp-right">
            <div className="rp-fin">
              <div className="rp-fin-title">Finishing<br />Recipe</div>
              <table className="rp-grid">
                <thead><tr><th>Body</th><th>1x1</th><th>C+C</th></tr></thead>
                <tbody>
                  <tr><td>{inches(jo.body_size)}</td><td>{inches(jo["1x1_size"])}</td><td>{inches(jo.cc_size)}</td></tr>
                  <tr><td>{names.bodyTouch ?? "N-A"}</td><td>{names.x1Touch ?? "N-A"}</td><td>{names.ccTouch ?? "N-A"}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="rp-calendar">Calendar Operator <Line wide /></p>

            <div className="rp-type">
              <span>Type <u>Body</u></span>
              <span>Volume: <b>{finVolume}</b> lts.</span>
            </div>
            <table className="rp-table rp-fin-table">
              <thead>
                <tr><th>Chemical</th><th className="num">Grm</th>{showFinPercent && <th className="num">OWF %</th>}<th className="num">Quantity</th></tr>
              </thead>
              <tbody>
                {fin === null && <tr><td colSpan={4} className="rp-muted">Loading...</td></tr>}
                {finRows.map((r) =>
                  r.item_id ? (
                    <tr key={r.id}>
                      <td>{maps.items.get(r.item_id)?.item_name ?? "Unknown item"}</td>
                      <td className="num">{fmtNum(r.grm, 3)}</td>
                      {showFinPercent && <td className="num">{fmtNum(r.percent_OWF, 3)}</td>}
                      <td className="num">{fixed(r.quantity, 2)}</td>
                    </tr>
                  ) : (
                    <tr key={r.id} className="rp-blank" aria-hidden="true"><td /><td />{showFinPercent && <td />}<td /></tr>
                  )
                )}
              </tbody>
            </table>

            <div className="rp-loading">
              <span className="rp-big">Loading</span>
              {[0, 1, 2, 3].map((i) => <span className="rp-slot" key={i}>:</span>)}
            </div>

            <div className="rp-two">
              <div className="rp-dryer">
                <p className="rp-big">Dryer Inf</p>
                <p>Temp. <b>&gt;150 &deg;C</b></p>
                <p>Operator <Line wide /></p>
              </div>
              <div className="rp-yield">
                <p className="rp-big">Fabric Yield</p>
                <p>SPI <b>{dash(jo.spi)}</b></p>
                <p>Greigh <b>{jo.greigh_yld != null ? `${jo.greigh_yld} GSM` : ""}</b></p>
                <p>Required <b>{jo.required_yld != null ? `${jo.required_yld} GSM` : ""}</b></p>
                <p>Acquired <Line wide /></p>
              </div>
            </div>

            <table className="rp-grid rp-width">
              <thead><tr><th /><th>Width</th><th>Yield</th></tr></thead>
              <tbody>
                {["Natural", "Bef. Dry", "Aft. Dry"].map((l) => (
                  <tr key={l}><th>{l}</th><td /><td /></tr>
                ))}
              </tbody>
            </table>

            <div className="rp-bottom">
              <div className="rp-qr-side">
                {qr?.ticket && <img className="rp-qr rp-qr-lg" src={qr.ticket} alt={`QR code of job ticket ${formatTicket(jo.job_ticket)}`} />}
                <table className="rp-sign">
                  <tbody>
                    <tr><td>Chemist</td><td>Operator 2</td></tr>
                    <tr><td>Preparator</td><td>Confirmed</td></tr>
                    <tr><td>Operator 1</td><td>Expander</td></tr>
                  </tbody>
                </table>
              </div>
              <div className="rp-record">
                <h4>Fabric Record</h4>
                <div className="rp-roll-cols">
                  {rollColumns.length === 0 && <p className="rp-muted">No rolls.</p>}
                  {rollColumns.map((c) => (
                    <div className="rp-roll-col" key={c.id}>
                      <div className="rp-roll-head">{c.name}</div>
                      <div className="rp-rs"><span>Rs</span><b>{c.list.length}</b></div>
                      <div className="rp-rs"><span>Wts</span><b>{c.weight.toFixed(2)}</b></div>
                      {c.list.map((r) => (
                        <div className="rp-roll" key={r.id}>{Number(r.roll_wt).toFixed(2)}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {qr?.info && <img className="rp-qr rp-qr-sm" src={qr.info} alt="QR code of the job details" />}
          </div>
        </div>
      </article>
    </div>,
    document.body
  );
}
