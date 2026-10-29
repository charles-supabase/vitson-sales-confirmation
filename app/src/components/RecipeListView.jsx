import { useEffect, useMemo, useState } from "react";
import { JobOrderTable, useJobOrderList } from "./JobOrdersView.jsx";
import { listRollsForJobOrders } from "../lib/salesApi.js";

const QUERY = { noRecipeOnly: true };

/**
 * Job orders that have no recipe date yet. A recipe can only be created for a job order that has fabric info:
 * those get a Recipe button (straight to the Recipe tab), the others an Add fabric info button.
 */
export default function RecipeListView({ lookups, confirmations, onRecipe, onFabric, notify }) {
  const { rows, loading, error } = useJobOrderList(QUERY, notify);
  const [rollCounts, setRollCounts] = useState(null); // null = loading, false = couldn't be read, else { jobOrderId: count }
  const customerOf = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);

  useEffect(() => {
    let cancelled = false;
    setRollCounts(null);
    if (loading) return undefined;
    if (rows.length === 0) {
      setRollCounts({});
      return undefined;
    }
    listRollsForJobOrders(rows.map((j) => j.id))
      .then((list) => {
        if (cancelled) return;
        const counts = {};
        list.forEach((r) => {
          counts[r.job_order_id] = (counts[r.job_order_id] ?? 0) + 1;
        });
        setRollCounts(counts);
      })
      .catch(() => !cancelled && setRollCounts(false)); // unknown: the database still refuses a recipe without fabric info
    return () => {
      cancelled = true;
    };
  }, [rows, loading]);

  const hasFabric = (j) => rollCounts === false || (rollCounts?.[j.id] ?? 0) > 0;
  const open = (j) => (hasFabric(j) ? onRecipe(j) : onFabric(j));

  return (
    <section className="panel theme-pending" aria-labelledby="rl-title">
      <div className="section-head"><h2 id="rl-title">Recipe</h2></div>
      <JobOrderTable
        rows={rows}
        loading={loading}
        error={error}
        customerOf={customerOf}
        salesOf={salesOf}
        rollCounts={rollCounts}
        onOpen={open}
        empty="Every job order has a recipe."
        action={(j) =>
          rollCounts === null ? (
            <span className="msg-soft">...</span>
          ) : hasFabric(j) ? (
            <button type="button" className="row-btn row-btn-go" onClick={() => onRecipe(j)}>Recipe</button>
          ) : (
            <button type="button" className="row-btn row-btn-warn" onClick={() => onFabric(j)}>Add fabric info</button>
          )
        }
      />
    </section>
  );
}
