import { createClient } from "@supabase/supabase-js";

// Asosiy (markaziy) Supabase loyihasi. Publishable kalit brauzer uchun mo'ljallangan, uni saytda ko'rsatish mumkin.
// Ma'lumot himoyasi jadvallardagi RLS siyosatlari orqali bo'ladi (SUPABASE-SQL.sql).
// Boshqa loyihaga ulash uchun .env.local da REACT_APP_SUPABASE_URL va REACT_APP_SUPABASE_KEY yozing.
export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || "https://mfltbznmcuxylcxqmfin.supabase.co";
export const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_KEY || "sb_publishable_evZzNjnXrfLEnSEVO01tqg_bgzf715K";

// Ilovada o'z login tizimi bor, Supabase Auth sessiyasi saqlanmaydi.
const klient = (url, key) => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// markaz — asosiy loyiha: do'konlar ro'yxati, Super Admin, onlayn holat, yordam xabarlari, mijoz_loyihalari.
export const markaz = klient(SUPABASE_URL, SUPABASE_KEY);

// supabase — do'kon ma'lumoti (mahsulotlar, sotuvlar ...) turgan loyiha.
// O'z loyihasi bor do'kon havolasi ochilganda shu loyihaga almashtiriladi, aks holda asosiy loyiha.
// eslint-disable-next-line import/no-mutable-exports
export let supabase = markaz;

export function mijozLoyihasigaUlan(url, key) {
  supabase = klient(url, key);
}

export const alohidaLoyihami = () => supabase !== markaz;

// Boshqa do'kon loyihasiga vaqtincha ulanish (masalan, Super Admin yangi do'konga direktor hisobini yozishi uchun).
export const klientYarat = (url, key) => klient(url, key);
