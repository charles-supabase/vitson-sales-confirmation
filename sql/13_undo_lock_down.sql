-- Emergency undo of 13_lock_down.sql: every policy is open again (the old TESTING state). Run in vitson-recipe -> SQL Editor.
do $$
declare r record;
begin
  for r in
    select c.relname as tbl, p.polname, p.polcmd
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname not in ('tbl_app_user','tbl_app_session','tbl_app_login_attempt')
  loop
    if r.polcmd = 'a' then execute format('alter policy %I on public.%I with check (true)', r.polname, r.tbl);
    elsif r.polcmd in ('r', 'd') then execute format('alter policy %I on public.%I using (true)', r.polname, r.tbl);
    else execute format('alter policy %I on public.%I using (true) with check (true)', r.polname, r.tbl);
    end if;
  end loop;
end $$;
