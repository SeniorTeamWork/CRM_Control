// Barcha bo'limlar ro'yxati. db.js shu ro'yxat bo'yicha Supabase'dan o'qiydi va har bir bo'limning
// map funksiyasi bilan ma'lumotni ilova ko'rinishiga keltiradi.
// Ro'yxat funksiya orqali beriladi: bo'lim fayllari db.js'ni import qiladi, db.js esa shu faylni
// (aylanma import), shuning uchun ro'yxat faqat chaqirilganda tuziladi.
import { mahsulotlarBolimi } from "./mahsulotlar";
import { mijozlarBolimi } from "./mijozlar";
import { sotuvlarBolimi } from "./sotuvlar";
import { taminotchilarBolimi, kirimlarBolimi } from "./taminotchilar";
import { xodimlarBolimi } from "./xodimlar";
import { ustalarBolimi } from "./ustalar";
import { moliyaBolimi } from "./moliya";
import { buyurtmalarBolimi } from "./buyurtmalar";
import { qoralamalarBolimi } from "./qoralamalar";
import { sozlamalarBolimi } from "./sozlamalar";

export const bolimlar = () => [
  mahsulotlarBolimi,
  mijozlarBolimi,
  sotuvlarBolimi,
  taminotchilarBolimi,
  kirimlarBolimi,
  xodimlarBolimi,
  ustalarBolimi,
  moliyaBolimi,
  buyurtmalarBolimi,
  qoralamalarBolimi,
  sozlamalarBolimi,
];

// Do'kon ochilganda o'qiladigan jadvallar (dokonlar alohida o'qiladi).
export const bolimJadvallari = () => [...new Set(bolimlar().flatMap((bolim) => bolim.jadvallar))].filter((table) => table !== "dokonlar");
