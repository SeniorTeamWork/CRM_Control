// Supabase bilan ishlashning markazi.
//
//  - Sahifalar ma'lumotni bolimlar/*.js dagi funksiyalar orqali oladi va saqlaydi (getProducts, saveProducts ...).
//  - Ma'lumot Supabase'dan yuklanadi, bolimlar/*.js dagi map funksiyalari bilan ilova ko'rinishiga keltiriladi
//    va sayt ochiq turgan paytda xotirada (memory) turadi. Brauzer xotirasiga (localStorage) yozilmaydi.
//  - Saqlanganda faqat o'zgargan yozuvlar Supabase'ga yuboriladi. Internet uzilsa, navbatda turadi.
//  - Boshqa kassir yoki kompyuter o'zgartirsa (Realtime yoki har 20 soniyada tekshiruv), ma'lumot
//    qayta yuklanadi va ochiq sahifalar yangilanadi.
//  - Supabase'ga ulanib bo'lmasa, sayt avvalgidek brauzer xotirasi bilan ishlaydi.
import { useEffect, useState } from "react";
import { supabase, markaz, mijozLoyihasigaUlan, alohidaLoyihami } from "./supabase";
import {
  COLLECTIONS, NESTED, SUPPLIER_ORDERS_PREFIX, arr, plain, appId, stableStringify,
  supplierOrderToItem, supplierPaymentsOf, isUuid, tenantToRow, tenantFromRow, mergeTicket,
  presenceToPatch, presenceFromRow, currencyToPatch,
} from "./mappers";
import { bolimlar, bolimJadvallari } from "./bolimlar";

// Navbat va xizmat belgilari brauzerda qoladi (bular biznes ma'lumoti emas).
const QUEUE_KEY = "sb_sync_queue_v1";
const DIRTY_KEY = "sb_sync_dirty_v1";
const READY_KEY = "sb_sync_ready_v1";
const BLOCKED_KEY = "sb_blocked_tables_v1";
const RESYNC_KEY = "sb_resync_tables_v1";
const ASOSIY_KEY = "sb_asosiy_dokon";
export const ADMIN_KEY = "super_admin_data_v1";
export const PRESENCE_KEY = "tenant_presence_v1";
const SALE_READY_KEY = "crm_sale_ready_reset";
const SALE_READY_VERSION = "sale-ready-v4";
const LOCAL_TICKET_TENANT = "local-crm";
const PAGE = 1000;
const REFRESH_MS = 20000;
// Sinov rejimi: Supabase'dan faqat o'qiladi, yuboriladigan o'zgarishlar crmSupabase.holat().sinov ga yoziladi.
const DRY_RUN = process.env.REACT_APP_SUPABASE_DRY_RUN === "true";

const PRIORITY = {
  dokonlar: 0, super_admin: 0, xodimlar: 1, mijozlar: 1, taminotchilar: 1, ustalar: 1,
  buyurtmalar: 2, sotuvlar: 3, mahsulotlar: 4, moliya: 4, taminot_kirimlari: 4, qoralamalar: 4,
};

/* ---------------- Brauzer xotirasi (faqat xizmat belgilari uchun) ---------------- */

const proto = typeof Storage !== "undefined" ? Storage.prototype : null;
const raw = proto ? { get: proto.getItem, set: proto.setItem, remove: proto.removeItem } : null;
const storage = () => { try { return window.localStorage; } catch { return null; } };
const rawGet = (key) => { try { return raw.get.call(storage(), key); } catch { return null; } };
const rawSet = (key, value) => { try { raw.set.call(storage(), key, value); return true; } catch { return false; } };
const rawRemove = (key) => { try { raw.remove.call(storage(), key); } catch { /* yo'q */ } };
const parse = (value) => { try { return value === null || value === undefined ? null : JSON.parse(value); } catch { return null; } };
const readJson = (key, fallback) => parse(rawGet(key)) ?? fallback;

const state = {
  mode: "local", // "supabase" — ma'lumot Supabase'dan yuklangan va xotirada turadi
  ready: false,
  bootAt: Date.now(),
  asosiyId: null,
  tenantMode: false,
  tenantId: "",
  // Super Admin qatori Supabase'dan muvaffaqiyatli tekshirildimi va topildimi.
  superAdminChecked: false,
  superAdminFound: false,
  activeDokonId: null,
  memory: new Map(),
  listeners: new Map(),
  snapshots: new Map(),
  pending: new Map(),
  flushTimer: null,
  ids: new Map(),
  appIds: new Map(),
  content: new Map(),
  queue: [],
  running: false,
  retryTimer: null,
  retryDelay: 0,
  refreshTimer: null,
  refreshing: false,
  writeSeq: 0, // har bir saqlashda oshadi: yangilash paytida saqlangan bo'lsa, eski javob qo'llanmaydi
  refreshSeq: 0,
  log: [],
  hydrateCancelled: false,
  dryRun: [],
  // Do'konning o'z Supabase loyihasi bor, lekin hali tayyor emas yoki manzilini bilib bo'lmadi:
  // bunday paytda hech narsa yuborilmaydi (ma'lumot asosiy loyihaga tushib qolmasligi uchun).
  loyihaKutilmoqda: false,
};

function note(level, message, extra) {
  state.log.unshift({ at: new Date().toISOString(), level, message, ...(extra ? { extra } : {}) });
  state.log.length = Math.min(state.log.length, 50);
  // eslint-disable-next-line no-console
  (level === "error" ? console.warn : console.info)(`[Supabase] ${message}`, extra || "");
}

/* ---------------- Kalitlar ---------------- */

function specFor(key) {
  if (COLLECTIONS[key]) return { type: "collection", conf: COLLECTIONS[key] };
  if (NESTED[key]) return { type: "nested", conf: NESTED[key] };
  if (key.startsWith(SUPPLIER_ORDERS_PREFIX) && key.length > SUPPLIER_ORDERS_PREFIX.length) return { type: "supplierOrders", supplierId: key.slice(SUPPLIER_ORDERS_PREFIX.length) };
  if (key === "crm_currency_settings_v1") return { type: "currency" };
  if (key === "crm_director_cards_v1") return { type: "cards" };
  if (key === "crm_director_account") return { type: "director" };
  if (/^crm_profile_(director|employee_.+)$/.test(key)) return { type: "profile", who: key.slice("crm_profile_".length) };
  if (key === ADMIN_KEY) return { type: "admin" };
  if (key === PRESENCE_KEY) return { type: "presence" };
  return null;
}

