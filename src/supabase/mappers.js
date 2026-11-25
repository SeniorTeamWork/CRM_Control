// Ilova obyektlari <-> Supabase jadval qatorlari (map qilish).
//
// Qoida: ilova obyektining o'zi "malumot" (jsonb) ustunida to'liq saqlanadi, shuning uchun
// qaytib o'qilganda hech narsa yo'qolmaydi. Oddiy ustunlar (nomi, narx, qoldiq ...) esa
// hisobot va view'lar (v_dashboard, v_sotuvlar ...) ishlashi uchun to'ldiriladi.
// Eski (Supabase'ga qo'lda kiritilgan) qatorlarda malumot bo'sh bo'lsa, obyekt ustunlardan tiklanadi.
import { uniqueProductCount } from "../data/productCounts";

/* ---------------- Yordamchi funksiyalar ---------------- */

export const arr = (value) => (Array.isArray(value) ? value : []);
export const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const money = (value) => Math.max(0, Math.round(num(value)));
const qty = (value) => Math.max(0, num(value));
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, num(value, fallback)));
const text = (value) => (value === null || value === undefined ? null : String(value).trim() || null);
const optionalNumber = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

export const isoDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
const dayOnly = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const iso = isoDate(value);
  return iso ? iso.slice(0, 10) : null;
};

// "1790693564881" -> 1790693564881 (ilovada raqamli id'lar raqam bo'lib saqlanadi).
export const appId = (value) => {
  if (value === null || value === undefined) return value;
  const s = String(value);
  return /^-?\d{1,15}$/.test(s) ? Number(s) : s;
};

// Boshqa jadvaldagi qatorga havola: navbat ishlaganda haqiqiy id bilan almashtiriladi.
export const ref = (table, ilovaId) => (ilovaId === null || ilovaId === undefined || ilovaId === "" ? null : { $ref: [table, String(ilovaId)] });

const withoutUndefined = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
const merge = (derived, stored) => ({ ...withoutUndefined(derived), ...plain(stored) });
const initials = (name) => String(name || "").trim().split(/\s+/).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase() || "X";

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* ---------------- Asosiy jadvallar (har bir obyekt = bitta qator) ---------------- */

export const productToRow = (p) => ({
  sku: text(p.sku) || `ID-${p.id}`,
  nomi: text(p.name) || "Mahsulot",
  kategoriya: text(p.category) || "Boshqa",
  brend: text(p.brand),
  narx: money(p.price),
  tannarx: money(p.cost),
  qoldiq: qty(p.stock),
  min_qoldiq: qty(p.minStock ?? p.minimumStock ?? 10),
  rasm: text(p.image),
  taminotchi_id: ref("taminotchilar", p.supplierId),
  olchov_turi: text(p.measurementType),
  qadoq: text(p.packaging),
  ogirlik: optionalNumber(p.weight),
});

export const productFromRow = (row, ctx) => merge({
  id: appId(row.ilova_id ?? row.id),
  sku: row.sku,
  name: row.nomi,
  category: row.kategoriya,
  brand: row.brend || "",
  price: num(row.narx),
  cost: num(row.tannarx),
  stock: num(row.qoldiq),
  minStock: num(row.min_qoldiq, 10),
  image: row.rasm || "📦",
  status: row.holat === "out" ? "low" : "active",
  supplierId: ctx.appIdOf("taminotchilar", row.taminotchi_id),
  measurementType: row.olchov_turi || undefined,
  packaging: row.qadoq || undefined,
  weight: row.ogirlik ?? undefined,
  createdAt: row.yaratilgan_at,
}, row.malumot);

export const customerToRow = (c) => ({
  ism: text(c.name) || "Mijoz",
  telefon: text(c.phone),
  hudud: text(c.region),
  holat: text(c.status) || "active",
  izoh: text(c.notes ?? c.note),
  manzil: text(c.address),
});

