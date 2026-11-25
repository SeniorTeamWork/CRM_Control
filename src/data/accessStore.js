import { readEmployees, saveEmployees } from "./employeeStore";
import { assertNotLocked, recordFailure, recordSuccess } from "./loginThrottle";
import { getData, removeData, setData } from "../supabase/db";

const DIRECTOR_KEY = "crm_director_account";
const LOCAL_LOGIN_KEY = "crm_local_login_v1";
export const SESSION_KEY = "crm_access_session";
export const ACCESS_SECTIONS = [
  { id: "dashboard", label: "Bosh sahifa" },
  { id: "sales-all", group: "Sotuvlar", label: "Barcha sotuvlar" },
  { id: "sales-new", group: "Sotuvlar", label: "Yangi sotuv (POS)" },
  { id: "sales-pos", group: "Sotuvlar", label: "Qo‘shimcha sotuv" },
  { id: "sales-returns", group: "Sotuvlar", label: "Qaytmalar" },
  { id: "orders-reservations", label: "Band qilinganlar" },
  { id: "pending-pickups", label: "Yetkazib berish" },
  { id: "products-all", group: "Mahsulotlar", label: "Barcha mahsulotlar" },
  { id: "defective-products", group: "Mahsulotlar", label: "Brak mahsulotlar" },
  { id: "customers-all", label: "Mijozlar" },
  { id: "suppliers-main", group: "Ta'minotchilar", label: "Ta'minotchilar" },
  { id: "suppliers-returns", group: "Ta'minotchilar", label: "Qaytarilgan tovarlar" },
  { id: "employees", label: "Xodimlar" },
  { id: "ustolar", label: "Ustolar" },
  { id: "finance-revenue", group: "Moliya", label: "Daromad" },
  { id: "finance-debt", group: "Moliya", label: "Qarzdorlik" },
  { id: "finance-payables", group: "Moliya", label: "Biz qarzdor" },
  { id: "reports", label: "Hisobotlar" },
  { id: "settings", label: "Sozlamalar" },
  { id: "ai-chat", label: "AI suhbat" },
  { id: "drafts", label: "Qoralama" },
];

const LEGACY_PERMISSION_GROUPS = {
  sales: ["sales-all", "sales-new", "sales-pos", "sales-returns"],
  products: ["products-all", "defective-products"],
  customers: ["customers-all"],
  suppliers: ["suppliers-main", "suppliers-returns"],
  orders: ["orders-reservations", "pending-pickups"],
  finance: ["finance-revenue", "finance-debt", "finance-payables"],
};
const legacyGroupForPage = Object.fromEntries(
  Object.entries(LEGACY_PERMISSION_GROUPS).flatMap(([group, pages]) => pages.map((page) => [page, group]))
);

export function expandEmployeePermissions(permissions = []) {
  const selected = new Set(Array.isArray(permissions) ? permissions : []);
  Object.entries(LEGACY_PERMISSION_GROUPS).forEach(([group, pages]) => {
    if (!selected.has(group)) return;
    if (!ACCESS_SECTIONS.some((section) => section.id === group)) selected.delete(group);
    pages.forEach((page) => selected.add(page));
  });
  return [...selected];
}

export function sectionForPage(page) {
  if (page === "help" || page === "notifications") return null;
  if (page === "orders") return "orders-reservations";
  if (page === "suppliers") return "suppliers-main";
  if (ACCESS_SECTIONS.some((section) => section.id === page)) return page;
  if (page.startsWith("customer-") || page.startsWith("customers-")) return "customers-all";
  if (page.startsWith("product-") || page.startsWith("products-")) return "products-all";
  if (page.startsWith("sales-")) return page;
  if (page.startsWith("finance-")) return page;
  if (page.startsWith("supplier-")) return "suppliers-main";
  if (page.startsWith("employee-")) return "employees";
  if (page.startsWith("debt-")) return "finance-debt";
  return page;
}

export function canAccess(user, page) {
  if (!user) return false;
  if (user.type === "director") return true;
  const section = sectionForPage(page);
  if (!section) return true;
  const permissions = user.permissions || [];
  return permissions.includes(section) || permissions.includes(legacyGroupForPage[section]);
}

export function getDirector() {
  try {
    const director = getData(DIRECTOR_KEY, null);
    if (director && !director.resetVersion) {
      const migrated = { ...director, resetVersion: 1 };
      setData(DIRECTOR_KEY, migrated);
      return migrated;
    }
    return director;
  }
  catch { return null; }
}

export function readLocalLogin() {
  try {
    const value = getData(LOCAL_LOGIN_KEY, null);
    removeData(LOCAL_LOGIN_KEY);
    return value?.login ? { login: value.login } : null;
  } catch { return null; }
}

const PASSWORD_ITERATIONS = 310000;
async function digest(password, salt, iterations = PASSWORD_ITERATIONS) {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const key = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations }, key, 256);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function legacyDigest(password, salt) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPassword(record, password) {
  if (!record?.salt || !record?.passwordHash) return false;
  const candidate = record.passwordIterations ? await digest(password, record.salt, record.passwordIterations) : await legacyDigest(password, record.salt);
  return record.passwordHash === candidate;
}

