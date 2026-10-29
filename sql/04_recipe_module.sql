-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Recipe tab: fixes, policies, functions.
-- Order of use: run this file first, then (testing only) 05_testing_anon_access_recipe.sql.
-- =====================================================================

-- 1) tbl_default_finishing_recipe.finishing_fabric_id has TWO foreign keys: one to
--    tbl_default_finishing_fabric_info (correct) and a leftover one to
--    tbl_default_dyeing_procedure. With both, a row can only be saved when the same id exists in
--    BOTH tables, so every finishing default would fail. Drop the leftover one.
alter table public."tbl_default_finishing_recipe"
  drop constraint if exists tbl_default_finishing_recipe_dyeing_procedure_id_fkey;

-- 2) tbl_temp_recipe needs to remember where each row came from, so "Save" can update the
--    default row it was copied from instead of adding a duplicate.
--      source_id        = id of the default recipe row this row was copied from (null = added by hand)
--      source_parent_id = dyeing_procedure_id (group 1) / finishing_fabric_id (group 2) / color_ref_id (group 3)
alter table public."tbl_temp_recipe"
  add column if not exists source_id bigint,
  add column if not exists source_parent_id bigint,
  add column if not exists average_price double precision;   -- looked up from tbl_Item_Sync when a row is appended

alter table public."tbl_temp_recipe" drop constraint if exists tbl_temp_recipe_group_by_check;
alter table public."tbl_temp_recipe" add constraint tbl_temp_recipe_group_by_check check (group_by in (1, 2, 3));

create index if not exists idx_temp_recipe_job_group on public."tbl_temp_recipe"(job_order_id, group_by);
create index if not exists idx_active_dye_job        on public."tbl_active_dye_recipe"(job_order_id);
create index if not exists idx_active_finishing_job  on public."tbl_active_finishing_recipe"(job_order_id);