export const customerFromRow = (row, ctx) => {
  const stats = ctx.customerStats.get(row.id) || {};
  return merge({
    id: appId(ctx.stripPrefix(row.ilova_id) ?? row.id),
    name: row.ism,
    phone: row.telefon || "",
    region: row.hudud || "",
    status: row.holat || "active",
    address: row.manzil || "",
    notes: row.izoh || undefined,
    debt: num(stats.qarz),
    purchases: num(stats.xaridlar_soni),
    spent: num(stats.jami_xarid),
    lastPurchase: dayOnly(stats.oxirgi_xarid) || "",
  }, row.malumot);
};

export const saleToRow = (s, w) => {
  const items = arr(s.items);
  const deliveryAddresses = arr(s.deliveryAddresses);
  const itemsTotal = items.reduce((sum, item) => sum + num(item.total, num(item.price) * num(item.qty)), 0);
  const amount = money(s.amount ?? s.total ?? itemsTotal);
  const subtotal = Math.max(amount, money(s.subtotal ?? amount + money(s.discountAmount)));
  const status = s.status || (num(s.debtBalance) > 0 ? "partial" : "paid");
  return {
    chek_raqami: text(s.receiptNumber) || String(s.id),
    mijoz_id: ref("mijozlar", s.customerId === undefined || s.customerId === null ? null : `${w.customerPrefix}${s.customerId}`),
    mijoz_ismi: text(s.customerName ?? s.customer) || "Noma'lum mijoz",
    mijoz_telefon: text(s.customerPhone),
    kassir_id: ref("xodimlar", s.employeeId ?? s.sellerId),
    oraliq_summa: subtotal,
    chegirma_foiz: clamp(s.discountPercent ?? s.globalDiscount, 0, 100, 0),
    chegirma_summa: subtotal - amount,
    tolangan_summa: money(s.initialPaidAmount ?? s.paidAmount ?? (status === "paid" ? amount : 0)),
    tolov_turi: text(s.payment ?? s.paymentMethod) || "Naqd",
    karta_oxirgi4: text(s.cardLast4),
    qarz_muddati: dayOnly(s.debtDueDate),
    yetkazish_manzili: text(s.deliveryAddress),
    sana: isoDate(s.date ?? s.createdAt) || new Date().toISOString(),
    yetkazish_manzillari: deliveryAddresses,
    mahsulotlar: items.map((item, index) => ({
      id: index + 1,
      nomi: item.name || "Mahsulot",
      narx: money(item.price),
      soni: qty(item.qty),
      jami: money(item.total ?? num(item.price) * num(item.qty)),
      tannarx: money(w.costOf(item.id)),
      manzil: text(item.deliveryAddress),
      addressId: item.addressId || "",
      deliveryDate: item.deliveryDate || "",
      deliveryStatus: item.deliveryStatus || "",
      deliveredAt: item.deliveredAt || "",
      ...(item.isDefectSale || item.defectId ? { isDefectSale: true, defectId: item.defectId, defectStatus: item.defectStatus, defectReason: item.defectReason } : {}),
      mahsulot_id: ref("mahsulotlar", item.id),
    })),
    buyurtma_id: ref("buyurtmalar", s.sourceOrderId),
  };
};

