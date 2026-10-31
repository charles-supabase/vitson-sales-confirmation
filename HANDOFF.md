# Vitson Sales Confirmations: handoff for a fresh Claude thread

Read this first, then `README.md` (setup, screens) and the user's memory files `/areas/vitson-sales-confirmation.md`, `vitson-dye-recipe-tab.md`, `vitson-tracking.md`, `vitson-ui-theme.md` (stated specs). The user is non-native English, gives specs incrementally, and tests on their own machine.

## 1. What it is
React 18 + Vite single-page app (`app/`, plain CSS, no router, no UI library; only extra dep `qrcode`) for a textile dye house: sales confirmation -> job orders -> fabric rolls -> dye/finishing/color-reference recipe -> printed recipe sheet, plus dashboard views (Job Orders search, Recipe list, Tracking, Deliveries).
Two Supabase projects (the Supabase MCP tools reach both):
- **vitson-recipe** (`vvzedjmmtnxvzflzwado`): everything the app reads and writes. The browser talks ONLY to this project, with the anon/publishable key (`app/.env`: `VITE_VITSON_SUPABASE_URL`, `VITE_VITSON_SUPABASE_ANON_KEY`).
- **charles-supabase's Project** (`xsknxirraveijgvbdfxs`): the user's accounting DB and source of truth for customers, aliases, fabrics, tones, dye process types, items. Postgres cannot have cross-project FKs, so reference data is mirrored into `*_Sync` tables here.

## 2. Repo tree (`vitson-sales-confirmation/`)
```
README.md                      setup + behaviour of every screen (kept current)
HANDOFF.md                     this file
sql/                           run in vitson-recipe SQL Editor; all idempotent; 01-08 are applied to the live DB, 09 is new and not yet run
  01_reference_sync_tables.sql   *_Sync mirrors (Alias, Fabric, tone, dye_process_type) + policies on hand-made tables
  02_job_order_foreign_keys.sql  FKs on tbl_job_order / tbl_price_list, price column (optional)
  03_testing_anon_access.sql     TESTING ONLY: anon policies for the base tables
  04_recipe_module.sql           recipe functions, tbl_recipe_ratio, date_recipe, policies, fixes (the big one)
  05_testing_anon_access_recipe.sql  TESTING ONLY: anon policies for recipe tables (+ a check query)
  06_fix_anon_ratio_and_color_ref.sql TESTING ONLY: anon policy for tbl_recipe_ratio, tbl_color_ref insert
  07_tracking.sql                tbl_tracking machine columns, unique per job order, tracking_weight_summary(), policies
  08_delivery_form.sql           default_alias_id column, identity on delivery ids, copied triggers, delivery_candidates/delivery_save, policies
  13_lock_down.sql / 13_undo_lock_down.sql  every policy -> valid app session (x-app-token), recipe tables need module recipe (NEW, run LAST)
  12_app_users.sql               tbl_app_user / tbl_app_session / tbl_app_login_attempt, app_login, app_verify, app_can, app_set_password ... (NEW)
  11_customer_price.sql          unique index + authenticated/anon policies on tbl_customer_price (NEW: user must run it; table existed with RLS on and no policy)
  10_status_filter.sql           job_order_status_ids(jsonb) + tracking_weight_summary(from,to,cond jsonb) (NEW: user must run it)
  09_delivery_copied_always_reset.sql  copied = false on EVERY delivery update unless the update sets copied itself (NEW: user must run it)
charles-supabase/supabase/
  config.toml                    verify_jwt=false for the webhook function
  functions/sync-reference-data/index.ts   ONE Edge Function for all Database Webhooks (+ backfill)
vitson-supabase/supabase/
  functions/app-login/index.ts   NEW: login / verify / ip-check, office rule via secret OFFICE_PUBLIC_IP (cf-connecting-ip)
  config.toml
  functions/set-default-alias/index.ts     NEW, NOT YET DEPLOYED (see section 8)
app/
  index.html, vite.config.js, package.json, .env.example
  src/main.jsx, App.jsx, styles.css
  src/lib/supabase.js            the single client (vitson-recipe)
  src/lib/salesApi.js            ALL data access (lookups, CRUD, RPC wrappers, searches); friendlyError()
  src/lib/format.js              money/weight/date helpers, formatTicket (xx-xxxxx-x-xx-x), compactTicket, CURRENCY=PHP, WEIGHT_UNIT=kg
  src/lib/recipeUtils.js         sort/group by step, quantity rules, ratio defaults, item bound filters, row signatures
  src/lib/unsavedGuard.js        useUnsavedGuard(), hasUnsavedChanges(), unsavedPrompt()
  src/components/Modal.jsx       dialog (focus, Esc only closes the top one)
  src/components/FormFields.jsx  TextField/SelectField/CheckField/toOptions + TicketInput/TicketField (live xx-xxxxx-x-xx-x formatting, caret kept) (module-level on purpose: no remounting)
  src/components/Icons.jsx       inline SVG icons + IconButton (edit/delete)
  src/components/ContextLine.jsx the per-tab "Customer / Customer JO / Job Ticket / Type / Color" line
  src/components/ConfirmationSection.jsx  tab 1
  src/components/JobOrderSection.jsx      tab 2 (form with JobOrderForm)
  src/components/FabricSection.jsx        tab 3 (roll-type columns)
  src/components/RecipeSection.jsx + RecipeGroup.jsx + RecipeReport.jsx   tab 4 + print sheet
  src/lib/lock.jsx               LockProvider (password dialog 1688, in main.jsx), useJobOrderLocks(ids), LockBanner
  src/components/DeliveryReceiptReport.jsx  printed delivery receipt BIG (type 1) / SMALL (type 2) from loadDeliveryReceipt(type, no); 'Data only' mode for pre-printed paper
  src/components/PriceDialog.jsx  'no price for this combination' pop-up (create price record / without price / back)
  src/components/StatusFilter.jsx  Status filter pop-up (Any/Filled in/Empty per stage date), describeStatus(), presets
  src/components/ListReport.jsx   generic printable table report (preview overlay, landscape option) used by Tracking summary and Job Orders prints
  src/components/JobOrdersView.jsx  (search + shared JobOrderTable/useJobOrderList; stage-date columns + 2 print buttons), RecipeListView.jsx, TrackingView.jsx, DeliveriesView.jsx
```

