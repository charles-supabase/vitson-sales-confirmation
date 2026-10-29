-- Run in: vitson-recipe -> SQL Editor. TESTING ONLY (same stance as 03 and 05).
-- Fills the two gaps found in your database: tbl_recipe_ratio has no anon policy, and tbl_color_ref
-- can be read by the anon key but not inserted into.
drop policy if exists "dev_all" on public."tbl_recipe_ratio";
create policy "dev_all" on public."tbl_recipe_ratio" for all to anon using (true) with check (true);
grant select, insert, update, delete on public."tbl_recipe_ratio" to anon;

drop policy if exists "dev_color_ref_insert" on public."tbl_color_ref";
create policy "dev_color_ref_insert" on public."tbl_color_ref" for insert to anon with check (true);
grant select, insert on public."tbl_color_ref" to anon;

grant usage, select on all sequences in schema public to anon;
