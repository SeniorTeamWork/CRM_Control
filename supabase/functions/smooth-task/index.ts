import { createClient } from "npm:@supabase/supabase-js@2";
import { SXEMA } from "./sxema.ts";

const API = "https://api.supabase.com/v1";

// Asosiy (markaziy) loyiha bazasi. Bu ikki qiymatni Supabase funksiyaga o'zi beradi.
const markaz = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const sarlavha = {
  // trim: Secrets'ga nusxalanganda token oxiriga bo'sh joy yoki yangi qator qo'shilib qolishi mumkin
  Authorization: `Bearer ${(Deno.env.get("MANAGEMENT_TOKEN") || "").trim()}`,
  "Content-Type": "application/json",
};

// Javob qaytarish uchun yordamchi. CORS sarlavhalari sayt brauzerdan chaqira olishi uchun.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Super Admin parolini tekshirish (saytdagi accessStore.js bilan bir xil usul)
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
async function superAdminmi(login: string, parol: string) {
  const { data: admin } = await markaz.from("super_admin").select("*").eq("id", 1).maybeSingle();
  if (!admin?.salt || !admin?.parol_hash || admin.login !== login) return false;
  const matn = new TextEncoder().encode(`${admin.salt}:${parol}`);
  let xesh: string;
  if (admin.parol_iteratsiya) {
    const kalit = await crypto.subtle.importKey("raw", matn, "PBKDF2", false, ["deriveBits"]);
    xesh = hex(await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(admin.salt), iterations: admin.parol_iteratsiya },
      kalit, 256,
    ));
  } else {
    xesh = hex(await crypto.subtle.digest("SHA-256", matn));
  }
  return xesh === admin.parol_hash;
}

// Kirish kaliti (token): Super Admin saytga kirganda beriladi, keyin "Yangi mijoz" parol so'ramaydi.
// HMAC bilan imzolanadi, 12 soat amal qiladi. Parol almashsa (salt o'zgaradi) eski kalit bekor bo'ladi.
const TOKEN_MUDDATI = 12 * 60 * 60 * 1000;
const imzoKaliti = crypto.subtle.importKey(
  "raw", new TextEncoder().encode(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64dan = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function tokenYarat(login: string) {
  const { data: admin } = await markaz.from("super_admin").select("salt").eq("id", 1).maybeSingle();
  const malumot = b64(new TextEncoder().encode(JSON.stringify({ login, salt: admin?.salt, exp: Date.now() + TOKEN_MUDDATI })));
  const imzo = new Uint8Array(await crypto.subtle.sign("HMAC", await imzoKaliti, new TextEncoder().encode(malumot)));
  return `${malumot}.${b64(imzo)}`;
}

async function tokenTogrimi(token: string) {
  try {
    const [malumot, imzo] = String(token || "").split(".");
    if (!malumot || !imzo) return false;
    const togri = await crypto.subtle.verify("HMAC", await imzoKaliti, b64dan(imzo), new TextEncoder().encode(malumot));
    if (!togri) return false;
    const { login, salt, exp } = JSON.parse(new TextDecoder().decode(b64dan(malumot)));
    if (!exp || Date.now() > exp) return false;
    const { data: admin } = await markaz.from("super_admin").select("login, salt").eq("id", 1).maybeSingle();
    return Boolean(admin) && admin.login === login && admin.salt === salt;
  } catch {
    return false;
  }
}

// Parol yoki kirish kaliti bilan tekshirish
const ruxsatmi = (body: any) => (body.token ? tokenTogrimi(body.token) : superAdminmi(body.login, body.parol));

// SQL ichiga matn qo'yish uchun: ' belgisini ikkilaymiz
const sqlMatn = (s: string) => `'${String(s).replace(/'/g, "''")}'`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Kutilmagan xato bo'lsa ham javob CORS sarlavhalari bilan qaytadi — sayt sababini ko'radi.
  try {
    return await ishla(req);
  } catch (error) {
    console.error(error);
    return json({ xato: "Funksiyada xato", tafsilot: String((error as Error)?.message || error) }, 500);
  }
});

