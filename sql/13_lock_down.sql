-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor, ONLY AFTER 12_app_users.sql, the deployed Edge Function and a successful login test.
-- User access control, part 2: every table policy (the TESTING anon ones and the authenticated ones) now requires a valid
-- session token (x-app-token). The recipe tables also require the "recipe" module.
-- Without a token the anon key reads and writes nothing.  Undo: 13_undo_lock_down.sql.
-- =====================================================================
do $$
declare
  r record;
  expr text;
  recipe_tables text[] := array['tbl_temp_recipe','tbl_active_dye_recipe','tbl_active_finishing_recipe','tbl_recipe_ratio',
                                'tbl_default_dye_recipe','tbl_default_finishing_fabric_info','tbl_default_finishing_recipe','tbl_default_color_ref_recipe'];
begin
  for r in
    select c.relname as tbl, p.polname, p.polcmd
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname not in ('tbl_app_user','tbl_app_session','tbl_app_login_attempt')
  loop
    expr := case when r.tbl = any (recipe_tables) then '(select public.app_can(''recipe''))' else '(select public.app_can())' end;
    if r.polcmd = 'a' then
      execute format('alter policy %I on public.%I with check (%s)', r.polname, r.tbl, expr);
    elsif r.polcmd in ('r', 'd') then
      execute format('alter policy %I on public.%I using (%s)', r.polname, r.tbl, expr);
    else  -- 'w' update and '*' all
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.polname, r.tbl, expr, expr);
    end if;
  end loop;
end $$;