export const saleFromRow = (row, ctx) => {
  const amount = num(row.jami_summa, num(row.oraliq_summa) - num(row.chegirma_summa));
  const paid = num(row.tolangan_summa);
  const debt = Math.max(0, amount - paid);
  const deliveryAddresses = arr(row.yetkazish_manzillari);
  const items = arr(row.mahsulotlar).map((item) => {
    const itemAddressId = item.addressId || "";
    const itemAddress = deliveryAddresses.find((address) => itemAddressId && String(address?.id) === String(itemAddressId))
      || deliveryAddresses.find((address) => address?.address && address.address === item.manzil)
      || (deliveryAddresses.length === 1 ? deliveryAddresses[0] : null);
    return {
      id: ctx.appIdOf("mahsulotlar", item.mahsulot_id) ?? item.id,
      name: item.nomi,
      price: num(item.narx),
      qty: num(item.soni),
      total: num(item.jami),
      deliveryAddress: item.manzil || itemAddress?.address || undefined,
      addressId: itemAddressId || itemAddress?.id || undefined,
      deliveryDate: item.deliveryDate || itemAddress?.deliveryDate || "",
      deliveryStatus: item.deliveryStatus || "",
      deliveredAt: item.deliveredAt || "",
      ...(item.isDefectSale || item.defectId ? { isDefectSale: true, defectId: item.defectId, defectStatus: item.defectStatus, defectReason: item.defectReason } : {}),
    };
  });
  const mapped = merge({
    id: row.ilova_id || row.id,
    receiptNumber: row.chek_raqami || row.id,
    customerId: ctx.appIdOf("mijozlar", row.mijoz_id),
    customer: row.mijoz_ismi || "Noma'lum mijoz",
    customerName: row.mijoz_ismi || "",
    customerPhone: row.mijoz_telefon || "",
    employeeId: ctx.appIdOf("xodimlar", row.kassir_id) ?? null,
    amount,
    subtotal: num(row.oraliq_summa),
    discountPercent: num(row.chegirma_foiz),
    discountAmount: num(row.chegirma_summa),
    paidAmount: paid,
    initialPaidAmount: paid,
    debtBalance: debt,
    debtDueDate: row.qarz_muddati || "",
    status: paid === 0 && amount > 0 ? "debt" : debt > 0 ? "partial" : "paid",
    payment: row.tolov_turi || "Naqd",
    cardLast4: row.karta_oxirgi4 || "",
    deliveryAddress: row.yetkazish_manzili || "",
    deliveryAddresses: arr(row.yetkazish_manzillari),
    date: row.sana,
    items,
    products: uniqueProductCount(items),
    productIds: [...new Set(items.map((item) => item.id))],
  }, row.malumot);
  return { ...mapped, products: uniqueProductCount(mapped.items, mapped.products), productIds: [...new Set((mapped.items || []).map((item) => item.id))] };
};

export const supplierToRow = (s) => ({
  nomi: text(s.name) || "Ta'minotchi",
  telefon: text(s.phone),
  manzil: text(s.address),
  holat: s.status === "inactive" ? "inactive" : "active",
});

export const supplierFromRow = (row, ctx) => {
  const stats = ctx.supplierStats.get(row.id) || {};
  return merge({
    id: appId(row.ilova_id ?? row.id),
    name: row.nomi,
    phone: row.telefon || "",
    address: row.manzil || "",
    status: row.holat || "active",
    products: ctx.productCountBySupplier.get(row.id) || 0,
    purchases: num(stats.jami_xarid),
    debt: num(stats.qarz),
    lastOrder: stats.oxirgi_buyurtma || "",
  }, row.malumot);
};

const salaryToItem = (p, index) => ({
  id: index + 1,
  ilova_id: p.id === undefined ? null : String(p.id),
  davr: text(p.period),
  summa: money(p.amount),
  kutilgan_summa: money(p.expectedAmount),
  tolov_kuni: optionalNumber(p.dueDay),
  tolangan_sana: text(p.paidAt),
  malumot: p,
});

export const employeeToRow = (e) => ({
  ism: text(e.name) || "Xodim",
  lavozim: text(e.role) || "Xodim",
  telefon: text(e.phone),
  holat: e.status === "active" ? "active" : "inactive",
  // Bazadagi cheklovlar: maosh >= 0, kun 1..28, oy "YYYY-MM".
  oylik_maosh: optionalNumber(e.monthlySalary) === null ? null : money(e.monthlySalary),
  maosh_kuni: Number.isInteger(Number(e.salaryDueDay)) && Number(e.salaryDueDay) >= 1 && Number(e.salaryDueDay) <= 28 ? Number(e.salaryDueDay) : null,
  maosh_boshlanish_oy: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(e.salaryStartMonth || "")) ? e.salaryStartMonth : null,
  familiya: text(e.lastName),
  email: text(e.email),
  rol: "xodim",
  login: text(e.login),
  parol_hash: text(e.passwordHash),
  ruxsatlar: arr(e.permissions),
  hisob_faol: e.status === "active",
  maosh_tolovlari: arr(e.salaryPayments).map(salaryToItem),
});

