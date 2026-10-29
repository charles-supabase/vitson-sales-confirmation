# Vitson Sales Confirmations (React + Vite, Supabase webhook sync)

> **Update checklist (this version):** deploy the new `set-default-alias` function to **vitson-recipe** (it writes a customer's default alias to charles-supabase):
> ```
> cd vitson-supabase
> supabase link --project-ref vvzedjmmtnxvzflzwado
> supabase secrets set CHARLES_SUPABASE_URL=https://xsknxirraveijgvbdfxs.supabase.co CHARLES_SERVICE_ROLE_KEY=<charles-supabase service role key>
> supabase functions deploy set-default-alias
> ```
> Until it is deployed the Set default button still works, but only in this app, and says so. Then `npm install` and restart the dev server.

Four-tab entry: **Sales Confirmation** → **Job Order** → **Fabric Info** → **Recipe**.

```
charles-supabase's Project                          vitson-recipe
 tbl_Customer, tbl_Alias, tbl_Fabric,   Database    sync-reference-data      tbl_Customer_Sync, tbl_Alias_Sync, tbl_Fabric_Sync,
 tbl_tone, tbl_dye_process_type       ──Webhooks──▶ (one Edge Function)  ──▶ tbl_tone_sync, tbl_dye_process_type_sync
                                                                                     │ real FKs
 React app (anon key) ──▶ tbl_Sales_Confirmation ─1:many─▶ tbl_job_order ─1:many─▶ tbl_fabric_info
```

## 1. vitson-recipe: mirror tables and policies
SQL Editor → run `sql/01_reference_sync_tables.sql`. It creates `tbl_Alias_Sync`, `tbl_Fabric_Sync`, `tbl_tone_sync`,
`tbl_dye_process_type_sync` and adds the missing row level security policies on your hand-made tables.

## 2. charles-supabase: deploy the one sync function
It replaces `sync-customer` and covers all five source tables.

```bash
cd charles-supabase
supabase link --project-ref xsknxirraveijgvbdfxs

supabase secrets set \
  TARGET_SUPABASE_URL=https://vvzedjmmtnxvzflzwado.supabase.co \
  TARGET_SERVICE_ROLE_KEY=<vitson-recipe service role / secret key> \
  WEBHOOK_SECRET=<long random string>

supabase functions deploy sync-reference-data --no-verify-jwt
```

## 3. charles-supabase: five Database Webhooks
Dashboard → **Database → Webhooks**. Create one hook per table (seven in all), all pointing at the same function:

| Hook name | Table |
|---|---|
| `sync_customer` | `tbl_Customer` |
| `sync_alias` | `tbl_Alias` |
| `sync_fabric` | `tbl_Fabric` |
| `sync_tone` | `tbl_tone` |
| `sync_dye_process_type` | `tbl_dye_process_type` |
| `sync_item_bound` | `tbl_Item_Bound` |
| `sync_item` | `tbl_Item` |

For each: events **Insert, Update, Delete**, type **Supabase Edge Functions** → `sync-reference-data`, method `POST`,
HTTP header `x-webhook-secret` = your `WEBHOOK_SECRET`. If you already have a `sync_customer` hook, edit it to call the new
function, then delete the old `sync-customer` function.

## 4. Load the existing rows
```bash
curl -X POST "https://xsknxirraveijgvbdfxs.supabase.co/functions/v1/sync-reference-data" \
  -H "x-webhook-secret: <WEBHOOK_SECRET>" -H "Content-Type: application/json" \
  -d '{"backfill": true}'
```
Add `"table": "tbl_tone"` to do one table. The backfill also marks mirror rows inactive when their source row no longer exists.
Run it again whenever you suspect drift: Database Webhooks don't retry failed calls.

## 5. Foreign keys on tbl_job_order
Assign them in the Table Editor now that the `_sync` tables exist, or run `sql/02_job_order_foreign_keys.sql`, which also
widens `1x1_touch_id` / `cc_touch_id` to bigint and adds a `price` column to `tbl_price_list`.

**If the dropdowns are empty in the app:** every policy is for the `authenticated` role, so an app using only the anon key
sees nothing. `sql/03_testing_anon_access.sql` opens the tables to `anon` for testing only.

## 6. Recipe tab: run `sql/04_recipe_module.sql`, redeploy, backfill
1. SQL Editor → `sql/04_recipe_module.sql`. It drops a leftover foreign key on `tbl_default_finishing_recipe`, adds two tracking
   columns to `tbl_temp_recipe`, adds policies, and creates the four `recipe_*` functions. Testing with the anon key? Then run
   `sql/05_testing_anon_access_recipe.sql` after it.
2. Redeploy the function (`supabase functions deploy sync-reference-data --no-verify-jwt`), add the `tbl_Item_Bound` and
   `tbl_Item` webhooks, then run the backfill from step 4. `tbl_Item_Sync` is empty until you do, and the recipe item dropdown needs it.

**Re-running `04` and `05`:** they are safe to run again (they only add or replace). Run them again after any update, in that order.

## 7. Run the app
```bash
cd app
cp .env.example .env      # vitson-recipe URL + anon key
npm install
npm run dev
```

## How the three sections work
- **Sales Confirmation:** customer (searchable, from `tbl_Customer_Sync`), date, sales confirmation no., customer job order no.
- **Job Order:** for the selected confirmation. Dye process, fabric and tone come from the `_sync` tables; color, color reference,
  touches and reprocess reasons from their tables. Unit price is suggested from `tbl_price_list` (customer + dye process + fabric + tone) once that table has a `price` column.
- **Fabric Info:** for the selected job order. Pick Body, 1x1, Collar, Cuffs or Cotton Tapes and enter weights; several can be pasted at once.
  Totals show per roll type and per job order.

Deleting is blocked by the database while child rows exist (a confirmation with job orders, a job order with rolls).
Currency and weight unit are constants in `app/src/lib/format.js`.

## Recipe tab
Tabs open as soon as what they need exists: **Fabric Info** once the sales confirmation has a job order, **Recipe** once the current job order has fabric info.
The first job order is current by default; switch job tickets from the bar under the tabs.

1. Pick a **dye procedure** (`tbl_default_dyeing_procedure`). The database copies its default dye recipe into `tbl_temp_recipe`
   (group 1), then looks up the default finishing recipe (group 2) and the default color reference recipe (group 3).
2. Edit freely: every cell change, added row and deleted row is kept in `tbl_temp_recipe` immediately. Rows are shown per group,
   with a band per dyeing step. Steps are sorted by the first letter of `dye_step_name` (ties by full name), rows by `order`.
3. **Save ... default** on a section writes it back: group 1 updates `tbl_default_dye_recipe` of that procedure; group 2 creates a
   `tbl_default_finishing_fabric_info` entry (or updates the matching one) and its recipe rows; group 3 saves under the job order's color reference.
4. **Save recipe** replaces the job order's rows in `tbl_active_dye_recipe` (groups 1 and 3) and `tbl_active_finishing_recipe` (group 2).
   - **Blank rows:** a row with a dyeing step and no item is a blank spacing row. It is saved to the defaults with its step, its **order** and
     its parent id; item, grm, % OWF and quantity are NULL. Use **Add blank row** on a step's band (its order starts after that step's last row)
     and change the order to move it.
   - **Sorting:** first letter of the step name, then order ascending. Steps that share a letter (for example the "I)" steps) are interleaved by order.
   - **Average price:** looked up from `tbl_Item_Sync.average_price` only when rows are appended to `tbl_temp_recipe` (loading defaults, or putting an item on a row).
     It is kept in `tbl_temp_recipe.average_price` and copied to the active tables as is. The default tables don't store it.
   - **Dye volume ratio:** the dye and color reference sections share ONE ratio (editing it in either updates both). It is stored per job order in
     `tbl_recipe_ratio` (under group 1). Dye volume = total weight of ALL rolls x ratio (150 kg x 10 = 1,500 L).
   - **Finishing volume ratio (per roll):** the finishing section has its own ratio (stored under group 2). Finishing volume = number of **Body rolls** x ratio
     (2 Body rolls x 5 = 10 L).
   - **Quantity:** a row with a **Grm** gets `grm x volume / 1000` (dye volume in the dye and color reference sections, finishing volume in the finishing section).
     A row with a **% OWF** gets `% OWF x total weight of the Body rolls only / 100` in every section (Body = the `tbl_roll_type` named "Body").
     A row can have one or the other, so typing in one clears the other. Computed quantities can't be typed over; a row with neither keeps a typed quantity.
     The database repeats the calculation when you load defaults, save a default and save the recipe.
