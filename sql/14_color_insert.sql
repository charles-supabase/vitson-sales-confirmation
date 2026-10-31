-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Idempotent.
-- tbl_color had read policies only, so saving a NEW color from the job order form was refused (row level security).
-- Same two policies tbl_color_ref already has: one for authenticated, one TESTING one for anon (13_lock_down.sql turns both
-- into "valid session required" if you run it after this file).
-- =====================================================================
drop policy if exists "color_insert" on public."tbl_color";
create policy "color_insert" on public."tbl_color" for insert to authenticated with check (true);
drop policy if exists "dev_color_insert" on public."tbl_color";
create policy "dev_color_insert" on public."tbl_color" for insert to anon with check (true);
