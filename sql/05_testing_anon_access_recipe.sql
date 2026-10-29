-- =====================================================================
-- TESTING ONLY. Run in: vitson-recipe -> SQL Editor, AFTER 04_recipe_module.sql.
-- Same stance as 03: your app currently talks to Supabase with the anon key, so the Recipe tab's
-- tables need anon policies too. Anyone holding the anon key can read and write these tables.
-- Replace with a real login before going live; drop the policies named dev_* to undo.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tbl_dyeing_steps','tbl_default_dyeing_procedure','tbl_Item_Sync','tbl_Item_Bound_Sync'] loop
    execute format('drop policy if exists "dev_read" on public.%I', t);
    execute format('create policy "dev_read" on public.%I for select to anon using (true)', t);
    execute format('grant select on public.%I to anon', t);
  end loop;

  foreach t in array array['tbl_default_dye_recipe','tbl_default_finishing_recipe','tbl_default_finishing_fabric_info',
                           'tbl_default_color_ref_recipe','tbl_temp_recipe','tbl_active_dye_recipe','tbl_active_finishing_recipe'] loop
    execute format('drop policy if exists "dev_all" on public.%I', t);
    execute format('create policy "dev_all" on public.%I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
  end loop;
end $$;

-- new color references are added from the job order form
drop policy if exists "dev_color_ref_insert" on public."tbl_color_ref";
create policy "dev_color_ref_insert" on public."tbl_color_ref" for insert to anon with check (true);
grant select, insert on public."tbl_color_ref" to anon;

-- dye volume ratio per job order and section
drop policy if exists "dev_all" on public."tbl_recipe_ratio";
create policy "dev_all" on public."tbl_recipe_ratio" for all to anon using (true) with check (true);
grant select, insert, update, delete on public."tbl_recipe_ratio" to anon;

grant usage, select on all sequences in schema public to anon;
grant execute on function public.recipe_find_finishing_info(bigint)          to anon;
grant execute on function public.recipe_load_group(bigint, smallint, bigint) to anon;
grant execute on function public.recipe_save_group(bigint, smallint, bigint) to anon;
grant execute on function public.recipe_finalize(bigint)                     to anon;
grant execute on function public.recipe_roll_weight(bigint)                  to anon;
grant execute on function public.recipe_body_weight(bigint)                  to anon;
grant execute on function public.recipe_body_roll_count(bigint)              to anon;
grant execute on function public.recipe_recalc_quantities(bigint, smallint)  to anon;
grant execute on function public.recipe_set_ratio(bigint, smallint, double precision) to anon;

-- ---------------------------------------------------------------------
-- Check: lists every app table that still has NO policy for the anon key (should return no rows).
-- ---------------------------------------------------------------------
select t.table_name as still_missing_anon_policy
from (values
  ('tbl_Customer_Sync'),('tbl_Alias_Sync'),('tbl_Fabric_Sync'),('tbl_tone_sync'),('tbl_dye_process_type_sync'),('tbl_Item_Sync'),('tbl_Item_Bound_Sync'),
  ('tbl_touch'),('tbl_reprocess_reasons'),('tbl_roll_type'),('tbl_color'),('tbl_color_ref'),('tbl_price_list'),('tbl_dyeing_steps'),('tbl_default_dyeing_procedure'),
  ('tbl_Sales_Confirmation'),('tbl_job_order'),('tbl_fabric_info'),('tbl_default_dye_recipe'),('tbl_default_finishing_recipe'),('tbl_default_finishing_fabric_info'),
  ('tbl_default_color_ref_recipe'),('tbl_temp_recipe'),('tbl_active_dye_recipe'),('tbl_active_finishing_recipe'),('tbl_recipe_ratio')
) as t(table_name)
where not exists (
  select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name and 'anon' = any(p.roles));
