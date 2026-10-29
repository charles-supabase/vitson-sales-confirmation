import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./Icons.jsx";
import { TicketInput } from "./FormFields.jsx";
import ListReport from "./ListReport.jsx";
import StatusFilterDialog, { describeStatus, hasStatus } from "./StatusFilter.jsx";
import {
  deleteTracking,
  friendlyError,
  getTracking,
  listRecentTracking,
  saveTracking,
  searchJobOrders,
  trackingWeightSummary,
} from "../lib/salesApi.js";
import { compactTicket, formatDate, formatTicket, formatWeight, today } from "../lib/format.js";
import { unsavedPrompt, useUnsavedGuard } from "../lib/unsavedGuard.js";

// Each stage: the tbl_tracking columns it writes and which tbl_machine.machine_type values its dropdown offers
const STAGES = [
  { key: "hydro", label: "Hydro", dateCol: "date_hydro", machineCol: "machine_hydro_id", types: [3], required: true },
  { key: "dryer", label: "Dryer", dateCol: "date_dryer", machineCol: "machine_dryer_id", types: [2] },
  { key: "heatset", label: "Heatset", dateCol: "date_Heatset", machineCol: "machine_heatset_id", types: [11, 10] },
  { key: "packed", label: "Packed", dateCol: "date_packed", machineCol: "machine_packed_id", types: [32] },
];

// A stage that is already recorded is on, with its saved date and machine. Dates default to today.
const formFor = (tracking) =>
  Object.fromEntries(
    STAGES.map((s) => {
      const date = tracking?.[s.dateCol] ?? null;
      return [s.key, { on: s.required ? true : Boolean(date), date: date ?? today(), machine: tracking?.[s.machineCol] ? String(tracking[s.machineCol]) : "" }];
    })
  );

const monthRange = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
};

