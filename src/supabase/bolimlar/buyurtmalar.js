// MIJOZ BUYURTMALARI (tovarni band qilish) — Supabase jadvali: buyurtmalar
import { getData, setData, useData } from "../db";
import { storedObjectFromRow } from "../mappers";
import { tartibla } from "./yordamchi";

export const ORDERS_KEY = "crm_customer_orders_v1";

export const buyurtmalarBolimi = {
  nomi: "Buyurtmalar",
  jadvallar: ["buyurtmalar"],
  // Buyurtma obyektining o'zi "malumot" ustunida to'liq saqlanadi.
  map: (rows) => ({
    [ORDERS_KEY]: tartibla(rows.buyurtmalar, "yaratilgan_at", true).map(storedObjectFromRow),
  }),
};

// Sahifalar uchun
export const getOrders = () => getData(ORDERS_KEY, []);
export const saveOrders = (list) => setData(ORDERS_KEY, list);
export const useOrders = () => useData(ORDERS_KEY, []);