-- 3) Row level security policies (role: authenticated)
do $$
declare t text;
begin
  foreach t in array array['tbl_dyeing_steps','tbl_default_dyeing_procedure'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "lookup_read" on public.%I', t);
    execute format('create policy "lookup_read" on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  foreach t in array array['tbl_default_dye_recipe','tbl_default_finishing_recipe','tbl_default_finishing_fabric_info',
                           'tbl_default_color_ref_recipe','tbl_temp_recipe','tbl_active_dye_recipe','tbl_active_finishing_recipe'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "entry_all" on public.%I', t);
    execute format('create policy "entry_all" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 3b) The job order form can add a new color reference (tbl_color_ref): allow inserts
drop policy if exists "color_ref_insert" on public."tbl_color_ref";
create policy "color_ref_insert" on public."tbl_color_ref" for insert to authenticated with check (true);
grant select, insert on public."tbl_color_ref" to authenticated;

-- 3c) Dye volume ratio: one value per job order and recipe section (1 dye, 2 finishing, 3 color reference).
--     dye volume = total roll weight (tbl_fabric_info) x ratio
create table if not exists public."tbl_recipe_ratio" (
  id           bigint generated always as identity primary key,
  job_order_id bigint not null references public."tbl_job_order"(id) on delete cascade,
  group_by     smallint not null check (group_by in (1, 2, 3)),
  dye_ratio    double precision not null check (dye_ratio > 0),
  unique (job_order_id, group_by)
);
alter table public."tbl_recipe_ratio" enable row level security;
drop policy if exists "entry_all" on public."tbl_recipe_ratio";
create policy "entry_all" on public."tbl_recipe_ratio" for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public."tbl_recipe_ratio" to authenticated;

-- Date the recipe was last saved for the job order (set by recipe_finalize). The "Recipe" list shows job orders where it is NULL.
alter table public."tbl_job_order" add column if not exists date_recipe date;

-- The dye (1) and color reference (3) sections share ONE ratio, stored under group 1. Fold any group 3 rows in.
update public."tbl_recipe_ratio" r set group_by = 1
 where r.group_by = 3
   and not exists (select 1 from public."tbl_recipe_ratio" x where x.job_order_id = r.job_order_id and x.group_by = 1);
delete from public."tbl_recipe_ratio" where group_by = 3;

-- 4) Functions. They run with the caller's rights (RLS applies) and each call is ONE transaction,
--    so a half-finished save can't leave defaults in a broken state.

-- Finds the default finishing entry that matches ALL of the job order's fields.
-- tbl_default_finishing_fabric_info.touch_id is compared with the job order's BODY touch.
create or replace function public.recipe_find_finishing_info(p_job_order_id bigint)
returns bigint
language sql
stable
set search_path = public
as $$
  select f.id
  from public."tbl_job_order" jo
  join public."tbl_Sales_Confirmation" sc on sc.id = jo.sales_id
  join public."tbl_default_finishing_fabric_info" f
    on f.customer_id    = sc.customer_id
   and f.fabric_id      = jo.fabric_id
   and f.touch_id       = jo.body_touch_id
   and f.tone_id        = jo.tone_id
   and f.mercerize      = coalesce(jo.mercerize, false)
   and f.stock_no       = jo.stock_no
   and f.spi            = jo.spi
   and f.dye_process_id = jo.dye_process_id
  where jo.id = p_job_order_id
  order by f.id
  limit 1;
$$;

-- Rebuilds ONE group of tbl_temp_recipe for a job order from the saved defaults.
--   group 1: tbl_default_dye_recipe        (needs p_procedure_id)
--   group 2: tbl_default_finishing_recipe  (found through recipe_find_finishing_info)
--   group 3: tbl_default_color_ref_recipe  (job order's color_ref_id)
-- Total roll weight of a job order: every row of tbl_fabric_info (Body + 1x1 + Collar + Cuffs + others).
create or replace function public.recipe_roll_weight(p_job_order_id bigint)
returns double precision
language sql
stable
set search_path = public
as $$
  select coalesce(sum(roll_wt), 0)::double precision from public."tbl_fabric_info" where job_order_id = p_job_order_id;
$$;

-- Weight of the Body rolls only: tbl_fabric_info rows whose tbl_roll_type.roll_name is 'Body'.
create or replace function public.recipe_body_weight(p_job_order_id bigint)
returns double precision
language sql
stable
set search_path = public
as $$
  select coalesce(sum(f.roll_wt), 0)::double precision
  from public."tbl_fabric_info" f
  join public."tbl_roll_type" rt on rt.id = f.roll_type_id
  where f.job_order_id = p_job_order_id and lower(btrim(rt.roll_name)) = 'body';
$$;

-- Number of Body rolls (rows, not weight): the basis of the finishing volume.
create or replace function public.recipe_body_roll_count(p_job_order_id bigint)
returns bigint
language sql
stable
set search_path = public
as $$
  select count(*)
  from public."tbl_fabric_info" f
  join public."tbl_roll_type" rt on rt.id = f.roll_type_id
  where f.job_order_id = p_job_order_id and lower(btrim(rt.roll_name)) = 'body';
$$;

-- Recomputes quantity in tbl_temp_recipe for one group.
--   Volume:  dye (1) and color reference (3), which share ONE ratio stored under group 1:
--              volume = total weight of ALL rolls x dye volume ratio
--            finishing (2), which has its own "finishing volume ratio per roll":
--              volume = number of Body rolls x finishing volume ratio
--   grm is set         -> quantity = (grm x volume) / 1000
--   percent_OWF is set -> quantity = (percent_OWF x total weight of the BODY rolls only) / 100
-- Only one of grm / percent_OWF may be set on a row. Rows with neither keep their typed quantity, and nothing is
-- computed while its basis is missing (no ratio, or no rolls).
create or replace function public.recipe_recalc_quantities(p_job_order_id bigint, p_group smallint)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_weight double precision := public.recipe_roll_weight(p_job_order_id);
  v_body   double precision := public.recipe_body_weight(p_job_order_id);
  v_rolls  bigint           := public.recipe_body_roll_count(p_job_order_id);
  v_ratio  double precision;
  v_volume double precision;
begin
  select dye_ratio into v_ratio from public."tbl_recipe_ratio"
   where job_order_id = p_job_order_id and group_by = case when p_group = 3 then 1 else p_group end;
  -- no ratio stored for this job order: use the defaults (dye and color reference 8, finishing 15 per Body roll)
  v_ratio := coalesce(v_ratio, case when p_group = 2 then 15 else 8 end);
  if v_ratio is not null then
    if p_group = 2 then
      if v_rolls > 0 then v_volume := v_rolls * v_ratio; end if;
    elsif v_weight > 0 then
      v_volume := v_weight * v_ratio;
    end if;
  end if;

  if v_volume is not null then
    update public."tbl_temp_recipe" set quantity = (grm * v_volume) / 1000.0
     where job_order_id = p_job_order_id and group_by = p_group
       and item_id is not null and grm is not null and "percent_OWF" is null;
  end if;
  if v_body > 0 then
    update public."tbl_temp_recipe" set quantity = ("percent_OWF" * v_body) / 100.0
     where job_order_id = p_job_order_id and group_by = p_group
       and item_id is not null and "percent_OWF" is not null and grm is null;
  end if;
end $$;

-- Sets (or clears, with NULL = back to the default) a ratio and recomputes the quantities it affects.
-- Group 1 or 3 -> the shared dye / color reference ratio (both sections are recomputed).
-- Group 2      -> the finishing volume ratio per Body roll.
create or replace function public.recipe_set_ratio(p_job_order_id bigint, p_group smallint, p_ratio double precision)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_weight double precision;
  v_rolls  bigint;
  v_key    smallint := case when p_group = 3 then 1 else p_group end;
  v_eff    double precision := coalesce(p_ratio, case when p_group = 2 then 15 else 8 end);
begin
  if p_group not in (1, 2, 3) then raise exception 'Unknown recipe group %', p_group; end if;
  if not exists (select 1 from public."tbl_job_order" where id = p_job_order_id) then
    raise exception 'Job order % was not found', p_job_order_id;
  end if;
  if p_ratio is not null and p_ratio <= 0 then raise exception 'The ratio must be greater than 0.'; end if;

  if p_ratio is null then
    delete from public."tbl_recipe_ratio" where job_order_id = p_job_order_id and group_by = v_key;
  else
    insert into public."tbl_recipe_ratio" (job_order_id, group_by, dye_ratio) values (p_job_order_id, v_key, p_ratio)
    on conflict (job_order_id, group_by) do update set dye_ratio = excluded.dye_ratio;
  end if;

  if v_key = 1 then
    perform public.recipe_recalc_quantities(p_job_order_id, 1::smallint);
    perform public.recipe_recalc_quantities(p_job_order_id, 3::smallint);
  else
    perform public.recipe_recalc_quantities(p_job_order_id, v_key);
  end if;

  v_weight := public.recipe_roll_weight(p_job_order_id);
  v_rolls  := public.recipe_body_roll_count(p_job_order_id);
  return jsonb_build_object('weight', v_weight, 'body_weight', public.recipe_body_weight(p_job_order_id),
                            'body_rolls', v_rolls, 'ratio', v_eff,
                            'volume', case when v_key = 2 then v_rolls * v_eff else v_weight * v_eff end);
end $$;

create or replace function public.recipe_load_group(
  p_job_order_id bigint,
  p_group        smallint,
  p_procedure_id bigint default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  jo       public."tbl_job_order"%rowtype;
  v_parent bigint;
  v_rows   integer := 0;
  v_reason text;
begin
  if p_group not in (1, 2, 3) then raise exception 'Unknown recipe group %', p_group; end if;

  select * into jo from public."tbl_job_order" where id = p_job_order_id;
  if not found then raise exception 'Job order % was not found', p_job_order_id; end if;
  if not exists (select 1 from public."tbl_fabric_info" where job_order_id = p_job_order_id) then
    raise exception 'Add fabric info to this job order before creating a recipe.';
  end if;

  delete from public."tbl_temp_recipe" where job_order_id = p_job_order_id and group_by = p_group;

  if p_group = 1 then
    if p_procedure_id is null then raise exception 'Select a dye procedure first.'; end if;
    v_parent := p_procedure_id;
    insert into public."tbl_temp_recipe"
      (job_order_id, group_by, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order", average_price, source_id, source_parent_id)
    select p_job_order_id, 1, d.dyeing_steps_id, d.item_id, d.grm, d."percent_OWF", d.quantity, d."order", (select i.average_price from public."tbl_Item_Sync" i where i.id = d.item_id), d.id, v_parent
    from public."tbl_default_dye_recipe" d
    where d.dyeing_procedure_id = p_procedure_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then v_reason := 'no_default'; end if;

  elsif p_group = 2 then
    v_parent := public.recipe_find_finishing_info(p_job_order_id);
    if v_parent is null then
      v_reason := 'no_match';
    else
      insert into public."tbl_temp_recipe"
        (job_order_id, group_by, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order", average_price, source_id, source_parent_id)
      select p_job_order_id, 2, d.dyeing_steps_id, d.item_id, d.grm, d."percent_OWF", d.quantity, d."order", (select i.average_price from public."tbl_Item_Sync" i where i.id = d.item_id), d.id, v_parent
      from public."tbl_default_finishing_recipe" d
      where d.finishing_fabric_id = v_parent;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_reason := 'no_default'; end if;
    end if;

  else
    v_parent := jo.color_ref_id;
    if v_parent is null then
      v_reason := 'no_color_ref';
    else
      insert into public."tbl_temp_recipe"
        (job_order_id, group_by, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order", average_price, source_id, source_parent_id)
      select p_job_order_id, 3, d.dyeing_steps_id, d.item_id, d.grm, d."percent_OWF", d.quantity, d."order", (select i.average_price from public."tbl_Item_Sync" i where i.id = d.item_id), d.id, v_parent
      from public."tbl_default_color_ref_recipe" d
      where d.color_ref_id = v_parent;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then v_reason := 'no_default'; end if;
    end if;
  end if;

  perform public.recipe_recalc_quantities(p_job_order_id, p_group);

  return jsonb_build_object('group', p_group, 'parent_id', v_parent, 'rows', v_rows, 'reason', v_reason);
end $$;

-- Saves ONE group of tbl_temp_recipe back to its default table.
--   Rows copied from a default (source_id set) UPDATE that default row; rows added by hand are INSERTED;
--   default rows that were deleted from the temp list are removed, so the default matches the list.
--   Group 2 creates a tbl_default_finishing_fabric_info entry first when no match exists.
create or replace function public.recipe_save_group(
  p_job_order_id bigint,
  p_group        smallint,
  p_procedure_id bigint default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  jo        public."tbl_job_order"%rowtype;
  r         public."tbl_temp_recipe"%rowtype;
  v_cust    bigint;
  v_parent  bigint;
  v_created boolean := false;
  v_table   text;
  v_pcol    text;
  v_count   integer;
  v_ins     integer := 0;
  v_upd     integer := 0;
  v_del     integer := 0;
  v_new     bigint;
  v_missing text[];
begin
  if p_group not in (1, 2, 3) then raise exception 'Unknown recipe group %', p_group; end if;

  select * into jo from public."tbl_job_order" where id = p_job_order_id;
  if not found then raise exception 'Job order % was not found', p_job_order_id; end if;
  if not exists (select 1 from public."tbl_fabric_info" where job_order_id = p_job_order_id) then
    raise exception 'Add fabric info to this job order before creating a recipe.';
  end if;

  select count(*) into v_count from public."tbl_temp_recipe" where job_order_id = p_job_order_id and group_by = p_group;
  if v_count = 0 then raise exception 'There are no rows in this section to save.'; end if;

  if exists (select 1 from public."tbl_temp_recipe"
             where job_order_id = p_job_order_id and group_by = p_group and dyeing_steps_id is null) then
    raise exception 'Every row needs a dyeing step.';
  end if;

  -- A blank (spacing) row keeps its step and its order (the order says where the blank row sits);
  -- item, grm, percent_OWF, quantity and average_price are NULL.
  update public."tbl_temp_recipe"
     set grm = null, "percent_OWF" = null, quantity = null, average_price = null
   where job_order_id = p_job_order_id and group_by = p_group and item_id is null;

  if exists (select 1 from public."tbl_temp_recipe"
             where job_order_id = p_job_order_id and group_by = p_group and grm is not null and "percent_OWF" is not null) then
    raise exception 'A row can have a Grm or a percent OWF, not both.';
  end if;
  perform public.recipe_recalc_quantities(p_job_order_id, p_group);

  if p_group = 1 then
    v_parent := coalesce(p_procedure_id, (
      select source_parent_id from public."tbl_temp_recipe"
      where job_order_id = p_job_order_id and group_by = 1 and source_parent_id is not null
      order by id limit 1));
    if v_parent is null then raise exception 'Select a dye procedure first.'; end if;
    v_table := 'tbl_default_dye_recipe';
    v_pcol  := 'dyeing_procedure_id';

  elsif p_group = 2 then
    v_parent := public.recipe_find_finishing_info(p_job_order_id);
    if v_parent is null then
      select customer_id into v_cust from public."tbl_Sales_Confirmation" where id = jo.sales_id;
      v_missing := array_remove(array[
        case when v_cust is null              then 'customer'   end,
        case when jo.fabric_id is null        then 'fabric'     end,
        case when jo.body_touch_id is null    then 'body touch' end,
        case when jo.tone_id is null          then 'tone'       end,
        case when jo.stock_no is null         then 'stock no.'  end,
        case when jo.spi is null              then 'SPI'        end,
        case when jo.dye_process_id is null   then 'dye process' end
      ], null);
      if coalesce(array_length(v_missing, 1), 0) > 0 then
        raise exception 'The job order is missing: %. Complete it before saving a finishing default.', array_to_string(v_missing, ', ');
      end if;
      insert into public."tbl_default_finishing_fabric_info"
        (customer_id, fabric_id, touch_id, tone_id, mercerize, stock_no, spi, dye_process_id)
      values
        (v_cust, jo.fabric_id, jo.body_touch_id, jo.tone_id, coalesce(jo.mercerize, false), jo.stock_no, jo.spi, jo.dye_process_id)
      returning id into v_parent;
      v_created := true;
    end if;
    v_table := 'tbl_default_finishing_recipe';
    v_pcol  := 'finishing_fabric_id';

  else
    v_parent := jo.color_ref_id;
    if v_parent is null then raise exception 'Select a color reference on the job order first.'; end if;
    v_table := 'tbl_default_color_ref_recipe';
    v_pcol  := 'color_ref_id';
  end if;

  -- remove default rows that are no longer in the list
  execute format($q$
    delete from public.%I d
    where d.%I = $1
      and not exists (
        select 1 from public."tbl_temp_recipe" t
        where t.job_order_id = $2 and t.group_by = $3 and t.source_id = d.id and t.source_parent_id = $1)
  $q$, v_table, v_pcol) using v_parent, p_job_order_id, p_group;
  get diagnostics v_del = row_count;

  -- update default rows this list was copied from
  execute format($q$
    update public.%I d
       set dyeing_steps_id = t.dyeing_steps_id, item_id = t.item_id, grm = t.grm,
           "percent_OWF" = t."percent_OWF", quantity = t.quantity, "order" = t."order"
      from public."tbl_temp_recipe" t
     where t.job_order_id = $1 and t.group_by = $2
       and t.source_id = d.id and t.source_parent_id = $3 and d.%I = $3
  $q$, v_table, v_pcol) using p_job_order_id, p_group, v_parent;
  get diagnostics v_upd = row_count;

  -- insert rows added by hand (or copied from a different default)
  for r in
    select * from public."tbl_temp_recipe" t
    where t.job_order_id = p_job_order_id and t.group_by = p_group
      and (t.source_id is null or t.source_parent_id is distinct from v_parent)
    order by t.id
  loop
    execute format($q$
      insert into public.%I (%I, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order")
      values ($1, $2, $3, $4, $5, $6, $7) returning id
    $q$, v_table, v_pcol)
    into v_new
    using v_parent, r.dyeing_steps_id, r.item_id, r.grm, r."percent_OWF", r.quantity, r."order";
    update public."tbl_temp_recipe" set source_id = v_new where id = r.id;
    v_ins := v_ins + 1;
  end loop;

  update public."tbl_temp_recipe" set source_parent_id = v_parent
  where job_order_id = p_job_order_id and group_by = p_group;

  return jsonb_build_object('group', p_group, 'parent_id', v_parent, 'inserted', v_ins,
                            'updated', v_upd, 'deleted', v_del, 'created_parent', v_created);
end $$;

-- Final save: copy groups 1 and 3 to tbl_active_dye_recipe and group 2 to tbl_active_finishing_recipe,
-- replacing whatever was active for the job order.
create or replace function public.recipe_finalize(p_job_order_id bigint)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_dye integer;
  v_fin integer;
begin
  if not exists (select 1 from public."tbl_job_order" where id = p_job_order_id) then
    raise exception 'Job order % was not found', p_job_order_id;
  end if;
  if not exists (select 1 from public."tbl_fabric_info" where job_order_id = p_job_order_id) then
    raise exception 'Add fabric info to this job order before creating a recipe.';
  end if;
  if not exists (select 1 from public."tbl_temp_recipe" where job_order_id = p_job_order_id) then
    raise exception 'There is no recipe to save.';
  end if;
  if exists (select 1 from public."tbl_temp_recipe"
             where job_order_id = p_job_order_id and dyeing_steps_id is null) then
    raise exception 'Every row needs a dyeing step.';
  end if;

  -- blank rows (no item) keep their step and order only
  update public."tbl_temp_recipe"
     set grm = null, "percent_OWF" = null, quantity = null, average_price = null
   where job_order_id = p_job_order_id and item_id is null;

  if exists (select 1 from public."tbl_temp_recipe"
             where job_order_id = p_job_order_id and grm is not null and "percent_OWF" is not null) then
    raise exception 'A row can have a Grm or a percent OWF, not both.';
  end if;
  perform public.recipe_recalc_quantities(p_job_order_id, 1::smallint);
  perform public.recipe_recalc_quantities(p_job_order_id, 2::smallint);
  perform public.recipe_recalc_quantities(p_job_order_id, 3::smallint);

  delete from public."tbl_active_dye_recipe"       where job_order_id = p_job_order_id;
  delete from public."tbl_active_finishing_recipe" where job_order_id = p_job_order_id;

  -- average_price was looked up when the row was appended to tbl_temp_recipe; it is copied, not looked up again
  insert into public."tbl_active_dye_recipe"
    (job_order_id, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order", average_price)
  select t.job_order_id, t.dyeing_steps_id, t.item_id, t.grm, t."percent_OWF", t.quantity, t."order",
         t.average_price
  from public."tbl_temp_recipe" t
  where t.job_order_id = p_job_order_id and t.group_by in (1, 3)
  order by t.group_by, t.id;
  get diagnostics v_dye = row_count;

  insert into public."tbl_active_finishing_recipe"
    (job_order_id, dyeing_steps_id, item_id, grm, "percent_OWF", quantity, "order", average_price)
  select t.job_order_id, t.dyeing_steps_id, t.item_id, t.grm, t."percent_OWF", t.quantity, t."order",
         t.average_price
  from public."tbl_temp_recipe" t
  where t.job_order_id = p_job_order_id and t.group_by = 2
  order by t.id;
  get diagnostics v_fin = row_count;

  update public."tbl_job_order" set date_recipe = current_date where id = p_job_order_id;

  return jsonb_build_object('dye', v_dye, 'finishing', v_fin);
end $$;

grant execute on function public.recipe_find_finishing_info(bigint)            to authenticated;
grant execute on function public.recipe_load_group(bigint, smallint, bigint)   to authenticated;
grant execute on function public.recipe_save_group(bigint, smallint, bigint)   to authenticated;
grant execute on function public.recipe_finalize(bigint)                       to authenticated;
grant execute on function public.recipe_roll_weight(bigint)                    to authenticated;
grant execute on function public.recipe_body_weight(bigint)                    to authenticated;
grant execute on function public.recipe_body_roll_count(bigint)                to authenticated;
grant execute on function public.recipe_recalc_quantities(bigint, smallint)    to authenticated;
grant execute on function public.recipe_set_ratio(bigint, smallint, double precision) to authenticated;
