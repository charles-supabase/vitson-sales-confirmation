import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "./Icons.jsx";
import { TicketInput } from "./FormFields.jsx";
import { LockBanner, useJobOrderLocks } from "../lib/lock.jsx";
import DeliveryReceiptReport from "./DeliveryReceiptReport.jsx";
import {
  deleteDelivery,
  findDeliveryCandidates,
  friendlyError,
  getMaxDeliveryReceipt,
  loadDeliveryReceipt,
  listDeliveredRolls,
  listRecentDeliveries,
  listRolls,
  saveDelivery,
  setDefaultAlias,
} from "../lib/salesApi.js";
import { formatDate, formatTicket, formatWeight, today } from "../lib/format.js";
import { unsavedPrompt, useUnsavedGuard } from "../lib/unsavedGuard.js";

const LOSS_LIMIT = 5; // a weight loss above this percentage fails
const norm = (v) => String(v ?? "").trim().toLowerCase();
const noZeros = (v) => String(v ?? "").trim().replace(/^0+(?=\d)/, ""); // customer numbers compare without leading zeros
const blankForm = () => ({ date: today(), receipt: "", typeId: "", aliasId: "", sl: "", sw: "", density: "" });
const groupRolls = (list) => {
  const out = {};
  for (const r of list) (out[r.roll_type_id] ??= []).push(Number(r.roll_wt));
  return out;
};
const sum = (list) => list.reduce((n, w) => n + Number(w || 0), 0);

/**
 * One form for a delivery: pick a job ticket that hasn't been delivered, enter the delivery details and the delivered
 * rolls (same layout as Fabric Info), and compare with what was picked up. Saves tbl_Delivery + tbl_fabric_info_delivered.
 */
