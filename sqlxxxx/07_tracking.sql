-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Tracking view.
-- tbl_tracking had the stage dates but no machine columns, and neither tbl_tracking nor tbl_machine had
-- any row level security policy.
-- =====================================================================

-- 1) One machine per stage (the dropdowns are filtered by tbl_machine.machine_type:
--    Hydro 3, Dryer 2, Heatset 11 and 10, Packed 32)
alter table public."tbl_tracking"
  add column if not exists machine_hydro_id   bigint references public."tbl_machine"(id),
  add column if not exists machine_dryer_id   bigint references public."tbl_machine"(id),
  add column if not exists machine_heatset_id bigint references public."tbl_machine"(id),
  add column if not exists machine_packed_id  bigint references public."tbl_machine"(id);

-- 2) One tracking record per job order
create unique index if not exists uq_tracking_job_order on public."tbl_tracking"(job_order_id) where job_order_id is not null;

-- 3) Policies for the authenticated role
alter table public."tbl_machine"  enable row level security;
alter table public."tbl_tracking" enable row level security;

drop policy if exists "lookup_read" on public."tbl_machine";
create policy "lookup_read" on public."tbl_machine" for select to authenticated using (true);
grant select on public."tbl_machine" to authenticated;

drop policy if exists "entry_all" on public."tbl_tracking";
create policy "entry_all" on public."tbl_tracking" for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public."tbl_tracking" to authenticated;

-- 4) TESTING ONLY: the app currently connects with the anon key (same stance as 03, 05 and 06).
--    Anyone holding the anon key can read and write these tables. Drop the dev_* policies to undo.
drop policy if exists "dev_read" on public."tbl_machine";
create policy "dev_read" on public."tbl_machine" for select to anon using (true);
grant select on public."tbl_machine" to anon;

drop policy if exists "dev_all" on public."tbl_tracking";
create policy "dev_all" on public."tbl_tracking" for all to anon using (true) with check (true);
grant select, insert, update, delete on public."tbl_tracking" to anon;

grant usage, select on all sequences in schema public to anon;

-- 5) Tracking summary: total roll weight per dye process for the job orders whose date_hydro falls in a period.
--    (one tracking row per job order, so every roll is counted once)
create or replace function public.tracking_weight_summary(p_from date, p_to date)
returns table (dye_process_id bigint, job_orders bigint, total_weight double precision)
language sql
stable
set search_path = public
as $$
  select jo.dye_process_id,
         count(distinct t.job_order_id) as job_orders,
         coalesce(sum(f.roll_wt), 0)::double precision as total_weight
  from public."tbl_tracking" t
  join public."tbl_job_order" jo on jo.id = t.job_order_id
  left join public."tbl_fabric_info" f on f.job_order_id = jo.id
  where t.date_hydro between p_from and p_to
  group by jo.dye_process_id
  order by jo.dye_process_id;
$$;
grant execute on function public.tracking_weight_summary(date, date) to authenticated, anon;
