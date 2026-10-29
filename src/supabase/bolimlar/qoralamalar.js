// QORALAMALAR bo'limi — Supabase jadvali: qoralamalar
// turi = 'eslatma' — eslatmalar, turi = 'sotuv' — keyinroq davom ettirish uchun saqlangan sotuvlar.
import { getData, setData, useData } from "../db";
import { storedObjectFromRow } from "../mappers";
import { tartibla } from "./yordamchi";

export const NOTES_KEY = "crm_notes_drafts_v1";
export const SAVED_SALE_DRAFTS_KEY = "crm_saved_sale_drafts_v1";

export const qoralamalarBolimi = {
  nomi: "Qoralamalar",
  jadvallar: ["qoralamalar"],
  map: (rows) => {
    const sorted = tartibla(rows.qoralamalar, "yangilangan_at", true);
    return {
      [NOTES_KEY]: sorted.filter((row) => row.turi === "eslatma").map(storedObjectFromRow),
      [SAVED_SALE_DRAFTS_KEY]: sorted.filter((row) => row.turi === "sotuv").map(storedObjectFromRow),
    };
  },
};

// Sahifalar uchun
export const getNotes = () => getData(NOTES_KEY, []);
export const saveNotes = (list) => setData(NOTES_KEY, list);
export const useNotes = () => useData(NOTES_KEY, []);

export const getSavedSaleDrafts = () => getData(SAVED_SALE_DRAFTS_KEY, []);
export const saveSavedSaleDrafts = (list) => setData(SAVED_SALE_DRAFTS_KEY, list);