5. **Print** opens a report built from the saved recipe: sales confirmation, job order, fabric info, then the dye and finishing recipes (with their
   dye volumes). It is disabled while there are unsaved changes. Two QR codes are printed: top right, the job ticket only; bottom right (end of the
   report), the job details as JSON with every id replaced by its name: `customer_no`, `cus_jo_no`, `dye_process_name`, `fabric_name`, `tone_name`,
   `color_name`, `body_touch_name`, `body_size`, `1x1_size`, `greigh_yld`, `required_yld`, `color_ref_code`. The codes come from the `qrcode` package,
   so run `npm install` after updating.

The finishing lookup compares customer, fabric, **body** touch, tone, mercerize, stock no., SPI and dye process. Every one of those must be
filled on the job order, because the default table doesn't allow empty values.

## Color references on the job order
The Color reference field is a text box with suggestions from `tbl_color_ref`. Adding a new one needs an insert policy on `tbl_color_ref`: `04` adds it for `authenticated`, and `05` for the anon key (testing only). A code that isn't in the list opens a popup asking whether to save it as a
new color reference; confirming adds it to `tbl_color_ref` and saves the job order with it. Going back saves nothing.

## Screens and shortcuts
- **Dashboard (left):** Sales Confirmations, Job Orders and Recipe. It collapses to icons with the menu button, and collapses itself after you pick a view.
- **Colour coding:** blue = sales confirmation, green = job order, purple = fabric info, teal = recipe (dye = blue, color reference = pink, finishing = green). Inputs are pale yellow and turn light blue when focused; messages are bold orange and errors bold red.
- **Sales Confirmation:** the highest sales confirmation no. is shown in a highlighted, large-font box right beside the Sales confirmation no. input (no caption); double-click the input to fill in the next one (max + 1). Double-click a record to open its job orders.
  Saving a new confirmation opens the Job Order tab with an empty job order form; saving a new job order opens Fabric Info with the cursor in the Body box.
