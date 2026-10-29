-- =====================================================================
-- CRM: Supabase'da yetishmayotgan jadval va ustunlar
-- Supabase -> SQL Editor ga to'liq qo'yib, "Run" bosing.
-- Qayta ishga tushirsa ham xato bermaydi (if not exists).
-- =====================================================================
begin;

-- 0. yangilangan_at ni avtomatik yangilaydigan funksiya
create or replace function public.crm_yangilangan_at()
returns trigger
language plpgsql
as $$
begin
  new.yangilangan_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. MIJOZ BUYURTMALARI  (Buyurtmalar sahifasi)
--    localStorage: crm_customer_orders_v1   (src/data/ordersStore.js)
-- ---------------------------------------------------------------------
create table if not exists public.buyurtmalar (
  id                   uuid primary key default gen_random_uuid(),
  dokon_id             uuid not null references public.dokonlar(id) on delete cascade,
  ilova_id             text,                              -- ilovadagi order.id
  buyurtma_raqami      text not null,                     -- "B-123456"
  holat                text not null default 'reserved',  -- reserved / ...
  mijoz_ismi           text,
  mijoz_telefon        text,
  xodim_id             bigint references public.xodimlar(id) on delete set null,
  xodim_ismi           text,
  mahsulotlar          jsonb not null default '[]'::jsonb, -- cart
  chegirma_foiz        numeric(5,2) not null default 0,
  oraliq_summa         bigint not null default 0,
  chegirma_summa       bigint not null default 0,
  jami_summa           bigint not null default 0,
  yetkazish_manzili    text,
  yetkazish_manzillari jsonb not null default '[]'::jsonb,
  manzil_tasdiqlangan  boolean not null default false,
  ochilgan_at          timestamptz,
  yaratilgan_at        timestamptz not null default now(),
  yangilangan_at       timestamptz not null default now(),
  malumot              jsonb not null default '{}'::jsonb,
  unique (dokon_id, ilova_id)
);
create index if not exists buyurtmalar_dokon_holat_idx on public.buyurtmalar (dokon_id, holat);

-- ---------------------------------------------------------------------
-- 2. QORALAMALAR  (Qoralama sahifasi)
--    localStorage: crm_notes_drafts_v1        -> turi = 'eslatma'
--                  crm_saved_sale_drafts_v1   -> turi = 'sotuv'
-- ---------------------------------------------------------------------
create table if not exists public.qoralamalar (
  id             uuid primary key default gen_random_uuid(),
  dokon_id       uuid not null references public.dokonlar(id) on delete cascade,
  ilova_id       text,
  turi           text not null check (turi in ('eslatma', 'sotuv')),
  sarlavha       text,                                   -- eslatma uchun
  matn           text,                                   -- eslatma uchun
  qadalgan       boolean not null default false,         -- pinned
  mijoz_ismi     text,                                   -- sotuv qoralamasi uchun
  mijoz_telefon  text,
  mahsulotlar    jsonb not null default '[]'::jsonb,     -- cart
  xodim_id       bigint references public.xodimlar(id) on delete set null,
  yaratilgan_at  timestamptz not null default now(),
  yangilangan_at timestamptz not null default now(),
  malumot        jsonb not null default '{}'::jsonb,
  unique (dokon_id, ilova_id)
);
create index if not exists qoralamalar_dokon_turi_idx on public.qoralamalar (dokon_id, turi);

-- ---------------------------------------------------------------------
-- 3. TA'MINOTCHIDAN QABUL QILINGAN TOVARLAR (kirimlar)
--    localStorage: crm_supplier_receipts  (REC-... yozuvlar)
--    ProductDetail va Moliya sahifalari shundan o'qiydi.
-- ---------------------------------------------------------------------
create table if not exists public.taminot_kirimlari (
  id              bigint generated always as identity primary key,
  dokon_id        uuid not null references public.dokonlar(id) on delete cascade,
  ilova_id        text,                                  -- "REC-1790..."
  taminotchi_id   bigint references public.taminotchilar(id) on delete set null,
  taminotchi_nomi text,
  buyurtma_id     text,                                  -- order.id (PO-...)
  mahsulotlar     jsonb not null default '[]'::jsonb,    -- [{id, quantity, cost}]
  summa           bigint not null default 0,
  sana            timestamptz not null default now(),
  yaratilgan_at   timestamptz not null default now(),
  malumot         jsonb not null default '{}'::jsonb,
  unique (dokon_id, ilova_id)
);
create index if not exists taminot_kirimlari_taminotchi_idx on public.taminot_kirimlari (dokon_id, taminotchi_id);

-- ---------------------------------------------------------------------
-- 4. QO'SHIMCHA KASSA (sales-pos sahifasi, "P-" raqamli cheklar)
--    localStorage: crm_additional_pos_sales, crm_additional_pos_customers
--    Alohida jadval o'rniga sotuvlar va mijozlar ga "kassa" ustuni.
-- ---------------------------------------------------------------------
alter table public.sotuvlar
  add column if not exists kassa text not null default 'asosiy'
    check (kassa in ('asosiy', 'qoshimcha')),
  add column if not exists buyurtma_id uuid
    references public.buyurtmalar(id) on delete set null;   -- sale.sourceOrderId