export async function createCredentials(login, password) {
  const salt = crypto.randomUUID();
  return { login: login.trim().toLowerCase(), salt, passwordHash: await digest(password, salt), passwordIterations: PASSWORD_ITERATIONS };
}

export function loginExists(login) {
  const normalized = login.trim().toLowerCase();
  return getDirector()?.login === normalized || readEmployees().some((employee) => employee.login === normalized);
}

export async function registerDirector(login, password) {
  if (getDirector()) throw new Error("Direktor hisobi allaqachon yaratilgan.");
  if (loginExists(login)) throw new Error("Bu login band.");
  setData(DIRECTOR_KEY, { ...await createCredentials(login, password), resetVersion: 1 });
  removeData(LOCAL_LOGIN_KEY);
  return { type: "director", name: "Direktor", credentialId: getDirector()?.salt };
}

export async function resetDirectorAfterRecovery(password) {
  if (password.length < 8) throw new Error("Yangi parol kamida 8 belgidan iborat bo'lsin.");
  const director = getDirector();
  if (!director) throw new Error("Direktor hisobi topilmadi.");
  const updated = { ...await createCredentials(director.login, password), resetVersion: 1 };
  setData(DIRECTOR_KEY, updated);
  removeData(LOCAL_LOGIN_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  return { type: "director", name: "Direktor", credentialId: updated.salt };
}

export async function updateDirectorCredentials(login, currentPassword, newPassword = "") {
  const normalized = login.trim().toLowerCase();
  const director = getDirector();
  if (!director) throw new Error("Direktor hisobi topilmadi.");
  assertNotLocked("crm-settings");
  if (!currentPassword || !await verifyPassword(director, currentPassword)) {
    recordFailure("crm-settings");
    throw new Error("Hozirgi parol noto'g'ri.");
  }
  if (!normalized) throw new Error("Yangi loginni kiriting.");
  if (readEmployees().some((employee) => employee.login === normalized)) {
    throw new Error("Bu login xodim tomonidan ishlatilmoqda.");
  }
  if (!newPassword && normalized === director.login) throw new Error("Login yoki parolni o'zgartiring.");
  if (newPassword && newPassword.length < 8) throw new Error("Yangi parol kamida 8 belgidan iborat bo'lsin.");
  const updated = newPassword
    ? { ...await createCredentials(normalized, newPassword), resetVersion: 1 }
    : { ...director, login: normalized, resetVersion: 1 };
  setData(DIRECTOR_KEY, updated);
  removeData(LOCAL_LOGIN_KEY);
  return updated;
}

export async function authenticate(login, password) {
  const normalized = login.trim().toLowerCase();
  assertNotLocked("crm");
  const director = getDirector();
  if (director?.login === normalized && await verifyPassword(director, password)) {
    if (!director.passwordIterations) setData(DIRECTOR_KEY, { ...director, ...await createCredentials(normalized, password), resetVersion: 1 });
    removeData(LOCAL_LOGIN_KEY);
    recordSuccess("crm");
    return { type: "director", name: "Direktor", credentialId: getDirector()?.salt };
  }
  const employee = readEmployees().find((entry) => entry.login === normalized);
  if (employee?.status === "active" && await verifyPassword(employee, password)) {
    if (!employee.passwordIterations) {
      const upgraded = { ...employee, ...await createCredentials(normalized, password) };
      saveEmployees(readEmployees().map(entry => entry.id === employee.id ? upgraded : entry));
    }
    removeData(LOCAL_LOGIN_KEY);
    recordSuccess("crm");
    return { type: "employee", id: employee.id, name: employee.name, role: employee.role, permissions: employee.permissions || [], credentialId: employee.salt };
  }
  recordFailure("crm");
  throw new Error("Login yoki parol noto'g'ri, yoxud xodim hisobi faol emas.");
}

// Sahifa yangilanganda (F5 / Ctrl+R) login so'ralmasligi uchun sessiya shu tabda (sessionStorage) saqlanadi.
// Tab yopilsa sessiya o'chadi. Parol saqlanmaydi; tiklashda hisob qayta tekshiriladi (readSession).
export function writeSession(account) {
  try { if (account) sessionStorage.setItem(SESSION_KEY, JSON.stringify(account)); } catch { /* saqlab bo'lmadi */ }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* yo'q */ }
}

export function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (saved?.type === "director") {
      const director = getDirector();
      return director && saved.credentialId === director.salt ? saved : null;
    }
    if (saved?.type === "employee") {
      const employee = readEmployees().find((entry) => entry.id === saved.id && entry.status === "active" && entry.login);
      return employee && saved.credentialId === employee.salt
        ? { type: "employee", id: employee.id, name: employee.name, role: employee.role, permissions: employee.permissions || [], credentialId: employee.salt }
        : null;
    }
  } catch { /* Invalid session */ }
  return null;
}