export const employeeFromRow = (row) => merge({
  id: appId(row.ilova_id ?? row.id),
  name: row.ism,
  role: row.lavozim || "",
  phone: row.telefon || "",
  email: row.email || undefined,
  lastName: row.familiya || undefined,
  status: row.holat || "active",
  avatar: initials(row.ism),
  sales: 0,
  revenue: 0,
  lastActive: "—",
  login: row.login || undefined,
  passwordHash: row.parol_hash || undefined,
  permissions: arr(row.ruxsatlar),
  monthlySalary: row.oylik_maosh ?? undefined,
  salaryDueDay: row.maosh_kuni ?? undefined,
  salaryStartMonth: row.maosh_boshlanish_oy || undefined,
  salaryPayments: arr(row.maosh_tolovlari).map((item) => merge({
    id: item.ilova_id || String(item.id),
    period: item.davr,
    amount: num(item.summa),
    expectedAmount: num(item.kutilgan_summa),
    dueDay: item.tolov_kuni ?? undefined,
    paidAt: item.tolangan_sana,
  }, item.malumot)),
}, row.malumot);

export const ustaToRow = (u) => ({
  ism: text(u.name) || "Usta",
  telefon: text(u.phone),
  mutaxassislik: text(u.specialty) || "—",
  foiz: clamp(u.percentage, 0, 100, 30),
  balans: Math.round(num(u.balance)),
  holat: u.status === "inactive" ? "inactive" : "active",
  bajarilgan_ishlar: Math.max(0, Math.round(num(u.completedWorks))),
  reyting: clamp(u.rating, 0, 5, 5),
});

export const ustaFromRow = (row) => merge({
  id: appId(row.ilova_id ?? row.id),
  name: row.ism,
  phone: row.telefon || "",
  specialty: row.mutaxassislik || "",
  percentage: num(row.foiz, 30),
  balance: num(row.balans),
  status: row.holat || "active",
  completedWorks: num(row.bajarilgan_ishlar),
  rating: num(row.reyting, 5),
}, row.malumot);

export const receiptToRow = (r) => ({
  taminotchi_id: ref("taminotchilar", r.supplierId),
  taminotchi_nomi: text(r.supplier),
  buyurtma_id: text(r.orderId),
  mahsulotlar: arr(r.products),
  summa: money(r.amount),
  sana: isoDate(r.date) || new Date().toISOString(),
});

export const receiptFromRow = (row, ctx) => merge({
  id: row.ilova_id || String(row.id),
  supplierId: ctx.appIdOf("taminotchilar", row.taminotchi_id),
  supplier: row.taminotchi_nomi || "",
  orderId: row.buyurtma_id || "",
  products: arr(row.mahsulotlar),
  items: arr(row.mahsulotlar).reduce((sum, item) => sum + num(item.quantity), 0),
  amount: num(row.summa),
  date: row.sana,
}, row.malumot);

export const orderToRow = (o) => ({
  buyurtma_raqami: text(o.orderNumber) || String(o.id),
  holat: text(o.status) || "reserved",
  mijoz_ismi: text(o.customerName),
  mijoz_telefon: text(o.customerPhone),
  xodim_id: ref("xodimlar", o.employeeId),
  xodim_ismi: text(o.employeeName),
  mahsulotlar: arr(o.cart),
  chegirma_foiz: clamp(o.globalDiscount, 0, 100, 0),
  oraliq_summa: money(o.subtotal),
  chegirma_summa: money(o.discountAmount),
  jami_summa: money(o.total),
  yetkazish_manzili: text(o.deliveryAddress),
  yetkazish_manzillari: arr(o.addresses),
  manzil_tasdiqlangan: Boolean(o.addressConfirmed),
  ochilgan_at: isoDate(o.openedAt),
});

