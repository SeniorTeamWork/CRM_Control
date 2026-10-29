// XODIMLAR bo'limi — Supabase jadvali: xodimlar
// Direktor ham shu jadvalda (rol = 'direktor'). Har bir xodimning profili "profil" ustunida.
import { getData, setData, useData } from "../db";
import { employeeFromRow, plain } from "../mappers";

export const EMPLOYEES_KEY = "crm_employees";
export const DIRECTOR_KEY = "crm_director_account";
export const profileKeyOf = (who) => `crm_profile_${who}`; // who: "director" yoki "employee_<id>"

export const xodimlarBolimi = {
  nomi: "Xodimlar",
  jadvallar: ["xodimlar"],
  // { ism, lavozim, telefon, ruxsatlar, oylik_maosh, maosh_tolovlari } -> { name, role, phone, permissions, monthlySalary, salaryPayments }
  map: (rows) => {
    const director = rows.xodimlar.find((row) => row.rol === "direktor");
    const stored = plain(director?.malumot);
    const entries = {
      [EMPLOYEES_KEY]: rows.xodimlar.filter((row) => row.rol !== "direktor").map(employeeFromRow),
      [DIRECTOR_KEY]: director && stored.salt && (stored.passwordHash || director.parol_hash)
        ? { ...stored, login: stored.login || director.login, passwordHash: stored.passwordHash || director.parol_hash, resetVersion: stored.resetVersion || 1 }
        : null,
    };
    rows.xodimlar.forEach((row) => {
      const profile = plain(row.profil);
      if (Object.keys(profile).length) entries[profileKeyOf(row.rol === "direktor" ? "director" : `employee_${row.ilova_id}`)] = profile;
    });
    return entries;
  },
};

// Sahifalar uchun
export const getEmployees = () => getData(EMPLOYEES_KEY, []);
export const saveEmployees = (list) => setData(EMPLOYEES_KEY, list);
export const useEmployees = () => useData(EMPLOYEES_KEY, []);

export const getDirectorAccount = () => getData(DIRECTOR_KEY, null);
export const saveDirectorAccount = (account) => setData(DIRECTOR_KEY, account);
