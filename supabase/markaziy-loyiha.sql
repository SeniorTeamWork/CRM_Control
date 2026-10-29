-- =====================================================================
-- ASOSIY (MARKAZIY) LOYIHA uchun: har bir mijoz qaysi Supabase loyihasida ekanini saqlaydi.
-- Supabase -> SeniorTeamWork's Project -> SQL Editor -> New query -> shu faylni to'liq qo'ying -> Run.
-- Qayta ishga tushirsa ham xato bermaydi.
-- =====================================================================
begin;

create table if not exists public.mijoz_loyihalari (
  dokon_id             uuid primary key references public.dokonlar(id) on delete cascade,
  project_ref          text not null,
  supabase_url         text,
  publishable_key      text,
  holat                text not null default 'yaratilmoqda' check (holat in ('yaratilmoqda', 'tayyor', 'xato')),
  jadvallar_ornatildi  boolean not null default false,
  xato                 text,
  yaratilgan_at        timestamptz not null default now(),
  tayyor_at            timestamptz
);

-- Jadval oldinroq qisqa ko'rinishda yaratilgan bo'lsa, yetishmagan ustunlarni qo'shamiz.
alter table public.mijoz_loyihalari add column if not exists jadvallar_ornatildi boolean not null default false;
alter table public.mijoz_loyihalari add column if not exists xato text;
alter table public.mijoz_loyihalari add column if not exists tayyor_at timestamptz;

-- Jadvalni faqat Edge Function (service_role) o'qiydi va yozadi. Sayt va boshqalar to'g'ridan-to'g'ri ko'rmaydi.
alter table public.mijoz_loyihalari enable row level security;
revoke all on public.mijoz_loyihalari from anon, authenticated;

-- Sayt do'kon havolasi bilan ochilganda o'z loyihasining manzilini shu funksiya orqali oladi.
-- Faqat to'g'ri taklif kodi (havoladagi invite) bilan javob beradi.
create or replace function public.mijoz_loyihasi(p_dokon uuid, p_taklif uuid)
returns table (supabase_url text, publishable_key text, holat text)
language sql
security definer
set search_path = public
stable
as $$
  select m.supabase_url, m.publishable_key, m.holat
  from public.mijoz_loyihalari m
  join public.dokonlar d on d.id = m.dokon_id
  where d.id = p_dokon and d.taklif_kodi = p_taklif;
$$;

revoke all on function public.mijoz_loyihasi(uuid, uuid) from public;
grant execute on function public.mijoz_loyihasi(uuid, uuid) to anon, authenticated;

-- Super Admin login va paroli ochiq holda (parol esdan chiqsa ko'rish uchun).
-- Faqat Dashboard -> Table Editor'da ko'rinadi: sayt (publishable kalit) bu jadvalni o'qiy ham, yoza ham olmaydi.
-- Unga faqat Edge Function yozadi — Super Admin kirganda yoki parolini almashtirganda.
create table if not exists public.super_admin_eslatma (
  id              smallint primary key default 1 check (id = 1),
  login           text not null,
  parol           text not null,
  yangilangan_at  timestamptz not null default now()
);
alter table public.super_admin_eslatma enable row level security;
revoke all on public.super_admin_eslatma from anon, authenticated;

commit;
