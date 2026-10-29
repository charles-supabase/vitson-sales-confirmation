import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, searchJobOrders } from "../lib/salesApi.js";
import { formatDate } from "../lib/format.js";

const EMPTY = { cusJoNo: "", customerId: "", jobTicket: "", date: "", from: "", to: "", dateRecipe: "" };

// Shared by the "Job Orders" search and the "Recipe" (no recipe yet) list
export function JobOrderTable({ rows, loading, error, customerOf, salesOf, onOpen, action, empty }) {
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
              <th className="num">Sales conf. no.</th>
              <th>Recipe date</th>
              {action && <th className="actions-col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="state-cell">Loading...</td></tr>}
            {!loading && error && <tr><td colSpan={7} className="state-cell msg-error">{error}</td></tr>}
            {!loading && !error && rows.length === 0 && <tr><td colSpan={7} className="state-cell">{empty}</td></tr>}
            {rows.map((j) => {
              const sc = salesOf.get(j.sales_id);
              return (
                <tr key={j.id} className="is-clickable" onDoubleClick={() => onOpen(j)}>
                  <td className="strong">{j.job_ticket}</td>
                  <td>{formatDate(j.date_job_order)}</td>
                  <td className="strong">{sc ? customerOf.get(sc.customer_id) ?? "Unknown customer" : ""}</td>
                  <td>{sc?.cus_jo_no ?? ""}</td>
                  <td className="num">{sc?.sales_confirm_no ?? ""}</td>
                  <td>{j.date_recipe ? formatDate(j.date_recipe) : <span className="msg-soft">none</span>}</td>
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
  const { rows, loading, error, run } = useJobOrderList({}, notify);

  const customerOf = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);
  const set = (key) => (e) => setF((v) => ({ ...v, [key]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    run(f);
  };
  const clear = () => {
    setF(EMPTY);
    run(EMPTY);
  };

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
          <input id="jv-ticket" value={f.jobTicket} onChange={set("jobTicket")} />
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
        </div>
      </form>

      <JobOrderTable rows={rows} loading={loading} error={error} customerOf={customerOf} salesOf={salesOf} onOpen={onOpen} empty="No job orders match." />
    </section>
  );
}