// Supabase rejimida qaysi kalitlar xotirada turadi. Qolganlari (til, tema, ochiq savat) brauzerda qoladi.
function inMemory(key) {
  if (state.mode !== "supabase") return false;
  if (key === ADMIN_KEY || key === PRESENCE_KEY) return true;
  if (!state.tenantMode) return false;
  return Boolean(specFor(key)) || key.startsWith("crm_document_numbers_") || key === "crm_document_id_backup";
}

const dokonOf = () => (state.tenantMode ? state.tenantId : null);

const idKey = (dokonId, table, ilova) => `${dokonId}|${table}|${ilova}`;
function remember(dokonId, table, ilova, pk) {
  if (pk === null || pk === undefined || ilova === null || ilova === undefined) return;
  state.ids.set(idKey(dokonId, table, ilova), pk);
  state.appIds.set(idKey(dokonId, table, pk), String(ilova));
}
function forget(dokonId, table, ilova) {
  const pk = state.ids.get(idKey(dokonId, table, ilova));
  state.ids.delete(idKey(dokonId, table, ilova));
  if (pk !== undefined) state.appIds.delete(idKey(dokonId, table, pk));
}

const salePk = (dokonId, ilova) => (dokonId === state.asosiyId ? ilova : `${String(dokonId).slice(0, 8)}:${ilova}`);

/* ---------------- Sahifalar uchun: o'qish, saqlash, kuzatish ---------------- */

function readText(key) {
  if (inMemory(key)) return state.memory.has(key) ? state.memory.get(key) : null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}

const remoteListeners = new Set();
let remoteVersion = 0;

function emit(key, external) {
  arr([...(state.listeners.get(key) || [])]).forEach((listener) => listener());
  if (external) {
    remoteVersion += 1;
    remoteListeners.forEach((listener) => listener(remoteVersion));
  }
  // Boshqa joydan kelgan o'zgarish: sahifalardagi "storage" tinglovchilari ham yangilanadi.
  if (external && typeof window !== "undefined") {
    try { window.dispatchEvent(new StorageEvent("storage", { key })); } catch { window.dispatchEvent(new Event("storage")); }
  }
}

// Har safar yangi nusxa qaytadi: sahifa uni o'zgartirsa ham saqlangan holat buzilmaydi.
export function getData(key, fallback = null) {
  const value = parse(readText(key));
  if (value !== null && value !== undefined) return value;
  // Do'kon havolasi bilan ochilgan, lekin ma'lumot yo'q (Supabase'ga ulanmagan): sahifalar namunaviy
  // (soxta) ro'yxatni ko'rsatmasin — aks holda u keyinroq haqiqiy bazaga yozilib ketardi.
  if (fallback === null && state.tenantMode && (COLLECTIONS[key] || NESTED[key])) return [];
  return fallback;
}

export function setData(key, value) {
  const text = JSON.stringify(value);
  const old = readText(key);
  if (inMemory(key)) state.memory.set(key, text);
  else {
    try { window.localStorage.setItem(key, text); } catch (error) { throw error; }
  }
  if (specFor(key) && (state.tenantMode || key === ADMIN_KEY || key === PRESENCE_KEY)) noteWrite(key, old, text);
  emit(key, false);
}

export function removeData(key) {
  if (inMemory(key)) state.memory.delete(key);
  else { try { window.localStorage.removeItem(key); } catch { /* yo'q */ } }
  emit(key, false);
}

export function subscribeData(key, listener) {
  if (!state.listeners.has(key)) state.listeners.set(key, new Set());
  state.listeners.get(key).add(listener);
  return () => state.listeners.get(key)?.delete(listener);
}

