import { employees } from "./mockData";
import { getData, setData } from "../supabase/db";
import { EMPLOYEES_KEY } from "../supabase/bolimlar/xodimlar";

// Xodimlar Supabase'dagi "xodimlar" jadvalidan (bolimlar/xodimlar.js).
export function readEmployees() {
  const stored = getData(EMPLOYEES_KEY, null);
  if (stored === null) return employees;
  if (!Array.isArray(stored)) throw new Error("Invalid employee data");
  return stored;
}

export function saveEmployees(list) {
  setData(EMPLOYEES_KEY, list);
}
