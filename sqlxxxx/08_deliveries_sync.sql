-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Read-only mirror of charles-supabase's tbl_Deliveries
-- (name = source name + _Sync). Written only by the sync-reference-data Edge Function.
-- tbl_Alias_Sync already exists and is already synced.
-- No foreign keys: a delivery must never be rejected because its alias or job order hasn't arrived yet
-- (webhooks are not retried). The app joins them in the browser.
-- =====================================================================
create table if not exists public."tbl_Deliveries_Sync" (
  id                bigint primary key,
  job_order_id      bigint not null,              -- the job order id in charles-supabase, not tbl_job_order here
  delivery_receipt  bigint not null,
  receivable_type_id bigint not null,
  date_delivery     date   not null,
  delivered_body_wt double precision not null,
  delivered_1x1_wt  double precision not null,
  delivered_cc_wt   double precision not null,
  count_body        integer not null,
  count_1x1         integer not null,
  count_cc          integer not null,
  invoice_id        bigint not null,
  alias_id          bigint,
  is_active         boolean not null default true,
  synced_at         timestamptz not null default now()
);
create index if not exists idx_deliveries_sync_date on public."tbl_Deliveries_Sync"(date_delivery desc);

comment on table public."tbl_Deliveries_Sync" is
  'Read-only mirror of tbl_Deliveries (charles-supabase). Maintained by the sync-reference-data Edge Function.';

alter table public."tbl_Deliveries_Sync" enable row level security;
drop policy if exists "sync_read" on public."tbl_Deliveries_Sync";
create policy "sync_read" on public."tbl_Deliveries_Sync" for select to authenticated using (true);
grant select on public."tbl_Deliveries_Sync" to authenticated;
grant all on public."tbl_Deliveries_Sync" to service_role;

-- TESTING ONLY: the app currently connects with the anon key (same stance as 03, 05, 06 and 07)
drop policy if exists "dev_read" on public."tbl_Deliveries_Sync";
create policy "dev_read" on public."tbl_Deliveries_Sync" for select to anon using (true);
grant select on public."tbl_Deliveries_Sync" to anon;