export default function DeliveriesView({ lookups, confirmations, notify, confirmDelete, reloadLookups }) {
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [candLoading, setCandLoading] = useState(true);
  const [candError, setCandError] = useState("");

  const [job, setJob] = useState(null); // the job order being delivered
  const [delivery, setDelivery] = useState(null); // the saved record when editing
  const [ticketRolls, setTicketRolls] = useState([]); // rolls picked up (tbl_fabric_info): the "Ticket" side
  const [form, setForm] = useState(blankForm());
  const [rolls, setRolls] = useState({}); // delivered rolls { [roll type id]: [weights] }
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [defaultBusy, setDefaultBusy] = useState(false);
  const [maxReceipt, setMaxReceipt] = useState(null); // highest delivery receipt of the chosen receivable type

  const [recent, setRecent] = useState({ rows: [], rolls: [], jobs: [] });
  const [recentLoading, setRecentLoading] = useState(true);
  const [recentError, setRecentError] = useState("");
  const [receipt, setReceipt] = useState(null); // { data, big } while the printed delivery receipt is open
  // Deliveries marked copied lock their job order and delivery (view only) until the password is entered
  const locks = useJobOrderLocks([job?.id, ...recent.rows.map((r) => r.job_order_id)], recent.rows);
  const formLocked = Boolean(job) && locks.isLocked(job.id);

  const snapshot = useRef("");
  const inputs = useRef({});

  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);
  const customerById = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c])), [lookups.customers]);
  const aliasName = useMemo(() => new Map(lookups.aliases.map((a) => [a.id, a.alias_name])), [lookups.aliases]);
  const typeName = useMemo(() => new Map(lookups.receivableTypes.map((t) => [t.id, t.receivable_type])), [lookups.receivableTypes]);
  const jobById = useMemo(() => new Map(recent.jobs.map((j) => [j.id, j])), [recent.jobs]);
  const nameOf = (list, key, id) => list.find((r) => r.id === id)?.[key] ?? "";

  const sales = job ? salesOf.get(job.sales_id) : null;
  const customer = sales ? customerById.get(sales.customer_id) : null;
  const defaultAliasId = customer?.default_alias_id ?? null;

  // unsaved changes: anything different from what was loaded, or a weight typed but not added with Enter
  const dirty = Boolean(job) && (JSON.stringify({ form, rolls }) !== snapshot.current || Object.values(drafts).some((v) => v && v.trim() !== ""));
  useUnsavedGuard(dirty);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    setRecentError("");
    try {
      setRecent(await listRecentDeliveries());
    } catch (err) {
      setRecentError(friendlyError(err));
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // The highest delivery receipt of the chosen type (BIG or SMALL); read again whenever the deliveries change
  useEffect(() => {
    if (!job || !form.typeId) {
      setMaxReceipt(null);
      return undefined;
    }
    let cancelled = false;
    getMaxDeliveryReceipt(Number(form.typeId))
      .then((n) => !cancelled && setMaxReceipt(n))
      .catch(() => !cancelled && setMaxReceipt(null));
    return () => {
      cancelled = true;
    };
  }, [job, form.typeId, recent.rows]);

  // Job tickets that have no delivery yet (typed with or without dashes)
  useEffect(() => {
    if (job) return undefined;
    let cancelled = false;
    setCandLoading(true);
    const timer = setTimeout(async () => {
      try {
        const list = await findDeliveryCandidates(search);
        if (!cancelled) {
          setCandidates(list);
          setCandError("");
        }
      } catch (err) {
        if (!cancelled) {
          setCandidates([]);
          setCandError(friendlyError(err));
        }
      } finally {
        if (!cancelled) setCandLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, job]);

  const resetForm = () => {
    const f = blankForm();
    setJob(null);
    setDelivery(null);
    setTicketRolls([]);
    setForm(f);
    setRolls({});
    setDrafts({});
    setErrors({});
    snapshot.current = JSON.stringify({ form: f, rolls: {} });
  };

  const load = async (jo, existing = null) => {
    let ticket = [];
    let delivered = [];
    try {
      ticket = await listRolls(jo.id);
      if (existing) delivered = await listDeliveredRolls(existing.id);
    } catch (err) {
      notify("error", "Couldn't load the job order", friendlyError(err));
      return;
    }
    const f = existing
      ? {
          date: existing.date_delivery,
          receipt: String(existing.delivery_receipt),
          typeId: String(existing.receivable_type_id),
          aliasId: existing.alias_id ? String(existing.alias_id) : "",
          sl: existing.shrinkage_length ?? "",
          sw: existing.shrinkage_width ?? "",
          density: existing.acquired_density ?? "",
        }
      : blankForm();
    const r = groupRolls(delivered);
    setJob(jo);
    setDelivery(existing);
    setTicketRolls(ticket);
    setForm({ ...f, sl: String(f.sl), sw: String(f.sw), density: String(f.density) });
    setRolls(r);
    setDrafts({});
    setErrors({});
    snapshot.current = JSON.stringify({ form: { ...f, sl: String(f.sl), sw: String(f.sw), density: String(f.density) }, rolls: r });
  };

  // Leaving a form with unsaved changes asks first
  const guardedDo = (action) => (dirty ? confirmDelete(unsavedPrompt(action)) : action());

  const onType = (e) => {
    const v = e.target.value;
    // BIG receipts start from the customer's default alias; SMALL receipts have no alias
    setForm((f) => ({ ...f, typeId: v, aliasId: v === "1" ? f.aliasId || (defaultAliasId ? String(defaultAliasId) : "") : "" }));
  };
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Double-click on the receipt box: the next number (highest of this type + 1)
  const fillNextReceipt = async () => {
    if (!form.typeId) return setErrors((e) => ({ ...e, typeId: "Select the receivable type first." }));
    try {
      const max = await getMaxDeliveryReceipt(Number(form.typeId));
      setMaxReceipt(max);
      setForm((f) => ({ ...f, receipt: String(max + 1) }));
      setErrors((e) => ({ ...e, receipt: "" }));
    } catch (err) {
      notify("error", "Couldn't read the last delivery receipt", friendlyError(err));
    }
  };

  // alias choices: ONLY the aliases whose associated_customer (comma separated customer numbers) contains this customer's number.
  // An alias already chosen on a saved delivery stays visible (marked) so it is never lost silently.
  const aliasChoices = useMemo(() => {
    const no = noZeros(customer?.customer_no);
    const live = lookups.aliases.filter((a) => a.is_active !== false || String(a.id) === form.aliasId);
    const linked = live.filter((a) => no && String(a.associated_customer ?? "").split(",").map(noZeros).includes(no));
    const kept = live.filter((a) => String(a.id) === form.aliasId && !linked.includes(a));
    return { linked, kept, no };
  }, [lookups.aliases, customer, form.aliasId]);
  const aliasLabel = (a) => (a.id === defaultAliasId ? `${a.alias_name} (default)` : a.alias_name);

  // delivered roll entry: Enter adds the weight(s) typed in that roll type's box
  const addRolls = (typeId) => {
    const tokens = (drafts[typeId] ?? "").split(/[\s,;]+/).filter(Boolean);
    if (tokens.length === 0) return;
    const weights = tokens.map(Number);
    const bad = tokens.filter((_, i) => !Number.isFinite(weights[i]) || weights[i] <= 0);
    if (bad.length) return setErrors((e) => ({ ...e, [`roll-${typeId}`]: `Not a valid weight: ${bad.join(", ")}` }));
    setErrors((e) => ({ ...e, [`roll-${typeId}`]: "" }));
    setRolls((r) => ({ ...r, [typeId]: [...(r[typeId] ?? []), ...weights] }));
    setDrafts((d) => ({ ...d, [typeId]: "" }));
  };
  const removeRoll = (typeId, index) => setRolls((r) => ({ ...r, [typeId]: r[typeId].filter((_, i) => i !== index) }));

  // comparison with the job ticket: loss % = (ticket - delivered) / ticket x 100; rolls: the balance must be 0
  const deliveredList = Object.values(rolls).flat();
  const deliveredWt = sum(deliveredList);
  const deliveredCount = deliveredList.length;
  const ticketWt = sum(ticketRolls.map((r) => r.roll_wt));
  const ticketCount = ticketRolls.length;
  const loss = ticketWt > 0 ? ((ticketWt - deliveredWt) / ticketWt) * 100 : null;
  const lossShown = loss === null ? null : Math.round(loss * 100) / 100; // what the badge displays
  const isGain = lossShown !== null && lossShown < 0; // negative loss = more delivered than received
  const balance = ticketCount - deliveredCount;
  const showResult = deliveredCount > 0;

  const bodyType = lookups.rollTypes.find((t) => norm(t.roll_name) === "body");
  const x1Type = lookups.rollTypes.find((t) => norm(t.roll_name) === "1x1");
  const bodyWt = bodyType ? sum(rolls[bodyType.id] ?? []) : 0;
  const x1Wt = x1Type ? sum(rolls[x1Type.id] ?? []) : 0;

  // What was received (the job ticket's fabric info). Only those roll types get an entry column.
  const receivedByType = new Map();
  const receivedCount = new Map(); // number of rolls received per roll type, shown as Body(4)
  for (const r of ticketRolls) {
    receivedByType.set(r.roll_type_id, (receivedByType.get(r.roll_type_id) ?? 0) + Number(r.roll_wt || 0));
    receivedCount.set(r.roll_type_id, (receivedCount.get(r.roll_type_id) ?? 0) + 1);
  }
  const receivedBody = bodyType ? receivedByType.get(bodyType.id) ?? 0 : 0;
  const receivedX1 = x1Type ? receivedByType.get(x1Type.id) ?? 0 : 0;
  const visibleTypes = lookups.rollTypes.filter((t) => receivedByType.has(t.id) || (rolls[t.id]?.length ?? 0) > 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!job || formLocked) return;
    const next = {};
    const receipt = Number(form.receipt);
    if (!form.receipt || !Number.isInteger(receipt) || receipt <= 0) next.receipt = "Enter the delivery receipt number.";
    if (!form.date) next.date = "Enter the delivery date.";
    if (!form.typeId) next.typeId = "Select the receivable type.";
    for (const [key, label] of [["sl", "Shrinkage length"], ["sw", "Shrinkage width"], ["density", "Acquired density"]]) {
      const n = Number(form[key]);
      if (String(form[key]).trim() !== "" && (!Number.isInteger(n) || n < -32768 || n > 32767)) next[key] = `${label} must be a whole number.`;
    }
    if (Object.values(drafts).some((v) => v && v.trim() !== "")) next.rolls = "Press Enter to add the weights you typed, or clear them.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const int = (v) => (String(v).trim() === "" ? null : Number(v));
    const aliasId = form.typeId === "1" && form.aliasId ? Number(form.aliasId) : null;
    setSaving(true);
    try {
      await saveDelivery({
        id: delivery?.id ?? null,
        job_order_id: job.id,
        delivery_receipt: receipt,
        receivable_type_id: Number(form.typeId),
        date_delivery: form.date,
        alias_id: aliasId,
        shrinkage_length: int(form.sl),
        shrinkage_width: int(form.sw),
        acquired_density: int(form.density),
        rolls: Object.entries(rolls).flatMap(([typeId, list]) => list.map((w) => ({ roll_type_id: Number(typeId), roll_wt: w }))),
      });

      // BIG receipt with an alias other than the customer's default: offer to make it the new default
      const askDefault = aliasId && customer && aliasId !== defaultAliasId;
      const cust = customer;
      const label = aliasName.get(aliasId);
      resetForm();
      await loadRecent();
      notify(
        "success",
        "Saved successfully",
        `Delivery receipt ${receipt} has been saved.`,
        askDefault
          ? () =>
              confirmDelete({
                title: "Change the default alias?",
                message: `Make ${label} the default alias of ${cust.customer_name}? New BIG deliveries for this customer will start with it.`,
                confirmLabel: "Make default",
                cancelLabel: "No, keep it",
                tone: "primary",
                onConfirm: () => applyDefault(cust, aliasId, label),
              })
          : undefined
      );
    } catch (err) {
      notify("error", "Couldn't save the delivery", friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  // Writes the new default alias (to charles-supabase as well) and refreshes the customers
  const applyDefault = async (cust, aliasId, label) => {
    const res = await setDefaultAlias(cust.id, aliasId);
    await reloadLookups();
    notify(
      "success",
      "Default alias set",
      res.localOnly
        ? `${label} is now the default alias of ${cust.customer_name} in this app only: the set-default-alias function isn't deployed, so charles-supabase was not updated.`
        : `${label} is now the default alias of ${cust.customer_name}, also in charles-supabase.`
    );
  };

  const canSetDefault = Boolean(customer && form.aliasId && Number(form.aliasId) !== defaultAliasId);
  const askSetDefault = () => {
    const aliasId = Number(form.aliasId);
    const label = aliasName.get(aliasId);
    const cust = customer;
    confirmDelete({
      title: "Set the default alias?",
      message: `Make ${label} the default alias of ${cust.customer_name}? It is saved in charles-supabase too, and new BIG deliveries for this customer will start with it.`,
      confirmLabel: "Set default",
      tone: "primary",
      onConfirm: async () => {
        setDefaultBusy(true);
        try {
          await applyDefault(cust, aliasId, label);
        } finally {
          setDefaultBusy(false);
        }
      },
    });
  };

  const openDelivery = (row) => {
    const jo = jobById.get(row.job_order_id);
    if (jo) guardedDo(() => load(jo, row));
  };
  // Prints the saved delivery receipt: every job ticket that shares this receipt number and receivable type
  const printReceipt = async (row) => {
    try {
      const data = await loadDeliveryReceipt(row.receivable_type_id, row.delivery_receipt);
      setReceipt({ data, big: Number(row.receivable_type_id) === 1 });
    } catch (err) {
      notify("error", "Couldn't prepare the delivery receipt", friendlyError(err));
    }
  };

  const askDelete = (row) => (locks.isLocked(row.job_order_id) ? locks.unlock(row.job_order_id, () => confirmRemove(row)) : confirmRemove(row));
  const confirmRemove = (row) => {
    const jo = jobById.get(row.job_order_id);
    confirmDelete({
      title: "Delete this delivery?",
      message: `Delivery receipt ${row.delivery_receipt} of job ticket ${formatTicket(jo?.job_ticket)} and its delivered rolls will be removed. The job ticket can be delivered again afterwards.`,
      confirmLabel: "Delete delivery",
      onConfirm: async () => {
        await deleteDelivery(row.id);
        if (delivery?.id === row.id) resetForm();
        await loadRecent();
        notify("success", "Deleted", `Delivery receipt ${row.delivery_receipt} has been deleted.`);
      },
    });
  };

  const deliveredByDelivery = useMemo(() => {
    const m = new Map();
    for (const r of recent.rolls) {
      const e = m.get(r.delivery_id) ?? { wt: 0, n: 0 };
      e.wt += Number(r.roll_wt || 0);
      e.n += 1;
      m.set(r.delivery_id, e);
    }
    return m;
  }, [recent.rolls]);

  return (
    <section className="panel theme-deliv" aria-labelledby="dv-title">
      <div className="section-head"><h2 id="dv-title">Deliveries</h2></div>

      {/* 1. pick a job ticket that has no delivery yet */}
      {!job && (
        <div className="deliv-card">
          <div className="field">
            <label htmlFor="dv-search">Job ticket</label>
            <TicketInput id="dv-search" autoComplete="off" maxLength={13} value={search} onValue={setSearch} />
          </div>
          {candError && <p className="msg-error">{candError}</p>}
          {candLoading && <p className="msg">Searching...</p>}
          {!candLoading && !candError && candidates.length === 0 && <p className="msg">No job ticket without a delivery matches.</p>}
          <ul className="deliv-results">
            {candidates.map((c) => {
              const sc = salesOf.get(c.sales_id);
              return (
                <li key={c.id}>
                  <button type="button" className="deliv-result" onClick={() => load(c)}>
                    <b>{formatTicket(c.job_ticket)}</b>
                    <span>{customerById.get(sc?.customer_id)?.customer_name ?? ""}</span>
                    <span>{sc?.cus_jo_no ?? ""}</span>
                    <span>{formatDate(c.date_job_order)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 2. everything in one form */}
      {job && (
        <form className="deliv-form" onSubmit={submit} noValidate>
          <div className="ctx ctx-recipe deliv-ctx">
            <span className="ctx-pill ctx-c3">Job Ticket : <b>{formatTicket(job.job_ticket)}</b></span>
            <span className="ctx-pill ctx-c1">Customer : <b>{customer?.customer_name ?? ""}</b></span>
            <span className="ctx-pill ctx-c2">Customer JO : <b>{sales?.cus_jo_no ?? ""}</b></span>
            <span className="ctx-pill ctx-c4">Color : <b>{nameOf(lookups.colors, "color_name", job.color_id) || "-"}</b></span>
            <span className="ctx-pill ctx-c5">Tone : <b>{nameOf(lookups.tones, "tone_name", job.tone_id) || "-"}</b></span>
            <span className="ctx-pill ctx-c6">Fabric : <b>{nameOf(lookups.fabrics, "fabric_name", job.fabric_id) || "-"}</b></span>
            <span className="ctx-pill ctx-c7">Type : <b>{nameOf(lookups.dyeProcesses, "dye_process_name", job.dye_process_id) || "-"}</b></span>
            {!delivery && (
              <button type="button" className="btn btn-small" onClick={() => guardedDo(resetForm)}>Choose another job ticket</button>
            )}
          </div>

          {formLocked && <LockBanner onUnlock={() => locks.unlock(job.id)} />}

          <fieldset className="lock-wrap" disabled={formLocked}>
          <fieldset className="group">
            <legend>Delivery</legend>
            <div className="form-grid cols-3">
              <div className={`field ${errors.date ? "has-error" : ""}`}>
                <label htmlFor="dv-date">Date delivered</label>
                <input id="dv-date" type="date" value={form.date} onChange={set("date")} />
                {errors.date && <p className="field-error">{errors.date}</p>}
              </div>
              <div className={`field ${errors.typeId ? "has-error" : ""}`}>
                <label htmlFor="dv-type">Receivable type</label>
                <select id="dv-type" value={form.typeId} onChange={onType}>
                  <option value="">Select a type</option>
                  {lookups.receivableTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.receivable_type}</option>
                  ))}
                </select>
                {errors.typeId && <p className="field-error">{errors.typeId}</p>}
              </div>
              <div className={`field ${errors.receipt ? "has-error" : ""}`}>
                <label htmlFor="dv-receipt">Delivery receipt</label>
                <div className="input-with-max">
                  <input
                    id="dv-receipt"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={form.receipt}
                    onChange={set("receipt")}
                    onDoubleClick={fillNextReceipt}
                    title="Double-click to use the next number of this receivable type"
                  />
                  <output className="max-box" aria-label="Highest delivery receipt of this receivable type" title="Highest delivery receipt of this receivable type">
                    {maxReceipt || "-"}
                  </output>
                </div>
                {errors.receipt && <p className="field-error">{errors.receipt}</p>}
              </div>
              {form.typeId === "1" && (
                <div className="field span-3">
                  <label htmlFor="dv-alias">Alias</label>
                  <div className="alias-row">
                  <select id="dv-alias" value={form.aliasId} onChange={set("aliasId")}>
                    <option value="">No alias</option>
                    {aliasChoices.linked.map((a) => (
                      <option key={a.id} value={a.id}>{aliasLabel(a)}</option>
                    ))}
                    {aliasChoices.kept.map((a) => (
                      <option key={a.id} value={a.id}>{aliasLabel(a)} (not linked)</option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-orange" onClick={askSetDefault} disabled={!canSetDefault || defaultBusy}>Set default</button>
                  </div>
                  {aliasChoices.linked.length === 0 && (
                    <p className="field-hint">
                      {aliasChoices.no ? `No alias is linked to customer no. ${customer?.customer_no}.` : "This customer has no customer no., so no alias can be matched."}
                    </p>
                  )}
                </div>
              )}
              <div className={`field ${errors.sl ? "has-error" : ""}`}>
                <label htmlFor="dv-sl">Shrinkage length</label>
                <input id="dv-sl" type="number" inputMode="numeric" step="1" value={form.sl} onChange={set("sl")} />
                {errors.sl && <p className="field-error">{errors.sl}</p>}
              </div>
              <div className={`field ${errors.sw ? "has-error" : ""}`}>
                <label htmlFor="dv-sw">Shrinkage width</label>
                <input id="dv-sw" type="number" inputMode="numeric" step="1" value={form.sw} onChange={set("sw")} />
                {errors.sw && <p className="field-error">{errors.sw}</p>}
              </div>
              <div className={`field ${errors.density ? "has-error" : ""}`}>
                <label htmlFor="dv-density">Acquired density</label>
                <input id="dv-density" type="number" inputMode="numeric" step="1" value={form.density} onChange={set("density")} />
                {errors.density && <p className="field-error">{errors.density}</p>}
              </div>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend>Delivered fabric info</legend>
            <div className="fabric-split">
              <div className="fabric-main">
              <div className="weight-summary weight-received" role="status">
                <span className="weight-kind">Received</span>
                <span><b>Body</b> {formatWeight(receivedBody)}</span>
                <i>+</i>
                <span><b>1x1</b> {formatWeight(receivedX1)}</span>
                <i>+</i>
                <span><b>Others</b> {formatWeight(ticketWt - receivedBody - receivedX1)}</span>
                <i>=</i>
                <span className="weight-total"><b>Total</b> {formatWeight(ticketWt)}</span>
              </div>
              <div className="weight-summary" role="status">
                <span className="weight-kind">Delivered</span>
                <span><b>Body</b> {formatWeight(bodyWt)}</span>
                <i>+</i>
                <span><b>1x1</b> {formatWeight(x1Wt)}</span>
                <i>+</i>
                <span><b>Others</b> {formatWeight(deliveredWt - bodyWt - x1Wt)}</span>
                <i>=</i>
                <span className="weight-total"><b>Total</b> {formatWeight(deliveredWt)}</span>
              </div>
              {errors.rolls && <p className="msg-error">{errors.rolls}</p>}
              {visibleTypes.length === 0 && <p className="msg">This job order has no received fabric info, so there is nothing to enter.</p>}
              <div className="roll-cols theme-fabric">
                {visibleTypes.map((t) => {
                  const list = rolls[t.id] ?? [];
                  return (
                    <div className="roll-col" key={t.id}>
                      <label className="roll-col-head" htmlFor={`dv-roll-${t.id}`}>
                        {t.roll_name} (<span className={`cnt ${list.length === (receivedCount.get(t.id) ?? 0) ? "cnt-ok" : "cnt-bad"}`} title={`${list.length} of ${receivedCount.get(t.id) ?? 0} rolls entered`}>{receivedCount.get(t.id) ?? 0}</span>)
                      </label>
                      <input
                        id={`dv-roll-${t.id}`}
                        ref={(el) => {
                          inputs.current[t.id] = el;
                        }}
                        className="roll-input"
                        inputMode="decimal"
                        autoComplete="off"
                        aria-label={`${t.roll_name} delivered roll weight`}
                        value={drafts[t.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addRolls(t.id);
                          }
                        }}
                      />
                      {errors[`roll-${t.id}`] && <p className="msg-error">{errors[`roll-${t.id}`]}</p>}
                      <div className="roll-col-meta">
                        <span>{list.length} {list.length === 1 ? "roll" : "rolls"}</span>
                        <span>{formatWeight(sum(list))}</span>
                      </div>
                      <ul className="roll-col-list">
                        {list.map((w, i) => (
                          <li key={i}>
                            <span className="roll-no">{i + 1}</span>
                            <span className="roll-wt">{Number(w).toFixed(2)}</span>
                            <button type="button" className="roll-x" aria-label={`Remove ${t.roll_name} roll ${i + 1}, ${Number(w).toFixed(2)}`} onClick={() => removeRoll(t.id, i)}>
                              &times;
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              </div>
              <aside className="fabric-side">
              <div className="compare" role="group" aria-label="Delivered compared with received">
                <div className="compare-head">
                  <span />
                  <span>Delivered</span>
                  <span>Received</span>
                  <span>Loss / Balance</span>
                </div>
                <div className="compare-row">
                  <span className="compare-label">Weight</span>
                  <output className="compare-val">{deliveredWt.toFixed(2)}</output>
                  <output className="compare-val">{ticketWt.toFixed(2)}</output>
                  {showResult && lossShown !== null ? (
                    <span className={`badge ${!isGain && lossShown > LOSS_LIMIT ? "badge-fail" : "badge-pass"}`}>
                      {isGain ? "Gain" : "Loss"} ({Math.abs(lossShown).toFixed(2)} %)
                    </span>
                  ) : (
                    <span />
                  )}
                </div>
                <div className="compare-row">
                  <span className="compare-label">Rolls</span>
                  <output className="compare-val">{deliveredCount}</output>
                  <output className="compare-val">{ticketCount}</output>
                  {showResult ? <span className={`badge ${balance === 0 ? "badge-pass" : "badge-fail"}`}>{balance === 0 ? "PASS" : "FAIL"} ({balance})</span> : <span />}
                </div>
              </div>
              </aside>
            </div>
          </fieldset>
          </fieldset>

          <div className="form-actions">
            <button type="button" className="btn" onClick={() => guardedDo(resetForm)} disabled={saving}>{formLocked ? "Close" : "Cancel"}</button>
            {delivery && <button type="button" className="btn" onClick={() => printReceipt(delivery)} disabled={saving}>Print DR</button>}
            {!formLocked && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : delivery ? "Update delivery" : "Save delivery"}</button>}
          </div>
        </form>
      )}

      <h3 className="sub-title">Recent deliveries</h3>
      <div className="table-card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="num">DR no.</th>
                <th>Job ticket</th>
                <th>Customer</th>
                <th>Date delivered</th>
                <th>Type</th>
                <th>Alias</th>
                <th className="num">Delivered</th>
                <th className="num">Rolls</th>
                <th className="actions-col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {recentLoading && <tr><td colSpan={9} className="state-cell">Loading...</td></tr>}
              {!recentLoading && recentError && <tr><td colSpan={9} className="state-cell msg-error">{recentError}</td></tr>}
              {!recentLoading && !recentError && recent.rows.length === 0 && <tr><td colSpan={9} className="state-cell">No deliveries recorded yet.</td></tr>}
              {recent.rows.map((r) => {
                const jo = jobById.get(r.job_order_id);
                const sc = jo ? salesOf.get(jo.sales_id) : null;
                const d = deliveredByDelivery.get(r.id);
                return (
                  <tr key={r.id} className={`is-clickable ${delivery?.id === r.id ? "is-selected" : ""}`} onDoubleClick={() => openDelivery(r)}>
                    <td className="num strong">{r.delivery_receipt}{locks.isLocked(r.job_order_id) && <span className="chip chip-lock tag" title="Copied: view only">Locked</span>}</td>
                    <td className="strong">{formatTicket(jo?.job_ticket)}</td>
                    <td>{sc ? customerById.get(sc.customer_id)?.customer_name ?? "" : ""}</td>
                    <td>{formatDate(r.date_delivery)}</td>
                    <td>{typeName.get(r.receivable_type_id) ?? r.receivable_type_id}</td>
                    <td>{r.alias_id ? aliasName.get(r.alias_id) ?? "Unknown alias" : ""}</td>
                    <td className="num">{formatWeight(d?.wt ?? 0)}</td>
                    <td className="num">{d?.n ?? 0}</td>
                    <td className="actions-col" onDoubleClick={(e) => e.stopPropagation()}>
                      <button type="button" className="row-btn row-btn-go" onClick={() => printReceipt(r)}>Print DR</button>
                      <IconButton kind="edit" label={`Edit delivery receipt ${r.delivery_receipt}`} onClick={() => openDelivery(r)} disabled={!jo} />
                      <IconButton kind="delete" label={`Delete delivery receipt ${r.delivery_receipt}`} onClick={() => askDelete(r)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {receipt && <DeliveryReceiptReport data={receipt.data} big={receipt.big} lookups={lookups} onClose={() => setReceipt(null)} />}
    </section>
  );
}