export default function TrackingView({ lookups, confirmations, notify, confirmDelete }) {
  const [tickets, setTickets] = useState([]); // latest job orders, for the suggestion list
  const [text, setText] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [job, setJob] = useState(null);
  const [tracking, setTracking] = useState(null);
  const [form, setForm] = useState(formFor(null));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [recent, setRecent] = useState({ rows: [], jobs: [] });
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState("");

  // summary (right side): filter on date_hydro, one day or a period such as a whole month
  const [mode, setMode] = useState("period");
  const [day, setDay] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [range, setRange] = useState(() => monthRange(today().slice(0, 7)));
  const [summary, setSummary] = useState({ rows: [], loading: true, error: "", label: "", statusText: "" });
  const [summaryStatus, setSummaryStatus] = useState({}); // conditions on the other stage dates (pop-up)
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef({});
  statusRef.current = summaryStatus;
  const summaryReq = useRef(0); // only the latest request may fill the summary

  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);
  const customerOf = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const processName = useMemo(() => new Map(lookups.dyeProcesses.map((d) => [d.id, d.dye_process_name])), [lookups.dyeProcesses]);
  const jobById = useMemo(() => new Map(recent.jobs.map((j) => [j.id, j])), [recent.jobs]);

  // unsaved changes: the stage form differs from what is saved (or from the blank form)
  const dirty = Boolean(job) && JSON.stringify(form) !== JSON.stringify(formFor(tracking));
  useUnsavedGuard(dirty);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError("");
    try {
      setRecent(await listRecentTracking());
    } catch (err) {
      setRecentError(friendlyError(err));
    } finally {
      setRecentLoading(false);
    }
  }, []);

  const runSummary = useCallback(async (fromDate, toDate) => {
    const id = ++summaryReq.current;
    if (!fromDate || !toDate || fromDate > toDate) {
      setSummary({ rows: [], loading: false, error: "Choose a day, or a period that starts before it ends.", label: "", statusText: "" });
      return;
    }
    const cond = statusRef.current;
    setSummary((s) => ({ ...s, loading: true, error: "" }));
    try {
      const rows = await trackingWeightSummary(fromDate, toDate, cond);
      if (id !== summaryReq.current) return;
      setSummary({
        rows,
        loading: false,
        error: "",
        label: fromDate === toDate ? formatDate(fromDate) : `${formatDate(fromDate)} to ${formatDate(toDate)}`,
        statusText: describeStatus(cond, ["hydro"]),
      });
    } catch (err) {
      if (id === summaryReq.current) setSummary({ rows: [], loading: false, error: friendlyError(err), label: "", statusText: "" });
    }
  }, []);

  // The summary loads by itself whenever the day, period or status filter changes (Show summary still works)
  useEffect(() => {
    const [a, b] = mode === "day" ? [day, day] : [range.from, range.to];
    if (!a || !b || a > b) return undefined; // wait for sensible dates; the button reports a bad period
    const timer = setTimeout(() => runSummary(a, b), 250);
    return () => clearTimeout(timer);
  }, [mode, day, range.from, range.to, summaryStatus, runSummary]);

  useEffect(() => {
    loadRecent();
    searchJobOrders({})
      .then(setTickets)
      .catch(() => setTickets([])); // the Find button still searches the database
  }, [loadRecent]);

  const chooseJob = useCallback(async (jo) => {
    setJob(jo);
    setText(formatTicket(jo.job_ticket));
    setCandidates([]);
    setSearchError("");
    setErrors({});
    try {
      const t = await getTracking(jo.id);
      setTracking(t);
      setForm(formFor(t));
    } catch (err) {
      setTracking(null);
      setForm(formFor(null));
      setSearchError(friendlyError(err));
    }
  }, []);

  // Going to another job ticket with unsaved changes asks first
  const pick = (jo) => {
    if (dirty && jo.id !== job?.id) confirmDelete(unsavedPrompt(() => chooseJob(jo)));
    else chooseJob(jo);
  };

  const sameTicket = (a, b) => compactTicket(a) === compactTicket(b);

  const find = async () => {
    const q = text.trim();
    if (!q) return;
    setSearchError("");
    setCandidates([]);
    const known = tickets.filter((j) => sameTicket(j.job_ticket, q));
    if (known.length === 1) return pick(known[0]);
    try {
      const found = await searchJobOrders({ jobTicket: q });
      const exact = found.filter((j) => sameTicket(j.job_ticket, q));
      if (exact.length === 1) return pick(exact[0]);
      if (found.length === 1) return pick(found[0]);
      if (found.length === 0) return setSearchError(`No job order matches "${q}".`);
      setCandidates(found.slice(0, 20));
    } catch (err) {
      setSearchError(friendlyError(err));
    }
  };

  const onTicketChange = (value) => {
    setText(value);
    const known = value.trim() ? tickets.filter((j) => sameTicket(j.job_ticket, value)) : []; // picked from the suggestion list
    if (known.length === 1 && !(job && job.id === known[0].id)) pick(known[0]);
  };

  const setStage = (key, patch) => setForm((f) => ({ ...f, [key]: { ...f[key], ...patch } }));
  const toggle = (key, on) => setStage(key, on ? { on: true, date: form[key].date || today() } : { on: false, machine: "" });

  const machineOptions = (stage) => {
    const list = lookups.machines.filter((m) => stage.types.includes(m.machine_type));
    const current = lookups.machines.find((m) => String(m.id) === form[stage.key].machine);
    return current && !list.includes(current) ? [...list, current] : list; // keep a saved machine that no longer matches the type
  };

  const save = async (e) => {
    e.preventDefault();
    if (!job) return;
    const next = {};
    for (const s of STAGES) {
      const f = form[s.key];
      if (!f.on) continue;
      if (!f.date) next[s.key] = `Enter the ${s.label} date.`;
      else if (!f.machine) next[s.key] = `Select the ${s.label} machine.`;
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const payload = { job_order_id: job.id };
    for (const s of STAGES) {
      const f = form[s.key];
      payload[s.dateCol] = f.on ? f.date : null;
      payload[s.machineCol] = f.on ? Number(f.machine) : null;
    }
    setSaving(true);
    try {
      const saved = await saveTracking({ id: tracking?.id, ...payload });
      setTracking(saved);
      setForm(formFor(saved));
      await loadRecent();
      notify("success", "Saved successfully", `Tracking for job ticket ${formatTicket(job.job_ticket)} has been saved.`);
    } catch (err) {
      notify("error", "Couldn't save tracking", friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (row) => {
    const j = jobById.get(row.job_order_id);
    confirmDelete({
      title: "Delete this tracking record?",
      message: `The tracking of job ticket ${formatTicket(j?.job_ticket)} will be removed. This can't be undone.`,
      confirmLabel: "Delete tracking",
      onConfirm: async () => {
        await deleteTracking(row.id);
        if (tracking?.id === row.id) {
          setTracking(null);
          setForm(formFor(null));
        }
        await loadRecent();
        await runSummary(...(mode === "day" ? [day, day] : [range.from, range.to]));
        notify("success", "Deleted", "The tracking record has been deleted.");
      },
    });
  };

  const sales = job ? salesOf.get(job.sales_id) : null;
  const typeName = job ? lookups.dyeProcesses.find((d) => d.id === job.dye_process_id)?.dye_process_name : "";
  const colorName = job ? lookups.colors.find((c) => c.id === job.color_id)?.color_name : "";

  const onMonth = (e) => {
    const ym = e.target.value;
    setMonth(ym);
    if (ym) setRange(monthRange(ym)); // a whole month
  };
  const [reportOpen, setReportOpen] = useState(false);
  const grand = summary.rows.reduce((t, r) => ({ jobs: t.jobs + Number(r.job_orders), weight: t.weight + Number(r.total_weight) }), { jobs: 0, weight: 0 });

  return (
    <section className="panel theme-track" aria-labelledby="tr-title">
      <div className="section-head"><h2 id="tr-title">Tracking</h2></div>

      <div className="track-layout">
        <div className="track-main">
          <form
            className="track-find"
            onSubmit={(e) => {
              e.preventDefault();
              find();
            }}
          >
            <div className="field">
              <label htmlFor="track-ticket">Job ticket</label>
              <TicketInput id="track-ticket" list="track-tickets" autoComplete="off" maxLength={13} value={text} onValue={onTicketChange} />
              <datalist id="track-tickets">
                {tickets.map((j) => (
                  <option key={j.id} value={formatTicket(j.job_ticket)} />
                ))}
              </datalist>
            </div>
            <button type="submit" className="btn btn-primary">Find</button>
          </form>
          {searchError && <p className="msg-error">{searchError}</p>}
          {candidates.length > 0 && (
            <ul className="track-candidates" aria-label="Job orders that match">
              {candidates.map((j) => (
                <li key={j.id}>
                  <button type="button" className="row-btn row-btn-go" onClick={() => pick(j)}>{formatTicket(j.job_ticket)}</button>
                  <span>{salesOf.get(j.sales_id)?.cus_jo_no ?? ""}</span>
                </li>
              ))}
            </ul>
          )}

          {job && (
            <>
              <div className="ctx ctx-recipe ctx-track">
                <span className="ctx-pill ctx-c3">Job Ticket : <b>{formatTicket(job.job_ticket)}</b></span>
                <span className="ctx-pill ctx-c1">Customer : <b>{sales ? customerOf.get(sales.customer_id) ?? "" : ""}</b></span>
                <span className="ctx-pill ctx-c2">Customer JO : <b>{sales?.cus_jo_no ?? ""}</b></span>
                <span className="ctx-pill ctx-c4">Type : <b>{typeName || "-"}</b></span>
                <span className="ctx-pill ctx-c5">Color : <b>{colorName || "-"}</b></span>
              </div>

              <form className="stage-card" onSubmit={save} noValidate>
                {STAGES.map((s) => {
                  const f = form[s.key];
                  return (
                    <div className={`stage-row ${f.on ? "is-on" : ""}`} key={s.key}>
                      <label className="stage-check">
                        <input type="checkbox" checked={f.on} disabled={s.required} onChange={(e) => toggle(s.key, e.target.checked)} />
                        <span>{s.label}</span>
                      </label>
                      <div className="field">
                        <label htmlFor={`track-${s.key}-date`}>Date</label>
                        <input id={`track-${s.key}-date`} type="date" value={f.date} disabled={!f.on} onChange={(e) => setStage(s.key, { date: e.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor={`track-${s.key}-machine`}>Machine</label>
                        <select id={`track-${s.key}-machine`} value={f.machine} disabled={!f.on} onChange={(e) => setStage(s.key, { machine: e.target.value })}>
                          <option value="">Select machine</option>
                          {machineOptions(s).map((m) => (
                            <option key={m.id} value={m.id}>{m.machine_name}</option>
                          ))}
                        </select>
                      </div>
                      {errors[s.key] && <p className="msg-error stage-error">{errors[s.key]}</p>}
                    </div>
                  );
                })}
                <div className="stage-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Save tracking"}</button>
                </div>
              </form>
            </>
          )}

          <h3 className="sub-title">Recent tracking</h3>
          <div className="table-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Job ticket</th>
                    <th>Hydro</th>
                    <th>Dryer</th>
                    <th>Heatset</th>
                    <th>Packed</th>
                    <th className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {recentLoading && <tr><td colSpan={6} className="state-cell">Loading...</td></tr>}
                  {!recentLoading && recentError && <tr><td colSpan={6} className="state-cell msg-error">{recentError}</td></tr>}
                  {!recentLoading && !recentError && recent.rows.length === 0 && <tr><td colSpan={6} className="state-cell">No tracking recorded yet.</td></tr>}
                  {recent.rows.map((r) => {
                    const j = jobById.get(r.job_order_id);
                    return (
                      <tr key={r.id} className={`is-clickable ${job && r.job_order_id === job.id ? "is-selected" : ""}`} onDoubleClick={() => j && pick(j)}>
                        <td className="strong">{formatTicket(j?.job_ticket)}</td>
                        <td>{formatDate(r.date_hydro)}</td>
                        <td>{r.date_dryer ? formatDate(r.date_dryer) : ""}</td>
                        <td>{r.date_Heatset ? formatDate(r.date_Heatset) : ""}</td>
                        <td>{r.date_packed ? formatDate(r.date_packed) : ""}</td>
                        <td className="actions-col" onDoubleClick={(e) => e.stopPropagation()}>
                          <IconButton kind="edit" label={`Edit tracking of job ticket ${formatTicket(j?.job_ticket)}`} onClick={() => j && pick(j)} disabled={!j} />
                          <IconButton kind="delete" label={`Delete tracking of job ticket ${formatTicket(j?.job_ticket)}`} onClick={() => askDelete(r)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* right third: weight per dye process for a Hydro date filter */}
        <aside className="track-summary" aria-labelledby="ts-title">
          <h3 id="ts-title">Tracking summary</h3>
          <form
            className="summary-filter"
            onSubmit={(e) => {
              e.preventDefault();
              runSummary(...(mode === "day" ? [day, day] : [range.from, range.to]));
            }}
          >
            <fieldset>
              <legend>Hydro date</legend>
              <label className="check"><input type="radio" name="sum-mode" checked={mode === "day"} onChange={() => setMode("day")} /> A day</label>
              <label className="check"><input type="radio" name="sum-mode" checked={mode === "period"} onChange={() => setMode("period")} /> A period</label>
            </fieldset>
            {mode === "day" ? (
              <div className="field">
                <label htmlFor="sum-day">Day</label>
                <input id="sum-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </div>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="sum-month">Whole month</label>
                  <input id="sum-month" type="month" value={month} onChange={onMonth} />
                </div>
                <div className="field">
                  <label htmlFor="sum-from">From</label>
                  <input id="sum-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                </div>
                <div className="field">
                  <label htmlFor="sum-to">To</label>
                  <input id="sum-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                </div>
              </>
            )}
            <div className="summary-buttons">
              <button type="submit" className="btn btn-primary">Show summary</button>
              <button type="button" className="btn btn-orange" onClick={() => setStatusOpen(true)}>Status filter...</button>
              <button type="button" className="btn" onClick={() => setReportOpen(true)} disabled={summary.loading || Boolean(summary.error) || summary.rows.length === 0}>Print</button>
            </div>
          </form>

          {summary.error && <p className="msg-error">{summary.error}</p>}
          {summary.loading && <p className="msg">Loading...</p>}
          {!summary.loading && !summary.error && (
            <>
              <p className="summary-label">{summary.label}</p>
              {summary.statusText && (
                <p className="summary-label">
                  {summary.statusText}{" "}
                  <button type="button" className="btn btn-small" onClick={() => setSummaryStatus({})}>Remove</button>
                </p>
              )}
              <table className="summary-table">
                <thead>
                  <tr><th>Dye process</th><th className="num">Job orders</th><th className="num">Total weight</th></tr>
                </thead>
                <tbody>
                  {summary.rows.length === 0 && <tr><td colSpan={3} className="state-cell">No tracking with a Hydro date in this period.</td></tr>}
                  {summary.rows.map((r) => (
                    <tr key={r.dye_process_id ?? "none"}>
                      <td>{processName.get(r.dye_process_id) ?? "No dye process"}</td>
                      <td className="num">{r.job_orders}</td>
                      <td className="num">{formatWeight(r.total_weight)}</td>
                    </tr>
                  ))}
                </tbody>
                {summary.rows.length > 0 && (
                  <tfoot>
                    <tr><th>Grand total</th><th className="num">{grand.jobs}</th><th className="num">{formatWeight(grand.weight)}</th></tr>
                  </tfoot>
                )}
              </table>
            </>
          )}
        </aside>
      </div>
      <StatusFilterDialog
        open={statusOpen}
        value={summaryStatus}
        hide={["hydro"]}
        onApply={(c) => {
          setSummaryStatus(c);
          setStatusOpen(false);
        }}
        onClose={() => setStatusOpen(false)}
      />

      {reportOpen && (
        <ListReport
          title="Tracking summary"
          lines={[`Hydro date: ${summary.label}`, ...(summary.statusText ? [`Status: ${summary.statusText}`] : []), "Weight and job orders per dye process"]}
          columns={[
            { key: "process", label: "Dye process" },
            { key: "jobs", label: "Job orders", num: true },
            { key: "weight", label: "Total weight", num: true },
          ]}
          rows={summary.rows.map((r) => ({
            key: r.dye_process_id ?? "none",
            cells: { process: processName.get(r.dye_process_id) ?? "No dye process", jobs: r.job_orders, weight: formatWeight(r.total_weight) },
          }))}
          totals={{ process: "Grand total", jobs: grand.jobs, weight: formatWeight(grand.weight) }}
          onClose={() => setReportOpen(false)}
        />
      )}
    </section>
  );
}
