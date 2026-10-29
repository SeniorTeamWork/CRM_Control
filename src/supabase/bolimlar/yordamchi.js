// Bo'limlar uchun umumiy yordamchi funksiyalar.
import { arr } from "../mappers";

// Qatorlarni ustun bo'yicha tartiblaydi (desc = kamayish tartibida). Supabase'dan id bo'yicha keladi.
export function tartibla(rows, column, desc = false) {
  const sorted = arr(rows).slice();
  if (!column || column === "id") return sorted;
  sorted.sort((a, b) => String(a[column] || "").localeCompare(String(b[column] || "")) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  if (desc) sorted.reverse();
  return sorted;
}

// Ustundagi qiymat bo'yicha ajratadi. kassa bo'sh bo'lsa "asosiy" deb olinadi.
export const kassasi = (row) => row.kassa ?? "asosiy";

export function unionById(remote, extra) {
  const known = new Set(arr(remote).map((item) => String(item?.id)));
  const missing = arr(extra).filter((item) => item?.id !== undefined && !known.has(String(item.id)));
  return missing.length ? [...arr(remote), ...missing] : arr(remote);
}