export const storedObjectFromRow = (row) => merge({ id: row.ilova_id || row.id }, row.malumot);

export const noteToRow = (n) => ({ sarlavha: text(n.title), matn: n.body === undefined ? null : String(n.body), qadalgan: Boolean(n.pinned) });
export const saleDraftToRow = (d) => ({
  mijoz_ismi: text(d.customerName),
  mijoz_telefon: text(d.customerPhone),
  mahsulotlar: arr(d.cart),
  xodim_id: ref("xodimlar", d.employeeId),
});

// Moliya: {incomes, expenses} ichidagi yozuvlarda id yo'q, shuning uchun mazmuni bo'yicha taniladi.
export const financeToList = (value) => {
  const data = plain(value);
  return [
    ...arr(data.incomes).map((item) => ({ kind: "kirim", item })),
    ...arr(data.expenses).map((item) => ({ kind: "chiqim", item })),
  ];
};
export const financeFromList = (entries) => ({
  incomes: entries.filter((entry) => entry.kind === "kirim").map((entry) => entry.item),
  expenses: entries.filter((entry) => entry.kind === "chiqim").map((entry) => entry.item),
});
export const financeToRow = (entry) => ({
  turi: entry.kind,
  kategoriya: text(entry.item?.category) || "Boshqa",
  summa: money(entry.item?.amount),
  sana: dayOnly(entry.item?.date) || new Date().toISOString().slice(0, 10),
  izoh: text(entry.item?.description),
});
export const financeFromRow = (row, ctx) => ({
  kind: row.turi === "chiqim" ? "chiqim" : "kirim",
  item: merge({
    category: row.kategoriya,
    amount: num(row.summa),
    date: row.sana,
    employee: ctx.staffName(row.xodim_id) || "Admin",
    description: row.izoh || "",
  }, row.malumot),
});

// localStorage kaliti -> jadval. filter: shu kalitga tegishli qatorlarni ajratadi.
export const COLLECTIONS = {
  crm_products: { table: "mahsulotlar", toRow: productToRow, fromRow: productFromRow, order: "id" },
  crm_customers: { table: "mijozlar", filter: { kassa: "asosiy" }, toRow: customerToRow, fromRow: customerFromRow, order: "id" },
  crm_additional_pos_customers: { table: "mijozlar", filter: { kassa: "qoshimcha" }, ilovaPrefix: "qoshimcha:", toRow: customerToRow, fromRow: customerFromRow, order: "id" },
  crm_sales: { table: "sotuvlar", filter: { kassa: "asosiy" }, toRow: saleToRow, fromRow: saleFromRow, order: "sana", desc: true, customerPrefix: "" },
  crm_additional_pos_sales: { table: "sotuvlar", filter: { kassa: "qoshimcha" }, toRow: saleToRow, fromRow: saleFromRow, order: "sana", desc: true, customerPrefix: "qoshimcha:" },
  crm_suppliers: { table: "taminotchilar", toRow: supplierToRow, fromRow: supplierFromRow, order: "id" },
  crm_employees: { table: "xodimlar", filter: { rol: "xodim" }, notDirector: true, toRow: employeeToRow, fromRow: employeeFromRow, order: "id" },
  crm_ustalar: { table: "ustalar", toRow: ustaToRow, fromRow: ustaFromRow, order: "id" },
  crm_supplier_receipts: { table: "taminot_kirimlari", toRow: receiptToRow, fromRow: receiptFromRow, order: "sana", desc: true },
  crm_customer_orders_v1: { table: "buyurtmalar", toRow: orderToRow, fromRow: storedObjectFromRow, order: "yaratilgan_at", desc: true },
  crm_notes_drafts_v1: { table: "qoralamalar", filter: { turi: "eslatma" }, toRow: noteToRow, fromRow: storedObjectFromRow, order: "yangilangan_at", desc: true },
  crm_saved_sale_drafts_v1: { table: "qoralamalar", filter: { turi: "sotuv" }, toRow: saleDraftToRow, fromRow: storedObjectFromRow, order: "yangilangan_at", desc: true },
  crm_finance_operations_v1: {
    table: "moliya", contentKeyed: true, toList: financeToList, fromList: financeFromList,
    toRow: financeToRow, fromRow: financeFromRow, malumotOf: (entry) => entry.item, order: "sana", desc: true,
  },
};

