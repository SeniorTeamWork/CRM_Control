import { getTextLanguage } from "../locales/languageState";
import { getData, setData } from "../supabase/db";

const STORAGE_KEY = "crm_currency_settings_v1";
const CENTRAL_BANK_META_KEY = "crm_currency_cbu_meta_v1";
const CURRENCY_RATE_MODE_KEY = "crm_currency_rate_mode_v1";
const SUPPORTED_CURRENCIES = ["UZS", "USD"];
const DEFAULT_SETTINGS = { code: "UZS", usdRate: 0, enabled: SUPPORTED_CURRENCIES };
const CENTRAL_BANK_USD_URL = "https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/";
const LOCAL_CENTRAL_BANK_USD_URL = "/api/currency/usd";

export function getCentralBankRateMeta() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CENTRAL_BANK_META_KEY) || "null");
    return value && typeof value === "object" ? value : null;
  } catch { return null; }
}

export function getCurrencyRateMode() {
  try { return window.localStorage.getItem(CURRENCY_RATE_MODE_KEY) === "manual" ? "manual" : "cbu"; } catch { return "cbu"; }
}

export function setCurrencyRateMode(mode) {
  try { window.localStorage.setItem(CURRENCY_RATE_MODE_KEY, mode === "manual" ? "manual" : "cbu"); } catch { /* rejim saqlanmasa ham shu sessiyada ishlaydi */ }
}

function saveCentralBankRateMeta(value) {
  try { window.localStorage.setItem(CENTRAL_BANK_META_KEY, JSON.stringify(value)); } catch { /* kesh saqlanmasa ham kurs ishlaydi */ }
}

export async function refreshCentralBankUsdRate() {
  if (getCurrencyRateMode() === "manual") return getCentralBankRateMeta() || { source: "manual", date: "", diff: null };
  let rateItem = null;
  const failures = [];
  for (const url of [LOCAL_CENTRAL_BANK_USD_URL, CENTRAL_BANK_USD_URL]) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const payload = await response.json();
      const candidate = Array.isArray(payload) ? payload.find((item) => item?.Ccy === "USD") : payload;
      const nominal = Number(String(candidate?.Nominal || "1").replace(",", ".")) || 1;
      const rate = Number(String(candidate?.Rate || "").replace(/\s/g, "").replace(",", ".")) / nominal;
      if (!Number.isFinite(rate) || rate <= 0 || candidate?.Ccy !== "USD") throw new Error("CBU_INVALID_RATE");
      rateItem = candidate;
      break;
    } catch (error) {
      failures.push(`${url === LOCAL_CENTRAL_BANK_USD_URL ? "Proksi" : "CBU"}: ${error?.message || "ulanish xatosi"}`);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  if (!rateItem) throw new Error(failures.join(" · ") || "CBU kursi olinmadi");

  // Yangilash vaqtida qo'lda rejim tanlangan bo'lsa, so'rov natijasi qo'lda kiritilgan qiymatni bosib ketmasin.
  if (getCurrencyRateMode() === "manual") return getCentralBankRateMeta() || { source: "manual", date: "", diff: null };

  const nominal = Number(String(rateItem.Nominal || "1").replace(",", ".")) || 1;
  const usdRate = Number(String(rateItem.Rate).replace(/\s/g, "").replace(",", ".")) / nominal;
  const current = getCurrencySettings();
  if (Math.abs(current.usdRate - usdRate) > 0.000001) saveCurrencySettings({ ...current, usdRate });

  const metadata = {
    source: "cbu.uz",
    date: String(rateItem.Date || ""),
    diff: Number(String(rateItem.Diff || "0").replace(/\s/g, "").replace(",", ".")) || 0,
    fetchedAt: new Date().toISOString(),
  };
  saveCentralBankRateMeta(metadata);
  return metadata;
}

export function saveManualUsdRate(value) {
  const usdRate = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(usdRate) || usdRate <= 0) return null;
  const settings = saveCurrencySettings({ ...getCurrencySettings(), code: "USD", usdRate });
  setCurrencyRateMode("manual");
  const metadata = { source: "manual", date: "", diff: null, fetchedAt: new Date().toISOString() };
  saveCentralBankRateMeta(metadata);
  return { settings, metadata };
}

export function getCurrencySettings() {
  try {
    const value = getData(STORAGE_KEY, {});
    const usdRate = Number(value.usdRate);
    const enabled = Array.isArray(value.enabled) ? SUPPORTED_CURRENCIES.filter((code) => value.enabled.includes(code)) : SUPPORTED_CURRENCIES;
    const safeEnabled = enabled.length ? enabled : SUPPORTED_CURRENCIES;
    return { code: value.code === "USD" && usdRate > 0 && safeEnabled.includes("USD") ? "USD" : safeEnabled[0], usdRate: usdRate > 0 ? usdRate : 0, enabled: safeEnabled };
  } catch { return DEFAULT_SETTINGS; }
}

export function saveCurrencySettings(next) {
  const current = getCurrencySettings();
  const usdRate = Number(next.usdRate ?? current.usdRate);
  const enabled = Array.isArray(next.enabled) ? SUPPORTED_CURRENCIES.filter((code) => next.enabled.includes(code)) : current.enabled;
  const safeEnabled = enabled.length ? enabled : current.enabled;
  const selected = next.code && safeEnabled.includes(next.code) ? next.code : safeEnabled[0];
  const settings = { code: selected === "USD" && usdRate > 0 ? "USD" : safeEnabled.includes("UZS") ? "UZS" : "USD", usdRate: usdRate > 0 ? usdRate : 0, enabled: safeEnabled };
  setData(STORAGE_KEY, settings);
  window.dispatchEvent(new Event("crm-currency-change"));
  return settings;
}

export const toDisplayMoney = (value) => {
  const { code, usdRate } = getCurrencySettings();
  const amount = Number(value) || 0;
  return code === "USD" && usdRate ? amount / usdRate : amount;
};

export const toBaseMoney = (value) => {
  const { code, usdRate } = getCurrencySettings();
  const amount = Number(String(value ?? "").replace(/,/g, "")) || 0;
  return Math.round(code === "USD" && usdRate ? amount * usdRate : amount);
};

export const formatCurrencyNumber = (value, { input = false } = {}) => {
  const { code } = getCurrencySettings();
  const amount = toDisplayMoney(value);
  return amount.toLocaleString("en-US", code === "USD" ? { minimumFractionDigits: input ? 0 : 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
};

export const currencyLabel = () => getCurrencySettings().code === "USD" ? "USD" : getTextLanguage() === "ru" ? "сум" : "so'm";

export const formatCurrency = (value) => `${formatCurrencyNumber(value)} ${currencyLabel()}`;

// Bo'sh qiymat (va so'mda 0) inputda "0" bo'lib turmaydi: "" qaytadi va input placeholder="0" ni ko'rsatadi.
export const moneyInputValue = (baseValue, grouped = true) => {
  const { code } = getCurrencySettings();
  if (baseValue === "" || baseValue === null || baseValue === undefined) return "";
  const amount = toDisplayMoney(baseValue);
  if (amount === 0 && code !== "USD") return "";
  return amount.toLocaleString("en-US", code === "USD"
    ? { useGrouping: grouped, maximumFractionDigits: 2 }
    : { useGrouping: grouped, maximumFractionDigits: 0 });
};
