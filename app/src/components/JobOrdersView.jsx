import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, listStageDates, searchJobOrders } from "../lib/salesApi.js";
import { formatDate, formatTicket } from "../lib/format.js";
import { TicketInput } from "./FormFields.jsx";
import ListReport from "./ListReport.jsx";
import StatusFilterDialog, { describeStatus, hasStatus } from "./StatusFilter.jsx";

const EMPTY = { cusJoNo: "", customerId: "", jobTicket: "", date: "", from: "", to: "", dateRecipe: "", status: {} };

// Shared by the "Job Orders" search and the "Recipe" (no recipe yet) list
// stages: Map(job order id -> { hydro, dryer, heatset, packed, delivered }) adds the tracking columns and drops the sales conf. no.
const STAGE_COLS = [["hydro", "Hydro"], ["dryer", "Dryer"], ["heatset", "Heatset"], ["packed", "Packed"], ["delivered", "Delivered"]];

export function JobOrderTable({ rows, loading, error, customerOf, salesOf, rollCounts, onOpen, action, empty, stages = null }) {
  const showRolls = rollCounts !== null && rollCounts !== undefined && rollCounts !== false;
  const withStages = stages !== null;
  const cols = (withStages ? 5 + STAGE_COLS.length : 6) + (showRolls ? 1 : 0) + (action ? 1 : 0);
  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Job ticket</th>
              <th>Job order date</th>
              <th>Customer</th>
              <th>Customer JO</th>
              {!withStages && <th className="num">Sales conf. no.</th>}
              <th>Recipe date</th>
              {withStages && STAGE_COLS.map(([, label]) => <th key={label}>{label}</th>)}
              {showRolls && <th className="num">Fabric rolls</th>}
              {action && <th className="actions-col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={cols} className="state-cell">Loading...</td></tr>}
            {!loading && error && <tr><td colSpan={cols} className="state-cell msg-error">{error}</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={cols} className="state-cell">{empty}</td></tr>}
            {rows.map((j) => {
              const sc = salesOf.get(j.sales_id);
              return (
                <tr key={j.id} className="is-clickable" onDoubleClick={() => onOpen(j)}>
                  <td className="strong">{formatTicket(j.job_ticket)}</td>
                  <td>{formatDate(j.date_job_order)}</td>
                  <td className="strong">{sc ? customerOf.get(sc.customer_id) ?? "Unknown customer" : ""}</td>
                  <td>{sc?.cus_jo_no ?? ""}</td>
                  {!withStages && <td className="num">{sc?.sales_confirm_no ?? ""}</td>}
                  <td>{j.date_recipe ? formatDate(j.date_recipe) : <span className="msg-soft">none</span>}</td>
                  {withStages &&
                    STAGE_COLS.map(([key, label]) => (
                      <td key={label}>{stages.get(j.id)?.[key] ? formatDate(stages.get(j.id)[key]) : <span className="stage-none">-</span>}</td>
                    ))}
                  {showRolls && <td className="num">{rollCounts[j.id] ?? 0}</td>}
                  {action && <td className="actions-col" onDoubleClick={(e) => e.stopPropagation()}>{action(j)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && !error && rows.length > 0 && (
        <div className="table-foot"><span>{rows.length} {rows.length === 1 ? "job order" : "job orders"}</span></div>
      )}
    </div>
  );
}

export function useJobOrderList(query, notify) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const run = useCallback(
    async (filters = {}) => {
      setLoading(true);
      setError("");
      try {
        setRows(await searchJobOrders({ ...query, ...filters }));
      } catch (err) {
        setRows([]);
        setError(friendlyError(err));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query?.noRecipeOnly]
  );

  useEffect(() => {
    run();
  }, [run]);

  return { rows, loading, error, run };
}

/** Search job orders by customer JO, customer, job ticket, date, period and recipe date (any combination). */
export default function JobOrdersView({ lookups, confirmations, onOpen, notify }) {
  const [f, setF] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY); // the filters behind the list on screen (what a report shows)
  const [stages, setStages] = useState(null); // tracking dates + delivered date of the listed job orders; null while loading
  const [report, setReport] = useState(null); // "orders" | "tracking"
  const [statusOpen, setStatusOpen] = useState(false);
  const { rows, loading, error, run } = useJobOrderList({}, notify);

  useEffect(() => {
    let cancelled = false;
    setStages(null);
    if (loading) return undefined;
    if (rows.length === 0) {
      setStages(new Map());
      return undefined;
    }
    listStageDates(rows.map((j) => j.id))
      .then((m) => !cancelled && setStages(m))
      .catch((err) => {
        if (cancelled) return;
        setStages(new Map());
        notify?.("error", "Couldn't read the tracking dates", friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, loading]);

  const customerOf = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);
  const set = (key) => (e) => setF((v) => ({ ...v, [key]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    setApplied(f);
    run(f);
  };
  // applying the pop-up runs the search at once, together with the other filters
  const applyStatus = (status) => {
    const next = { ...f, status };
    setF(next);
    setApplied(next);
    setStatusOpen(false);
    run(next);
  };
  const clear = () => {
    setF(EMPTY);
    setApplied(EMPTY);
    run(EMPTY);
  };

  // ---- reports: the records on screen (the applied filters), one without and one with the tracking dates
  const filterLines = () => {
    const a = applied;
    const parts = [];
    if (a.customerId) parts.push(`Customer: ${customerOf.get(Number(a.customerId)) ?? ""}`);
    if (a.cusJoNo) parts.push(`Customer JO: ${a.cusJoNo}`);
    if (a.jobTicket) parts.push(`Job ticket: ${a.jobTicket}`);
    if (a.date) parts.push(`Date: ${formatDate(a.date)}`);
    if (a.from || a.to) parts.push(`Period: ${a.from ? formatDate(a.from) : "start"} to ${a.to ? formatDate(a.to) : "latest"}`);
    if (a.dateRecipe) parts.push(`Recipe date: ${formatDate(a.dateRecipe)}`);
    if (hasStatus(a.status)) parts.push(`Status: ${describeStatus(a.status)}`);
    return [parts.length ? `Filters: ${parts.join(";  ")}` : "Filters: none (all job orders)"];
  };
  const day = (v) => (v ? formatDate(v) : "");
  const reportRows = rows.map((j) => {
    const sc = salesOf.get(j.sales_id);
    const st = stages?.get(j.id) ?? {};
    return {
      key: j.id,
      cells: {
        ticket: formatTicket(j.job_ticket),
        date: day(j.date_job_order),
        customer: sc ? customerOf.get(sc.customer_id) ?? "" : "",
        cusjo: sc?.cus_jo_no ?? "",
        recipe: day(j.date_recipe),
        hydro: day(st.hydro),
        dryer: day(st.dryer),
        heatset: day(st.heatset),
        packed: day(st.packed),
        delivered: day(st.delivered),
      },
    };
  });
  const baseCols = [
    { key: "ticket", label: "Job ticket" },
    { key: "date", label: "Job order date" },
    { key: "customer", label: "Customer" },
    { key: "cusjo", label: "Customer JO" },
    { key: "recipe", label: "Recipe date" },
  ];
  const stageReportCols = STAGE_COLS.map(([key, label]) => ({ key, label }));
  const reportNote = `${rows.length} ${rows.length === 1 ? "job order" : "job orders"}${rows.length >= 500 ? " (the search shows the latest 500)" : ""}`;

  return (
    <section className="panel theme-search" aria-labelledby="jv-title">
      <div className="section-head"><h2 id="jv-title">Job orders</h2></div>

      <form className="search-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="jv-cusjo">Customer JO</label>
          <input id="jv-cusjo" value={f.cusJoNo} onChange={set("cusJoNo")} />
        </div>
        <div className="field">
          <label htmlFor="jv-customer">Customer</label>
          <select id="jv-customer" value={f.customerId} onChange={set("customerId")}>
            <option value="">All customers</option>
            {lookups.customers.map((c) => (
              <option key={c.id} value={c.id}>{c.customer_name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="jv-ticket">Job ticket</label>
          <TicketInput id="jv-ticket" autoComplete="off" maxLength={15} value={f.jobTicket} onValue={(v) => setF((s) => ({ ...s, jobTicket: v }))} />
        </div>
        <div className="field">
          <label htmlFor="jv-date">Date</label>
          <input id="jv-date" type="date" value={f.date} onChange={set("date")} />
        </div>
        <div className="field">
          <label htmlFor="jv-from">Period from</label>
          <input id="jv-from" type="date" value={f.from} onChange={set("from")} />
        </div>
        <div className="field">
          <label htmlFor="jv-to">Period to</label>
          <input id="jv-to" type="date" value={f.to} onChange={set("to")} />
        </div>
        <div className="field">
          <label htmlFor="jv-recipe">Recipe date</label>
          <input id="jv-recipe" type="date" value={f.dateRecipe} onChange={set("dateRecipe")} />
        </div>
        <div className="search-actions">
          <button type="submit" className="btn btn-primary">Filter</button>
          <button type="button" className="btn" onClick={clear}>Clear</button>
          <button type="button" className="btn btn-orange" onClick={() => setStatusOpen(true)}>Status filter...</button>
          <button type="button" className="btn" onClick={() => setReport("orders")} disabled={loading || rows.length === 0}>Print</button>
          <button type="button" className="btn" onClick={() => setReport("tracking")} disabled={loading || rows.length === 0 || stages === null}>Print tracking</button>
        </div>
      </form>

      {hasStatus(applied.status) && (
        <div className="filter-chip" role="status">
          <span>Status filter: <b>{describeStatus(applied.status)}</b></span>
          <button type="button" className="btn btn-small" onClick={() => applyStatus({})}>Remove</button>
        </div>
      )}

      <StatusFilterDialog open={statusOpen} value={f.status} onApply={applyStatus} onClose={() => setStatusOpen(false)} />

      <JobOrderTable rows={rows} loading={loading} error={error} customerOf={customerOf} salesOf={salesOf} onOpen={onOpen} empty="No job orders match." stages={stages ?? new Map()} />

      {report === "orders" && (
        <ListReport title="Job orders" lines={filterLines()} columns={baseCols} rows={reportRows} note={reportNote} onClose={() => setReport(null)} />
      )}
      {report === "tracking" && (
        <ListReport
          title="Job orders tracking"
          lines={filterLines()}
          columns={[...baseCols, ...stageReportCols]}
          rows={reportRows}
          note={reportNote}
          landscape
          onClose={() => setReport(null)}
        />
      )}
    </section>
  );
}