// React hook: qiymat o'zgarsa (shu sahifada yoki boshqa kassirda) komponent qayta chiziladi.
export function useData(key, fallback = null) {
  const [value, setValue] = useState(() => getData(key, fallback));
  useEffect(() => {
    setValue(getData(key, fallback));
    return subscribeData(key, () => setValue(getData(key, fallback)));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

// React hook: boshqa kassir/kompyuterdan o'zgarish kelganda oshadigan raqam.
// Sahifa uni useEffect'ga qo'shib, ro'yxatlarini Supabase'dan kelgan yangi holatdan qayta o'qiydi.
export function useDataVersion() {
  const [version, setVersion] = useState(remoteVersion);
  useEffect(() => {
    remoteListeners.add(setVersion);
    return () => { remoteListeners.delete(setVersion); };
  }, []);
  return version;
}

export const activeDokonId = () => (state.mode === "supabase" ? state.activeDokonId : null);
export const isDryRun = () => DRY_RUN;
// Super Admin hisobini yaratishga ruxsat: faqat birinchi o'rnatishda (hisob ham, mijoz do'konlari ham yo'q bo'lsa).
// Supabase'ga ulanib, hisob borligini tekshira olmagan bo'lsak — yaratishga ruxsat yo'q.
export const superAdminSetupState = () => ({ supabase: state.mode === "supabase", checked: state.superAdminChecked, found: state.superAdminFound });

/* ---------------- O'zgarishlarni kuzatish ---------------- */

function noteWrite(key, oldRaw, newRaw) {
  if (oldRaw === newRaw) return;
  state.writeSeq += 1;
  if (!state.snapshots.has(key)) state.snapshots.set(key, parse(oldRaw));
  // Sahifa yopilib qolsa ham o'zgarish yo'qolmasin: oldingi va yangi holat brauzerga yoziladi.
  const dirty = readJson(DIRTY_KEY, {});
  dirty[key] = { prev: JSON.stringify(state.snapshots.get(key) ?? null), next: newRaw, dokonId: dokonOf() };
  rawSet(DIRTY_KEY, JSON.stringify(dirty));
  state.pending.set(key, newRaw);
  clearTimeout(state.flushTimer);
  state.flushTimer = setTimeout(flushPending, 400);
}

async function flushPending() {
  const entries = [...state.pending];
  state.pending.clear();
  const batch = [];
  for (const [key, value] of entries) {
    const prev = state.snapshots.get(key);
    const next = parse(value);
    state.snapshots.set(key, next);
    try {
      batch.push(...await buildOps(key, prev, next, dokonOf()));
    } catch (error) {
      note("error", `${key} uchun o'zgarishlar tayyorlanmadi`, error?.message);
    }
  }
  enqueue(sortBatch(batch));
  const dirty = readJson(DIRTY_KEY, {});
  entries.forEach(([key]) => { if (!state.pending.has(key)) delete dirty[key]; });
  rawSet(DIRTY_KEY, JSON.stringify(dirty));
}

/* ---------------- O'zgarishlarni amallarga aylantirish ---------------- */

const massWipe = (prevList, nextList) => {
  // Ochilish paytidagi avtomatik tozalash butun bazani o'chirib yubormasin.
  if (nextList.length === 0 && prevList.length >= 3 && Date.now() - state.bootAt < 10000) {
    note("error", "Ochilish paytida ro'yxat to'liq bo'shatildi — Supabase'dagi yozuvlar o'chirilmadi.");
    return true;
  }
  return false;
};

function writeCtx(conf = {}) {
  let products = null;
  return {
    customerPrefix: conf.customerPrefix || "",
    costOf: (productId) => {
      if (!products) products = arr(getData("crm_products", []));
      return products.find((product) => String(product.id) === String(productId))?.cost ?? 0;
    },
  };
}

function rowFor(conf, dokonId, ilova, item, w) {
  const filter = conf.filter || {};
  const row = { ...conf.toRow(item, w), ...filter, dokon_id: dokonId, ilova_id: ilova, malumot: conf.malumotOf ? conf.malumotOf(item) : item };
  if (conf.table === "sotuvlar") row.id = salePk(dokonId, ilova);
  return row;
}

const upsertOp = (table, dokonId, ilova, row) => ({ kind: "upsert", table, dokonId, ilova, row });
const deleteOp = (table, dokonId, ilova) => ({ kind: "delete", table, dokonId, ilova });

async function buildOps(key, prev, next, dokonId) {
  const spec = specFor(key);
  if (!spec) return [];
  switch (spec.type) {
    case "collection": return dokonId ? collectionOps(spec.conf, dokonId, key, prev, next) : [];
    case "nested": return dokonId ? nestedOps(spec.conf, dokonId, prev, next) : [];
    case "supplierOrders": return dokonId ? supplierOrderOps(spec.supplierId, dokonId, prev, next) : [];
    case "currency": return dokonId ? [{ kind: "dokonPatch", dokonId, patch: currencyToPatch(next), dedupe: `currency|${dokonId}` }] : [];
    case "cards": return dokonId ? [{ kind: "dokonPatch", dokonId, patch: { kartalar: arr(next) }, dedupe: `cards|${dokonId}` }] : [];
    case "director": return dokonId && next?.salt && next?.passwordHash ? [{ kind: "director", dokonId, account: next, dedupe: `director|${dokonId}` }] : [];
    case "profile": return dokonId && next ? [{ kind: "profile", dokonId, who: spec.who, profile: next, dedupe: `profile|${dokonId}|${spec.who}` }] : [];
    case "admin": return adminOps(prev, next);
    case "presence": return presenceOps(prev, next);
    default: return [];
  }
}

function collectionOps(conf, dokonId, key, prev, next) {
  const toList = conf.toList || arr;
  const prevList = toList(prev);
  const nextList = toList(next);
  if (massWipe(prevList, nextList)) return [];
  const w = writeCtx(conf);
  if (conf.contentKeyed) return contentOps(conf, dokonId, key, prevList, nextList, w);

  const keyOf = (item) => (item && item.id !== undefined && item.id !== null && item.id !== "" ? `${conf.ilovaPrefix || ""}${item.id}` : null);
  // Bir xil id'li yozuvlar bir-birini "o'chirmasin": ikkinchisi "#2" bilan alohida saqlanadi.
  const toMap = (list) => {
    const seen = new Map();
    return new Map(list.map((item) => {
      const itemKey = keyOf(item);
      if (!itemKey) return [null, item];
      const n = (seen.get(itemKey) || 0) + 1;
      seen.set(itemKey, n);
      return [n === 1 ? itemKey : `${itemKey}#${n}`, item];
    }).filter(([itemKey]) => itemKey));
  };
  const before = toMap(prevList);
  const after = toMap(nextList);
  const ops = [];
  const added = [...after.keys()].filter((itemKey) => !before.has(itemKey));
  const removed = [...before.keys()].filter((itemKey) => !after.has(itemKey));

  // Sotuv raqami o'zgarsa (S-2844 -> S-202609071) qator o'chirilmaydi, faqat ilova_id yangilanadi.
  if (conf.table === "sotuvlar") {
    removed.slice().forEach((oldKey) => {
      const receipt = before.get(oldKey)?.receiptNumber;
      const newKey = receipt && added.find((itemKey) => after.get(itemKey)?.receiptNumber === receipt);
      if (!newKey) return;
      ops.push({ kind: "rename", table: conf.table, dokonId, from: oldKey, to: newKey });
      removed.splice(removed.indexOf(oldKey), 1);
    });
  }
  for (const [ilova, item] of after) {
    const old = before.get(ilova);
    if (old && stableStringify(old) === stableStringify(item)) continue;
    ops.push(upsertOp(conf.table, dokonId, ilova, rowFor(conf, dokonId, ilova, item, w)));
  }
  removed.forEach((ilova) => ops.push(deleteOp(conf.table, dokonId, ilova)));
  return ops;
}

export const contentKeys = (entries) => {
  const counts = new Map();
  return entries.map((entry) => {
    const base = `${entry.kind}|${stableStringify(entry.item)}`;
    const n = (counts.get(base) || 0) + 1;
    counts.set(base, n);
    return [`${base}#${n}`, entry];
  });
};

async function contentOps(conf, dokonId, key, prevList, nextList, w) {
  const index = await contentIndex(dokonId, key, conf);
  const before = new Map(contentKeys(prevList));
  const after = new Map(contentKeys(nextList));
  const ops = [];
  for (const [contentKey, entry] of after) {
    if (before.has(contentKey)) continue;
    const ilova = index.get(contentKey) || `fin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    index.set(contentKey, ilova);
    ops.push(upsertOp(conf.table, dokonId, ilova, rowFor(conf, dokonId, ilova, entry, w)));
  }
  for (const [contentKey] of before) {
    if (after.has(contentKey)) continue;
    const ilova = index.get(contentKey);
    if (ilova) ops.push(deleteOp(conf.table, dokonId, ilova));
    index.delete(contentKey);
  }
  return ops;
}

async function contentIndex(dokonId, key, conf) {
  const cacheKey = `${dokonId}|${key}`;
  if (state.content.has(cacheKey)) return state.content.get(cacheKey);
  const index = new Map();
  try {
    const rows = await fetchAll(conf.table, (q) => q.eq("dokon_id", dokonId));
    const ctx = mapContext(dokonId, {});
    contentKeys(rows.map((row) => conf.fromRow(row, ctx))).forEach(([contentKey], i) => index.set(contentKey, rows[i].ilova_id || String(rows[i].id)));
  } catch (error) {
    note("error", "Moliya yozuvlarini solishtirish uchun yuklab bo'lmadi", error?.message);
  }
  state.content.set(cacheKey, index);
  return index;
}

function groupBy(list, parentOf) {
  const groups = new Map();
  list.forEach((item) => {
    const parent = parentOf(item);
    if (parent === null || parent === undefined || parent === "") return;
    const groupKey = String(parent);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(item);
  });
  return groups;
}

function nestedOps(conf, dokonId, prev, next) {
  const prevList = arr(prev);
  const nextList = arr(next);
  if (massWipe(prevList, nextList)) return [];
  const before = groupBy(prevList, conf.parentOf);
  const after = groupBy(nextList, conf.parentOf);
  const w = writeCtx();
  const ops = [];
  new Set([...before.keys(), ...after.keys()]).forEach((parent) => {
    const items = after.get(parent) || [];
    if (stableStringify(before.get(parent) || []) === stableStringify(items)) return;
    const mapped = items.map((item) => conf.toItem(item, w));
    ops.push({
      kind: "patch", table: conf.parentTable, dokonId, ilova: parent,
      patch: { [conf.column]: mapped, ...(conf.extraPatch ? conf.extraPatch(mapped) : {}) },
      dedupe: `patch|${conf.parentTable}|${dokonId}|${parent}|${conf.column}`,
    });
  });
  return ops;
}

function supplierOrderOps(supplierId, dokonId, prev, next) {
  const orders = arr(next);
  if (stableStringify(arr(prev)) === stableStringify(orders)) return [];
  const w = writeCtx();
  return [{
    kind: "patch", table: "taminotchilar", dokonId, ilova: String(supplierId),
    patch: { buyurtmalar: orders.map((order) => supplierOrderToItem(order, w)), tolovlar: supplierPaymentsOf(orders) },
    dedupe: `patch|taminotchilar|${dokonId}|${supplierId}|buyurtmalar`,
  }];
}

const ticketDokon = (tenantId) => (isUuid(tenantId) ? tenantId : state.asosiyId);

function adminOps(prev, next) {
  const before = plain(prev);
  const after = plain(next);
  const ops = [];
  const oldTenants = new Map(arr(before.tenants).map((tenant) => [tenant.id, tenant]));
  const newTenants = new Map(arr(after.tenants).map((tenant) => [tenant.id, tenant]));
  newTenants.forEach((tenant, id) => {
    if (!isUuid(id)) return;
    const old = oldTenants.get(id);
    if (old && stableStringify(tenantToRow(old)) === stableStringify(tenantToRow(tenant))) return;
    ops.push({ kind: "tenantUpsert", id, row: tenantToRow(tenant), dedupe: `tenant|${id}` });
  });
  oldTenants.forEach((tenant, id) => {
    if (!newTenants.has(id) && isUuid(id) && id !== state.asosiyId) ops.push({ kind: "tenantDelete", id, dedupe: `tenant|${id}` });
  });
  const oldTickets = new Map(arr(before.tickets).map((ticket) => [ticket.id, ticket]));
  arr(after.tickets).forEach((ticket) => {
    const dokonId = ticketDokon(ticket.tenantId);
    if (!dokonId || stableStringify(oldTickets.get(ticket.id)) === stableStringify(ticket)) return;
    ops.push({ kind: "ticket", dokonId, ticket, dedupe: `ticket|${ticket.id}` });
  });
  const account = after.account;
  const adminPart = (data) => stableStringify([data.account || null, data.profile || {}, data.preferences || {}, data.meta || {}]);
  if (!state.tenantMode && account?.salt && account?.passwordHash && adminPart(before) !== adminPart(after)) {
    ops.push({
      kind: "superAdmin", dedupe: "superAdmin",
      row: {
        login: account.login, parol_hash: account.passwordHash, salt: account.salt,
        parol_iteratsiya: account.passwordIterations || 310000,
        profil: plain(after.profile), sozlamalar: plain(after.preferences), meta: plain(after.meta),
      },
    });
  }
  return ops;
}

function presenceOps(prev, next) {
  const before = plain(prev);
  const ops = [];
  Object.entries(plain(next)).forEach(([tenantId, entry]) => {
    if (!isUuid(tenantId) || stableStringify(before[tenantId]) === stableStringify(entry)) return;
    ops.push({ kind: "dokonPatch", dokonId: tenantId, patch: presenceToPatch(plain(entry)), markaz: true, dedupe: `presence|${tenantId}` });
  });
  return ops;
}

function rank(op) {
  const p = PRIORITY[op.table] ?? 5;
  switch (op.kind) {
    case "tenantUpsert": case "superAdmin": return 0;
    case "director": return 1;
    case "rename": return p - 0.5;
    case "upsert": return p;
    case "delete": return 20 - p;
    case "tenantDelete": return 30;
    default: return 10;
  }
}
const sortBatch = (ops) => ops.map((op, i) => [op, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([op]) => op);

/* ---------------- Navbat (yuborilmagan o'zgarishlar) ---------------- */

function saveQueue() {
  if (!rawSet(QUEUE_KEY, JSON.stringify(state.queue))) note("error", "Navbatni saqlab bo'lmadi (brauzer xotirasi to'lgan)");
}

function enqueue(ops) {
  ops.forEach((op) => {
    op.dedupe = op.dedupe || (op.kind === "upsert" || op.kind === "delete" ? `row|${op.table}|${op.dokonId}|${op.ilova}` : null);
    const start = state.running ? 1 : 0;
    const existing = op.dedupe ? state.queue.findIndex((item, i) => i >= start && item.dedupe === op.dedupe) : -1;
    if (existing >= 0) state.queue[existing] = op;
    else state.queue.push(op);
  });
  if (ops.length) {
    saveQueue();
    processQueue();
  }
}

function scheduleRetry() {
  clearTimeout(state.retryTimer);
  state.retryDelay = Math.min(60000, state.retryDelay ? state.retryDelay * 2 : 3000);
  state.retryTimer = setTimeout(processQueue, state.retryDelay);
}

async function processQueue() {
  if (state.running || state.loyihaKutilmoqda) return;
  state.running = true;
  try {
    while (state.queue.length) {
      const op = state.queue[0];
      if (DRY_RUN) {
        state.dryRun.push(await resolveRefs(op, op.dokonId || state.asosiyId).catch(() => op));
        state.queue.shift();
        saveQueue();
        continue;
      }
      try {
        await runOp(op);
      } catch (error) {
        if (error?.transient) { scheduleRetry(); break; }
        if (error?.code === "42501" && op.table) setBlocked(op.table, true);
        note("error", `${op.kind} ${op.table || ""} ${op.ilova || op.id || ""} yuborilmadi`, error?.message);
      }
      state.queue.shift();
      saveQueue();
      state.retryDelay = 0;
    }
  } finally {
    state.running = false;
  }
}

async function call(builder) {
  const { data, error, status } = await builder;
  if (error) {
    const failure = new Error(`${error.code || status || ""} ${error.message || ""}`.trim());
    failure.code = error.code;
    failure.transient = !status || status >= 500 || status === 408 || status === 429;
    throw failure;
  }
  return data;
}

async function resolveRefs(value, dokonId) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveRefs(item, dokonId)));
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.$ref)) return lookupId(dokonId, value.$ref[0], value.$ref[1]);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = key === "malumot" ? item : await resolveRefs(item, dokonId);
  return out;
}

async function lookupId(dokonId, table, ilova) {
  const key = idKey(dokonId, table, ilova);
  if (state.ids.has(key)) return state.ids.get(key);
  // Bog'langan yozuv hali navbatda bo'lsa, avval o'shani yuboramiz.
  const index = state.queue.findIndex((op, i) => i > 0 && op.kind === "upsert" && op.table === table && op.dokonId === dokonId && op.ilova === ilova);
  if (index > 0 && !DRY_RUN) {
    const [dependency] = state.queue.splice(index, 1);
    saveQueue();
    try { await runOp(dependency); } catch (error) {
      if (error?.transient) { state.queue.splice(1, 0, dependency); saveQueue(); throw error; }
    }
    if (state.ids.has(key)) return state.ids.get(key);
  }
  const data = await call(supabase.from(table).select("id").eq("dokon_id", dokonId).eq("ilova_id", ilova).limit(1));
  const pk = data?.[0]?.id ?? null;
  if (pk !== null) remember(dokonId, table, ilova, pk);
  return pk;
}

async function upsertByIlova(op, body) {
  const { id, ...changes } = body;
  const updated = await call(supabase.from(op.table).update(changes).eq("dokon_id", op.dokonId).eq("ilova_id", op.ilova).select("id"));
  if (updated.length) return updated[0].id;
  const inserted = await call(supabase.from(op.table).insert(body).select("id"));
  return inserted[0]?.id;
}

async function runOp(op) {
  switch (op.kind) {
    case "upsert": {
      let body = await resolveRefs(op.row, op.dokonId);
      try {
        remember(op.dokonId, op.table, op.ilova, await upsertByIlova(op, body));
        setBlocked(op.table, false);
      } catch (error) {
        if (error.code !== "23505" || !/sku/i.test(error.message) || op.table !== "mahsulotlar") throw error;
        body = { ...body, sku: `${body.sku}-${op.ilova}` };
        remember(op.dokonId, op.table, op.ilova, await upsertByIlova(op, body));
      }
      return;
    }
    case "rename": {
      await call(supabase.from(op.table).update({ ilova_id: op.to }).eq("dokon_id", op.dokonId).eq("ilova_id", op.from));
      forget(op.dokonId, op.table, op.from);
      return;
    }
    case "delete": {
      await call(supabase.from(op.table).delete().eq("dokon_id", op.dokonId).eq("ilova_id", op.ilova));
      forget(op.dokonId, op.table, op.ilova);
      return;
    }
    case "patch": {
      const patch = await resolveRefs(op.patch, op.dokonId);
      const data = await call(supabase.from(op.table).update(patch).eq("dokon_id", op.dokonId).eq("ilova_id", op.ilova).select("id"));
      const hasItems = Object.values(op.patch).some((value) => Array.isArray(value) && value.length);
      if (!data.length && hasItems) note("error", `${op.table}: "${op.ilova}" topilmadi, ichki ro'yxat saqlanmadi`);
      return;
    }
    case "dokonPatch": {
      // Onlayn holat Super Admin uchun asosiy loyihada, valyuta va kartalar do'konning o'z loyihasida.
      await call((op.markaz ? markaz : supabase).from("dokonlar").update(op.patch).eq("id", op.dokonId));
      return;
    }
    case "director": {
      const account = op.account;
      const updated = await call(supabase.from("xodimlar").update({ login: account.login, parol_hash: account.passwordHash, malumot: account })
        .eq("dokon_id", op.dokonId).eq("rol", "direktor").select("id"));
      if (!updated.length) {
        await call(supabase.from("xodimlar").insert({
          dokon_id: op.dokonId, ilova_id: "director", ism: "Direktor", lavozim: "Direktor", rol: "direktor",
          holat: "active", hisob_faol: true, login: account.login, parol_hash: account.passwordHash, malumot: account,
        }));
      }
      return;
    }
    case "profile": {
      let query = supabase.from("xodimlar").update({ profil: op.profile }).eq("dokon_id", op.dokonId);
      query = op.who === "director" ? query.eq("rol", "direktor") : query.eq("ilova_id", op.who.replace(/^employee_/, ""));
      await call(query);
      return;
    }
    case "tenantUpsert": {
      const updated = await call(markaz.from("dokonlar").update(op.row).eq("id", op.id).select("id"));
      if (!updated.length) await call(markaz.from("dokonlar").insert({ id: op.id, ...op.row, asosiy: false }));
      return;
    }
    case "tenantDelete": {
      if (op.id !== state.asosiyId) await call(markaz.from("dokonlar").delete().eq("id", op.id).eq("asosiy", false));
      return;
    }
    case "ticket": {
      const rows = await call(markaz.from("dokonlar").select("yordam_xabarlari").eq("id", op.dokonId).limit(1));
      if (!rows.length) return;
      const tickets = arr(rows[0].yordam_xabarlari);
      const index = tickets.findIndex((ticket) => ticket.id === op.ticket.id);
      const next = index >= 0
        ? tickets.map((ticket, i) => (i === index ? mergeTicket(ticket, op.ticket) : ticket))
        : [...tickets, op.ticket];
      await call(markaz.from("dokonlar").update({ yordam_xabarlari: next }).eq("id", op.dokonId));
      return;
    }
    case "superAdmin": {
      const updated = await call(markaz.from("super_admin").update(op.row).eq("id", 1).select("id"));
      if (!updated.length) await call(markaz.from("super_admin").insert({ id: 1, ...op.row }));
      return;
    }
    default:
  }
}

/* ---------------- Supabase'dan o'qish ---------------- */

// Jadvaldagi barcha qatorlar (1000 tadan bo'lib). build — filtr, masalan q => q.eq("dokon_id", id).
// client — qaysi loyihadan o'qish (odatda do'kon ma'lumoti turgan loyiha).
export async function fetchAll(table, build = (q) => q, client = supabase) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const data = await call(build(client.from(table).select("*")).order("id").range(from, from + PAGE - 1));
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function tryFetchAll(table, build) {
  try {
    return await fetchAll(table, build);
  } catch (error) {
    if (error?.transient) throw error;
    note("error", `"${table}" jadvalini o'qib bo'lmadi — bu bo'lim mahalliy ma'lumot bilan ishlaydi`, error?.message);
    return null;
  }
}

export async function fetchByIds(view, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    try {
      const data = await call(supabase.from(view).select("*").in("id", ids.slice(i, i + 150)));
      data.forEach((row) => out.set(row.id, row));
    } catch (error) {
      if (error?.transient) throw error;
      return out;
    }
  }
  return out;
}

const stripPrefix = (value) => (value === null || value === undefined ? value : String(value).replace(/^qoshimcha:/, ""));

// Map funksiyalariga beriladigan yordamchi: boshqa jadvaldagi qator id'sini ilova id'siga aylantiradi.
function mapContext(dokonId, rows) {
  const staff = arr(rows.xodimlar);
  return {
    dokonId,
    rows,
    appIdOf: (table, pk) => {
      if (pk === null || pk === undefined) return undefined;
      const ilova = state.appIds.get(idKey(dokonId, table, pk));
      return ilova === undefined ? undefined : appId(stripPrefix(ilova));
    },
    stripPrefix,
    staffName: (pk) => staff.find((row) => row.id === pk)?.ism,
    customerStats: new Map(),
    supplierStats: new Map(),
    productCountBySupplier: new Map(),
    // Bo'limlar sotuvlar raqamini saqlash kabi qo'shimcha kalitlarni yozishi uchun.
    content: state.content,
    contentKeys,
  };
}

// RLS ruxsati yo'q jadval Supabase'dan bo'sh qaytadi: uni "bo'sh" deb ma'lumotni o'chirmaymiz.
const blockedTables = () => arr(readJson(BLOCKED_KEY, []));
function setBlocked(table, blocked) {
  const list = blockedTables();
  if (blocked === list.includes(table)) return;
  rawSet(BLOCKED_KEY, JSON.stringify(blocked ? [...list, table] : list.filter((item) => item !== table)));
  if (blocked) note("error", `"${table}" jadvaliga yozish uchun RLS ruxsati yo'q — SUPABASE-SQL.sql faylini ishga tushiring`);
  else rawSet(RESYNC_KEY, JSON.stringify([...new Set([...resyncTables(), table])]));
}
const resyncTables = () => arr(readJson(RESYNC_KEY, []));

// Ruxsat SQL'i ishga tushirilganini bilish: mavjud bo'lmagan do'kon bilan sinov yozuvi.
// Tashqi kalit xatosi bilan rad etiladi, shuning uchun bazada hech narsa qolmaydi.
async function recheckBlocked() {
  if (DRY_RUN) return;
  for (const table of blockedTables()) {
    if (table === "super_admin") continue;
    const { error, status } = await supabase.from(table).insert({ dokon_id: "00000000-0000-0000-0000-000000000000" });
    if (!status || status >= 500) return;
    if (error?.code !== "42501") setBlocked(table, false);
  }
}

const readyList = () => arr(readJson(READY_KEY, []));
const markReady = (id) => { const list = readyList(); if (!list.includes(id)) rawSet(READY_KEY, JSON.stringify([...list, id])); };

function unionById(remote, extra) {
  const known = new Set(remote.map((item) => String(item?.id)));
  const missing = arr(extra).filter((item) => item?.id !== undefined && !known.has(String(item.id)));
  return missing.length ? [...remote, ...missing] : remote;
}

// Hali yuborilmagan mahalliy o'zgarishi bor kalit Supabase'dagi eski holat bilan almashtirilmaydi.
function hasLocalChanges(key) {
  if (state.pending.has(key)) return true;
  const spec = specFor(key);
  const table = spec?.conf?.table || spec?.conf?.parentTable || (spec?.type === "supplierOrders" ? "taminotchilar" : null);
  return state.queue.some((op) => (table && op.table === table) || (!table && op.kind !== "upsert" && op.kind !== "delete"));
}

// Supabase'dan kelgan qiymatni xotiraga yozadi.
//  remoteValue — Supabase'dagi holat, value — xotiraga yoziladigan holat (birinchi ulanishda mahalliy bilan birlashgan).
function applyRemote(key, remoteValue, value, { refresh = false } = {}) {
  if (state.hydrateCancelled) return;
  if (refresh && (hasLocalChanges(key) || state.writeSeq !== state.refreshSeq)) return;
  const text = JSON.stringify(value);
  const changed = state.memory.get(key) !== text;
  state.memory.set(key, text);
  state.snapshots.set(key, remoteValue);
  if (!refresh && stableStringify(value) !== stableStringify(remoteValue)) {
    // Faqat brauzerda bo'lgan yozuvlar Supabase'ga yuboriladi.
    state.pending.set(key, text);
    clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(flushPending, 400);
  }
  if (changed) emit(key, refresh);
}

/* ---------------- Do'kon ma'lumotini yuklash (bolimlar/*.js orqali) ---------------- */

async function hydrateDokon(dokon, { refresh = false } = {}) {
  const dokonId = dokon.id;
  const scope = `tenant:${dokonId}:`;
  const firstRun = !refresh && !readyList().includes(dokonId);
  const resync = refresh ? [] : resyncTables();
  const byDokon = (q) => q.eq("dokon_id", dokonId);
  const blocked = blockedTables();
  const results = await Promise.all(bolimJadvallari().map((table) => (blocked.includes(table) ? null : tryFetchAll(table, byDokon))));
  const rows = Object.fromEntries(bolimJadvallari().map((table, i) => [table, results[i]]));
  rows.dokonlar = [dokon];

  Object.entries(rows).forEach(([table, list]) => {
    if (table === "dokonlar") return;
    arr(list).forEach((row) => {
      if (!row.ilova_id) {
        row.ilova_id = String(row.id);
        if (!DRY_RUN) supabase.from(table).update({ ilova_id: row.ilova_id }).eq("id", row.id).then(() => {}, () => {});
      }
      remember(dokonId, table, row.ilova_id, row.id);
    });
  });

  const ctx = mapContext(dokonId, rows);
  for (const bolim of bolimlar()) {
    if (bolim.oldin) await bolim.oldin(ctx, { fetchByIds });
  }
  if (state.hydrateCancelled) return;

  // Eski versiyada brauzerga yozilgan ma'lumot: Supabase'dagi bo'lim bo'sh bo'lsa, birinchi ulanishda ko'chiriladi.
  const localOf = (key) => parse(rawGet(scope + key));
  const seedIfEmpty = (remote, local) => (firstRun && arr(remote).length === 0 && arr(local).length ? arr(local) : remote);

  for (const bolim of bolimlar()) {
    if (bolim.jadvallar.some((table) => table !== "dokonlar" && !rows[table])) continue;
    const entries = bolim.map(rows, ctx);
    Object.entries(entries).forEach(([key, remote]) => {
      const conf = COLLECTIONS[key];
      if (refresh) { applyRemote(key, remote, remote, { refresh }); return; }
      const local = localOf(key);
      if (conf?.contentKeyed) {
        applyRemote(key, remote, firstRun && local ? conf.fromList(seedIfEmpty(conf.toList(remote), conf.toList(local))) : remote);
      } else if (conf && resync.includes(conf.table)) {
        applyRemote(key, remote, unionById(arr(remote), local));
      } else if (Array.isArray(remote)) {
        applyRemote(key, remote, seedIfEmpty(remote, local));
      } else {
        applyRemote(key, remote, remote ?? (firstRun ? local : null));
      }
    });
  }

  if (!state.hydrateCancelled && !refresh) {
    markReady(dokonId);
    rawSet(RESYNC_KEY, JSON.stringify(resync.filter((table) => !bolimJadvallari().includes(table) || !rows[table])));
    // Endi ma'lumot Supabase'da: eski versiya brauzerga yozgan nusxalar o'chiriladi.
    const legacy = [];
    for (let i = 0; i < (storage()?.length || 0); i += 1) {
      const key = storage().key(i);
      if (key?.startsWith(scope) && specFor(key.slice(scope.length))) legacy.push(key);
    }
    legacy.forEach(rawRemove);
  }
}

async function hydrateAdmin(dokonlar, { refresh = false } = {}) {
  let superRow = null;
  if (!state.tenantMode) {
    try {
      if (!blockedTables().includes("super_admin")) {
        const data = await call(markaz.from("super_admin").select("*").eq("id", 1).limit(1));
        superRow = data[0] || null;
        state.superAdminChecked = true;
        state.superAdminFound = Boolean(superRow);
      }
    } catch (error) {
      if (error?.transient) throw error;
    }
  }
  if (state.hydrateCancelled) return;
  const local = plain(refresh ? getData(ADMIN_KEY, {}) : readJson(ADMIN_KEY, {}));
  const firstRun = !refresh && !readyList().includes("admin");
  const localTenants = arr(local.tenants);
  const byId = new Map(localTenants.map((tenant) => [tenant.id, tenant]));
  const remoteTenants = dokonlar.map((row) => tenantFromRow(row, byId.get(row.id)));
  const tenants = firstRun && remoteTenants.length === 0 && localTenants.length ? localTenants : remoteTenants;

  const remoteTickets = dokonlar.flatMap((row) => arr(row.yordam_xabarlari).map((ticket) => ({ ...ticket, tenantId: ticketTenant(ticket, row) })));
  const tickets = new Map(remoteTickets.map((ticket) => [ticket.id, ticket]));
  arr(local.tickets).forEach((ticket) => tickets.set(ticket.id, mergeTicket(tickets.get(ticket.id), ticket)));

  const remoteAccount = superRow ? { login: superRow.login, salt: superRow.salt, passwordHash: superRow.parol_hash, passwordIterations: superRow.parol_iteratsiya } : null;
  const remote = {
    ...local,
    account: state.tenantMode ? local.account || null : remoteAccount,
    tenants: remoteTenants,
    tickets: remoteTickets,
    profile: superRow ? plain(superRow.profil) : plain(local.profile),
    preferences: superRow ? plain(superRow.sozlamalar) : plain(local.preferences),
    meta: superRow ? plain(superRow.meta) : plain(local.meta),
  };
  const merged = {
    ...remote,
    account: remote.account || local.account || null,
    tenants,
    tickets: [...tickets.values()],
    profile: superRow ? remote.profile : plain(local.profile),
    preferences: superRow ? remote.preferences : plain(local.preferences),
    meta: superRow ? remote.meta : plain(local.meta),
  };
  if (!superRow) {
    // Supabase'da Super Admin hali yo'q: mahalliy hisob yuboriladi.
    remote.profile = {}; remote.preferences = {}; remote.meta = {};
  }
  applyRemote(ADMIN_KEY, remote, merged, { refresh });
  if (!state.hydrateCancelled && !refresh) {
    markReady("admin");
    rawRemove(ADMIN_KEY);
  }
}

// Do'kon havolasisiz yozilgan murojaatlar ("local-crm") asosiy do'konda saqlanadi.
const ticketTenant = (ticket, row) => (row.id === state.asosiyId && ticket.tenantId === LOCAL_TICKET_TENANT ? LOCAL_TICKET_TENANT : row.id);

function applyPresence(dokonlar, { refresh = false } = {}) {
  if (state.hydrateCancelled) return;
  const local = plain(refresh ? getData(PRESENCE_KEY, {}) : readJson(PRESENCE_KEY, {}));
  const next = { ...local };
  dokonlar.forEach((row) => {
    if (state.tenantMode && row.id === state.tenantId) return;
    next[row.id] = presenceFromRow(row, plain(local[row.id]));
  });
  applyRemote(PRESENCE_KEY, next, next, { refresh: true });
  if (!refresh) rawRemove(PRESENCE_KEY);
}

// Ochiq do'konning qatori. O'z loyihasi bo'lsa — o'sha loyihadagi dokonlar jadvalidan (valyuta, kartalar ...).
async function faolDokon(dokonlar) {
  if (!state.tenantMode) return null;
  if (!alohidaLoyihami()) return dokonlar.find((row) => row.id === state.tenantId) || null;
  const own = await call(supabase.from("dokonlar").select("*").eq("id", state.tenantId).limit(1));
  return own[0] || null;
}

async function hydrate() {
  if (state.loyihaKutilmoqda) return false;
  const dokonlar = await fetchAll("dokonlar", undefined, markaz);
  const asosiy = dokonlar.find((row) => row.asosiy) || dokonlar[0];
  if (!asosiy) { note("error", "Supabase'da birorta ham do'kon (dokonlar) yo'q"); return false; }
  state.asosiyId = asosiy.id;
  rawSet(ASOSIY_KEY, asosiy.id);
  const active = await faolDokon(dokonlar);
  if (state.tenantMode && !active) {
    note("error", "Bu havoladagi do'kon Supabase'da topilmadi — mahalliy ma'lumot ishlatiladi");
    return false;
  }
  state.activeDokonId = active?.id || null;
  state.mode = "supabase";
  await hydrateAdmin(dokonlar);
  applyPresence(dokonlar);
  if (active) await hydrateDokon(active);
  return true;
}

/* ---------------- Boshqa kassir/kompyuterdagi o'zgarishlar ---------------- */

export async function refreshFromSupabase() {
  if (state.mode !== "supabase" || state.refreshing || state.queue.length || state.pending.size) return;
  state.refreshing = true;
  state.refreshSeq = state.writeSeq;
  try {
    const dokonlar = await call(markaz.from("dokonlar").select("*"));
    applyPresence(dokonlar, { refresh: true });
    await hydrateAdmin(dokonlar, { refresh: true });
    const active = state.activeDokonId && await faolDokon(dokonlar);
    if (active) await hydrateDokon(active, { refresh: true });
  } catch (error) {
    if (!error?.transient) note("error", "Supabase'dan yangilab bo'lmadi", error?.message);
  } finally {
    state.refreshing = false;
    // Yangilash paytida saqlangan bo'lsa, javob tashlab yuborilgan: biroz keyin qayta yangilanadi.
    if (state.writeSeq !== state.refreshSeq) scheduleRefresh(2000);
  }
}

function scheduleRefresh(delay = 1000) {
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(refreshFromSupabase, delay);
}

function startLiveUpdates() {
  setInterval(() => { if (document.visibilityState === "visible") refreshFromSupabase(); }, REFRESH_MS);
  window.addEventListener("focus", () => scheduleRefresh(300));
  // Realtime: Supabase'da jadvallar uchun Realtime yoqilgan bo'lsa, o'zgarish darhol keladi.
  try {
    const channel = supabase.channel(`crm-${state.activeDokonId || "admin"}`);
    if (state.activeDokonId) {
      bolimJadvallari().forEach((table) => channel.on("postgres_changes",
        { event: "*", schema: "public", table, filter: `dokon_id=eq.${state.activeDokonId}` }, () => scheduleRefresh()));
    }
    channel.on("postgres_changes", { event: "*", schema: "public", table: "dokonlar" }, () => scheduleRefresh());
    channel.subscribe();
    // O'z loyihasi bo'lsa, do'konlar ro'yxati va yordam xabarlari asosiy loyihada: uni ham kuzatamiz.
    if (alohidaLoyihami()) {
      markaz.channel(`crm-markaz-${state.activeDokonId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "dokonlar" }, () => scheduleRefresh())
        .subscribe();
    }
  } catch (error) {
    note("error", "Realtime ulanmadi — ma'lumot har 20 soniyada tekshiriladi", error?.message);
  }
}

/* ---------------- Ishga tushirish ---------------- */

// Do'kon havolasi ochilganda: shu do'konning o'z Supabase loyihasi bormi? (asosiy loyihadagi mijoz_loyihalari)
// Yo'q bo'lsa — do'kon asosiy loyihada ishlaydi (eski do'konlar).
async function mijozLoyihasiniTop(dokonId, taklif) {
  if (!isUuid(dokonId) || !isUuid(taklif)) return;
  const { data, error, status } = await markaz.rpc("mijoz_loyihasi", { p_dokon: dokonId, p_taklif: taklif });
  if (error) {
    // Funksiya hali yaratilmagan (markaziy-loyiha.sql ishga tushirilmagan) — eski usulda ishlaymiz.
    if (status === 404 || error.code === "PGRST202" || error.code === "42883") return;
    state.loyihaKutilmoqda = true;
    note("error", "Do'kon loyihasining manzilini bilib bo'lmadi — sahifani keyinroq yangilang", error.message);
    return;
  }
  const row = arr(data)[0];
  if (!row) return;
  if (row.holat !== "tayyor" || !row.supabase_url || !row.publishable_key) {
    state.loyihaKutilmoqda = true;
    note("error", "Bu do'konning Supabase loyihasi hali tayyorlanmoqda — 1-2 daqiqadan keyin sahifani yangilang");
    return;
  }
  mijozLoyihasigaUlan(row.supabase_url, row.publishable_key);
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("timeout"), ms))]);

async function replayDirty() {
  const dirty = readJson(DIRTY_KEY, {});
  const batch = [];
  for (const [key, entry] of Object.entries(dirty)) {
    try { batch.push(...await buildOps(key, parse(entry?.prev), parse(entry?.next), entry?.dokonId || dokonOf())); } catch { /* o'tkazib yuboriladi */ }
  }
  rawSet(DIRTY_KEY, "{}");
  if (batch.length) enqueue(sortBatch(batch));
}

export async function startSupabase() {
  if (typeof window === "undefined" || !raw || !storage()) return;
  const params = new URLSearchParams(window.location.search);
  const tenant = params.get("tenant") || "";
  state.tenantMode = Boolean(tenant && params.get("invite"));
  state.tenantId = state.tenantMode ? tenant : "";
  state.asosiyId = rawGet(ASOSIY_KEY) || null;
  state.queue = arr(readJson(QUEUE_KEY, []));

  // Avvalgi "sotuvga tayyorlash" tozalashi endi kerak emas: ma'lumot Supabase'dan keladi.
  rawSet(state.tenantMode ? `tenant:${tenant}:${SALE_READY_KEY}` : SALE_READY_KEY, SALE_READY_VERSION);

  window.addEventListener("online", () => processQueue());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.pending.size) { clearTimeout(state.flushTimer); flushPending(); }
  });

  try {
    if (state.tenantMode) {
      const result = await withTimeout(mijozLoyihasiniTop(tenant, params.get("invite")), 10000);
      if (result === "timeout") {
        state.loyihaKutilmoqda = true;
        note("error", "Do'kon loyihasini aniqlash uchun Supabase javob bermadi");
      }
    }
    await replayDirty();
    await withTimeout(processQueue(), 8000);
    await withTimeout(recheckBlocked().catch(() => {}), 5000);
    if (state.queue.length) {
      note("error", "Yuborilmagan o'zgarishlar bor — ilova brauzerdagi ma'lumot bilan ochildi, internet tiklanganda yuboriladi.");
    } else {
      const result = await withTimeout(hydrate(), 15000);
      if (result === "timeout") {
        state.hydrateCancelled = true;
        note("error", "Supabase javob bermadi — ilova brauzerdagi ma'lumot bilan ochildi.");
      }
    }
  } catch (error) {
    state.hydrateCancelled = true;
    note("error", "Supabase'dan yuklab bo'lmadi — ilova brauzerdagi ma'lumot bilan ochildi.", error?.message);
  }
  if (state.hydrateCancelled) {
    state.mode = "local";
    state.memory.clear();
  }

  state.ready = true;
  if (state.mode === "supabase") startLiveUpdates();
  window.crmSupabase = {
    holat: () => ({
      ulangan: state.mode === "supabase", asosiyDokon: state.asosiyId, faolDokon: state.activeDokonId,
      alohidaLoyiha: alohidaLoyihami(), loyihaKutilmoqda: state.loyihaKutilmoqda,
      navbat: state.queue.length, jurnal: state.log, xotiradagiKalitlar: [...state.memory.keys()],
      ...(DRY_RUN ? { sinov: state.dryRun } : {}),
    }),
    yuborish: () => processQueue(),
    yangilash: () => refreshFromSupabase(),
    // Faqat sinov rejimida: konsoldan o'qish/yozishni tekshirish uchun (bazaga hech narsa yozilmaydi).
    ...(DRY_RUN ? { getData, setData } : {}),
  };
}