alter table public.mijozlar
  add column if not exists kassa text not null default 'asosiy'
    check (kassa in ('asosiy', 'qoshimcha'));

-- ---------------------------------------------------------------------
-- 5. DO'KON JONLI HOLATI VA XATOLIKLARI (Super Admin -> Live Monitoring)
--    localStorage: tenant_presence_v1  (src/super-admin/tenantPresence.js)
--    oxirgi_faollik ustuni dokonlar da allaqachon bor.
-- ---------------------------------------------------------------------
alter table public.dokonlar
  add column if not exists oxirgi_kirish      timestamptz,
  add column if not exists oxirgi_kirgan      jsonb,        -- {name, role}
  add column if not exists faol_foydalanuvchi jsonb,        -- {name, role}
  add column if not exists offline_at         timestamptz;

create table if not exists public.dokon_xatolar (
  id            uuid primary key default gen_random_uuid(),
  dokon_id      uuid not null references public.dokonlar(id) on delete cascade,
  xabar         text not null check (char_length(xabar) <= 300),
  manba         text check (char_length(manba) <= 120),
  soni          integer not null default 1,
  birinchi_at   timestamptz not null default now(),
  oxirgi_at     timestamptz not null default now(),
  hal_qilingan_at timestamptz
);
create index if not exists dokon_xatolar_ochiq_idx
  on public.dokon_xatolar (dokon_id) where hal_qilingan_at is null;

-- ---------------------------------------------------------------------
-- 6. SUPER ADMIN HISOBI
--    localStorage: super_admin_data_v1 -> account, profile, preferences, meta
--    (tenants -> dokonlar, tickets -> dokonlar.yordam_xabarlari: bor)
--    Parol ochiq saqlanmaydi: PBKDF2 xesh + salt (accessStore.js bilan bir xil).
-- ---------------------------------------------------------------------
create table if not exists public.super_admin (
  id               smallint primary key default 1 check (id = 1),  -- faqat bitta qator
  login            text not null unique,
  parol_hash       text not null,
  salt             text not null,
  parol_iteratsiya integer not null default 310000,
  profil           jsonb not null default '{}'::jsonb,
  sozlamalar       jsonb not null default '{}'::jsonb,   -- messagePopup, titleBadge, idleMinutes
  meta             jsonb not null default '{}'::jsonb,   -- lastLoginAt, previousLoginAt ...
  yaratilgan_at    timestamptz not null default now(),
  yangilangan_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. yangilangan_at triggerlari
-- ---------------------------------------------------------------------
drop trigger if exists buyurtmalar_yangilangan on public.buyurtmalar;
create trigger buyurtmalar_yangilangan before update on public.buyurtmalar
  for each row execute function public.crm_yangilangan_at();

drop trigger if exists qoralamalar_yangilangan on public.qoralamalar;
create trigger qoralamalar_yangilangan before update on public.qoralamalar
  for each row execute function public.crm_yangilangan_at();

drop trigger if exists super_admin_yangilangan on public.super_admin;
create trigger super_admin_yangilangan before update on public.super_admin
  for each row execute function public.crm_yangilangan_at();

-- ---------------------------------------------------------------------
-- 8. RLS: yangi jadvallar yopiq. Ruxsat siyosatlari login tizimi
--    (Supabase Auth yoki backend) ulanganda yoziladi.
-- ---------------------------------------------------------------------
alter table public.buyurtmalar       enable row level security;
alter table public.qoralamalar       enable row level security;
alter table public.taminot_kirimlari enable row level security;
alter table public.dokon_xatolar     enable row level security;
alter table public.super_admin       enable row level security;

commit;


-- =====================================================================
-- IXTIYORIY: XAVFSIZLIK (o'qib chiqib, keyin izohdan chiqarib ishlating)
-- =====================================================================

-- A) "parollar" jadvali va "xodimlar_parollar" view parollarni OCHIQ matnda
--    saqlaydi. Xodim paroli xodimlar.parol_hash da xesh holida allaqachon bor.
--    Avval kerakli ma'lumotni zaxiralang, keyin o'chiring:
-- drop view  if exists public.xodimlar_parollar;
-- drop table if exists public.parollar;

-- B) v_* view'lar sukut bo'yicha egasi (postgres) huquqi bilan ishlaydi va
--    jadvallardagi RLS'ni chetlab o'tadi. RLS ishlashi uchun:
-- alter view public.v_chiqim_kategoriyalari set (security_invoker = true);
-- alter view public.v_dashboard             set (security_invoker = true);
-- alter view public.v_kam_qolgan_mahsulotlar set (security_invoker = true);
-- alter view public.v_kunlik_savdo          set (security_invoker = true);
-- alter view public.v_mijozlar              set (security_invoker = true);
-- alter view public.v_oylik_savdo           set (security_invoker = true);
-- alter view public.v_sotuvlar              set (security_invoker = true);
-- alter view public.v_taminotchilar         set (security_invoker = true);
-- alter view public.v_top_mahsulotlar       set (security_invoker = true);
-- alter view public.v_xodimlar              set (security_invoker = true);
