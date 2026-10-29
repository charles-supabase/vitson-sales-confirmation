import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, listDeliveries } from "../lib/salesApi.js";
import { formatDate, formatWeight } from "../lib/format.js";

const TYPES = { 1: "Big", 2: "Small" }; // tbl_receivable_type
const EMPTY = { from: "", to: "", receipt: "", aliasId: "" };

/** Deliveries mirrored from charles-supabase (tbl_Deliveries_Sync). Read-only. */
export default function DeliveriesView({ lookups }) {
  const [f, setF] = useState(EMPTY);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const aliasName = useMemo(() => new Map(lookups.aliases.map((a) => [a.id, a.alias_name])), [lookups.aliases]);

  const run = useCallback(async (filters) => {
    setLoading(true);
    setError("");
    try {
      setRows(await listDeliveries(filters));
    } catch (err) {
      setRows([]);
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    run(EMPTY);
  }, [run]);

  const set = (key) => (e) => setF((v) => ({ ...v, [key]: e.target.value }));
  const total = (r) => r.delivered_body_wt + r.delivered_1x1_wt + r.delivered_cc_wt;
  const rolls = (r) => r.count_body + r.count_1x1 + r.count_cc;
  const sum = rows.reduce((t, r) => ({ weight: t.weight + total(r), rolls: t.rolls + rolls(r) }), { weight: 0, rolls: 0 });

  return (
    <section className="panel theme-deliv" aria-labelledby="dv-title">
      <div className="section-head"><h2 id="dv-title">Deliveries</h2></div>

      <form
        className="search-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(f);
        }}
      >
        <div className="field">
          <label htmlFor="dv-from">Delivered from</label>
          <input id="dv-from" type="date" value={f.from} onChange={set("from")} />
        </div>
        <div className="field">
          <label htmlFor="dv-to">Delivered to</label>
          <input id="dv-to" type="date" value={f.to} onChange={set("to")} />
        </div>
        <div className="field">
          <label htmlFor="dv-dr">Delivery receipt</label>
          <input id="dv-dr" inputMode="numeric" value={f.receipt} onChange={set("receipt")} />
        </div>
        <div className="field">
          <label htmlFor="dv-alias">Alias</label>
          <select id="dv-alias" value={f.aliasId} onChange={set("aliasId")}>
            <option value="">All aliases</option>
            {lookups.aliases.map((a) => (
              <option key={a.id} value={a.id}>{a.alias_name}</option>
            ))}
          </select>
        </div>
        <div className="search-actions">
          <button type="submit" className="btn btn-primary">Filter</button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setF(EMPTY);
              run(EMPTY);
            }}
          >
            Clear
          </button>
        </div>
      </form>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">DR no.</th>
                <th>Date delivered</th>
                <th>Type</th>
                <th>Alias</th>
                <th className="num">Body</th>
                <th className="num">1x1</th>
                <th className="num">C+C</th>
                <th className="num">Total weight</th>
                <th className="num">Rolls</th>
                <th className="num">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={10} className="state-cell">Loading...</td></tr>}
              {!loading && error && <tr><td colSpan={10} className="state-cell msg-error">{error}</td></tr>}
              {!loading && !error && rows.length === 0 && (
                <tr><td colSpan={10} className="state-cell">No deliveries found. If none show at all, check that the tbl_Deliveries webhook is set up and run the backfill.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="num strong">{r.delivery_receipt}</td>
                  <td>{formatDate(r.date_delivery)}</td>
                  <td>{TYPES[r.receivable_type_id] ?? r.receivable_type_id}</td>
                  <td>{r.alias_id ? aliasName.get(r.alias_id) ?? "Unknown alias" : ""}</td>
                  <td className="num">{formatWeight(r.delivered_body_wt)}</td>
                  <td className="num">{formatWeight(r.delivered_1x1_wt)}</td>
                  <td className="num">{formatWeight(r.delivered_cc_wt)}</td>
                  <td className="num strong">{formatWeight(total(r))}</td>
                  <td className="num">{rolls(r)}</td>
                  <td className="num">{r.invoice_id ? r.invoice_id : <span className="msg-soft">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !error && rows.length > 0 && (
          <div className="table-foot">
            <span>{rows.length} {rows.length === 1 ? "delivery" : "deliveries"}</span>
            <span>{formatWeight(sum.weight)} in {sum.rolls} rolls</span>
          </div>
        )}
      </div>
    </section>
  );
}