/* ---------------- Ichma-ich ro'yxatlar (ota qatorning jsonb ustunida) ---------------- */

const returnToItem = (line) => ({
  id: String(line.id),
  ilova_id: String(line.id),
  sana: isoDate(line.date),
  soni: qty(line.quantity),
  holat: text(line.status) || "approved",
  sabab: text(line.reason),
  summa: money(line.amount),
  mijoz_ismi: text(line.customer),
  mahsulot_id: ref("mahsulotlar", line.productId),
  mahsulot_nomi: text(line.product),
  yetkazish_manzili: text(line.deliveryAddress),
  malumot: line,
});

export const returnFromItem = (item, parent, ctx) => {
  const quantity = num(item.soni, 1) || 1;
  return merge({
    id: item.ilova_id || String(item.id),
    groupId: item.ilova_id || String(item.id),
    saleId: parent.ilova_id || parent.id,
    productId: ctx.appIdOf("mahsulotlar", item.mahsulot_id) ?? "",
    customer: item.mijoz_ismi || parent.mijoz_ismi || "",
    product: item.mahsulot_nomi || "Mahsulot",
    quantity,
    unitPrice: num(item.summa) / quantity,
    amount: num(item.summa),
    reason: item.sabab || "",
    status: item.holat || "approved",
    date: item.sana,
    purchaseDate: parent.sana || "",
    deliveryAddress: item.yetkazish_manzili || "",
  }, item.malumot);
};

const paymentToItem = (p) => ({
  id: String(p.id),
  ilova_id: String(p.id),
  sana: isoDate(p.createdAt ?? p.date),
  summa: money(p.amount),
  tolov_turi: text(p.method) || "Naqd",
  karta_oxirgi4: text(p.cardLast4),
  izoh: text(p.note),
  qabul_karta_id: null,
  malumot: p,
});

export const paymentFromItem = (item, parent) => merge({
  id: item.ilova_id || `PAY-${item.id}`,
  saleId: parent.ilova_id || parent.id,
  customer: parent.mijoz_ismi || "",
  amount: num(item.summa),
  method: item.tolov_turi || "Naqd",
  cardLast4: item.karta_oxirgi4 || "",
  note: item.izoh || undefined,
  createdAt: item.sana,
}, item.malumot);

const supplierReturnToItem = (r) => ({
  id: String(r.id),
  ilova_id: String(r.id),
  sana: isoDate(r.returnedAt ?? r.date),
  soni: qty(r.items),
  sabab: text(r.reason),
  summa: money(r.amount),
  buyurtma_id: text(r.orderId),
  qabul_id: null,
  mahsulot_id: ref("mahsulotlar", r.productId),
  mahsulotlar_soni: qty(r.items),
  malumot: r,
});

export const supplierReturnFromItem = (item, parent, ctx) => {
  const order = arr(parent.buyurtmalar).find((o) => item.qabul_id && o.qabul && o.qabul.id === item.qabul_id);
  return merge({
    id: item.ilova_id || String(item.id),
    supplierId: appId(parent.ilova_id ?? parent.id),
    orderId: item.buyurtma_id || order?.ilova_id || order?.id || "",
    productId: ctx.appIdOf("mahsulotlar", item.mahsulot_id) ?? "",
    productName: "",
    productCount: 1,
    reason: item.sabab || "",
    items: num(item.soni ?? item.mahsulotlar_soni),
    amount: num(item.summa),
    returnedAt: item.sana,
  }, item.malumot);
};

