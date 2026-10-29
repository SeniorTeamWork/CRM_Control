// Bildirishnomalar va AI chat tarixi: localStorage orqali emas, to'g'ridan-to'g'ri Supabase bilan ishlaydi.
//  - Bildirishnomalar: dokonlar.bildirishnomalar (jsonb ro'yxat). Bazadagi triggerlar ham shu ro'yxatga yozadi,
//    shuning uchun o'zgartirishdan oldin har safar eng so'nggi ro'yxat o'qiladi.
//  - AI chat: xodimlar.ai_suhbat (har bir xodim va direktorning o'z suhbati).
import { supabase } from "./supabase";
import { activeDokonId, isDryRun } from "./db";

const POLL_MS = 30000;
const CHAT_LIMIT = 60;

async function call(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message || "Supabase xatosi");
  return data;
}

/* ---------------- Bildirishnomalar ---------------- */

const notifFromItem = (item) => ({
  id: String(item.id),
  type: ["warning", "success", "info"].includes(item.turi) ? item.turi : "info",
  title: item.sarlavha || "",
  description: item.matn || "",
  createdAt: item.yaratilgan_at || null,
  read: Boolean(item.oqilgan),
});

const byNewest = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

const notifState = { list: [], loaded: false, listeners: new Set(), timer: null };

function emit() {
  notifState.listeners.forEach((listener) => listener(notifState.list));
}

async function readRemoteNotifs(dokonId) {
  const rows = await call(supabase.from("dokonlar").select("bildirishnomalar").eq("id", dokonId).limit(1));
  return Array.isArray(rows?.[0]?.bildirishnomalar) ? rows[0].bildirishnomalar : [];
}

export async function refreshNotifications() {
  const dokonId = activeDokonId();
  if (!dokonId) return notifState.list;
  try {
    notifState.list = (await readRemoteNotifs(dokonId)).map(notifFromItem).sort(byNewest);
    notifState.loaded = true;
    emit();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[Supabase] Bildirishnomalar yuklanmadi", error.message);
  }
  return notifState.list;
}

// Ro'yxat o'zgarganda listener chaqiriladi. Qaytgan funksiya obunani bekor qiladi.
export function subscribeNotifications(listener) {
  notifState.listeners.add(listener);
  listener(notifState.list);
  if (!notifState.loaded) refreshNotifications();
  if (!notifState.timer) {
    notifState.timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshNotifications();
    }, POLL_MS);
  }
  return () => {
    notifState.listeners.delete(listener);
    if (!notifState.listeners.size) { clearInterval(notifState.timer); notifState.timer = null; }
  };
}

// change(items) bazadagi xom ro'yxatni oladi va yangisini qaytaradi.
async function changeNotifications(localChange, remoteChange) {
  notifState.list = localChange(notifState.list);
  emit();
  const dokonId = activeDokonId();
  if (!dokonId || isDryRun()) return;
  try {
    const next = remoteChange(await readRemoteNotifs(dokonId));
    await call(supabase.from("dokonlar").update({ bildirishnomalar: next }).eq("id", dokonId));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[Supabase] Bildirishnoma saqlanmadi", error.message);
    refreshNotifications();
  }
}

export function markAllNotificationsRead() {
  return changeNotifications(
    (list) => list.map((n) => ({ ...n, read: true })),
    (items) => items.map((item) => ({ ...item, oqilgan: true })),
  );
}

export function dismissNotification(id) {
  return changeNotifications(
    (list) => list.filter((n) => n.id !== String(id)),
    (items) => items.filter((item) => String(item.id) !== String(id)),
  );
}

/* ---------------- AI chat tarixi ---------------- */

function chatQuery(builder, dokonId, user) {
  const query = builder.eq("dokon_id", dokonId);
  return user?.type === "employee" && user?.id !== undefined && user?.id !== null
    ? query.eq("ilova_id", String(user.id))
    : query.eq("rol", "direktor");
}

const chatFromItem = (item) => ({
  role: item.rol === "assistant" ? "assistant" : "user",
  content: String(item.matn ?? ""),
  source: item.manba || "local",
});

// Supabase'dagi suhbat. Ulanmagan bo'lsa yoki xato bo'lsa null qaytadi (ilova brauzerdagisini ishlatadi).
export async function loadAiChat(user) {
  const dokonId = activeDokonId();
  if (!dokonId) return null;
  try {
    const rows = await call(chatQuery(supabase.from("xodimlar").select("ai_suhbat"), dokonId, user).limit(1));
    if (!rows?.length) return null;
    const items = Array.isArray(rows[0].ai_suhbat) ? rows[0].ai_suhbat : [];
    return items.filter((item) => typeof item?.matn === "string").map(chatFromItem).slice(-CHAT_LIMIT);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[Supabase] AI chat tarixi yuklanmadi", error.message);
    return null;
  }
}

const chatTimers = new Map();

// Tez-tez yozilmasligi uchun oxirgi o'zgarishdan 800 ms keyin saqlanadi.
export function saveAiChat(user, messages) {
  const dokonId = activeDokonId();
  if (!dokonId || isDryRun()) return;
  const key = `${dokonId}|${user?.type}|${user?.id ?? ""}`;
  clearTimeout(chatTimers.get(key));
  chatTimers.set(key, setTimeout(async () => {
    chatTimers.delete(key);
    const now = new Date().toISOString();
    const items = messages
      .filter((m) => m.source !== "welcome" && !m.failed && typeof m.content === "string")
      .slice(-CHAT_LIMIT)
      .map((m, index) => ({ id: index + 1, rol: m.role, matn: m.content, manba: m.source || "local", yaratilgan_at: m.createdAt || now }));
    try {
      await call(chatQuery(supabase.from("xodimlar").update({ ai_suhbat: items }), dokonId, user));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("[Supabase] AI chat tarixi saqlanmadi", error.message);
    }
  }, 800));
}
