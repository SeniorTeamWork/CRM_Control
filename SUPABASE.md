# Supabase ulanishi

Saytdagi barcha ma'lumot Supabase bazasidan olinadi va Supabase'ga saqlanadi. Har bir bo'lim
(mahsulotlar, mijozlar, sotuvlar ...) uchun `src/supabase/bolimlar/` papkasida alohida fayl bor:
unda qaysi jadvaldan o'qilishi, qatorlar qanday map qilinishi va sahifalar ma'lumotni qanday
olib-saqlashi yozilgan. Biznes ma'lumoti brauzer xotirasiga (localStorage) yozilmaydi.

## Fayllar

| Fayl | Nima |
|---|---|
| `src/supabase/supabase.js` | Supabase manzili va publishable kalit, `supabase` klienti |
| `src/supabase/db.js` | Markaz: yuklash, saqlash (faqat o'zgarganini yuborish), internetsiz navbat, boshqa kassirdagi o'zgarishlarni olish |
| `src/supabase/mappers.js` | Map funksiyalari: jadval qatori ↔ ilova obyekti (`productFromRow`, `productToRow` ...) |
| `src/supabase/bolimlar/*.js` | Har bir bo'lim: jadval, map va sahifalar uchun funksiyalar |
| `src/supabase/live.js` | Bildirishnomalar va AI chat tarixi (to'g'ridan-to'g'ri Supabase bilan) |
| `src/index.js` | Sayt ochilishidan oldin Supabase'dan yuklaydi (`startSupabase`) |

## Bo'limlar

| Fayl | Supabase jadvali | Sahifalar uchun funksiyalar |
|---|---|---|
| `mahsulotlar.js` | `mahsulotlar` | `getProducts`, `saveProducts`, `useProducts` |
| `mijozlar.js` | `mijozlar` (+ `v_mijozlar`) | `getCustomers`, `saveCustomers`, `useCustomers` |
| `sotuvlar.js` | `sotuvlar` (to'lovlar va qaytarishlar shu qatorda) | `getSales`, `saveSales`, `getReturns`, `saveReturns`, `getDebtPayments`, `saveDebtPayments` |
| `taminotchilar.js` | `taminotchilar` (+ `v_taminotchilar`), `taminot_kirimlari` | `getSuppliers`, `saveSuppliers`, `getSupplierOrders`, `saveSupplierOrders`, `getSupplierReceipts`, `saveSupplierReceipts` |
| `xodimlar.js` | `xodimlar` (direktor ham, `rol = 'direktor'`) | `getEmployees`, `saveEmployees`, `getDirectorAccount` |
| `ustalar.js` | `ustalar` | `getUstalar`, `saveUstalar`, `useUstalar` |
| `moliya.js` | `moliya` (`turi` = kirim / chiqim) | `getFinance`, `saveFinance`, `useFinance` |
| `buyurtmalar.js` | `buyurtmalar` | `getOrders`, `saveOrders`, `useOrders` |
| `qoralamalar.js` | `qoralamalar` (`turi` = eslatma / sotuv) | `getNotes`, `saveNotes`, `getSavedSaleDrafts` |
| `sozlamalar.js` | `dokonlar` (valyuta, kartalar) | `getCurrencySettings`, `getDirectorCards` |

Misol, sahifada:

```js
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";

const products = getProducts();                       // Supabase'dan kelgan, map qilingan ro'yxat
saveProducts(products.map((p) => p.id === id ? { ...p, price } : p));  // faqat o'zgargan qator yuboriladi
```

Bo'lim faylidagi map:

```js
map: (rows, ctx) => ({
  crm_products: rows.mahsulotlar.map((row) => productFromRow(row, ctx)),
  // { nomi, narx, tannarx, qoldiq } -> { name, price, cost, stock }
}),
```

## Qanday ishlaydi

- **Ochilishda** barcha bo'limlar Supabase'dan o'qiladi, map qilinadi va sayt ochiladi.
- **Saqlashda** faqat o'zgargan qatorlar yuboriladi (butun ro'yxat emas).
- **Boshqa kassir yoki kompyuter** o'zgartirsa, sayt buni Realtime orqali (Supabase'da yoqilgan
  bo'lsa) yoki har 20 soniyada, oynaga qaytilganda bilib oladi va ochiq sahifa yangilanadi.
  Siz saqlagan, lekin hali yuborilmagan o'zgarish eski ma'lumot bilan almashtirilmaydi.
- **Internet uzilsa** o'zgarishlar navbatda turadi va internet tiklanganda yuboriladi.
  Sahifa yopilib qolsa ham navbat saqlanadi.
- **Supabase'ga ulanib bo'lmasa** (ochilishda 15 soniya javob bo'lmasa), sayt bo'sh ro'yxatlar
  bilan ochiladi va ogohlantirish konsolga yoziladi. Ma'lumot brauzerda saqlanmagani uchun
  internetsiz ochilganda eski ma'lumot ko'rinmaydi.
- **Brauzerda qoladiganlar** (biznes ma'lumoti emas): til, tema, kirish sessiyasi, POS'dagi ochiq
  savat, yuborilmagan o'zgarishlar navbati.

## Ishga tushirish

1. `npm install`
2. `npm start` (yoki `npm run build`)
3. CRM do'kon havolasi orqali ochiladi: `/?tenant=<dokonlar.id>&invite=<dokonlar.taklif_kodi>`
   (Super Admin panelidagi "Taklif havolasi"). Oddiy `/` manzili Super Admin paneli.

## Tekshirish

Brauzer konsolida (F12):

```js
crmSupabase.holat()     // ulanish, navbatdagi o'zgarishlar, xatolar jurnali, xotiradagi bo'limlar
crmSupabase.yangilash() // Supabase'dan hozir qayta o'qish
```

Sinov rejimi: `.env.local` da `REACT_APP_SUPABASE_DRY_RUN=true` yozilsa, Supabase'dan faqat
o'qiladi, yuboriladigan o'zgarishlar `crmSupabase.holat().sinov` da ko'rinadi. Bu rejimda
konsolda `crmSupabase.getData(...)` va `crmSupabase.setData(...)` ham bor.

## Har bir mijoz — alohida Supabase loyihasi

Super Admin → **Yangi mijoz** (Super Admin paroli bilan) do'konga o'zining Supabase loyihasini ochadi.
Do'konlar ma'lumoti bir-biriga aralashmaydi.

| Qayerda | Nima |
|---|---|
| Asosiy loyiha | `dokonlar` (ro'yxat, onlayn holat, yordam xabarlari), `super_admin`, `mijoz_loyihalari` (qaysi do'kon qaysi loyihada) |
| Do'konning o'z loyihasi | mahsulotlar, mijozlar, sotuvlar, xodimlar ... (`supabase/mijoz-loyiha-sxema.sql`) |

- `src/supabase/supabase.js`: `markaz` — asosiy loyiha, `supabase` — do'kon ma'lumoti turgan loyiha.
- `src/supabase/mijozLoyiha.js`: Edge Function'ni chaqiradi (`yarat`, `holat`).
- `supabase/edge-function/`: Edge Function kodi (`index.ts`, `sxema.ts`). Supabase → Edge Functions → `smooth-task`.
  Secrets'da `MANAGEMENT_TOKEN` bo'lishi, **Verify JWT** o'chirilgan bo'lishi kerak.
- `supabase/markaziy-loyiha.sql`: asosiy loyihada bir marta ishga tushiriladi.
- Do'kon havolasi ochilganda sayt `mijoz_loyihasi(dokon, taklif)` orqali do'kon loyihasini topadi.
  Topilmasa (eski do'konlar, masalan UyMarket) — asosiy loyihada ishlaydi.
- Bepul tarifda faqat 2 ta faol loyiha bo'ladi; ko'p mijoz uchun Pro tarif kerak.
- Super Admin'da mijozni o'chirish uning Supabase loyihasini o'chirmaydi — uni Supabase'da qo'lda o'chiring.

## Bilish kerak bo'lgan narsalar

- **Xavfsizlik.** Saytda Supabase Auth yo'q, shuning uchun jadvallar publishable kalit bilan
  ochiq: kalitni bilgan har kim (u sayt kodida ko'rinadi) ma'lumotlarni o'qiy va o'zgartira oladi.
  Haqiqiy himoya uchun keyingi bosqich — Supabase Auth va har bir do'kon uchun RLS siyosatlari.
- `parollar` jadvali va `xodimlar_parollar` view parollarni ochiq matnda saqlaydi. Sayt ulardan
  foydalanmaydi; zaxira olib, o'chirib tashlash tavsiya etiladi.
- **Realtime.** Darhol yangilanish uchun Supabase → Database → Publications → `supabase_realtime`
  da jadvallarni yoqing. Yoqilmasa ham sayt har 20 soniyada tekshiradi.
- Super Admin'dagi "Zaxira nusxa" endi do'kon ma'lumotini o'z ichiga olmaydi (u brauzerda yo'q).
  To'liq zaxira uchun Supabase → Database → Backups'dan foydalaning.
- Agar Supabase'da biror triggerni sotuv qo'shilganda mahsulot qoldig'ini kamaytiradigan qilib
  yozgan bo'lsangiz, uni o'chiring: qoldiqni ilovaning o'zi hisoblab yuboradi.
