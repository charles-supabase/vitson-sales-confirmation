-- =====================================================================
-- TESTING ONLY. Run in: vitson-recipe -> SQL Editor.
-- All existing policies are for the `authenticated` role (a Supabase Auth login).
-- If the app connects with just the anon key (no Supabase Auth session), every
-- list comes back empty. This lets the anon key read and write the entry tables
-- so you can confirm that is the cause. Anyone holding the anon key can then
-- read and write these tables, so replace it with a real login before going live.
-- To undo: drop the policies named dev_* and revoke the grants below.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['tbl_Customer_Sync','tbl_Alias_Sync','tbl_Fabric_Sync','tbl_tone_sync',
                           'tbl_dye_process_type_sync','tbl_touch','tbl_reprocess_reasons','tbl_roll_type',
                           'tbl_color','tbl_color_ref','tbl_price_list'] loop
    execute format('drop policy if exists "dev_read" on public.%I', t);
    execute format('create policy "dev_read" on public.%I for select to anon using (true)', t);
    execute format('grant select on public.%I to anon', t);
  end loop;

  foreach t in array array['tbl_Sales_Confirmation','tbl_job_order','tbl_fabric_info'] loop
    execute format('drop policy if exists "dev_all" on public.%I', t);
    execute format('create policy "dev_all" on public.%I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon', t);
  end loop;
end $$;

-- Inserts rely on the id sequences of the identity columns
grant usage, select on all sequences in schema public to anon;
