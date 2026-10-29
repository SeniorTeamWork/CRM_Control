// "Yangi mijoz": har bir do'kon uchun alohida Supabase loyihasi.
// Ishni Supabase'dagi Edge Function bajaradi (kodi: supabase/edge-function/index.ts).
//   yarat   — Super Admin kirish kalitini (yoki parolini) tekshiradi, do'konni ro'yxatga yozadi va yangi loyiha ochadi
//   holat — loyiha tayyor bo'lsa, CRM jadvallarini o'rnatadi va "tayyor" deb belgilaydi
//   ochir   — do'konni va uning loyihasini o'chiradi (har doim parol bilan)
//   eslatma — Super Admin kirganda: login/parolni yopiq jadvalga yozadi va kirish kalitini qaytaradi
import { markaz } from "./supabase";

// Edge Function nomi (Supabase -> Edge Functions ro'yxatidagi nom).
export const MIJOZ_FUNKSIYASI = process.env.REACT_APP_MIJOZ_FUNKSIYASI || "smooth-task";

async function chaqir(body) {
  const { data, error } = await markaz.functions.invoke(MIJOZ_FUNKSIYASI, { body });
  if (error) {
    let xabar = error.message;
    try {
      const javob = await error.context.json();
      // tafsilot — Supabase Management API'ning o'z javobi (nima uchun rad etilgani)
      const tafsilot = typeof javob.tafsilot === "string" ? javob.tafsilot : javob.tafsilot && JSON.stringify(javob.tafsilot);
      xabar = [javob.xato || xabar, tafsilot].filter(Boolean).join(": ");
    } catch { /* javob JSON emas */ }
    throw new Error(xabar);
  }
  return data;
}

// Super Admin kirish kaliti (token): shu brauzer tabi yopilguncha saqlanadi.
const TOKEN_KEY = "super_admin_fn_token";
export const superAdminTokeni = () => { try { return sessionStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
export const superAdminTokeniniOchir = () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* yo'q */ } };
const tokenniSaqla = (token) => { try { if (token) sessionStorage.setItem(TOKEN_KEY, token); } catch { /* yo'q */ } };

// Kalit bo'lsa parol so'ralmaydi. Kalit eskirgan bo'lsa o'chiriladi va xato qaytadi — sayt parolni so'raydi.
// => { dokon_id, taklif_kodi, ref, holat: "yaratilmoqda" }
export async function yangiMijozYarat({ login, parol, nomi, domen, telefon }) {
  const token = parol ? "" : superAdminTokeni();
  try {
    return await chaqir({ amal: "yarat", ...(token ? { token } : { login, parol }), nomi, domen, telefon });
  } catch (error) {
    if (token && /sessiya eskirgan/.test(error.message)) {
      superAdminTokeniniOchir();
      throw new Error("Sessiya eskirgan. Super Admin parolini kiriting.");
    }
    throw error;
  }
}

export const mijozHolati = (dokonId) => chaqir({ amal: "holat", dokon_id: dokonId });

// Do'konni va uning Supabase loyihasini butunlay o'chiradi. => { ochirildi, loyiha_ochirildi }
export const mijozniOchir = ({ login, parol, dokonId }) =>
  chaqir({ amal: "ochir", login, parol, dokon_id: dokonId });

// Super Admin kirganda: login/parol Supabase'dagi yopiq super_admin_eslatma jadvaliga yoziladi
// (faqat Dashboard -> Table Editor'da ko'rinadi) va kirish kaliti olinadi.
// Funksiya parolni tekshiradi: yangi parol xeshi bazaga yetib borguncha bir necha marta urinadi.
export async function superAdminEslatma({ login, parol }) {
  if (process.env.NODE_ENV === "test" || !login || !parol) return false;
  for (let urinish = 0; urinish < 5; urinish += 1) {
    try {
      const javob = await chaqir({ amal: "eslatma", login, parol });
      tokenniSaqla(javob?.token);
      return true;
    } catch { /* xesh hali yozilmagan bo'lishi mumkin — qayta urinamiz */ }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

// Loyiha tayyor bo'lguncha har bir necha soniyada so'raydi. bekor() true qaytarsa to'xtaydi.
export async function tayyorBolishiniKut(dokonId, { onHolat, bekor = () => false, oraliq = 5000, muddat = 10 * 60000 } = {}) {
  const tugash = Date.now() + muddat;
  let xatolar = 0;
  while (!bekor()) {
    let javob;
    try {
      javob = await mijozHolati(dokonId);
      xatolar = 0;
    } catch (error) {
      // Internet uzilishi kabi bir martalik xatoda qayta so'raymiz, 3 marta ketma-ket bo'lsa to'xtaymiz.
      xatolar += 1;
      if (xatolar >= 3) throw error;
      javob = { holat: "yaratilmoqda", izoh: error.message };
    }
    if (bekor()) return null;
    onHolat?.(javob);
    if (javob?.holat === "tayyor") return javob;
    if (Date.now() > tugash) throw new Error("Loyiha 10 daqiqada tayyor bo'lmadi. Keyinroq qayta tekshiring.");
    await new Promise((resolve) => setTimeout(resolve, oraliq));
  }
  return null;
}
