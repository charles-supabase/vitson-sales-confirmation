import { useMemo } from "react";
import { JobOrderTable, useJobOrderList } from "./JobOrdersView.jsx";

const QUERY = { noRecipeOnly: true };

/** Job orders that have no recipe date yet. The Recipe button opens the sales confirmation straight on its Recipe tab. */
export default function RecipeListView({ lookups, confirmations, onRecipe, notify }) {
  const { rows, loading, error } = useJobOrderList(QUERY, notify);
  const customerOf = useMemo(() => new Map(lookups.customers.map((c) => [c.id, c.customer_name])), [lookups.customers]);
  const salesOf = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);

  return (
    <section className="panel theme-pending" aria-labelledby="rl-title">
      <div className="section-head"><h2 id="rl-title">Recipe</h2></div>
      <JobOrderTable
        rows={rows}
        loading={loading}
        error={error}
        customerOf={customerOf}
        salesOf={salesOf}
        onOpen={onRecipe}
        empty="Every job order has a recipe."
        action={(j) => (
          <button type="button" className="row-btn row-btn-go" onClick={() => onRecipe(j)}>Recipe</button>
        )}
      />
    </section>
  );
}
