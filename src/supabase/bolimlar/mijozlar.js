// MIJOZLAR bo'limi — Supabase jadvali: mijozlar (+ v_mijozlar view'idan qarz va xaridlar soni)
// Asosiy kassa va qo'shimcha kassa mijozlari bitta jadvalda, "kassa" ustuni bilan ajratiladi.
import { getData, setData, useData } from "../db";
import { customerFromRow } from "../mappers";
import { kassasi } from "./yordamchi";

export const CUSTOMERS_KEY = "crm_customers";
export const ADDITIONAL_CUSTOMERS_KEY = "crm_additional_pos_customers";

export const mijozlarBolimi = {
  nomi: "Mijozlar",
  jadvallar: ["mijozlar"],
  // Har bir mijozning qarzi va xaridlari v_mijozlar view'ida hisoblanadi.
  oldin: async (ctx, { fetchByIds }) => {
    ctx.customerStats = await fetchByIds("v_mijozlar", (ctx.rows.mijozlar || []).map((row) => row.id));
  },
  // { ism, telefon, hudud, holat } -> { name, phone, region, status, debt, purchases, spent }
  map: (rows, ctx) => ({
    [CUSTOMERS_KEY]: rows.mijozlar.filter((row) => kassasi(row) === "asosiy").map((row) => customerFromRow(row, ctx)),
    [ADDITIONAL_CUSTOMERS_KEY]: rows.mijozlar.filter((row) => kassasi(row) === "qoshimcha").map((row) => customerFromRow(row, ctx)),
  }),
};

// Sahifalar uchun. key — asosiy yoki qo'shimcha kassa ro'yxati.
export const getCustomers = (key = CUSTOMERS_KEY, fallback = []) => getData(key, fallback);
export const saveCustomers = (list, key = CUSTOMERS_KEY) => setData(key, list);
export const useCustomers = (key = CUSTOMERS_KEY) => useData(key, []);
