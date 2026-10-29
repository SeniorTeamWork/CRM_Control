// SOTUVLAR bo'limi — Supabase jadvali: sotuvlar
// Bitta sotuv qatorida: mahsulotlar (jsonb), qarz to'lovlari (tolovlar), qaytarishlar (qaytarishlar).
import { getData, setData, useData } from "../db";
import { saleFromRow, paymentFromItem, returnFromItem, arr, plain } from "../mappers";
import { kassasi, tartibla } from "./yordamchi";

export const SALES_KEY = "crm_sales";
export const ADDITIONAL_SALES_KEY = "crm_additional_pos_sales";
export const RETURNS_KEY = "crm_returns";
export const DEBT_PAYMENTS_KEY = "crm_debt_payments_v1";

// Ilovadagi documentNumbers.js eski raqamli sotuvlarni qayta raqamlamasligi uchun
// har bir sotuvning raqami o'ziga teng qilib yoziladi.
function documentNumbers(type, sales) {
  const numbers = plain(getData(`crm_document_numbers_${type}`, {}));
  sales.forEach((sale) => {
    const id = String(sale.groupId || sale.id);
    numbers[id] = id.replace(/^[SP]-/, "");
  });
  return numbers;
}

export const sotuvlarBolimi = {
  nomi: "Sotuvlar",
  jadvallar: ["sotuvlar"],
  // { chek_raqami, mijoz_ismi, jami_summa, tolangan_summa, mahsulotlar } -> { receiptNumber, customer, amount, paidAmount, items }
  map: (rows, ctx) => {
    const all = tartibla(rows.sotuvlar, "sana", true);
    const sales = all.filter((row) => kassasi(row) === "asosiy").map((row) => saleFromRow(row, ctx));
    const additional = all.filter((row) => kassasi(row) === "qoshimcha").map((row) => saleFromRow(row, ctx));
    return {
      [SALES_KEY]: sales,
      [ADDITIONAL_SALES_KEY]: additional,
      [DEBT_PAYMENTS_KEY]: rows.sotuvlar.flatMap((sale) => arr(sale.tolovlar).map((item) => paymentFromItem(item, sale, ctx))),
      [RETURNS_KEY]: rows.sotuvlar.flatMap((sale) => arr(sale.qaytarishlar).map((item) => returnFromItem(item, sale, ctx))),
      crm_document_numbers_sales: documentNumbers("sales", sales),
      "crm_document_numbers_additional-pos": documentNumbers("additional-pos", additional),
    };
  },
};

// Sahifalar uchun. key — asosiy (crm_sales) yoki qo'shimcha kassa (crm_additional_pos_sales).
export const getSales = (key = SALES_KEY) => getData(key, []);
export const saveSales = (list, key = SALES_KEY) => setData(key, list);
export const useSales = (key = SALES_KEY) => useData(key, []);

export const getReturns = () => getData(RETURNS_KEY, []);
export const saveReturns = (list) => setData(RETURNS_KEY, list);

export const getDebtPayments = () => getData(DEBT_PAYMENTS_KEY, []);
export const saveDebtPayments = (list) => setData(DEBT_PAYMENTS_KEY, list);
