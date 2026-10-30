import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./components/Modal.jsx";
import ContextLine from "./components/ContextLine.jsx";
import ConfirmationSection from "./components/ConfirmationSection.jsx";
import JobOrderSection from "./components/JobOrderSection.jsx";
import FabricSection from "./components/FabricSection.jsx";
import RecipeSection from "./components/RecipeSection.jsx";
import JobOrdersView from "./components/JobOrdersView.jsx";
import RecipeListView from "./components/RecipeListView.jsx";
import TrackingView from "./components/TrackingView.jsx";
import DeliveriesView from "./components/DeliveriesView.jsx";
import { BoxIcon, FileIcon, FlaskIcon, MenuIcon, SearchIcon, TruckIcon } from "./components/Icons.jsx";
import {
  EMPTY_LOOKUPS,
  friendlyError,
  listConfirmations,
  listJobOrderStubs,
  listJobOrders,
  listRolls,
  listRollsForJobOrders,
  loadLookups,
} from "./lib/salesApi.js";
import { formatDateTime, formatTicket } from "./lib/format.js";
import { hasUnsavedChanges, unsavedPrompt } from "./lib/unsavedGuard.js";
import { MODULES, useAuth } from "./lib/auth.jsx";
import ChangePasswordDialog from "./components/ChangePasswordDialog.jsx";

const TABS = [
  { id: "confirmation", label: "Sales Confirmation", theme: "confirm" },
  { id: "jobOrder", label: "Job Order", theme: "job" },
  { id: "fabric", label: "Fabric Info", theme: "fabric" },
  { id: "recipe", label: "Recipe", theme: "recipe" },
];

const VIEW_TITLES = { entry: "Sales Confirmations", jobOrders: "Job Orders", recipes: "Recipe", tracking: "Tracking", deliveries: "Deliveries" };

// The dashboard (sidebar) collapses when not in use; the choice is remembered in this browser
const readCollapsed = () => {
  try {
    return window.localStorage.getItem("vitson-sidebar") === "collapsed";
  } catch {
    return false;
  }
};

