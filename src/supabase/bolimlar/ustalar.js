// USTALAR bo'limi — Supabase jadvali: ustalar
import { getData, setData, useData } from "../db";
import { ustaFromRow } from "../mappers";

export const USTALAR_KEY = "crm_ustalar";

export const ustalarBolimi = {
  nomi: "Ustalar",
  jadvallar: ["ustalar"],
  // { ism, telefon, mutaxassislik, foiz, balans, reyting } -> { name, phone, specialty, percentage, balance, rating }
  map: (rows) => ({
    [USTALAR_KEY]: rows.ustalar.map(ustaFromRow),
  }),
};

// Sahifalar uchun
export const getUstalar = () => getData(USTALAR_KEY, []);
export const saveUstalar = (list) => setData(USTALAR_KEY, list);
export const useUstalar = () => useData(USTALAR_KEY, []);
