-- =====================================================================
-- Run in: vitson-recipe  ->  SQL Editor, AFTER 01 and after the first
-- backfill has filled the *_sync tables.
-- OPTIONAL: you can create the same links by hand in the Table Editor
-- instead. The app itself does not depend on these FKs (it joins in the
-- browser), but the FKs keep the data honest.
-- =====================================================================

-- 1) Make the touch columns bigint so they match tbl_touch.id (Table Editor warns on int4 -> int8)
alter table public."tbl_job_order"
  alter column "1x1_touch_id" type bigint,
  alter column "cc_touch_id"  type bigint;

-- 2) tbl_price_list has no price column yet. The Job Order form uses one to suggest the unit price.
alter table public."tbl_price_list" add column if not exists price double precision;

-- 3) Foreign keys on tbl_job_order
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_dye_process_id_fkey;
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_fabric_id_fkey;
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_tone_id_fkey;
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_color_id_fkey;
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_reprocess_id_fkey;
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_body_touch_id_fkey;
alter table public."tbl_job_order" drop constraint if exists "tbl_job_order_1x1_touch_id_fkey";
alter table public."tbl_job_order" drop constraint if exists tbl_job_order_cc_touch_id_fkey;

alter table public."tbl_job_order"
  add constraint tbl_job_order_dye_process_id_fkey foreign key (dye_process_id) references public."tbl_dye_process_type_sync"(id),
  add constraint tbl_job_order_fabric_id_fkey      foreign key (fabric_id)      references public."tbl_Fabric_Sync"(id),
  add constraint tbl_job_order_tone_id_fkey        foreign key (tone_id)        references public."tbl_tone_sync"(id),
  add constraint tbl_job_order_color_id_fkey       foreign key (color_id)       references public."tbl_color"(id),
  add constraint tbl_job_order_reprocess_id_fkey   foreign key (reprocess_id)   references public."tbl_reprocess_reasons"(id),
  add constraint tbl_job_order_body_touch_id_fkey  foreign key (body_touch_id)  references public."tbl_touch"(id),
  add constraint "tbl_job_order_1x1_touch_id_fkey" foreign key ("1x1_touch_id") references public."tbl_touch"(id),
  add constraint tbl_job_order_cc_touch_id_fkey    foreign key (cc_touch_id)    references public."tbl_touch"(id);

-- 4) Foreign keys on tbl_price_list
alter table public."tbl_price_list" drop constraint if exists tbl_price_list_tone_id_fkey;
alter table public."tbl_price_list" drop constraint if exists tbl_price_list_dye_process_id_fkey;
alter table public."tbl_price_list" drop constraint if exists tbl_price_list_fabric_id_fkey;

alter table public."tbl_price_list"
  add constraint tbl_price_list_tone_id_fkey        foreign key (tone_id)        references public."tbl_tone_sync"(id),
  add constraint tbl_price_list_dye_process_id_fkey foreign key (dye_process_id) references public."tbl_dye_process_type_sync"(id),
  add constraint tbl_price_list_fabric_id_fkey      foreign key (fabric_id)      references public."tbl_Fabric_Sync"(id);

-- 5) Fabric info rows belong to a job order; keep lookups fast
create index if not exists idx_fabric_info_job_order on public."tbl_fabric_info"(job_order_id);
create index if not exists idx_job_order_sales        on public."tbl_job_order"(sales_id);
