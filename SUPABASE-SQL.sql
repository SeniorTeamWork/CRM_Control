-- =====================================================================
-- ASOSIY LOYIHA (SeniorTeamWork's Project) uchun: bir marta ishlating.
-- Supabase -> SQL Editor -> New query -> shu faylni to'liq qo'ying -> Run.
-- Qayta ishga tushirsa ham xato bermaydi.
-- =====================================================================
begin;

-- 1. Yangi jadvallarga sayt (publishable kalit) orqali o'qish/yozish ruxsati.
--    Jadval o'chirilgan bo'lsa (masalan dokon_xatolar), u o'tkazib yuboriladi.
do $$
declare t text;
begin
  foreach t in array array['buyurtmalar', 'qoralamalar', 'taminot_kirimlari', 'dokon_xatolar', 'super_admin'] loop
    continue when to_regclass('public.' || t) is null;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists crm_ilova_kirishi on public.%I', t);
    execute format('create policy crm_ilova_kirishi on public.%I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

-- 2. ilova_id butun jadval bo'yicha emas, har bir do'kon ichida yagona bo'lsin.
--    (Har bir jadvalda "uq_<jadval>_dokon_ilova" indeksi allaqachon bor.)
do $$
declare t text;
begin
  foreach t in array array['mahsulotlar', 'mijozlar', 'sotuvlar', 'taminotchilar', 'ustalar', 'xodimlar'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_ilova_id_uq');
    execute format('drop index if exists public.%I', t || '_ilova_id_uq');
    execute format('create unique index if not exists %I on public.%I (dokon_id, ilova_id)', 'uq_' || t || '_dokon_ilova', t);
  end loop;
end $$;

-- 3. Xato tuzatish: "mahsulot_kamaydi" trigger mavjud bo'lmagan "bildirishnomalar" jadvaliga
--    yozmoqchi bo'ladi, shuning uchun qoldiq minimumdan tushganda mahsulotni saqlab bo'lmaydi.
--    Endi bildirishnoma do'konning "bildirishnomalar" ustuniga yoziladi.
create or replace function public.kam_qoldiq_bildirishnomasi()
returns trigger language plpgsql as $$
begin
  if new.holat in ('low', 'out') and new.holat is distinct from old.holat then
    update public.dokonlar
       set bildirishnomalar = bildirishnomalar || jsonb_build_array(jsonb_build_object(
             'id', (extract(epoch from clock_timestamp()) * 1000)::bigint,
             'turi', 'warning',
             'sarlavha', 'Omborda mahsulot kamaydi',
             'matn', new.nomi || ' — ' || new.qoldiq || ' dona qoldi (minimum: ' || new.min_qoldiq || ')',
             'oqilgan', false,
             'yaratilgan_at', now(),
             'malumot', '{}'::jsonb))
     where id = new.dokon_id;
  end if;
  return new;
end $$;

commit;
