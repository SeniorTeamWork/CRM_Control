import { getData, setData } from "../supabase/db";
export const FINANCE_STORAGE_KEY = "crm_finance_operations_v1";

export function readFinanceOperations() {
  try {
    const saved = getData(FINANCE_STORAGE_KEY, null);
    if (Array.isArray(saved?.incomes) && Array.isArray(saved?.expenses)) return saved;
  } catch { /* Use defaults when storage is invalid. */ }
  return { incomes: [], expenses: [] };
}

export function saveFinanceOperations(incomes, expenses) {
  setData(FINANCE_STORAGE_KEY, { incomes, expenses });
}
