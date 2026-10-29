// DO'KON SOZLAMALARI — Supabase jadvali: dokonlar (shu do'konning qatori)
// Valyuta (valyuta, usd_kurs, valyutalar) va pul qabul qiluvchi kartalar (kartalar).
import { getData, setData } from "../db";
import { currencyFromRow, arr } from "../mappers";

export const CURRENCY_KEY = "crm_currency_settings_v1";
export const CARDS_KEY = "crm_director_cards_v1";

export const sozlamalarBolimi = {
  nomi: "Sozlamalar",
  jadvallar: ["dokonlar"],
  map: (rows) => ({
    [CURRENCY_KEY]: currencyFromRow(rows.dokonlar[0]),
    [CARDS_KEY]: arr(rows.dokonlar[0].kartalar),
  }),
};

// Sahifalar uchun
export const getCurrencySettings = () => getData(CURRENCY_KEY, {});
export const saveCurrencySettings = (settings) => setData(CURRENCY_KEY, settings);

export const getDirectorCards = () => getData(CARDS_KEY, []);
export const saveDirectorCards = (cards) => setData(CARDS_KEY, cards);