export default function App() {
  const auth = useAuth();
  const allowedViews = Object.keys(MODULES).filter((v) => auth.can(MODULES[v])); // the dashboard items this user may open
  const [view, setView] = useState(() => allowedViews[0] ?? "none"); // "entry" | "jobOrders" | "recipes" | "tracking" | "deliveries"
  const [pwOpen, setPwOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [tab, setTab] = useState("confirmation");

  const [lookups, setLookups] = useState(EMPTY_LOOKUPS);
  const [warnings, setWarnings] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  const [jobCounts, setJobCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [confirmationId, setConfirmationId] = useState(null);
  const [confirmationFilter, setConfirmationFilter] = useState(null); // { salesId, jobTicket } from the Job Orders search
  const [jobOrders, setJobOrders] = useState([]);
  const [jobTotals, setJobTotals] = useState({});
  const [jobOrderId, setJobOrderId] = useState(null);
  const [wantedJobOrderId, setWantedJobOrderId] = useState(null);
  const [rolls, setRolls] = useState([]);
  const [rollsFor, setRollsFor] = useState(null); // job order whose rolls are loaded in `rolls`

  const [newJobRequest, setNewJobRequest] = useState(0); // bumped to open the empty job order form
  const [fabricFocus, setFabricFocus] = useState(0); // bumped to put the cursor in the first roll box

  const [notice, setNotice] = useState(null); // { tone, title, message, after }
  const [pending, setPending] = useState(null); // { title, message, confirmLabel, tone, onConfirm }
  const [pendingBusy, setPendingBusy] = useState(false);

  const notify = useCallback((tone, title, message, after) => setNotice({ tone, title, message, after }), []);
  const confirmDelete = useCallback((spec) => setPending(spec), []);
  // Leaving something with unsaved changes (tab, dashboard button, another job ticket) asks first, in the app's own popup
  const guarded = useCallback((action) => {
    if (hasUnsavedChanges()) setPending(unsavedPrompt(() => action()));
    else action();
  }, []);
  const closeNotice = () => {
    const after = notice?.after;
    setNotice(null);
    after?.();
  };

  const toggleSidebar = (next = !collapsed) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem("vitson-sidebar", next ? "collapsed" : "open");
    } catch {
      /* the choice just isn't remembered */
    }
  };

  const reloadLookups = useCallback(async () => {
    const { lookups: l } = await loadLookups();
    setLookups(l);
  }, []);

  const refreshConfirmations = useCallback(async () => {
    const [c, stubs] = await Promise.all([listConfirmations(), listJobOrderStubs()]);
    const counts = {};
    stubs.forEach((j) => {
      counts[j.sales_id] = (counts[j.sales_id] ?? 0) + 1;
    });
    setConfirmations(c);
    setJobCounts(counts);
  }, []);

  const refreshJobOrders = useCallback(async (salesId) => {
    const jo = await listJobOrders(salesId);
    const r = await listRollsForJobOrders(jo.map((j) => j.id));
    const totals = {};
    r.forEach((x) => {
      const t = (totals[x.job_order_id] ??= { rolls: 0, weight: 0 });
      t.rolls += 1;
      t.weight += Number(x.roll_wt) || 0;
    });
    setJobOrders(jo);
    setJobTotals(totals);
  }, []);

  const refreshRolls = useCallback(async (id) => {
    setRolls(await listRolls(id));
    setRollsFor(id);
  }, []);

  // First load
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [{ lookups: l, warnings: w }] = await Promise.all([loadLookups(), refreshConfirmations()]);
      // Row level security hides rows without raising an error, so an empty list needs its own warning
      if (l.customers.length === 0 && !w.some((x) => x.startsWith("tbl_Customer_Sync")))
        w.push("tbl_Customer_Sync returned no rows (the sync hasn't run, or this session isn't allowed to read it)");
      setLookups(l);
      setWarnings(w);
    } catch (err) {
      setLoadError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [refreshConfirmations]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!confirmationId) {
      setJobOrders([]);
      setJobTotals({});
      return;
    }
    setJobOrders([]);
    setJobTotals({});
    refreshJobOrders(confirmationId).catch((err) => setLoadError(friendlyError(err)));
  }, [confirmationId, refreshJobOrders]);

  // Job orders that already exist are the current job order from the start (or the one asked for by a list)
  useEffect(() => {
    if (jobOrders.length === 0) return;
    if (wantedJobOrderId && jobOrders.some((j) => j.id === wantedJobOrderId)) {
      setJobOrderId(wantedJobOrderId);
      setWantedJobOrderId(null);
      return;
    }
    if (!jobOrders.some((j) => j.id === jobOrderId)) setJobOrderId(jobOrders[0].id);
  }, [jobOrders, jobOrderId, wantedJobOrderId]);

  useEffect(() => {
    setRollsFor(null);
    if (!jobOrderId) {
      setRolls([]);
      return;
    }
    setRolls([]);
    refreshRolls(jobOrderId).catch((err) => setLoadError(friendlyError(err)));
  }, [jobOrderId, refreshRolls]);

  const customerName = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const confirmation = confirmations.find((c) => c.id === confirmationId) ?? null;
  const jobOrder = jobOrders.find((j) => j.id === jobOrderId) ?? null;
  const rollsReady = rollsFor === jobOrderId;
  const typeName = lookups.dyeProcesses.find((d) => d.id === jobOrder?.dye_process_id)?.dye_process_name ?? "";
  const colorName = lookups.colors.find((c) => c.id === jobOrder?.color_id)?.color_name ?? "";

  const selectConfirmation = (id) => {
    if (id !== confirmationId) setJobOrderId(null);
    setConfirmationId(id);
  };

  // Go to the entry screen for a confirmation / job order (from a list or a double-click)
  const openEntryNow = ({ salesId, jobOrderId: wanted = null, tab: nextTab = "confirmation", filter = null }) => {
    if (!auth.can(MODULES.entry)) return;
    if (nextTab === "recipe" && !auth.can(MODULES.recipes)) nextTab = "jobOrder";
    setView("entry");
    setConfirmationFilter(filter);
    setWantedJobOrderId(wanted);
    if (salesId !== confirmationId) {
      setJobOrderId(null);
      setConfirmationId(salesId);
    } else if (wanted) {
      setJobOrderId(wanted);
      setWantedJobOrderId(null);
    }
    setTab(nextTab);
    toggleSidebar(true);
  };

  const openEntry = (opts) => guarded(() => openEntryNow(opts));

  const goView = (next) =>
    guarded(() => {
      if (!auth.can(MODULES[next])) return;
      setView(next);
      if (next === "entry") setConfirmationFilter(null);
      toggleSidebar(true);
    });

  const onConfirmationChanged = async (saved, deletedId) => {
    await refreshConfirmations();
    if (saved) selectConfirmation(saved.id);
    if (deletedId && deletedId === confirmationId) {
      setConfirmationId(null);
      setJobOrderId(null);
    }
  };

  const onJobOrderChanged = async (saved, deletedId) => {
    await Promise.all([refreshJobOrders(confirmationId), refreshConfirmations()]);
    if (saved) setJobOrderId(saved.id);
    if (deletedId && deletedId === jobOrderId) setJobOrderId(null);
  };

  const onRollsChanged = async () => {
    await Promise.all([refreshRolls(jobOrderId), refreshJobOrders(confirmationId)]);
  };

  // A new sales confirmation continues on the Job Order tab (and opens an empty job order form); a new job order continues on Fabric Info
  const handleConfirmationCreated = (saved) => {
    setTab("jobOrder");
    notify("success", "Saved successfully", `Sales confirmation ${saved.sales_confirm_no} has been created.`, () => setNewJobRequest((n) => n + 1));
  };
  const handleJobOrderCreated = (saved) => {
    setTab("fabric");
    notify("success", "Saved successfully", `Job ticket ${formatTicket(saved.job_ticket)} has been created.`, () => setFabricFocus((n) => n + 1));
  };

  const runPending = async () => {
    setPendingBusy(true);
    try {
      await pending.onConfirm();
      setPending(null);
    } catch (err) {
      setPending(null);
      notify("error", "Couldn't complete that", friendlyError(err));
    } finally {
      setPendingBusy(false);
    }
  };

  // Reference lists: when were they last refreshed from charles-supabase?
  const lastSynced = [lookups.customers, lookups.dyeProcesses, lookups.fabrics, lookups.tones]
    .flat()
    .reduce((max, r) => (r.synced_at && r.synced_at > max ? r.synced_at : max), "");
  const activeCustomers = lookups.customers.filter((c) => c.is_active).length;

  // A tab opens as soon as what it needs already exists: Fabric Info once the confirmation has a job order,
  // Recipe once the current job order has fabric info (a jump from the Recipe list is let through).
  const hasJobOrder = Boolean(jobOrder);
  const hasFabric = hasJobOrder && rolls.length > 0;
  const needConfirmation = "Select a sales confirmation first";
  const tabState = {
    confirmation: { disabled: false },
    jobOrder: { disabled: !confirmation, hint: needConfirmation },
    fabric: { disabled: !hasJobOrder, hint: confirmation ? "Add a job order first" : needConfirmation },
    recipe: {
      disabled: !hasFabric,
      hint: !confirmation ? needConfirmation : !hasJobOrder ? "Add a job order first" : "Add fabric info first",
    },
  };

  const navItems = [
    { id: "entry", label: "Sales Confirmations", icon: <FileIcon /> },
    { id: "jobOrders", label: "Job Orders", icon: <SearchIcon /> },
    { id: "recipes", label: "Recipe", icon: <FlaskIcon /> },
    { id: "tracking", label: "Tracking", icon: <TruckIcon /> },
    { id: "deliveries", label: "Deliveries", icon: <BoxIcon /> },
  ].filter((n) => auth.can(MODULES[n.id]));
  // the Recipe tab belongs to the recipe module
  const tabs = TABS.filter((t) => t.id !== "recipe" || auth.can(MODULES.recipes));

  return (
    <div className={`shell ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Dashboard">
        <div className="side-top">
          <button type="button" className="side-toggle" onClick={() => toggleSidebar()} aria-label={collapsed ? "Open the dashboard" : "Collapse the dashboard"} aria-expanded={!collapsed}>
            <MenuIcon />
          </button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">V</span>
            <span className="brand-name">Vitson</span>
          </div>
        </div>
        <nav aria-label="Views">
          {navItems.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`nav-item ${view === n.id ? "is-current" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
              title={n.label}
              onClick={() => goView(n.id)}
            >
              <span className="nav-icon">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sync-card" role="status">
          <div className="sync-title">Reference lists</div>
          <div className="sync-count">{activeCustomers.toLocaleString("en")} active customers</div>
          <div className="sync-time">Last synced {formatDateTime(lastSynced || null)}</div>
        </div>
      </aside>

      <main className="main" id="entry">
        <header className="page-head">
          <h1>{VIEW_TITLES[view] ?? "Vitson"}</h1>
          <div className="user-bar">
            <span>Signed in as <b>{auth.user?.display_name}</b>{auth.user?.is_super_admin ? " (super admin)" : ""}</span>
            <button type="button" className="link-btn" onClick={() => setPwOpen(true)}>Change password</button>
            <button type="button" className="link-btn" onClick={() => guarded(() => auth.logout())}>Log out</button>
          </div>
        </header>

        {allowedViews.length === 0 && (
          <div className="banner banner-warn" role="status">Your account has no access to any module yet. Ask Charles or Susan to give you access.</div>
        )}
        <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} onDone={() => notify("success", "Password changed", "Your password has been changed. Other devices need to sign in again.")} />

        {loadError && (
          <div className="banner banner-error" role="alert">
            <span>{loadError}</span>
            <button type="button" className="link-btn" onClick={loadAll}>Retry</button>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="banner banner-warn" role="status">
            <span>Some lists couldn't load and will be empty: {warnings.join("; ")}</span>
          </div>
        )}

        {view === "entry" && (
          <>
            <div className="tabs" role="tablist" aria-label="Entry sections">
              {tabs.map((t, i) => {
                const disabled = tabState[t.id].disabled && tab !== t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`tab-${t.id}`}
                    aria-selected={tab === t.id}
                    aria-controls={`panel-${t.id}`}
                    aria-disabled={disabled}
                    title={disabled ? tabState[t.id].hint : undefined}
                    className={`tab tab-${t.theme} ${tab === t.id ? "is-on" : ""}`}
                    onClick={() => !disabled && t.id !== tab && guarded(() => setTab(t.id))}
                  >
                    <span className="tab-n">{i + 1}</span>
                    {t.label}
                  </button>
                );
              })}
            </div>

            <ContextLine
              tab={tab}
              confirmation={confirmation}
              customerName={confirmation ? customerName.get(confirmation.customer_id) : null}
              jobOrder={jobOrder}
              jobOrders={jobOrders}
              jobOrderId={jobOrderId}
              typeName={typeName}
              colorName={colorName}
              onPickJob={(id) => guarded(() => setJobOrderId(id))}
            />

            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === "confirmation" && (
                <ConfirmationSection
                  lookups={lookups}
                  confirmations={confirmations}
                  jobCounts={jobCounts}
                  loading={loading}
                  selectedId={confirmationId}
                  filter={confirmationFilter}
                  onClearFilter={() => setConfirmationFilter(null)}
                  onSelect={selectConfirmation}
                  onOpenJobOrders={(row) => {
                    selectConfirmation(row.id);
                    setTab("jobOrder");
                  }}
                  onChanged={onConfirmationChanged}
                  onCreated={handleConfirmationCreated}
                  notify={notify}
                  confirmDelete={confirmDelete}
                />
              )}
              {tab === "jobOrder" && (
                <JobOrderSection
                  confirmation={confirmation}
                  customerName={confirmation ? customerName.get(confirmation.customer_id) : null}
                  lookups={lookups}
                  jobOrders={jobOrders}
                  jobTotals={jobTotals}
                  selectedId={jobOrderId}
                  onSelect={setJobOrderId}
                  onOpenFabric={(j) => {
                    setJobOrderId(j.id);
                    setTab("fabric");
                  }}
                  onChanged={onJobOrderChanged}
                  onCreated={handleJobOrderCreated}
                  openNewRequest={newJobRequest}
                  reloadLookups={reloadLookups}
                  notify={notify}
                  confirmDelete={confirmDelete}
                />
              )}
              {tab === "fabric" && (
                <FabricSection
                  jobOrder={jobOrder}
                  lookups={lookups}
                  rolls={rolls}
                  loading={!rollsReady}
                  onChanged={onRollsChanged}
                  notify={notify}
                  focusRequest={fabricFocus}
                />
              )}
              {tab === "recipe" && (
                <RecipeSection
                  jobOrder={jobOrder}
                  confirmation={confirmation}
                  lookups={lookups}
                  rolls={rolls}
                  rollsLoading={!rollsReady}
                  onNeedFabric={() => setTab("fabric")}
                  notify={notify}
                  confirmAction={confirmDelete}
                />
              )}
            </div>
          </>
        )}

        {view === "jobOrders" && (
          <JobOrdersView
            lookups={lookups}
            confirmations={confirmations}
            notify={notify}
            onOpen={(j) =>
              openEntry({ salesId: j.sales_id, jobOrderId: j.id, tab: "confirmation", filter: { salesId: j.sales_id, jobTicket: j.job_ticket } })
            }
          />
        )}

        {view === "recipes" && (
          <RecipeListView
            lookups={lookups}
            confirmations={confirmations}
            notify={notify}
            onRecipe={(j) => openEntry({ salesId: j.sales_id, jobOrderId: j.id, tab: "recipe" })}
            onFabric={(j) => openEntry({ salesId: j.sales_id, jobOrderId: j.id, tab: "fabric" })}
          />
        )}

        {view === "deliveries" && (
          <DeliveriesView lookups={lookups} confirmations={confirmations} notify={notify} confirmDelete={confirmDelete} reloadLookups={reloadLookups} />
        )}

        {view === "tracking" && <TrackingView lookups={lookups} confirmations={confirmations} notify={notify} confirmDelete={confirmDelete} />}
      </main>

      {/* Confirmations (in-app, not window.confirm) */}
      <Modal
        open={Boolean(pending)}
        title={pending?.title ?? ""}
        size="sm"
        onClose={() => !pendingBusy && setPending(null)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setPending(null)} disabled={pendingBusy}>{pending?.cancelLabel ?? "Cancel"}</button>
            <button
              type="button"
              className={`btn ${pending?.tone === "primary" ? "btn-primary" : "btn-danger"}`}
              onClick={runPending}
              disabled={pendingBusy}
            >
              {pendingBusy ? "Working..." : pending?.confirmLabel}
            </button>
          </>
        }
      >
        <p className="modal-text">{pending?.message}</p>
      </Modal>

      {/* Success / error notice (in-app, not window.alert) */}
      <Modal
        open={Boolean(notice)}
        title={notice?.title ?? ""}
        size="sm"
        onClose={closeNotice}
        footer={<button type="button" className="btn btn-primary" onClick={closeNotice}>OK</button>}
      >
        <div className={`notice notice-${notice?.tone}`}>
          <span className="notice-icon" aria-hidden="true">{notice?.tone === "success" ? "\u2713" : "!"}</span>
          <p className="modal-text">{notice?.message}</p>
        </div>
      </Modal>
    </div>
  );
}