// Har bir ro'yxat elementidagi qaysi maydon ota qatorni (ilova id) ko'rsatadi.
export const NESTED = {
  crm_returns: {
    parentTable: "sotuvlar", column: "qaytarishlar", parentOf: (line) => line.saleId,
    toItem: returnToItem, fromItem: returnFromItem,
    extraPatch: (items) => ({ qaytarilgan: items.length > 0 }),
  },
  crm_debt_payments_v1: {
    parentTable: "sotuvlar", column: "tolovlar", parentOf: (payment) => payment.saleId,
    toItem: paymentToItem, fromItem: paymentFromItem,
  },
  crm_supplier_returns: {
    parentTable: "taminotchilar", column: "qaytarishlar", parentOf: (record) => record.supplierId,
    toItem: supplierReturnToItem, fromItem: supplierReturnFromItem,
  },
};

/* ---------------- Ta'minotchi buyurtmalari: crm_supplier_orders_<id> ---------------- */

export const SUPPLIER_ORDERS_PREFIX = "crm_supplier_orders_";

export function supplierOrderToItem(order, w) {
  return {
    id: String(order.id),
    ilova_id: String(order.id),
    sana: text(order.date),
    summa: money(order.amount),
    qolgan_qarz: money(order.remaining),
    tolov_turi: text(order.payment),
    tolov_holati: text(order.status),
    mahsulotlar_soni: qty(order.items),
    mahsulot_turlari_soni: qty(order.productCount),
    mahsulotlar: arr(order.productDetails).map((line) => ({
      mahsulot_id: ref("mahsulotlar", line.id),
      nomi: text(line.name),
      soni: qty(line.quantity),
      tannarx: money(line.cost ?? w.costOf(line.id)),
    })),
    qabul: null,
    malumot: order,
  };
}

export function supplierPaymentsOf(orders) {
  return arr(orders).flatMap((order) => arr(order.paymentHistory).map((payment) => ({
    id: String(payment.id),
    ilova_id: String(payment.id),
    buyurtma_id: String(order.id),
    summa: money(payment.amount),
    sana: isoDate(payment.date),
    usul: text(payment.method),
    turi: text(payment.kind),
    malumot: payment,
  })));
}

export function supplierOrdersFromRow(row, ctx) {
  const payments = arr(row.tolovlar);
  return arr(row.buyurtmalar).map((item) => {
    const id = item.ilova_id || String(item.id);
    const summa = num(item.summa);
    return merge({
      id,
      supplierId: appId(row.ilova_id ?? row.id),
      items: num(item.mahsulotlar_soni),
      productCount: num(item.mahsulot_turlari_soni) || arr(item.mahsulotlar).length,
      productIds: arr(item.mahsulotlar).map((line) => ctx.appIdOf("mahsulotlar", line.mahsulot_id)).filter((value) => value !== undefined && value !== null),
      productDetails: arr(item.mahsulotlar).map((line) => ({
        id: ctx.appIdOf("mahsulotlar", line.mahsulot_id),
        name: line.nomi || "",
        quantity: num(line.soni),
        cost: num(line.tannarx),
      })),
      amount: summa,
      remaining: item.qolgan_qarz ? num(item.qolgan_qarz) : item.tolov_holati === "paid" ? 0 : item.tolov_holati ? summa : 0,
      payment: item.tolov_turi || "",
      status: item.tolov_holati || "paid",
      paymentHistory: payments.filter((payment) => String(payment.buyurtma_id) === id).map((payment) => merge({
        id: payment.ilova_id || String(payment.id),
        amount: num(payment.summa),
        method: payment.usul || "Naqd",
        date: payment.sana,
        kind: payment.turi || "debt",
      }, payment.malumot)),
      received: Boolean(item.qabul) || item.qabul === undefined,
      date: item.sana,
    }, item.malumot);
  });
}

