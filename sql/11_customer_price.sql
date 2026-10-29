-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Idempotent.
-- Price lookup for new / changed job orders: tbl_customer_price (customer_id, tone_id, fabric_id, dye_process_id -> unit_price).
-- The table already existed but had row level security ON and no policy, so the app could not read or write it.
-- =====================================================================

-- 1) one price per combination (the lookup needs exactly one match)
create unique index if not exists uq_customer_price_combo
  on public."tbl_customer_price"(customer_id, tone_id, fabric_id, dye_process_id);

-- 2) policies for the authenticated role
alter table public."tbl_customer_price" enable row level security;
drop policy if exists "entry_all" on public."tbl_customer_price";
create policy "entry_all" on public."tbl_customer_price" for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public."tbl_customer_price" to authenticated;

-- 3) TESTING ONLY: the app connects with the anon key (same stance as 03, 05, 06 and 07). Drop dev_all to undo.
drop policy if exists "dev_all" on public."tbl_customer_price";
create policy "dev_all" on public."tbl_customer_price" for all to anon using (true) with check (true);
grant select, insert, update, delete on public."tbl_customer_price" to anon;

grant usage, select on all sequences in schema public to anon;
