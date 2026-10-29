// TA'MINOTCHILAR bo'limi — Supabase jadvallari: taminotchilar (+ v_taminotchilar), taminot_kirimlari
// Ta'minotchi qatorida: unga berilgan buyurtmalar, to'lovlar va qaytarishlar (jsonb ustunlar).
import { getData, setData, useData } from "../db";
import {
  supplierFromRow, supplierOrdersFromRow, supplierReturnFromItem, receiptFromRow, receiptsFromSupplierRow,
  SUPPLIER_ORDERS_PREFIX, arr,
} from "../mappers";
import { tartibla, unionById } from "./yordamchi";

export const SUPPLIERS_KEY = "crm_suppliers";
export const SUPPLIER_RETURNS_KEY = "crm_supplier_returns";
export const SUPPLIER_RECEIPTS_KEY = "crm_supplier_receipts";
export const supplierOrdersKey = (supplierId) => `${SUPPLIER_ORDERS_PREFIX}${supplierId}`;

export const taminotchilarBolimi = {
  nomi: "Ta'minotchilar",
  jadvallar: ["taminotchilar"],
  oldin: async (ctx, { fetchByIds }) => {
    ctx.supplierStats = await fetchByIds("v_taminotchilar", (ctx.rows.taminotchilar || []).map((row) => row.id));
    arr(ctx.rows.mahsulotlar).forEach((row) => {
      if (row.taminotchi_id) ctx.productCountBySupplier.set(row.taminotchi_id, (ctx.productCountBySupplier.get(row.taminotchi_id) || 0) + 1);
    });
  },
  // { nomi, telefon, manzil, buyurtmalar, tolovlar, qaytarishlar } -> { name, phone, address, ... }
  map: (rows, ctx) => {
    const entries = {
      [SUPPLIERS_KEY]: rows.taminotchilar.map((row) => supplierFromRow(row, ctx)),
      [SUPPLIER_RETURNS_KEY]: rows.taminotchilar.flatMap((row) => arr(row.qaytarishlar).map((item) => supplierReturnFromItem(item, row, ctx))),
    };
    rows.taminotchilar.forEach((row) => { entries[supplierOrdersKey(row.ilova_id)] = supplierOrdersFromRow(row, ctx); });
    return entries;
  },
};

export const kirimlarBolimi = {
  nomi: "Tovar qabul qilish",
  jadvallar: ["taminot_kirimlari"],
  // Eski qatorlarda qabul yozuvi ta'minotchi buyurtmasi ichida turadi — ular ham qo'shiladi.
  map: (rows, ctx) => ({
    [SUPPLIER_RECEIPTS_KEY]: unionById(
      tartibla(rows.taminot_kirimlari, "sana", true).map((row) => receiptFromRow(row, ctx)),
      arr(rows.taminotchilar).flatMap(receiptsFromSupplierRow),
    ),
  }),
};

// Sahifalar uchun
export const getSuppliers = (fallback = []) => getData(SUPPLIERS_KEY, fallback);
export const saveSuppliers = (list) => setData(SUPPLIERS_KEY, list);
export const useSuppliers = () => useData(SUPPLIERS_KEY, []);

export const getSupplierOrders = (supplierId) => getData(supplierOrdersKey(supplierId), []);
export const saveSupplierOrders = (supplierId, list) => setData(supplierOrdersKey(supplierId), list);

export const getSupplierReceipts = () => getData(SUPPLIER_RECEIPTS_KEY, []);
export const saveSupplierReceipts = (list) => setData(SUPPLIER_RECEIPTS_KEY, list);

export const getSupplierReturns = () => getData(SUPPLIER_RETURNS_KEY, []);
export const saveSupplierReturns = (list) => setData(SUPPLIER_RETURNS_KEY, list);