- **Job Order:** double-click a record to edit it. Edit and delete are icon buttons.
- **Fabric Info:** one column per roll type with its own weight box; Enter adds the roll (several weights separated by spaces also work). Clicking a label focuses its box.
  The summary reads Body + 1x1 + Others = Total.
- **Recipe:** dye recipe on the left, color reference above finishing on the right. Default ratios: 8 (dye and color reference), 15 per Body roll (finishing); clear the box to go back to the default.
  Items are filtered by `tbl_Item_Sync.bound_id`: color reference 22 to 25, finishing 1, 4, 10, 11, 17, 19, 20, dye everything else.
  **Save default** turns into **Update Default** (darker orange) once a row was added, deleted or changed. The only status message kept is the red "no default recipe is linked" one.
- **Job Orders (dashboard):** search by customer JO, customer, job ticket, date, period and recipe date (any combination), with Filter and Clear. Double-click a record to open its sales confirmation, filtered to that job ticket.
- **Recipe (dashboard):** job orders with no recipe date. The Recipe button opens the confirmation on its Recipe tab. `date_recipe` is set when you press **Save recipe**.
- **Report:** laid out like the paper recipe sheet (header boxes, dyeing recipe by step with Water volume, finishing box, yield, QR of the job ticket, fabric record per roll type, QR of the job details at the bottom right).
- **Recipe only with fabric info:** the Recipe tab stays closed until the job order has fabric rolls, and the database refuses to load, save or finalize a recipe without them.
  In the dashboard's Recipe list, job orders without fabric rolls get an **Add fabric info** button instead of **Recipe**.