// Eski qatorlardagi "qabul" yozuvlari ilovadagi "crm_supplier_receipts" ro'yxatiga.
export function receiptsFromSupplierRow(row) {
  return arr(row.buyurtmalar).filter((item) => item.qabul).map((item) => merge({
    id: item.qabul.ilova_id || String(item.qabul.id),
    supplierId: appId(row.ilova_id ?? row.id),
    supplier: row.nomi,
    orderId: item.ilova_id || String(item.id),
    items: num(item.qabul.mahsulotlar_soni),
    products: [],
    amount: num(item.qabul.summa),
    date: item.qabul.sana,
  }, item.qabul.malumot));
}

/* ---------------- Super Admin: do'konlar va yordam xabarlari ---------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value || ""));

export const tenantToRow = (tenant) => withoutUndefined({
  nomi: text(tenant.name) || "Do'kon",
  domen: text(tenant.domain),
  telefon: text(tenant.phone),
  taklif_kodi: isUuid(tenant.invite) ? tenant.invite : undefined,
  holat: text(tenant.status) || "online",
});

export const tenantFromRow = (row, local = {}) => ({
  ...local,
  id: row.id,
  name: row.nomi,
  domain: row.domen || "",
  phone: row.telefon || "",
  invite: row.taklif_kodi || local.invite || "",
  status: row.holat || local.status || "online",
  createdAt: row.yaratilgan_at || local.createdAt,
  lastSeen: row.oxirgi_faollik || local.lastSeen || row.yaratilgan_at,
  errors: arr(local.errors),
});

// Ikki xil nusxadagi bitta murojaatni birlashtiradi: xabarlar id bo'yicha qo'shiladi, o'chmaydi.
export function mergeTicket(a, b) {
  if (!a) return b;
  if (!b) return a;
  const messages = new Map();
  [...arr(a.messages), ...arr(b.messages)].forEach((message) => {
    const key = String(message.id ?? `${message.createdAt}-${message.text}`);
    messages.set(key, { ...messages.get(key), ...message });
  });
  const newer = String(a.updatedAt || "") > String(b.updatedAt || "") ? a : b;
  return { ...a, ...b, ...newer, messages: [...messages.values()].sort((x, y) => String(x.createdAt || "").localeCompare(String(y.createdAt || ""))) };
}

export const presenceToPatch = (entry) => ({
  oxirgi_faollik: isoDate(entry.lastSeen),
  oxirgi_kirish: isoDate(entry.lastLoginAt),
  oxirgi_kirgan: entry.lastLoginBy || null,
  faol_foydalanuvchi: entry.activeUser || null,
  offline_at: isoDate(entry.offlineAt),
  xatolar: arr(entry.errors),
});

export const presenceFromRow = (row, local = {}) => withoutUndefined({
  ...local,
  lastSeen: row.oxirgi_faollik || local.lastSeen || undefined,
  lastLoginAt: row.oxirgi_kirish || local.lastLoginAt || undefined,
  lastLoginBy: row.oxirgi_kirgan || local.lastLoginBy || undefined,
  activeUser: row.faol_foydalanuvchi || local.activeUser || undefined,
  offlineAt: row.offline_at || null,
  errors: Array.isArray(row.xatolar) ? row.xatolar : arr(local.errors),
});

export const currencyToPatch = (settings) => {
  const value = plain(settings);
  return {
    valyuta: value.code === "USD" ? "USD" : "so'm",
    usd_kurs: Math.max(0, num(value.usdRate)),
    valyutalar: arr(value.enabled).length ? arr(value.enabled) : ["UZS", "USD"],
  };
};

export const currencyFromRow = (row) => ({
  code: row.valyuta === "USD" ? "USD" : "UZS",
  usdRate: num(row.usd_kurs),
  enabled: arr(row.valyutalar).filter((code) => code === "UZS" || code === "USD").length
    ? arr(row.valyutalar).filter((code) => code === "UZS" || code === "USD")
    : ["UZS", "USD"],
});
