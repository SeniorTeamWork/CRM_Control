// MAHSULOTLAR bo'limi — Supabase jadvali: mahsulotlar
import { getData, setData, useData } from "../db";
import { productFromRow } from "../mappers";

export const PRODUCTS_KEY = "crm_products";

export const mahsulotlarBolimi = {
  nomi: "Mahsulotlar",
  jadvallar: ["mahsulotlar"],
  // Supabase qatorlari -> ilovadagi mahsulot obyekti
  // { nomi, narx, tannarx, qoldiq, min_qoldiq, ... } -> { name, price, cost, stock, minStock, ... }
  map: (rows, ctx) => ({
    [PRODUCTS_KEY]: rows.mahsulotlar.map((row) => productFromRow(row, ctx)),
  }),
};

// Sahifalar uchun. fallback — ma'lumot hali bo'lmasa qaytadigan qiymat.
export const getProducts = (fallback = []) => getData(PRODUCTS_KEY, fallback);
export const saveProducts = (list) => setData(PRODUCTS_KEY, list);
export const useProducts = () => useData(PRODUCTS_KEY, []);
