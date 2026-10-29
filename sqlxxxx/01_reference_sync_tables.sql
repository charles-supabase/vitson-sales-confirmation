-- =====================================================================
-- Run in: vitson-recipe  ->  SQL Editor
-- Creates the read-only mirrors of charles-supabase's reference tables,
-- named <source table> + _Sync (tbl_Customer_Sync already exists):
--   tbl_Alias              -> tbl_Alias_Sync
--   tbl_Fabric             -> tbl_Fabric_Sync
--   tbl_tone               -> tbl_tone_sync
--   tbl_dye_process_type   -> tbl_dye_process_type_sync
-- Column names and types match the source (ids are bigint, no identity),
-- plus is_active / synced_at, same as tbl_Customer_Sync.
-- =====================================================================

create table if not exists public."tbl_Alias_Sync" (
  id                  bigint primary key,
  alias_name          text not null,
  "TIN_number"        bigint,
  associated_customer text,
  alias_address       text,
  is_active           boolean not null default true,
  synced_at           timestamptz not null default now()
);

create table if not exists public."tbl_Fabric_Sync" (
  id          bigint primary key,
  fabric_name text not null,
  is_active   boolean not null default true,
  synced_at   timestamptz not null default now()
);

create table if not exists public."tbl_tone_sync" (
  id         bigint primary key,
  tone_name  text not null,
  tone_code  text,
  is_active  boolean not null default true,
  synced_at  timestamptz not null default now()
);

create table if not exists public."tbl_dye_process_type_sync" (
  id               bigint primary key,
  dye_process_name text not null,
  is_active        boolean not null default true,
  synced_at        timestamptz not null default now()
);

comment on table public."tbl_Alias_Sync"            is 'Read-only mirror of tbl_Alias (charles-supabase). Written only by the sync-reference-data Edge Function.';
comment on table public."tbl_Fabric_Sync"           is 'Read-only mirror of tbl_Fabric (charles-supabase). Written only by the sync-reference-data Edge Function.';
comment on table public."tbl_tone_sync"             is 'Read-only mirror of tbl_tone (charles-supabase). Written only by the sync-reference-data Edge Function.';
comment on table public."tbl_dye_process_type_sync" is 'Read-only mirror of tbl_dye_process_type (charles-supabase). Written only by the sync-reference-data Edge Function.';

-- RLS + privileges for the four mirrors (service_role bypasses RLS for the sync)
do $$
declare t text;
begin
  foreach t in array array['tbl_Alias_Sync','tbl_Fabric_Sync','tbl_tone_sync','tbl_dye_process_type_sync'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "sync_read" on public.%I', t);
    execute format('create policy "sync_read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- =====================================================================
-- Policies for the tables you created by hand. RLS is ON for them but no
-- policy exists yet, so the app would read and write nothing.
-- Lookup tables: read-only. Entry tables: full access.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tbl_touch','tbl_reprocess_reasons','tbl_roll_type','tbl_color','tbl_color_ref','tbl_price_list'] loop
    execute format('drop policy if exists "lookup_read" on public.%I', t);
    execute format('create policy "lookup_read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  foreach t in array array['tbl_job_order','tbl_fabric_info'] loop
    execute format('drop policy if exists "entry_all" on public.%I', t);
    execute format('create policy "entry_all" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- IMPORTANT: every policy above (and the existing ones on
-- tbl_Customer_Sync / tbl_Sales_Confirmation) targets the `authenticated`
-- role, i.e. a Supabase Auth login. Your Vitson login is custom (tbl_User),
-- so if this app calls Supabase with the anon key and no Supabase Auth
-- session, nothing will load. Either route the app through a Supabase Auth
-- session, or (testing only) grant the same to `anon`:
--   create policy "dev_all" on public."tbl_job_order" for all to anon using (true) with check (true);
--   grant select, insert, update, delete on public."tbl_job_order" to anon;   -- repeat per table
-- ---------------------------------------------------------------------