async function ishla(req: Request): Promise<Response> {

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // body bo'sh yoki JSON emas
  }

  // ---------------------------------------------------------------
  // 1) YARAT: { "amal": "yarat", "token" (yoki "login", "parol"), "nomi", "domen"?, "telefon"? }
  //    Do'konni ro'yxatga yozadi va unga yangi Supabase loyihasi ochadi.
  // ---------------------------------------------------------------
  if (body.amal === "yarat") {
    if (!(await ruxsatmi(body))) return json({ xato: body.token ? "sessiya eskirgan" : "login yoki parol noto'g'ri" }, 401);
    if (!body.nomi) return json({ xato: "nomi kerak" }, 400);

    // a) Asosiy loyihadagi dokonlar jadvaliga yangi do'kon
    const { data: dokon, error: dokonXato } = await markaz
      .from("dokonlar")
      .insert({ nomi: body.nomi, domen: body.domen || null, telefon: body.telefon || null, asosiy: false })
      .select("id, taklif_kodi")
      .single();
    if (dokonXato) return json({ xato: dokonXato.message }, 400);

    // b) Yangi Supabase loyihasi
    const tashkilotlar = await (await fetch(`${API}/organizations`, { headers: sarlavha })).json();
    const javob = await fetch(`${API}/projects`, {
      method: "POST",
      headers: sarlavha,
      body: JSON.stringify({
        name: body.nomi,
        organization_id: tashkilotlar[0].id,
        region: "eu-central-1",
        db_pass: crypto.randomUUID() + "Aa1!",
      }),
    });
    const loyiha = await javob.json();
    if (!javob.ok) {
      // Loyiha ochilmasa, do'konni ham o'chiramiz
      await markaz.from("dokonlar").delete().eq("id", dokon.id);
      return json({ xato: "loyiha yaratilmadi", tafsilot: loyiha }, 400);
    }

    // c) Ro'yxatga yozamiz: shu do'kon shu loyihada
    await markaz.from("mijoz_loyihalari").insert({
      dokon_id: dokon.id,
      project_ref: loyiha.id,
      supabase_url: `https://${loyiha.id}.supabase.co`,
    });

    return json({ dokon_id: dokon.id, taklif_kodi: dokon.taklif_kodi, ref: loyiha.id, holat: "yaratilmoqda" });
  }

  // ---------------------------------------------------------------
  // 2) HOLAT: { "amal": "holat", "dokon_id": "..." }
  //    Loyiha tayyor bo'lsa: jadvallarni o'rnatadi, kalitni oladi va "tayyor" deb belgilaydi.
  //    Sayt buni har bir necha soniyada chaqiradi.
  // ---------------------------------------------------------------
  if (body.amal === "holat") {
    const { data: m } = await markaz.from("mijoz_loyihalari").select("*").eq("dokon_id", body.dokon_id).maybeSingle();
    if (!m) return json({ xato: "bunday do'kon yo'q" }, 404);
    if (m.holat === "tayyor") return json({ holat: "tayyor", supabase_url: m.supabase_url });

    // a) Loyiha ishga tushdimi?
    const loyiha = await (await fetch(`${API}/projects/${m.project_ref}`, { headers: sarlavha })).json();
    if (loyiha.status !== "ACTIVE_HEALTHY") return json({ holat: "yaratilmoqda", loyiha_holati: loyiha.status });

    // b) CRM jadvallari + do'konning o'z qatori (asosiy loyihadagi bilan bir xil id va taklif kodi)
    if (!m.jadvallar_ornatildi) {
      const { data: d } = await markaz.from("dokonlar").select("id, nomi, taklif_kodi").eq("id", m.dokon_id).single();
      const sql = SXEMA + `
        insert into public.dokonlar (id, nomi, taklif_kodi, asosiy)
        values ('${d.id}', ${sqlMatn(d.nomi)}, '${d.taklif_kodi}', true)
        on conflict (id) do nothing;`;
      const javob = await fetch(`${API}/projects/${m.project_ref}/database/query`, {
        method: "POST",
        headers: sarlavha,
        body: JSON.stringify({ query: sql }),
      });
      if (!javob.ok) {
        const xato = await javob.text();
        await markaz.from("mijoz_loyihalari").update({ holat: "xato", xato }).eq("dokon_id", m.dokon_id);
        return json({ holat: "xato", xato }, 400);
      }
      await markaz.from("mijoz_loyihalari").update({ jadvallar_ornatildi: true, xato: null }).eq("dokon_id", m.dokon_id);
    }

    // c) Yangi loyihaning publishable kaliti (saytga beriladigan ochiq kalit)
    const kalitlar = await (await fetch(`${API}/projects/${m.project_ref}/api-keys`, { headers: sarlavha })).json();
    const kalit = kalitlar.find((k: any) => k.type === "publishable") || kalitlar.find((k: any) => k.name === "anon");
    if (!kalit?.api_key) return json({ holat: "yaratilmoqda", izoh: "kalit hali tayyor emas" });

    await markaz.from("mijoz_loyihalari").update({
      publishable_key: kalit.api_key,
      holat: "tayyor",
      tayyor_at: new Date().toISOString(),
    }).eq("dokon_id", m.dokon_id);

    return json({ holat: "tayyor", supabase_url: m.supabase_url });
  }

  // ---------------------------------------------------------------
  // 3) OCHIR: { "amal": "ochir", "login", "parol", "dokon_id" }
  //    Do'konning Supabase loyihasini va asosiy loyihadagi yozuvini butunlay o'chiradi.
  // ---------------------------------------------------------------
  if (body.amal === "ochir") {
    if (!(await superAdminmi(body.login, body.parol))) return json({ xato: "login yoki parol noto'g'ri" }, 401);

    const { data: dokon } = await markaz.from("dokonlar").select("id, asosiy").eq("id", body.dokon_id).maybeSingle();
    if (!dokon) return json({ xato: "bunday do'kon yo'q" }, 404);
    if (dokon.asosiy) return json({ xato: "asosiy do'konni o'chirib bo'lmaydi" }, 400);

    // a) O'z loyihasi bo'lsa, Supabase'dan o'chiramiz
    const { data: m } = await markaz.from("mijoz_loyihalari").select("project_ref").eq("dokon_id", dokon.id).maybeSingle();
    let loyihaOchirildi = false;
    if (m?.project_ref) {
      const javob = await fetch(`${API}/projects/${m.project_ref}`, { method: "DELETE", headers: sarlavha });
      // 404 — loyiha allaqachon o'chirilgan (masalan, Dashboard'dan qo'lda)
      if (!javob.ok && javob.status !== 404) {
        return json({ xato: "Supabase loyihasi o'chirilmadi", tafsilot: await javob.text() }, 400);
      }
      loyihaOchirildi = true;
    }

    // b) Asosiy loyihadagi do'kon yozuvi (mijoz_loyihalari qatori ham birga o'chadi)
    const { error } = await markaz.from("dokonlar").delete().eq("id", dokon.id);
    if (error) return json({ xato: error.message }, 400);

    return json({ ochirildi: true, loyiha_ochirildi: loyihaOchirildi });
  }

  // ---------------------------------------------------------------
  // 4) ESLATMA: { "amal": "eslatma", "login", "parol" }  — Super Admin saytga kirganda chaqiriladi.
  //    Login/parolni yopiq super_admin_eslatma jadvaliga ochiq holda yozadi (faqat Dashboard'da ko'rinadi)
  //    va kirish kalitini (token) qaytaradi.
  // ---------------------------------------------------------------
  if (body.amal === "eslatma") {
    if (!(await superAdminmi(body.login, body.parol))) return json({ xato: "login yoki parol noto'g'ri" }, 401);
    const { error } = await markaz.from("super_admin_eslatma").upsert({
      id: 1,
      login: body.login,
      parol: body.parol,
      yangilangan_at: new Date().toISOString(),
    });
    return json({ saqlandi: !error, token: await tokenYarat(body.login) });
  }

  return json({ xato: "amal noma'lum: 'yarat', 'holat', 'ochir' yoki 'eslatma' bo'lishi kerak" }, 400);
}
