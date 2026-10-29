// MOLIYA bo'limi — Supabase jadvali: moliya (turi = 'kirim' yoki 'chiqim')
// Ilovada moliya bitta obyekt: { incomes: [...], expenses: [...] }.
import { getData, setData, useData } from "../db";
import { financeFromRow, financeFromList } from "../mappers";
import { tartibla } from "./yordamchi";

export const FINANCE_KEY = "crm_finance_operations_v1";

export const moliyaBolimi = {
  nomi: "Moliya",
  jadvallar: ["moliya"],
  // { turi, kategoriya, summa, sana, izoh } -> incomes/expenses ichidagi { category, amount, date, description }
  map: (rows, ctx) => {
    const own = tartibla(rows.moliya, "sana", true);
    const entries = own.map((row) => financeFromRow(row, ctx));
    // Moliya yozuvlarida ilovada id yo'q: keyin o'zgartirish/o'chirish uchun mazmuni bo'yicha qator eslab qolinadi.
    const index = new Map();
    ctx.contentKeys(entries).forEach(([contentKey], i) => index.set(contentKey, own[i].ilova_id));
    ctx.content.set(`${ctx.dokonId}|${FINANCE_KEY}`, index);
    return { [FINANCE_KEY]: financeFromList(entries) };
  },
};

// Sahifalar uchun
export const getFinance = () => getData(FINANCE_KEY, null);
export const saveFinance = (value) => setData(FINANCE_KEY, value);
export const useFinance = () => useData(FINANCE_KEY, null);