- **Tracking (dashboard):** pick a job ticket (type it, choose from the list, or press Find) and record the Hydro, Dryer, Heatset and Packed stages: a date (today by default) and a machine per stage.
  Machines are filtered by `tbl_machine.machine_type`: Hydro 3, Dryer 2, Heatset 11 and 10, Packed 32. Hydro is always recorded (`date_hydro` can't be empty); tick another stage when it happens.
  One `tbl_tracking` record per job order (`sql/07_tracking.sql` adds the machine columns and that rule). Recent tracking is listed below the form; double-click a row to open it.
- The job order list no longer shows the unit price, and the Fabric Info and Recipe tabs show **Type** (dye process) and **Color** next to the job ticket.
- **Unsaved changes:** closing a form (Cancel, the x, Esc, a click outside), leaving a tab or dashboard view, or switching job ticket while something is typed but not saved asks
  "You have changes that are not saved. Exit without saving them?" in the app's own popup (Keep editing / Exit without saving). Fabric Info counts a weight that was typed but not added with Enter.
  The Recipe tab keeps its draft automatically, so it is not part of this.
- **Job tickets** are shown as `xx-xxxxx-x-xx-x` everywhere (lists, tabs, popups, the report) and are formatted **while typing** in every job ticket box (job order form, Job Orders search, Tracking, Deliveries search; at most 11 characters, caret stays in place). The stored value and the QR code keep the raw ticket, and searches accept it with or without dashes.
- **Tracking summary (right third of the Tracking view, #bfdbcd):** filter the Hydro date by a day, or a period (type From/To, or pick a whole month). It lists, per dye process, the number of job orders and the total roll
  weight of those job orders, with the grand total. Computed in the database by `tracking_weight_summary`.
- **Deliveries (dashboard):** one form, no tabs. Search a job ticket that has no delivery yet (typed with or without dashes); its customer, customer JO, color, tone, fabric and type load into the form.
  Enter the delivery date, delivery receipt, shrinkage length and width, acquired density and receivable type (BIG = 1, SMALL = 2), then the delivered rolls in the Fabric Info layout (Enter adds a roll).
  A SMALL receipt has no alias; a BIG one starts from the customer's `default_alias_id` (aliases linked to the customer's number are listed first). The comparison card shows delivered against ticket:
  weight loss = (ticket - delivered) / ticket x 100 (PASS up to 5%, FAIL above it) and rolls (PASS when the balance is 0).
  If a BIG receipt is saved with an alias other than the default, the app asks whether to make it the customer's default. `copied` goes back to false on every new, changed or re-rolled delivery.
  Recent deliveries are listed below; double-click one to edit it. One delivery per job order, saved together with its rolls in one transaction (`delivery_save`).
- **Deliveries form, latest:** the delivered-roll columns are only the roll types that were received (job ticket's fabric info); the section shows **Received** (Body + 1x1 + Others = Total) above **Delivered**;
  the comparison columns are Delivered / Received / Loss-Balance. A **Set default** button beside the Alias box makes the chosen alias the customer's default, in `tbl_Customer_Sync` and in charles-supabase's `tbl_Customer`
  (through `vitson-supabase/.../set-default-alias`, which then lets the customer webhook mirror it back). Anyone holding the vitson-recipe anon key can call that function, and it can change only `default_alias_id`.

- **Deliveries form, layout (latest):** Date delivered, Receivable type, then Delivery receipt. A highlighted box beside Delivery receipt shows the highest delivery receipt of the chosen type (BIG 1 / SMALL 2);
  double-click the receipt input to fill in that number + 1. The Alias list shows only aliases whose `tbl_Alias_Sync.associated_customer` (comma separated customer numbers) contains the customer's `customer_no`
  (an alias already saved on the delivery stays listed, marked "not linked"). In Delivered fabric info each roll type shows how many rolls were received, e.g. **Body(4)**, **1x1(2)**, and the blue comparison box
  sits on the right of that section. The weight result reads **Gain (xx %)** in green when more was delivered than received, **Loss (xx %)** in green up to 5 %, and **Loss (xx %)** in red above 5 %.
  `sql/09_delivery_copied_always_reset.sql` makes `copied` go back to false on every update of a delivery (run it once in vitson-recipe).

- **Roll counts (Deliveries):** each delivered-roll column head reads `Body (x)`: x is the number of delivered rolls entered so far, green when it equals the rolls received for that type, red when not (hover for the received count).
- **Reports (print preview, then the browser print dialog):** Tracking summary has a **Print** button (Hydro date period, job orders and weight per dye process, grand total). Job Orders has **Print** (the filtered list) and **Print tracking**
  (the same records with Hydro, Dryer, Heatset, Packed and Delivered dates, landscape). The Job Orders list now shows those five dates after the Recipe date (Delivered comes from `tbl_Delivery`) and no longer shows the sales conf. no.
  Reports follow the filters last applied with **Filter** (not text still being typed) and show the latest 500 matches at most.

- **Tracking summary loads by itself** when the day, period (month, From, To) or status filter changes; **Show summary** still works. **Status filter...** (Tracking summary and Job Orders) opens a pop-up that combines
  conditions on the Recipe, Hydro, Dryer, Heatset, Packed and Delivered dates, each *Any / Filled in / Empty*, with quick presets (hydro done not delivered, no recipe yet, recipe done no hydro, packed not delivered).
  In Job Orders it runs together with the other filters and is shown on the reports; in the summary the Hydro date is always the period, so that row is hidden. Run `sql/10_status_filter.sql` once (it replaces `tracking_weight_summary`
  with a version that accepts the conditions).

- **Unit price lookup (Job Order):** saving a NEW job order, or an existing one whose tone, fabric or dye process changed, looks up `tbl_customer_price` for the customer (from the sales confirmation) + tone + fabric + dye process (all four must match)
  and stores the price in `tbl_job_order.unit_price` (still not shown in the form). When the combination has no price, a pop-up asks whether to create a price record: **Yes, create it** (enter the unit price, saved to `tbl_customer_price` and to the job order),
  **No, save without price** (job order saved with no unit price) or **Back to form** (nothing saved). Run `sql/11_customer_price.sql` once (policies + one price per combination).
- **Count badges:** in Deliveries the roll count in each head (`Body (3)`) and the Loss/Balance messages are solid green (OK) or red (not OK) boxes with yellow text.
- **Locked records:** when `tbl_Delivery.copied` is true, the job order, its fabric rolls, the delivery and its delivered rolls are view only: forms are greyed, Save and the roll boxes are off, rows show a Locked tag and Delete asks for the password.
  **Unlock to edit** asks for the password (1688); the unlock lasts until the page is reloaded. Saving a delivery sets `copied` back to false, which also ends the lock. The check is in the app only (the password sits in the browser code).

- **Roll count in the Deliveries heads (changed):** `Body (4)` always shows the total rolls RECEIVED for that type and never changes while rolls are entered. Its box is green when the delivered rolls entered equal the received count and red otherwise (hover shows "x of 4 rolls entered").

- **Job ticket pattern (corrected):** `A#-#####-#-AA-#` (A letter, # digit, 11 characters). In the job order form a NEW ticket is typed with the pattern enforced: letters become capitals, a character that doesn't fit its position is ignored, and the ticket must be complete to save.
  An old ticket that doesn't follow the pattern stays editable as it is; search boxes accept any characters.
- **Delivery receipt print (Deliveries):** **Print DR** in the recent list (and in the form when editing a delivery) opens a preview of the paper receipt for that receipt number and receivable type; every job ticket sharing the number is on the same receipt.
  BIG: alias name, TIN and address (the customer's own details when the delivery has no alias), table Quantity / Weight / Description / Color / J.O. / FW / Remarks. SMALL: customer name only, table Roll / Weight / Stock / Fabric / Process / Shade / Job Order / FW / Remark.
  Both end with the packing list: per job ticket the roll weights per roll type (6 per line) and the total. Fields: Description/Shade = stock no. (Body) or roll type, fabric, dye process, tone code + color; Color/Remark = color reference; J.O. = customer JO no.; size (body, 1x1, cc) in Remarks (BIG) or FW (SMALL).
  **Data only (pre-printed form)** hides the form's text and lines. Paper size is A4 for now.
