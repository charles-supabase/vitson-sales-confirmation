-- =====================================================================
-- Run in: vitson-recipe -> SQL Editor.  Idempotent.
-- "copied" goes back to false on EVERY update of a delivery (not only when a business column differs),
-- unless the update itself sets copied (the copy process setting it to true is left alone).
-- Delivered rolls inserted, changed or deleted already reset it (trg_delivery_rolls_copied, file 08).
-- =====================================================================
create or replace function public.delivery_reset_copied()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.copied := false;
  elsif new.copied is not distinct from old.copied then
    new.copied := false;   -- the update did not touch copied itself, so the record counts as changed
  end if;
  return new;
end $$;
-- the triggers from 08 keep pointing at this function; nothing else to change