## 3. Database (vitson-recipe), by module
All ids are bigint. Table names are mixed case and MUST be quoted in SQL (`"tbl_Sales_Confirmation"`). RLS is on everywhere.
- **Mirrors (read-only, written by the sync function; extra cols `is_active`, `synced_at`; soft delete = is_active false):** `tbl_Customer_Sync(id, customer_name, address, customer_TIN, customer_no, default_alias_id)`, `tbl_Alias_Sync(id, alias_name, TIN_number, associated_customer, alias_address)`, `tbl_Fabric_Sync`, `tbl_tone_sync(tone_name, tone_code)`, `tbl_dye_process_type_sync`, `tbl_Item_Sync(item_name, Price, bound_id, Shade_id, average_price)`, `tbl_Item_Bound_Sync(bound_name, sorting_id)`.
- **Lookups the user maintains:** `tbl_touch`, `tbl_reprocess_reasons`, `tbl_roll_type` (Body, 1x1, Collar, Cuffs, Cotton Tapes), `tbl_color`, `tbl_color_ref(color_ref_code)`, `tbl_price_list`, `tbl_dyeing_steps(dye_step_name "A) Scouring"...)`, `tbl_default_dyeing_procedure(procedure_name)`, `tbl_machine(machine_name, machine_type)`, `tbl_receivable_type(1 BIG, 2 SMALL)`.
- **Entry chain:** `tbl_Sales_Confirmation(sales_confirm_no, confirmation_date, customer_id, cus_jo_no)` 1-n `tbl_job_order` (job_ticket, dye_process_id, fabric_id, tone_id, color_id, color_ref_id, stock_no, spi, mercerize, reprocessed/reprocess_id, greigh_yld, required_yld, grouping, body/1x1/cc `_touch_id` + `_size` (1x1 columns are named `"1x1_touch_id"`, `"1x1_size"`), unit_price (not shown in the UI), copied, **date_recipe**) 1-n `tbl_fabric_info(roll_wt, roll_type_id)`.
- **Recipe:** defaults `tbl_default_dye_recipe` (by procedure), `tbl_default_finishing_fabric_info` + `tbl_default_finishing_recipe`, `tbl_default_color_ref_recipe`; working copy `tbl_temp_recipe` (group_by 1 dye / 2 finishing / 3 color ref; extra cols `source_id`, `source_parent_id`, `average_price`); output `tbl_active_dye_recipe` (groups 1+3), `tbl_active_finishing_recipe` (group 2); `tbl_recipe_ratio(job_order_id, group_by 1|2, dye_ratio)`.
- **Tracking:** `tbl_tracking(job_order_id unique, date_hydro NOT NULL, date_dryer, "date_Heatset", date_packed, date_dyed(unused), machine_hydro/dryer/heatset/packed_id)`.
- **Deliveries (local, NOT synced):** `tbl_Delivery(job_order_id unique, delivery_receipt, receivable_type_id, date_delivery, alias_id -> tbl_Alias_Sync, copied, shrinkage_length/width, acquired_density smallint)`, `tbl_fabric_info_delivered(delivery_id, roll_type_id, roll_wt)`.
- **RPC / functions** (all SECURITY INVOKER, one transaction per call): `recipe_load_group`, `recipe_save_group`, `recipe_finalize`, `recipe_set_ratio`, `recipe_recalc_quantities`, `recipe_roll_weight`, `recipe_body_weight`, `recipe_body_roll_count`, `recipe_find_finishing_info`, `tracking_weight_summary(from,to)`, `delivery_candidates(search,limit)`, `delivery_save(...)`; triggers `trg_delivery_copied`, `trg_delivery_rolls_copied`.
- **Security state:** policies exist for `authenticated` AND (testing) `anon`, because the app has no login (Vitson's own login is custom, `tbl_User`, unused here). New tables need BOTH policy sets or the app silently reads nothing (RLS returns empty, not an error). `tbl_Customer_Sync` allows UPDATE of `default_alias_id` only (column grant).
- **Live data (last check):** 54 customers (1 with a default alias), 223 aliases, 325 items, 5 sales confirmations, 6 job orders, 6 tracking rows, 1 delivery. These are the user's own test data: never delete or leave test rows (see section 7).

## 4. Sync (charles -> vitson-recipe)
`sync-reference-data` (verify_jwt off, header `x-webhook-secret`, secrets `TARGET_SUPABASE_URL`, `TARGET_SERVICE_ROLE_KEY`, `WEBHOOK_SECRET`) maps source table -> mirror + column list: tbl_Customer (incl. default_alias_id), tbl_Alias, tbl_Fabric, tbl_tone, tbl_dye_process_type, tbl_Item_Bound, tbl_Item. INSERT/UPDATE upsert, DELETE = deactivate. `{"backfill": true, "table": "..."}` reloads and deactivates rows that vanished. One Database Webhook per source table exists in charles for those tables. `tbl_Deliveries` is deliberately NOT synced.

## 5. App modules: current state (all working per the user's testing unless noted)
- **Shell (`App.jsx`)**: collapsible dashboard (Sales Confirmations, Job Orders, Recipe, Tracking, Deliveries; collapses after a choice, remembered in localStorage). Holds lookups, confirmations, selected confirmation/job order, rolls; `notify(tone,title,msg,after)` and `confirmDelete(spec)` drive the two in-app popups (NO native alert/confirm: user preference). `guarded(action)` = unsaved-changes prompt before leaving.
- **Entry view, 4 colour-coded tabs** (blue/green/purple/teal): 1 Sales Confirmation (list, search, form with "latest no." and double-click = max+1; double-click row opens job orders; new confirmation -> Job Order tab + empty form), 2 Job Order (list without unit price, double-click = edit, icon buttons, color reference typed with "save new color ref?" popup; new job order -> Fabric Info), 3 Fabric Info (one column per roll type, Enter adds roll, Body + 1x1 + Others = Total), 4 Recipe (only when the job order has fabric info; also enforced by the DB). Tabs open as soon as their prerequisite exists; first job order auto-selected; job ticket dropdown on Fabric tab.
- **Recipe**: pick dye procedure -> `recipe_load_group` 1/2/3 into `tbl_temp_recipe`; two columns (dye left; color ref over finishing right); inline edits saved to temp immediately; blank rows (step + order only); Save default / "Update Default" per section (sync back via `recipe_save_group`, creates finishing default entry if none); "Save recipe" = `recipe_finalize` (also stamps `date_recipe`); Print = paper-sheet clone with two QR codes. Items filtered by bound per section.
- **Job Orders view**: AND-combinable filters (customer JO, customer, ticket, date, period, recipe date); double-click opens the confirmation filtered to that ticket. **Recipe view**: job orders with `date_recipe` null; Recipe button (or Add fabric info if no rolls).
- **Tracking view**: find a ticket, 4 stages (Hydro required; others ticked when done) each with date (default today) + machine filtered by type (Hydro 3, Dryer 2, Heatset 11/10, Packed 32); right third (#bfdbcd) = weight per dye process for a Hydro date day/period/month + grand total.
- **Deliveries view (one form, no tabs)**: candidates = job orders with no delivery; shows job info pills; delivery fields; BIG(1) shows Alias (default from customer, linked aliases first) + **Set default** button, SMALL(2) hides alias; delivered rolls ONLY for roll types that were received, Received and Delivered weight lines, comparison card (Delivered / Received / Loss-Balance); save via `delivery_save`; after saving with a non-default alias asks to make it default; recent list with edit/delete. **Latest changes, built and syntax-checked but NOT yet tried by the user:** received-only columns, Received line, Set default + write-back; and the layout pass: order Date, Receivable type, Delivery receipt with a highlighted max-receipt box per type (double-click = max+1, `getMaxDeliveryReceipt`), Body(4)-style received counts on roll columns, blue comparison box on the right of Delivered fabric info, Gain/Loss (xx %) badge (green gain, green loss up to 5, red above 5), alias list limited to aliases linked to the customer. Sales Confirmation dialog: highlighted large max-no box beside the input. Job ticket boxes (job order form, Job Orders search, Tracking, Deliveries search) format while typing and cap at 11 chars; stored raw.

## 6. Business rules to preserve
- Quantity: Grm row = `grm * volume / 1000`; % OWF row = `percent_OWF * Body weight / 100`; a row may have only one of the two; neither = typed quantity; blank row = item null (keeps step + order). Volumes: dye/color ref = total roll weight x ratio (shared ratio, default 8); finishing = number of Body rolls x ratio (default 15). Rule lives in BOTH `recipeUtils.js` and `recipe_recalc_quantities` (keep equal).
- Sort: first letter of step name, then order ascending (steps sharing a letter interleave); headers repeat per run.
- Item bounds: color ref 22-25; finishing 1,4,10,11,17,19,20; dye = everything else.
- Delivery comparison: loss % = (received - delivered) / received x 100; FAIL above 5%; rolls PASS only when received count = delivered count. `copied` = false on insert, on any business change, and on roll changes.
- Job tickets display as `xx-xxxxx-x-xx-x` (stored raw; QR keeps raw). Orange is always `#ab5709`. Inputs pale yellow, focused light blue; messages bold orange, errors bold red; ratio input `#fceb9f`.

## 7. Working conventions (important)
- Verify before shipping: syntax-check all JSX with the TypeScript transpiler + a missing-name check; test SQL on the live DB inside ONE multi-statement call that ends with `raise exception 'TEST_OUTPUT %'` so everything rolls back, then confirm nothing persisted. There is no Postgres, npm or network in the sandbox: the app has never been built or run by Claude.
- Always `present_files` the zip (`/mnt/user-data/outputs/vitson-sales-confirmation.zip`, rebuilt each time) and say what the user must run (SQL file, function deploy, `npm install`).
- After any new table: add authenticated + anon policies, then say so (recurring cause of "empty list" reports).
- Save stated specs to memory as they are given (never inferred ones). Be explicit about assumptions; the user corrects quickly.

## 8. Next steps
1. **Deploy and verify `set-default-alias`** (vitson-recipe): secrets `CHARLES_SUPABASE_URL=https://xsknxirraveijgvbdfxs.supabase.co`, `CHARLES_SERVICE_ROLE_KEY=<charles service key>`; `supabase functions deploy set-default-alias`. Until then the Set default button falls back to a local-only update and says so. Needs the charles customer webhook + redeployed sync function (default_alias_id is mapped) to mirror back.
2. Have the user test the changed Deliveries form (received-only columns, Set default, comparison "Received") and fix what they report.
3. **No next module has been specified by the user.** Ask what is next. Open items they might raise: a real login to replace the anon "testing" policies (repeatedly recommended, not yet requested); report fields with no data (BinNo, Due Date print blank); `date_dyed` in tracking; mirroring charles job orders; the Recipe tab's draft (`tbl_temp_recipe`) is kept per job order and never auto-cleaned.

## 9. Latest session (not yet tried by the user)
Roll heads `Body (x)` with x = delivered count, green/red vs received count. Reports: Tracking summary Print, Job Orders Print and Print tracking (`listStageDates` in salesApi.js reads tbl_tracking + tbl_Delivery.date_delivery). Job Orders list lost the sales conf. no. column (Recipe list keeps it).
OPEN: the user attached a small, rotated photo of the paper Delivery Receipt (VITSON INTERNATIONAL INCORPORATED, customer / TIN / address, quantity / weight / description, "INSPECT BEFORE CUTTING", "PACKING LIST" with Body weights). The layout was NOT built: ask for the exact fields, paper size and where the Print button goes.

Status filter + auto summary (also untested): Tracking summary reloads on any filter change (250 ms debounce, latest request wins). Status conditions are `{recipe,hydro,dryer,heatset,packed,delivered: true|false}`; Job Orders asks `job_order_status_ids` first, then fetches those ids in chunks of 150 and merges (500 max). ASSUMPTION to confirm with the user: the pop-up was built for BOTH the Job Orders list and the Tracking summary.

Price lookup + lock (untested by the user): JobOrderSection.resolveUnitPrice runs findCustomerPrice(customer_id from the confirmation, tone, fabric, dye) for new job orders and when tone/fabric/dye changed; no match -> PriceDialog -> createCustomerPrice; result stored in tbl_job_order.unit_price (double precision, no FK).
Lock = delivery.copied true (copiedJobOrderIds) -> job order form, fabric rolls, delivery form and delivered rolls read-only; password 1688 held in lib/lock.jsx; unlocked ids live in memory until reload. UI only, not enforced in the database. ASSUMPTION: fabric rolls and delivered rolls count as "related records". Not done: resetting delivery.copied when an unlocked job order or roll edit is saved.

Job ticket pattern is A#-#####-#-AA-# (format.js typingTicket(strict), isTicket; strict only for new tickets or conforming ones). Delivery receipt print built from the user's two sample photos (dr_big, dr_small); layout and field mapping are my reading of the photos and have NOT been checked against paper: first two ticket groups (A#-#####) printed in the packing list tag, row order 1x1 then Body (BIG) / Body then 1x1 (SMALL), black DR number overprint only in Data only mode, A4 page, Ref/Approved/Checked/Delivered/Truck/Driver blank. Ask the user to compare a test print.

## 10. Access control (built, SQL tested on the live DB in rolled-back transactions; Edge Function and UI NOT run)
Own users table in vitson-recipe (NOT charles' tbl_User, NOT Supabase Auth). Login = Edge Function app-login (verify_jwt off) -> public.app_login -> random session token (SHA-256 stored) sent as header x-app-token by lib/supabase.js; RLS reads it through public.app_can(module) (request.headers). lib/auth.jsx (AuthProvider, MODULES map, can()), LoginView, ChangePasswordDialog; App.jsx hides nav items/tabs by module. set-default-alias now also requires the token + module deliveries.
Users seeded: Charles, Susan (super admin), Ana (all), Mark, Joyce, Arnel (all but recipe), Michelle (NO modules: user did not say). Passwords are NOT set: the user runs app_set_password per person. Open: Michelle's modules; client IP is trusted from cf-connecting-ip inside the Edge Function (verify with Check connection from the office before running 13); the office rule is checked at login and by app_verify (open + every 5 min), not on every database request; accounting app (charles tbl_User) keeps separate passwords.

Ticket pattern now alnum at positions 1, 9, 10 (A), digits elsewhere; maxLength 15 in all TicketInput uses. Job order form: jo-split layout; body touch is the default for 1x1 and cc touch (followers only while equal to the old body value or empty).

isTicket(): >= 7 compact characters and every character fits the shape; the tail (#-AA-#) is optional.

Job order form: color is now typed (values.color_name, datalist) like color reference; isNA() skips lookup/prompt and ensures an N/A row via createColor/createColorRef; one combined confirm for new color + new ref (saveWithLookups).

sql/14_color_insert.sql: tbl_color had no INSERT policy (new colors failed with 42501). friendlyError now shows the database message for 42501 so the table is visible.

New color/ref prompt is field-level (onBlur unless focus goes to a button, or Enter): askNewEntry creates the record + reloadLookups and keeps the form open; submit-time prompt (handleSave) remains as fallback and saves the job order.
