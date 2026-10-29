-- =====================================================================
-- Run in: vitson-recipe  ->  SQL Editor
-- Purpose: local mirror of charles-supabase's tbl_Customer, plus
--          tbl_Sales_Confirmation with a REAL foreign key to the mirror.
-- Identifiers are quoted so the mixed-case names match what supabase-js
-- and the Table Editor show (tbl_Sales_Confirmation, not lowercase).
-- =====================================================================

-- 1) Mirror of the customer list (written ONLY by the sync Edge Function)
create table if not exists public."tbl_Customer_Sync" (
  id            uuid primary key,                 -- same id as charles-supabase tbl_Customer.id
  customer_name text not null,
  is_active     boolean not null default true,    -- false when the source row is deleted
  synced_at     timestamptz not null default now()
);

comment on table public."tbl_Customer_Sync" is
  'Read-only mirror of tbl_Customer from charles-supabase. Maintained by the sync-customer Edge Function.';

-- 2) Auto-numbering for confirmations: SC-000001, SC-000002, ...
create sequence if not exists public.seq_sales_confirmation_no start 1;

-- 3) Sales confirmations
create table if not exists public."tbl_Sales_Confirmation" (
  id                uuid primary key default gen_random_uuid(),
  confirmation_no   text not null unique
                    default ('SC-' || lpad(nextval('public.seq_sales_confirmation_no')::text, 6, '0')),
  confirmation_date date not null default current_date,
  customer_id       uuid not null
                    references public."tbl_Customer_Sync"(id)
                    on update cascade on delete restrict,
  po_number         text,
  description       text not null,
  quantity          numeric(14,2) not null check (quantity > 0),
  unit_price        numeric(14,2) not null check (unit_price >= 0),
  total_amount      numeric(16,2) generated always as (round(quantity * unit_price, 2)) stored,
  delivery_date     date,
  status            text not null default 'Draft'
                    check (status in ('Draft','Confirmed','Delivered','Cancelled')),
  remarks           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_sales_confirmation_customer on public."tbl_Sales_Confirmation"(customer_id);
create index if not exists idx_sales_confirmation_date     on public."tbl_Sales_Confirmation"(confirmation_date desc);

-- 4) Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_sales_confirmation_updated_at on public."tbl_Sales_Confirmation";
create trigger trg_sales_confirmation_updated_at
  before update on public."tbl_Sales_Confirmation"
  for each row execute function public.set_updated_at();

-- 5) Row Level Security
alter table public."tbl_Customer_Sync"      enable row level security;
alter table public."tbl_Sales_Confirmation" enable row level security;

drop policy if exists "customer_sync_read" on public."tbl_Customer_Sync";
create policy "customer_sync_read" on public."tbl_Customer_Sync"
  for select to authenticated using (true);

drop policy if exists "sales_confirmation_all" on public."tbl_Sales_Confirmation";
create policy "sales_confirmation_all" on public."tbl_Sales_Confirmation"
  for all to authenticated using (true) with check (true);

-- 6) Privileges (service_role bypasses RLS, so the sync function can write the mirror)
grant select                         on public."tbl_Customer_Sync"      to authenticated;
grant select, insert, update, delete on public."tbl_Sales_Confirmation" to authenticated;
grant usage on sequence public.seq_sales_confirmation_no                to authenticated;
grant all on public."tbl_Customer_Sync", public."tbl_Sales_Confirmation" to service_role;

-- ---------------------------------------------------------------------
-- OPTIONAL, local testing only: if the app has no login yet, uncomment
-- to let the anon key use these tables. Remove before going live.
-- ---------------------------------------------------------------------
-- grant select on public."tbl_Customer_Sync" to anon;
-- grant select, insert, update, delete on public."tbl_Sales_Confirmation" to anon;
-- grant usage on sequence public.seq_sales_confirmation_no to anon;
-- create policy "dev_customer_sync_read" on public."tbl_Customer_Sync" for select to anon using (true);
-- create policy "dev_sales_confirmation_all" on public."tbl_Sales_Confirmation" for all to anon using (true) with check (true);
