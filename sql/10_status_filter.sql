-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Idempotent.
-- Status filters (the "Status filter" pop-up of Job Orders and of the Tracking summary).
-- p_cond is a JSON object; every key is optional: true = the date IS filled in, false = it is NOT.
--   recipe   tbl_job_order.date_recipe       hydro    tbl_tracking.date_hydro
--   dryer    tbl_tracking.date_dryer         heatset  tbl_tracking."date_Heatset"
--   packed   tbl_tracking.date_packed        delivered tbl_Delivery.date_delivery
-- Example: {"hydro": true, "delivered": false} = hydro done, not delivered yet.
-- =====================================================================

-- 1) Job orders that match the conditions (newest first, at most 5000 ids)
create or replace function public.job_order_status_ids(p_cond jsonb default '{}'::jsonb)
returns setof bigint
language sql
stable
set search_path = public
as $$
  select jo.id
  from public."tbl_job_order" jo
  left join public."tbl_tracking" t on t.job_order_id = jo.id
  left join public."tbl_Delivery" d on d.job_order_id = jo.id
  where ((p_cond->>'recipe')    is null or (jo.date_recipe   is not null) = (p_cond->>'recipe')::boolean)
    and ((p_cond->>'hydro')     is null or (t.date_hydro     is not null) = (p_cond->>'hydro')::boolean)
    and ((p_cond->>'dryer')     is null or (t.date_dryer     is not null) = (p_cond->>'dryer')::boolean)
    and ((p_cond->>'heatset')   is null or (t."date_Heatset" is not null) = (p_cond->>'heatset')::boolean)
    and ((p_cond->>'packed')    is null or (t.date_packed    is not null) = (p_cond->>'packed')::boolean)
    and ((p_cond->>'delivered') is null or (d.date_delivery  is not null) = (p_cond->>'delivered')::boolean)
  order by jo.date_job_order desc nulls last, jo.id desc
  limit 5000;
$$;
grant execute on function public.job_order_status_ids(jsonb) to authenticated, anon;

-- 2) The tracking summary (weight per dye process for a Hydro date period), now with the same conditions.
--    The old two-argument version is replaced; calling it with two arguments still works.
drop function if exists public.tracking_weight_summary(date, date);
create or replace function public.tracking_weight_summary(p_from date, p_to date, p_cond jsonb default '{}'::jsonb)
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
  left join public."tbl_Delivery" d on d.job_order_id = jo.id
  left join public."tbl_fabric_info" f on f.job_order_id = jo.id
  where t.date_hydro between p_from and p_to
    and ((p_cond->>'recipe')    is null or (jo.date_recipe   is not null) = (p_cond->>'recipe')::boolean)
    and ((p_cond->>'dryer')     is null or (t.date_dryer     is not null) = (p_cond->>'dryer')::boolean)
    and ((p_cond->>'heatset')   is null or (t."date_Heatset" is not null) = (p_cond->>'heatset')::boolean)
    and ((p_cond->>'packed')    is null or (t.date_packed    is not null) = (p_cond->>'packed')::boolean)
    and ((p_cond->>'delivered') is null or (d.date_delivery  is not null) = (p_cond->>'delivered')::boolean)
  group by jo.dye_process_id
  order by jo.dye_process_id;
$$;
grant execute on function public.tracking_weight_summary(date, date, jsonb) to authenticated, anon;
