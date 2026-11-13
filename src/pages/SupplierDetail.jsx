import SalesProductFilter from "../components/SalesProductFilter";
import { saleMatchesProduct } from "../data/salesProductFilter";
import "./Sales.css";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";
import SupplierReturnsLedger, { SupplierReturnForm, SupplierReturnPrompt } from "../components/SupplierReturns";
import { calculateReturn, returnLimits, reduceReturnStock, orderReturnBalance, returnOffset, supplierOutstanding, allocateReturnDebt, summarizeOrderReturns } from "../data/supplierReturns";
import { reservedQuantitiesByCondition } from "../data/ordersStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Calendar, CreditCard, DollarSign, Download, Edit2, HandCoins, Package, PackageCheck, Phone, Plus, RotateCcw, Save, Trash2, Truck } from "lucide-react";
import Modal, { Field } from "../components/Modal";
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { getTenantCompanyName } from "../data/tenantBrand";
import "./SupplierDetail.css";
import { getData, setData, useDataVersion } from "../supabase/db";

const read = (key) => { try { const v = getData(key, []); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (key, value) => setData(key, value);
const money = (v) => formatCurrency(v);
const date = (v) => v ? new Intl.DateTimeFormat("uz-UZ", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v)) : "—";
const dateTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Sana saqlanmagan";
  if (!String(value).includes("T") && !String(value).includes(":")) return `${date(value)} · Vaqt saqlanmagan`;
  return new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const returnTimestamp = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Ma'lumot saqlanmagan";
  if (!String(value).includes("T") && !String(value).includes(":")) return date(value) + " · Vaqt saqlanmagan";
  return new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};
const label = (id) => String(id || "—").startsWith("PO-LEGACY-") ? "Qabul qilingan tovar" : id;
const state = { paid: ["To'landi", "var(--success)"], partial: ["Qisman", "var(--warning)"], debt: ["Qarz", "var(--danger)"] };
const orderDebt = (order) => order.status === "paid" ? 0 : Math.max(0, Number(order.remaining ?? (order.status === "debt" ? order.amount : 0)));
const blankItem = { name: "", brand: "", category: "", packaging: "", quantity: "", packageCount: "", weight: "", cost: "" };
const firstUpper = (value = "") => value ? value[0].toLocaleUpperCase("uz-UZ") + value.slice(1) : "";
const digits = (value) => String(value || "").replace(/\D/g, "");
const amount = (value) => Number(digits(value) || 0);
const safeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const unitOf = (line) => line?.measurementUnit || line?.product?.measurementUnit || (line?.measurementType === "weight" || line?.product?.measurementType === "weight" ? "kg" : "dona");
const groupedQuantity = (lines, getQuantity) => {
  const totals = new Map();
  lines.forEach((line) => {
    const quantity = Number(getQuantity(line) || 0);
    if (quantity <= 0) return;
    const unit = unitOf(line);
    totals.set(unit, (totals.get(unit) || 0) + quantity);
  });
  return [...totals.entries()].map(([unit, quantity]) => `${quantity.toLocaleString("uz-UZ")} ${unit}`).join(" · ") || `0 ${unitOf(lines[0])}`;
};
const quantityGroupsText = (groups) => Object.entries(groups || {}).filter(([, quantity]) => quantity > 0).map(([unit, quantity]) => `${quantity.toLocaleString("uz-UZ")} ${unit}`).join(" · ") || "0 dona";
const combinedQuantityGroups = (first = {}, second = {}) => Object.fromEntries([...new Set([...Object.keys(first), ...Object.keys(second)])].map((unit) => [unit, Number(first[unit] || 0) + Number(second[unit] || 0)]));

export default function SupplierDetail({ supplierId, onBack }) {
  useUILanguage();
  const { success } = useToast();
  const [returnReceipt, setReturnReceipt] = useState(null);
  const closeReturnReceipt = useCallback(() => setReturnReceipt(null), []);
  const returnSaving = useRef(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState("");
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [supplier, setSupplier] = useState(() => read("crm_suppliers").find((x) => String(x.id) === String(supplierId)));
  const [orders, setOrders] = useState(() => read(`crm_supplier_orders_${supplierId}`));
  const [returns, setReturns] = useState(() => read("crm_supplier_returns").filter((x) => String(x.supplierId) === String(supplierId)));
  // Boshqa kassir yoki kompyuterda o'zgarsa, Supabase'dan kelgan yangi holat qayta o'qiladi.
  const dataVersion = useDataVersion();
  useEffect(() => {
    if (!dataVersion) return;
    setSupplier(read("crm_suppliers").find((x) => String(x.id) === String(supplierId)));
    setOrders(read(`crm_supplier_orders_${supplierId}`));
    setReturns(read("crm_supplier_returns").filter((x) => String(x.supplierId) === String(supplierId)));
  }, [dataVersion, supplierId]);
  const [tab, setTab] = useState("orders"), [detail, setDetail] = useState(null), [legacyDebtOpen, setLegacyDebtOpen] = useState(false), [returnDraft, setReturnDraft] = useState(null), [confirming, setConfirming] = useState(false), [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({ name: supplier?.name || "", phone: supplier?.phone || "", address: supplier?.address || "", status: supplier?.status || "active" }));
  const [receiveOpen, setReceiveOpen] = useState(false), [receiveConfirm, setReceiveConfirm] = useState(false), [receiveItems, setReceiveItems] = useState([]), [receiveForm, setReceiveForm] = useState(blankItem), [cash, setCash] = useState(""), [debtInput, setDebtInput] = useState(""), [receiveError, setReceiveError] = useState("");
  const [receive, setReceive] = useState({ id: "", items: "" });
  const products = read("crm_products").filter((x) => String(x.supplierId) === String(supplierId));
  useEffect(() => {
    if (orders.length || (!products.length && !Number(supplier?.debt))) return;
    const now = supplier?.createdAt || new Date().toISOString(), details = products.map((x) => ({ id: x.id, name: x.name, quantity: x.stock, defectiveQuantity: Number(x.defectiveStock || 0), cost: x.cost, measurementType: x.measurementType || "count", measurementUnit: x.measurementUnit || (x.measurementType === "weight" ? "kg" : "dona") }));
    const outstanding = Math.max(0, Number(supplier?.debt) || 0), total = Math.max(Number(supplier?.purchases) || 0, details.reduce((s, x) => s + Number(x.quantity || 0) * Number(x.cost || 0), 0), outstanding);
    const order = { id: `PO-LEGACY-${supplierId}`, supplierId, supplierName: supplier?.name || "", supplierAddress: supplier?.address || "", items: details.reduce((s, x) => s + Number(x.quantity || 0), 0), productCount: details.length, productIds: details.map((x) => x.id), productDetails: details, amount: total, remaining: outstanding, payment: outstanding ? outstanding >= total ? "Qarz" : "Qisman" : "Naqd", status: outstanding ? outstanding >= total ? "debt" : "partial" : "paid", received: true, date: now };
    write(`crm_supplier_orders_${supplierId}`, [order]); setOrders([order]);
  }, [orders.length, products, supplier, supplierId]);
  useEffect(() => {
    if (!supplier || !orders.length) return;
    const orderBalance = orders.reduce((sum, order) => sum + orderReturnBalance(order, returns), 0);
    const legacyDebt = Math.max(Number(supplier.legacyDebt || 0), Math.max(0, Number(supplier.debt || 0) - orderBalance));
    const currentDebt = orderBalance + legacyDebt;
    if (Number(supplier.debt || 0) === currentDebt && Number(supplier.legacyDebt || 0) === legacyDebt) return;
    const updated = { ...supplier, debt: currentDebt, legacyDebt };
    write("crm_suppliers", read("crm_suppliers").map((item) => String(item.id) === String(supplierId) ? updated : item));
    setSupplier(updated);
  }, [orders, returns, supplier, supplierId]);
  if (!supplier) return <div className="card p-8 text-center">{tx("Ta'minotchi topilmadi")}</div>;
  const total = orders.reduce((s, x) => s + Number(x.amount || 0), 0), orderBalance = orders.reduce((sum, order) => sum + orderReturnBalance(order, returns), 0), legacyDebt = Math.max(Number(supplier.legacyDebt || 0), Math.max(0, Number(supplier.debt || 0) - orderBalance)), debt = orderBalance + legacyDebt;
  const items = (order) => {
    const details = order?.productDetails || order?.products;
    if (details?.length) return details.map((line) => { const product = products.find((x) => String(x.id) === String(line.id)) || line.product || line; return { ...line, measurementType: line.measurementType || product.measurementType, measurementUnit: line.measurementUnit || product.measurementUnit, product }; });
    const ids = order?.productIds;
    return ids?.length ? products.filter((x) => ids.includes(x.id)).map((product) => ({ ...product, quantity: product.stock, product })) : products.map((product) => ({ ...product, quantity: product.stock, product }));
  };
  const currentReturnLimits = (line, product, returnRows, orderId) => {
    const reserved = reservedQuantitiesByCondition(), productId = String(product.id);
    return returnLimits(line, product, returnRows, orderId, { good: reserved.good[productId] || 0, defective: reserved.defective[productId] || 0 });
  };
  const summary = (order) => { const orderReturns = returns.filter((x) => String(x.orderId) === String(order?.id)), returned = orderReturns.reduce((s, x) => s + Number(x.amount || 0), 0), amount = Number(order?.amount || 0), net = Math.max(0, amount - returned), debt = orderReturnBalance(order, returns), returnedQuantities = summarizeOrderReturns(order?.id, items(order), orderReturns); return { returned, amount, net, debt, cash: Math.max(0, net - debt), returnedQuantities }; };
  const paymentHistory = (order) => {
    if (Array.isArray(order?.paymentHistory)) return order.paymentHistory;
    const paid = Math.max(0, Number(order?.amount || 0) - orderDebt(order));
    return paid > 0 ? [{ id: `PAY-INITIAL-${order.id}`, amount: paid, method: order.payment || "Naqd", date: order.date, kind: "initial" }] : [];
  };
  const paidTransactions = orders.flatMap((order) => paymentHistory(order).map((payment) => ({ order, payment }))).filter(({ payment }) => Number(payment.amount) > 0);
  const downloadOrderPdf = (order) => {
    const orderItems = items(order), totals = summary(order);
    const companyName = getTenantCompanyName();
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) return;
    const rows = orderItems.map((line, index) => {
      const quantity = Number(line.quantity || 0), cost = Number(line.cost ?? line.product?.cost ?? 0);
      return `<tr><td>${index + 1}</td><td><strong>${safeHtml(line.name)}</strong></td><td>${safeHtml(quantity.toLocaleString("uz-UZ"))} ${safeHtml(unitOf(line))}</td><td>${money(cost)}</td><td>${money(quantity * cost)}</td></tr>`;
    }).join("");
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safeHtml(label(order.id))}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:48px;line-height:1.45}.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #2563eb;padding-bottom:20px;margin-bottom:28px}.brand{font-size:24px;font-weight:800;color:#2563eb}.title{font-size:22px;font-weight:800;margin:0 0 6px}.muted{color:#64748b;font-size:13px}.info{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:22px 0}.box{padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px}.box b{display:block;margin-top:4px}table{border-collapse:collapse;width:100%;margin-top:22px}th{background:#eff6ff;color:#1e3a8a;text-align:left;font-size:12px;padding:11px;border:1px solid #bfdbfe}td{padding:11px;border:1px solid #e2e8f0;font-size:13px}tfoot td{font-weight:700;background:#f8fafc}.right{text-align:right}.footer{margin-top:36px;padding-top:14px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px}@media print{body{margin:28px}}</style></head><body><div class="head"><div><div class="brand">${safeHtml(companyName)}</div><div class="muted">Ta'minotchidan qabul qilingan tovarlar</div></div><div class="right"><h1 class="title">Xarid dalolatnomasi</h1><div class="muted">${safeHtml(label(order.id))}</div></div></div><div class="info"><div class="box"><span class="muted">Ta'minotchi</span><b>${safeHtml(supplier.name)}</b><span class="muted">${safeHtml(supplier.phone || "Telefon ko'rsatilmagan")}</span><span class="muted">${safeHtml(order.supplierAddress || supplier.address || "Manzil ko'rsatilmagan")}</span></div><div class="box"><span class="muted">Qabul qilingan sana</span><b>${safeHtml(dateTime(order.date))}</b><span class="muted">To'lov: ${safeHtml(order.payment || "—")}</span></div></div><table><thead><tr><th>#</th><th>Mahsulot</th><th>Miqdor</th><th>Tan narxi</th><th>Jami summa</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Mahsulotlar topilmadi</td></tr>'}</tbody><tfoot><tr><td colspan="4" class="right">Umumiy xarid summasi</td><td>${money(totals.amount)}</td></tr><tr><td colspan="4" class="right">Naqd to'lov</td><td>${money(totals.cash)}</td></tr><tr><td colspan="4" class="right">Qarzga yozilgan</td><td>${money(totals.debt)}</td></tr></tfoot></table><div class="footer">Hujjat ${safeHtml(new Date().toLocaleString("uz-UZ"))} da ${safeHtml(companyName)} orqali shakllantirildi.</div><script>window.onload=()=>{window.print();};</script></body></html>`);
    popup.document.close();
  };
  const downloadPaymentReceipt = (order, payment) => {
    const orderItems = items(order), popup = window.open("", "_blank", "width=760,height=780");
    if (!popup) return;
    const rows = orderItems.map((line, index) => {
      const quantity = Number(line.quantity || 0), cost = Number(line.cost ?? line.product?.cost ?? 0);
      return `<tr><td>${index + 1}</td><td><strong>${safeHtml(line.name || line.product?.name || "Mahsulot")}</strong><br><small>ID: ${safeHtml(line.id || line.product?.id || "—")} · Brend: ${safeHtml(line.brand || line.product?.brand || "—")}</small></td><td>${safeHtml(quantity.toLocaleString("uz-UZ"))} ${safeHtml(unitOf(line))}</td><td>${safeHtml(Number(line.defectiveQuantity || 0).toLocaleString("uz-UZ"))} ${safeHtml(unitOf(line))}</td><td>${money(quantity * cost)}</td></tr>`;
    }).join("");
    const companyName = getTenantCompanyName(), paidAt = payment.date || order.date;
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Chek-${safeHtml(payment.id || order.id)}</title><style>body{font-family:Arial,sans-serif;color:#172033;margin:40px;line-height:1.5}.head{display:flex;justify-content:space-between;border-bottom:3px solid #2563eb;padding-bottom:18px;margin-bottom:24px}.brand{font-size:22px;font-weight:800;color:#2563eb}.title{font-size:20px;margin:0}.muted{color:#64748b;font-size:12px}.info{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.box{padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px}.box b{display:block;margin-top:4px}table{border-collapse:collapse;width:100%;margin:18px 0}th{background:#eff6ff;text-align:left;font-size:12px;padding:9px;border:1px solid #bfdbfe}td{padding:9px;border:1px solid #e2e8f0;font-size:12px}tfoot td{font-weight:700}.paid{margin-top:16px;padding:16px;background:#ecfdf5;border-radius:8px;color:#047857;font-size:18px;font-weight:800}.right{text-align:right}@media print{body{margin:24px}}</style></head><body><div class="head"><div><div class="brand">${safeHtml(companyName)}</div><div class="muted">Ta’minotchi to‘lovi cheki</div></div><div class="right"><h1 class="title">TO‘LOV CHEKI</h1><div class="muted">${safeHtml(payment.id || "—")}</div></div></div><div class="info"><div class="box"><span class="muted">Ta’minotchi</span><b>${safeHtml(order.supplierName || supplier.name)}</b></div><div class="box"><span class="muted">To‘lov sanasi</span><b>${safeHtml(dateTime(paidAt))}</b></div><div class="box"><span class="muted">Qabul / buyurtma ID</span><b>${safeHtml(label(order.id))}</b></div><div class="box"><span class="muted">To‘lov usuli</span><b>${safeHtml(payment.method || "Naqd")}</b></div></div><table><thead><tr><th>#</th><th>Mahsulot</th><th>Qabul miqdori</th><th>Brak</th><th>Mahsulot summasi</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Mahsulotlar topilmadi</td></tr>'}</tbody><tfoot><tr><td colspan="4" class="right">Umumiy xarid summasi</td><td>${money(order.amount)}</td></tr></tfoot></table><div class="paid">To‘langan summa: ${money(payment.amount)}</div><p class="muted">Chek ${safeHtml(new Date().toLocaleString("uz-UZ"))} da shakllantirildi.</p><script>window.onload=()=>{window.print();};</script></body></html>`);
    popup.document.close();
  };
  const updateOrders = (next) => { setOrders(next); write(`crm_supplier_orders_${supplierId}`, next); };
  const save = () => { const next = { ...supplier, ...form }; write("crm_suppliers", read("crm_suppliers").map((x) => String(x.id) === String(supplierId) ? next : x)); setSupplier(next); setEditing(false); success("Ta'minotchi yangilandi", next.name); };
  const remove = () => { write("crm_suppliers", read("crm_suppliers").filter((x) => String(x.id) !== String(supplierId))); onBack?.(); };
  const openPayment = (order) => { setPaymentOrder(order); setPaymentAmountInput(String(summary(order).debt)); };
  const pay = (order, paymentValue = paymentAmountInput) => {
    if (!order || summary(order).debt <= 0) return;
    const outstanding = summary(order).debt;
    const paidNow = Math.min(outstanding, amount(paymentValue));
    if (paidNow <= 0) return;
    const remaining = Math.max(0, outstanding - paidNow), paidBefore = Math.max(0, Number(order.amount || 0) - orderDebt(order));
    const returnedAmount = returns.reduce((sum, record) => sum + returnOffset(record, order.id), 0);
    const history = Array.isArray(order.paymentHistory) ? order.paymentHistory : paidBefore > 0 ? [{ id: `PAY-INITIAL-${order.id}`, amount: paidBefore, method: order.payment || "Naqd", date: order.date, kind: "initial" }] : [];
    const paymentEntry = { id: `PAY-${Date.now()}`, amount: paidNow, method: "Naqd", date: new Date().toISOString(), kind: "debt" };
    const updatedOrder = { ...order, status: remaining === 0 ? "paid" : "partial", remaining: remaining === 0 ? 0 : remaining + returnedAmount, payment: remaining === 0 ? "Naqd" : "Qisman", paymentHistory: [...history, paymentEntry] };
    const updatedOrders = orders.map((item) => item.id === order.id ? updatedOrder : item);
    const orderBalance = updatedOrders.reduce((sum, item) => sum + orderReturnBalance(item, returns), 0);
    const legacyBalance = supplierOutstanding(supplier, orders, returns).legacy;
    const updatedSupplier = { ...supplier, debt: orderBalance + legacyBalance, legacyDebt: legacyBalance };
    updateOrders(updatedOrders);
    setDetail((current) => current?.id === order.id ? updatedOrder : current);
    write("crm_suppliers", read("crm_suppliers").map((item) => String(item.id) === String(supplierId) ? updatedSupplier : item));
    setSupplier(updatedSupplier);
    setPaymentOrder(null);
    setPaymentAmountInput("");
    downloadPaymentReceipt(updatedOrder, paymentEntry);
    success(remaining === 0 ? "Qarz to‘landi" : "Qisman to‘lov qabul qilindi", `${money(paidNow)} · ${tx("Qolgan qarz")}: ${money(remaining)}`);
  };
  const addReceiveItem = () => {
    if (!receiveForm.name.trim() || !receiveForm.quantity || !receiveForm.cost) return setReceiveError("Mahsulot nomi, miqdori va tan narxini kiriting");
    setReceiveItems((items) => [...items, { ...receiveForm, id: `${Date.now()}-${items.length}` }]); setReceiveForm(blankItem); setReceiveError("");
  };
  const saveReceipt = () => {
    const last = receiveForm.name.trim() ? [...receiveItems, { ...receiveForm, id: `${Date.now()}-last` }] : receiveItems;
    const totalAmount = last.reduce((sum, item) => sum + Number(item.quantity || 0) * amount(item.cost), 0), cashAmount = amount(cash);
    if (!last.length) return setReceiveError("Kamida bitta mahsulot qo'shing");
    if (!Number.isFinite(cashAmount) || cashAmount < 0 || cashAmount > totalAmount) return setReceiveError("Naqd to'lov summasini to'g'ri kiriting");
    const now = new Date().toISOString(), catalog = read("crm_products"), productList = last.map((item, index) => { const name = firstUpper(item.name.trim()), quantity = Number(item.quantity), existing = catalog.find((product) => String(product.supplierId) === String(supplierId) && String(product.name || "").trim().toLowerCase() === name.toLowerCase()); return existing ? { ...existing, stock: Number(existing.stock || 0) + quantity, cost: amount(item.cost) || existing.cost, brand: firstUpper(item.brand.trim()) || existing.brand, category: firstUpper(item.category.trim()) || existing.category, packaging: firstUpper(item.packaging.trim()) || existing.packaging, weight: Number(item.weight) || existing.weight || 0 } : { id: `${Date.now()}-${index}`, name, brand: firstUpper(item.brand.trim()), category: firstUpper(item.category.trim()) || "Boshqa", packaging: firstUpper(item.packaging.trim()) || "Dona", stock: quantity, cost: amount(item.cost), price: 0, supplierId, supplierName: supplier.name, packageCount: Number(item.packageCount) || 0, weight: Number(item.weight) || 0 }; });
    const receiptLines = last.map((item, index) => ({ id: productList[index].id, name: productList[index].name, brand: productList[index].brand, measurementType: item.measurementType || productList[index].measurementType || "count", measurementUnit: item.measurementUnit || productList[index].measurementUnit || "dona", quantity: Number(item.quantity), defectiveQuantity: Number(item.defectiveQuantity || 0), cost: amount(item.cost) }));
    const initialPayment = cashAmount > 0 ? { id: `PAY-INITIAL-${Date.now()}`, amount: cashAmount, method: "Naqd", date: now, kind: "initial" } : null;
    const order = { id: `PO-${Date.now().toString().slice(-6)}`, supplierId, supplierName: supplier.name, supplierAddress: supplier.address || "", items: receiptLines.reduce((sum, item) => sum + item.quantity, 0), productCount: receiptLines.length, productIds: receiptLines.map((item) => item.id), productDetails: receiptLines, amount: totalAmount, remaining: totalAmount - cashAmount, payment: cashAmount === totalAmount ? "Naqd" : "Qisman", status: cashAmount === totalAmount ? "paid" : cashAmount ? "partial" : "debt", paymentHistory: initialPayment ? [initialPayment] : [], received: true, date: now };
    write("crm_products", [...productList.filter((item) => !catalog.some((product) => String(product.id) === String(item.id))), ...catalog.map((product) => productList.find((item) => String(item.id) === String(product.id)) || product)]); write(`crm_supplier_orders_${supplierId}`, [order, ...orders]);
    write("crm_supplier_receipts", [{ id: `REC-${Date.now()}`, supplierId, supplier: supplier.name, supplierAddress: supplier.address || "", orderId: order.id, items: order.items, products: order.productDetails, amount: totalAmount, date: now }, ...read("crm_supplier_receipts")]);
    const nextSupplier = { ...supplier, products: Number(supplier.products || 0) + productList.length, purchases: Number(supplier.purchases || 0) + totalAmount, debt: Number(supplier.debt || 0) + order.remaining, lastOrder: now }; write("crm_suppliers", read("crm_suppliers").map((item) => String(item.id) === String(supplierId) ? nextSupplier : item));
    setSupplier(nextSupplier); setOrders([order, ...orders]); setReceiveOpen(false); setReceiveConfirm(false); setReceiveItems([]); setReceiveForm(blankItem); setCash(""); setDebtInput(""); success("Tovar qabul qilindi", `${productList.length} xil mahsulot`); if (initialPayment) downloadPaymentReceipt(order, initialPayment);
  };
  const receiveGoods = () => {};
  const startReturn = (line) => {
    const product = read("crm_products").find(x => String(x.id) === String(line.id));
    if (!product || !detail) return;
    const currentReturns = read("crm_supplier_returns").filter(r => String(r.supplierId) === String(supplierId));
    const limits = currentReturnLimits(line, product, currentReturns, detail.id);
    returnSaving.current = false;
    setReturnDraft({ product, line, ...limits, orderId: detail.id, orderDebt: supplierOutstanding(supplier,orders,currentReturns).total, receivedAt: detail.date, unit: unitOf(line), goodQuantity: "", defectiveQuantity: "", refundedAmount: "", reason: "" });
    setConfirming(false);
  };
  const returnGoods = () => {
    if (!returnDraft || returnSaving.current) return;
    const catalog = read("crm_products"), allReturns = read("crm_supplier_returns");
    const product = catalog.find(x => String(x.id) === String(returnDraft.product.id));
    const latestOrders = read(`crm_supplier_orders_${supplierId}`);
    const latestSupplier = read("crm_suppliers").find(x => String(x.id)===String(supplierId)) || supplier;
    const order = latestOrders.find(x => String(x.id) === String(returnDraft.orderId));
    if (!product || !order) return;
    const ownReturns = allReturns.filter(r => String(r.supplierId) === String(supplierId));
    const fresh = { ...returnDraft, ...currentReturnLimits(returnDraft.line,product,ownReturns,order.id), orderDebt: supplierOutstanding(latestSupplier,latestOrders,ownReturns).total };
    const totals = calculateReturn(fresh);
    if (!totals.valid || fresh.orderDebt !== returnDraft.orderDebt) { setReturnDraft({...fresh,error:"Ombor qoldig‘i, band qilingan miqdor yoki qarz o‘zgardi. Miqdor va pulni qayta tekshiring."}); setConfirming(false); return; }
    returnSaving.current = true;
    const record = { version:2, id:crypto.randomUUID(), supplierId, supplierName:supplier.name, orderId:order.id, productId:product.id, productName:product.name, productCategory:product.categoryName || product.category || product.categoryTitle || "", productCount:1, reason:fresh.reason.trim(), items:totals.goodQuantity+totals.defectiveQuantity, measurementUnit:fresh.unit, goodQuantity:totals.goodQuantity, defectiveQuantity:totals.defectiveQuantity, goodUnitCost:fresh.goodCost, defectUnitCost:fresh.badCost, amount:totals.amount, debtOffset:totals.debtOffset, refundDue:totals.refundDue, refundedAmount:totals.refundedAmount, receivedAt:fresh.receivedAt, returnedAt:new Date().toISOString() };
    Object.assign(record, allocateReturnDebt(totals.debtOffset,latestSupplier,latestOrders,ownReturns,order.id));
    try {
      const suppliers = read("crm_suppliers");
      const previousSupplier = suppliers.find(x => String(x.id) === String(supplierId)) || supplier;
      const nextSupplier = {...previousSupplier,debt:Math.max(0,fresh.orderDebt-totals.debtOffset),legacyDebt:Math.max(0,supplierOutstanding(latestSupplier,latestOrders,ownReturns).legacy-record.legacyOffset)};
      write("crm_products",catalog.map(x => String(x.id)===String(product.id)?reduceReturnStock(x,record,fresh.defectIds):x));
      write("crm_suppliers",suppliers.map(x => String(x.id)===String(supplierId)?nextSupplier:x));
      write("crm_supplier_returns",[record,...allReturns]);
      setSupplier(nextSupplier); setReturns([record,...ownReturns]); setReturnDraft(null); setConfirming(false); setReturnReceipt(record);
      success("Tovar qaytarildi",product.name);
    } catch (error) { returnSaving.current=false; setReturnDraft({...fresh,error:error.message || "Saqlash amalga oshmadi"}); }
  };
  const tabs = [["orders", "Buyurtmalar"], ["payments", "To'lovlar"], ["debt", "Qarzdorlik"], ["returns", "Qaytarilgan tovarlar"]];
  const open = (order) => setDetail(order);
  const detailReceipt = detail ? read("crm_supplier_receipts").find((receipt) => String(receipt.id) === String(detail.receiptId) || String(receipt.orderId) === String(detail.id) || receipt.orderIds?.some((id) => String(id) === String(detail.id))) : null;
  return <div className="space-y-6 fade-in">
    <div className="flex items-center justify-between gap-4"><div className="flex items-center gap-4"><button className="app-back-button" onClick={onBack}><ArrowLeft size={16}/>{tx("Orqaga")}</button><div><h1 className="font-display font-bold text-2xl">{tx("Ta'minotchi profili")}</h1><p className="text-sm" style={{ color: "var(--text-muted)" }}>{tx("Yetkazib beruvchi tarixi va shartnomalari")}</p></div></div><button className="btn-primary" onClick={() => { setReceiveError(""); setReceiveOpen(true); }}><PackageCheck size={16}/>{tx("Tovar qabul qilish")}</button></div>
    <div className="grid gap-5 detail-grid" style={{ gridTemplateColumns: "300px 1fr" }}><aside className="space-y-4"><div className="card p-5 text-center"><div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto mb-4" style={{ background: "linear-gradient(135deg,var(--brand),var(--violet))" }}>{supplier.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}</div><h2 className="font-display font-bold text-lg">{supplier.name}</h2><div className="space-y-3 mt-5 text-left text-sm" style={{ color: "var(--text-secondary)" }}><div className="flex gap-3"><Phone size={15}/>{supplier.phone || "—"}</div><div className="flex gap-3"><Package size={15}/>{supplier.address || tx("Manzil ko‘rsatilmagan")}</div><div className="flex gap-3"><Package size={15}/>{products.length} {tx("ta mahsulot")}</div><div className="flex gap-3"><Calendar size={15}/>{tx("So'nggi:")} {dateTime(orders[0]?.date)}</div></div><div className="grid grid-cols-2 gap-3 mt-5"><button className="btn-ghost text-sm justify-center" onClick={() => setEditing(!editing)}><Edit2 size={14}/>{tx("Tahrirlash")}</button><button className="btn-ghost text-sm justify-center" style={{ color: "var(--danger)" }} onClick={remove}><Trash2 size={14}/>{tx("O'chirish")}</button></div>{editing && <div className="space-y-2 mt-4"><input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/><input className="input-base" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}/><input className="input-base" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={tx("Ta’minotchi manzili (ixtiyoriy)")}/><select className="input-base" value={form.status || "active"} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">{tx("Faol")}</option><option value="inactive">{tx("Nofaol")}</option></select><button className="btn-primary w-full justify-center" onClick={save}><Save size={14}/>{tx("Saqlash")}</button></div>}</div><div className="grid grid-cols-2 gap-3">{[[Package, products.length, "Jami mahsulot"], [DollarSign, money(total), "Jami xaridlar"], [CreditCard, debt ? money(debt) : "—", "Joriy qarz"], [Truck, supplier.status === "inactive" ? "Nofaol" : "Faol", "Holat"]].map(([Icon, value, text]) => { const hasDebt = text === "Joriy qarz" && debt > 0; const isStatus = text === "Holat"; const inactive = supplier.status === "inactive"; const color = isStatus ? (inactive ? "var(--danger)" : "var(--brand)") : hasDebt ? "var(--danger)" : null; return <div className="card p-4 min-w-0" key={text} style={isStatus ? { background: inactive ? "var(--danger-light)" : "var(--brand-light)", borderColor: inactive ? "var(--danger-border)" : "var(--brand-border)" } : undefined}><Icon size={16} style={{ color: color || "var(--brand)" }}/><b className="block mt-2 min-w-0" style={{ color: color || "var(--text-primary)", overflowWrap: "anywhere" }}>{value}</b><small style={{ color: color || "var(--text-faint)" }}>{tx(text)}</small></div>; })}</div></aside>
    <section className="card overflow-hidden"><div className="flex items-center gap-1 px-5 pt-4 overflow-x-auto" style={{ borderBottom: "1px solid var(--border-subtle)" }}>{tabs.map(([id, text]) => <button key={id} onClick={() => setTab(id)} className="px-4 py-3 text-sm font-medium whitespace-nowrap" style={{ color: tab === id ? "var(--brand)" : "var(--text-muted)", borderBottom: tab === id ? "2px solid var(--brand)" : "2px solid transparent" }}>{tx(text)}</button>)}</div>
    {tab === "orders" && <FilteredSupplierOrders orders={orders} open={open} download={downloadOrderPdf} getItems={items}/>} {tab === "payments" && <div className="p-5 space-y-4"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl p-4" style={{ background: "var(--brand-light)", color: "var(--brand)" }}><small>{tx("To‘lovlar soni")}</small><b className="block text-xl mt-1">{paidTransactions.length}</b></div><div className="rounded-xl p-4" style={{ background: "var(--success-light)", color: "var(--success)" }}><small>{tx("Jami to‘langan")}</small><b className="block text-lg mt-1">{money(paidTransactions.reduce((sum, row) => sum + Number(row.payment.amount || 0), 0))}</b></div></div><div className="space-y-3">{paidTransactions.map(({ order, payment }) => <SupplierPaymentCard key={`${order.id}-${payment.id}`} order={order} payment={payment} lines={items(order)} totals={summary(order)} supplier={supplier} open={() => open(order)} download={() => downloadPaymentReceipt(order, payment)}/>)}{!paidTransactions.length && <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>{tx("To‘lovlar hali mavjud emas")}</p>}</div></div>} {tab === "debt" && <div className="p-5 space-y-5">{debt > 0 ? <><div className="p-4 rounded-2xl" style={{ background: "var(--danger-light)", border: "1px solid var(--danger-border)" }}><div className="text-sm font-semibold mb-1" style={{ color: "var(--danger)" }}>{tx("Joriy qarzdorlik")}</div><div className="text-2xl font-display font-bold" style={{ color: "var(--danger)" }}>{money(debt)}</div></div><div><h3 className="font-semibold text-sm mb-3">{tx("Buyurtmaga bog‘langan qarzlar")}</h3><div className="space-y-2">{orders.filter((x) => summary(x).debt > 0).map((x) => { const productNames = (x.productDetails || []).map((line) => line.name).filter(Boolean); const source = productNames.length ? productNames.slice(0, 2).join(", ") + (productNames.length > 2 ? ` +${productNames.length - 2}` : "") : x.productCount ? `${x.productCount} xil mahsulot` : tx("Mahsulot ma’lumoti saqlanmagan"); return <div key={x.id} className="flex items-center justify-between gap-3 p-4 rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}><button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(x)}><b className="block text-sm">{label(x.id)}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{dateTime(x.date)} · {source}</small><small className="block mt-1" style={{ color: "var(--brand)" }}>{tx("Buyurtma va mahsulot tafsilotlari")}</small></button><div className="text-right shrink-0"><b className="block text-sm" style={{ color: "var(--danger)" }}>{money(summary(x).debt)}</b><button className="btn-primary text-xs mt-2" onClick={() => openPayment(x)}><HandCoins size={14}/>{tx("Qarzni to‘lash")}</button></div></div>; })}{!orders.some((x) => summary(x).debt > 0) && !legacyDebt && <p className="py-6 text-sm" style={{ color: "var(--text-muted)" }}>{tx("Buyurtmalardan qolgan qarz topilmadi")}</p>}</div></div>{legacyDebt > 0 && <div><h3 className="font-semibold text-sm mb-3">{tx("Manbasi aniqlanmagan eski qoldiq")}</h3><button type="button" onClick={() => setLegacyDebtOpen(true)} className="w-full flex items-center justify-between gap-3 p-4 rounded-xl text-left" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}><span><b className="block text-sm">{tx("Buyurtmaga biriktirilmagan qarz")}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{tx("Saqlangan sana")}: {dateTime(supplier.lastOrder || supplier.createdAt)}</small><small className="block mt-1" style={{ color: "var(--brand)" }}>{tx("Manba ma’lumotini ko‘rish")} →</small></span><b className="text-sm shrink-0" style={{ color: "var(--danger)" }}>{money(legacyDebt)}</b></button></div>}</> : <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>{tx("Ta'minotchidan qarzdorlik mavjud emas.")}</div>}</div>} {tab === "returns" && <SupplierReturnsLedger records={returns}/>} {tab === "receiving" && <div className="p-5 flex gap-3 flex-wrap"><select className="input-base max-w-xs" value={receive.id} onChange={(e) => setReceive({ id: e.target.value, items: orders.find((x) => x.id === e.target.value)?.items || "" })}><option value="">{tx("Buyurtmani tanlang")}</option>{orders.map((x) => <option key={x.id} value={x.id}>{label(x.id)}</option>)}</select><input className="input-base max-w-48" type="number" min="1" value={receive.items} onChange={(e) => setReceive({ ...receive, items: e.target.value })}/><button className="btn-primary" onClick={receiveGoods}><PackageCheck size={16}/>{tx("Tovarni qabul qilish")}</button></div>}</section></div>
    <Modal contentOnly open={!!selectedReturn} onClose={() => setSelectedReturn(null)} title="Qaytarilgan tovar tafsilotlari" subtitle={supplier.name} icon={RotateCcw}>
      {selectedReturn && <dl className="space-y-3 text-sm">
        {[["Mahsulot", selectedReturn.productName || "Ma'lumot saqlanmagan"], ["Qaytarilgan miqdor", selectedReturn.items != null ? selectedReturn.items + " " + (selectedReturn.measurementUnit || "dona") : "Ma'lumot saqlanmagan"], ["Mahsulot turlari", selectedReturn.productCount != null ? selectedReturn.productCount + " xil" : selectedReturn.productId || selectedReturn.productName ? "1 xil" : "Ma'lumot saqlanmagan"], ["Qaytarish sababi", selectedReturn.reason || "Sabab kiritilmagan"], ["Qaytarilgan sana va vaqt", returnTimestamp(selectedReturn.returnedAt)], ["Qaytarilgan tovar summasi", money(selectedReturn.amount)], ["Buyurtma", label(selectedReturn.orderId)]].map(([name, value]) => <div key={name} className="flex justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}><dt style={{ color: "var(--text-muted)" }}>{tx(name)}</dt><dd style={{ margin: 0, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere" }}>{tx(value)}</dd></div>)}
      </dl>}
    </Modal>
    <Modal contentOnly open={legacyDebtOpen} onClose={() => setLegacyDebtOpen(false)} title="Qarz manbasi" subtitle={supplier.name} icon={CreditCard}>
      <dl className="space-y-1 text-sm">
        {[["Qoldiq summasi", money(legacyDebt)], ["Manba", "Eski ta’minotchi qarzi yozuvi"], ["Buyurtma raqami", "Avvalgi yozuvda saqlanmagan"], ["Bog‘langan mahsulotlar", "Avvalgi yozuvda saqlanmagan"], ["Saqlangan sana-vaqt", dateTime(supplier.lastOrder || supplier.createdAt)], ["Ma’lumot holati", "Qarz CRMdagi eski umumiy qoldiqdan olindi; alohida buyurtma tafsiloti mavjud emas"]].map(([name, value]) => <div key={name} className="flex justify-between gap-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}><dt style={{ color: "var(--text-muted)" }}>{tx(name)}</dt><dd className="font-semibold text-right" style={{ margin: 0, overflowWrap: "anywhere" }}>{tx(value)}</dd></div>)}
      </dl>
    </Modal>    <Modal contentOnly open={!!paymentOrder} onClose={() => { setPaymentOrder(null); setPaymentAmountInput(""); }} title="Qarz to‘lovini tasdiqlash" subtitle={supplier.name} icon={HandCoins}>
      {paymentOrder && <div className="space-y-4">
        <div className="space-y-3 text-sm">
          {[["Buyurtma", label(paymentOrder.id)], ["Xarid sanasi", date(paymentOrder.date)], ["Umumiy summa", money(paymentOrder.amount)], ["To‘langan", money(Number(paymentOrder.amount || 0) - orderDebt(paymentOrder))], ["To‘lov usuli", "Naqd"]].map(([name, value]) => <div key={name} className="flex justify-between gap-3"><span style={{ color: "var(--text-muted)" }}>{tx(name)}</span><strong>{tx(value)}</strong></div>)}
        </div>
        <Field label={tx("To‘lanadigan summa")}><div className="relative"><input className="input-base pr-14" type="text" inputMode="numeric" value={paymentAmountInput === "" ? "" : moneyInputValue(paymentAmountInput, true)} onChange={(event) => { const raw = event.target.value; setPaymentAmountInput(raw === "" ? "" : String(Math.min(summary(paymentOrder).debt, toBaseMoney(raw)))); }} placeholder="0"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div></Field>
        <div className="p-4 rounded-xl min-w-0" style={{ background: Math.max(0, summary(paymentOrder).debt - amount(paymentAmountInput)) > 0 ? "var(--danger-light)" : "var(--success-light)", color: Math.max(0, summary(paymentOrder).debt - amount(paymentAmountInput)) > 0 ? "var(--danger)" : "var(--success)" }}><p className="text-sm">{tx("To‘lovdan keyin qoladigan qarz")}</p><strong className="block text-xl" style={{ overflowWrap: "anywhere" }}>{money(Math.max(0, summary(paymentOrder).debt - amount(paymentAmountInput)))}</strong></div>
        <p className="text-sm">{tx("Ushbu to‘lovni amalga oshirishni tasdiqlaysizmi?")}</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => { setPaymentOrder(null); setPaymentAmountInput(""); }}>{tx("Bekor qilish")}</button><button type="button" className="btn-primary" onClick={() => pay(paymentOrder)} disabled={amount(paymentAmountInput) <= 0}>{tx("Ha, to‘lovni tasdiqlash")}</button></div>
      </div>}
    </Modal>
    <EnhancedSupplierReceiveModal open={receiveOpen} close={() => setReceiveOpen(false)} supplier={supplier} form={receiveForm} setForm={setReceiveForm} items={receiveItems} setItems={setReceiveItems} cash={cash} setCash={setCash} debtInput={debtInput} setDebtInput={setDebtInput} error={receiveError} add={addReceiveItem} save={() => setReceiveConfirm(true)}/>
    <Modal contentOnly open={receiveConfirm} onClose={() => setReceiveConfirm(false)} title={tx("Qabulni tasdiqlash")} subtitle={supplier.name} icon={PackageCheck} width={420}><div className="space-y-4"><p className="text-sm" style={{ color: "var(--text-secondary)" }}>{tx("Kiritilgan mahsulotlarni qabul qilishni tasdiqlaysizmi?")}</p><div className="flex justify-end gap-2"><button className="btn-ghost" onClick={() => setReceiveConfirm(false)}>{tx("Bekor qilish")}</button><button className="btn-primary" onClick={saveReceipt}><PackageCheck size={15}/>{tx("Qabul qilish")}</button></div></div></Modal>
    <DetailModal order={detail} receipt={detailReceipt} supplier={supplier} close={() => setDetail(null)} lines={items(detail)} summary={detail ? summary(detail) : null} payments={detail ? paymentHistory(detail) : []} startReturn={startReturn} onPay={(order, value) => pay(order, value)}/>
    <SupplierReturnForm draft={returnDraft} confirming={confirming} close={() => setReturnDraft(null)} setConfirming={setConfirming} setDraft={setReturnDraft} confirm={returnGoods}/>
    <SupplierReturnPrompt record={returnReceipt} close={closeReturnReceipt}/>
  </div>;
}

function SupplierPaymentCard({ order, payment, lines, totals, supplier, open, download }) {
  const [expanded, setExpanded] = useState(false);
  const quantity = (line) => Number(line.quantity || 0);
  const defective = (line) => Number(line.defectiveQuantity ?? line.defects?.reduce?.((sum, defect) => sum + Number(defect.quantity || 0), 0) ?? 0);
  const productTotal = (line) => quantity(line) * Number(line.cost ?? line.product?.cost ?? 0);
  const totalQuantity = groupedQuantity(lines, quantity);
  const totalDefective = groupedQuantity(lines, defective);
  return <article className="rounded-xl p-4 transition-colors duration-200" style={{ background: expanded ? "color-mix(in srgb, var(--brand) 8%, var(--surface))" : "var(--surface-2)", border: `1px solid ${expanded ? "var(--brand)" : "var(--border-subtle)"}`, boxShadow: expanded ? "0 8px 24px rgba(37, 99, 235, 0.10)" : "none" }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <b className="block text-sm">{tx("Qabul ID")}: {label(order.id)}</b>
        <small className="mt-1 block" style={{ color: "var(--text-muted)" }}>{payment.method || order.payment || tx("To‘lov")} · {dateTime(payment.date || order.date)}</small>
        <small className="mt-1 block" style={{ color: "var(--text-secondary)" }}>{lines.length} {tx("xil mahsulot")} · {totalQuantity}{totalDefective ? <> · <span style={{ color: "var(--danger)" }}>{tx("Brak")}: {totalDefective}</span></> : null}</small>
      </button>
      <div className="flex items-center gap-3">
        <div className="text-right"><small className="block" style={{ color: "var(--text-muted)" }}>{tx("To‘langan summa")}</small><b className="text-lg" style={{ color: "var(--success)" }}>{money(payment.amount)}</b></div>
        <button type="button" className="btn-ghost text-xs" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? tx("Yopish") : tx("Tafsilotlarni ko‘rish")} <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
      </div>
    </div>
    {expanded && <>
    <div className="space-y-2 py-3">{lines.length ? lines.map((line, index) => <div key={`${line.id || line.product?.id || line.name}-${index}`} className="rounded-lg bg-white/70 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><b className="text-sm">{line.name || line.product?.name || tx("Mahsulot nomi saqlanmagan")}</b><small className="mt-1 block" style={{ color: "var(--text-muted)" }}>{tx("ID")}: {line.id || line.product?.id || "—"} <span className="mx-1">·</span> {tx("Brend")}: {line.brand || line.product?.brand || "—"}</small></div><b className="text-sm">{money(productTotal(line))}</b></div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}><span>{tx("Qabul qilingan")}: {quantity(line).toLocaleString("uz-UZ")} {tx(unitOf(line))}</span><span style={{ color: defective(line) ? "var(--danger)" : "var(--text-muted)" }}>{tx("Brak")}: {defective(line).toLocaleString("uz-UZ")} {tx(unitOf(line))}</span><span>{money(Number(line.cost ?? line.product?.cost ?? 0))} / {tx(unitOf(line))}</span></div>
    </div>) : <p className="text-sm" style={{ color: "var(--text-muted)" }}>{tx("Mahsulot tafsilotlari saqlanmagan")}</p>}</div>
    <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}><div className="grid gap-1 text-xs" style={{ color: "var(--text-muted)" }}><span>{tx("Ta’minotchi")}: <b style={{ color: "var(--text-primary)" }}>{order.supplierName || supplier?.name || "—"}</b></span><span>{tx("Manzil")}: <b style={{ color: "var(--text-primary)" }}>{order.supplierAddress || supplier?.address || "—"}</b></span><span>{tx("Qabul qilingan sana")}: <b style={{ color: "var(--text-primary)" }}>{dateTime(order.receivedAt || order.date)}</b></span><span>{tx("Jami xarid")}: <b style={{ color: "var(--text-primary)" }}>{money(totals.amount)}</b> · {tx("Qolgan qarz")}: <b style={{ color: "var(--danger)" }}>{money(totals.debt)}</b></span></div><div className="flex gap-2"><button type="button" className="btn-ghost text-xs" onClick={open}>{tx("Tafsilotlar")}</button><button type="button" className="btn-primary text-xs" onClick={download}><Download size={14}/>{tx("Chekni PDF yuklash")}</button></div></div>
    </>}
  </article>;
}function OrderRows({ orders, open, download, getItems }) { return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr style={{ background: "var(--surface-2)" }}>{["Buyurtma", "Mahsulotlar", "Summa", "Sana", "Holat", "PDF"].map((x) => <th className="text-left px-4 py-2 text-xs" key={x}>{tx(x)}</th>)}</tr></thead><tbody>{orders.map((x) => { const s = state[x.status] || state.debt; return <tr key={x.id} className="border-t cursor-pointer hover:bg-slate-50" onClick={() => open(x)}><td className="px-4 py-2.5 text-xs">{label(x.id)}</td><td className="px-4 py-2.5 text-xs">{x.productCount || "—"}{tx("xil ·")} {groupedQuantity(getItems(x), (line) => line.quantity)}</td><td className="px-4 py-2.5 text-xs">{money(x.amount)}</td><td className="px-4 py-2.5 text-xs">{dateTime(x.date)}</td><td className="px-4 py-2.5 text-xs" style={{ color: s[1] }}>{tx(s[0])}</td><td className="px-4 py-2.5"><button type="button" className="btn-ghost text-xs" title={tx("PDF yuklash")} onClick={(event) => { event.stopPropagation(); download(x); }}><Download size={14}/>{tx("PDF")}</button></td></tr>; })}</tbody></table></div>; }
function List({ rows, empty, render }) { return <div className="p-5 space-y-3">{rows.map((x) => <div className="flex items-center justify-between gap-3 p-4 rounded-xl text-sm" style={{ background: "var(--surface-2)" }} key={x.id}>{render(x)}</div>)}{!rows.length && <p className="text-center py-10 text-sm">{tx(empty)}</p>}</div>; }
// Old qabul oynasi HMR davomida mavjud sessionlar uchun qoldirilgan.
// eslint-disable-next-line no-unused-vars
function SupplierReceiveModal({ open, close, supplier, form, setForm, items, setItems, cash, setCash, error, add, save }) { const total = [...items, ...(form.name.trim() ? [form] : [])].reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.cost || 0), 0), debt = Math.max(0, total - (Number(cash) || 0)), packNeedsCount = /qop|karob|box/i.test(form.packaging); return <Modal contentOnly open={open} onClose={close} title={tx("Tovar qabul qilish")} subtitle={supplier?.name || ""} icon={PackageCheck} width={720}><div/> </Modal>; }
function DetailModal({ order, receipt, supplier, close, lines, summary, payments, startReturn, onPay }) {
  const [paymentInput, setPaymentInput] = useState("");
  useEffect(() => setPaymentInput(""), [order?.id]);
  const paymentValue = amount(paymentInput);
  const remainingAfterPayment = Math.max(0, Number(summary?.debt || 0) - paymentValue);
  const defectiveTotal = lines.reduce((sum, line) => {
    const defects = Array.isArray(line.defects) ? line.defects : [];
    return sum + (defects.reduce((defectSum, defect) => defectSum + Number(defect.total || 0), 0) || Number(line.defectiveQuantity || 0) * Number(line.defectUnitPrice || defects[0]?.unitPrice || 0));
  }, 0);
  const receiptId = order?.receiptId || receipt?.id || order?.id;
  const shipment = {
        supplier: order?.supplierName || receipt?.supplier || supplier?.name,
    supplierAddress: order?.supplierAddress || receipt?.supplierAddress || receipt?.supplierAddresses?.find((entry) => String(entry.supplierId) === String(order?.supplierId))?.address || supplier?.address,
    farmName: order?.farmName || receipt?.farmName,
    tripNumber: order?.tripNumber || receipt?.tripNumber,
  };
  return <Modal contentOnly open={Boolean(order)} onClose={close} title={tx("Qabul tafsilotlari")} subtitle={order ? `${dateTime(order.date)} · ${lines.length} xil mahsulot` : ""} icon={Package} width={680}>
    <div className="space-y-4">
      <section className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
        <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2" style={{ borderColor: "var(--border-subtle)" }}><div><b className="text-sm">{tx("Qabul ma’lumotlari")}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{tx("Qabul ID")}: {label(receiptId)} · {tx("Sana")}: {dateTime(order?.date || receipt?.date)}</small></div><b className="text-xs" style={{ color: "var(--brand)" }}>{lines.length} {tx("xil mahsulot")}</b></div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 text-xs">{[["Ta’minotchi", shipment.supplier], ["Manzil", shipment.supplierAddress], ["Firma / ferma", shipment.farmName], ["Reys raqami", shipment.tripNumber]].map(([name, value]) => <div key={name}><small style={{ color: "var(--text-muted)" }}>{tx(name)}</small><b className="block mt-0.5 break-words">{value || "—"}</b></div>)}</div>
      </section>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{[["Yangi mahsulotlar", groupedQuantity(lines, (line) => line.quantity)], ["Braklar soni", groupedQuantity(lines, (line) => line.defectiveQuantity ?? line.defects?.reduce?.((sum, defect) => sum + Number(defect.quantity || 0), 0) ?? 0)], ["Braklar jami narxi", money(defectiveTotal)], ["Jami xarid summasi", money(summary?.amount || order?.amount || 0)], ["Jami to‘langan", money(summary?.cash || 0)], ["Qolgan qarz", money(summary?.debt || 0)]].map(([name, value]) => <div className="rounded-lg p-3" style={{ background: "var(--brand-light)" }} key={name}><small>{tx(name)}</small><b className="block mt-1">{value}</b></div>)}</div>
      <div className="space-y-2">{lines.map((line, index) => {
        const defects = Array.isArray(line.defects) ? line.defects : [];
        const defectCount = Number(line.defectiveQuantity ?? defects.reduce((sum, defect) => sum + Number(defect.quantity || 0), 0));
        const defectReason = line.defectReason || defects.map((defect) => defect.reason).filter(Boolean).join(", ");
        const defectStatus = line.defectStatus || defects.map((defect) => defect.status).filter(Boolean).join(", ");
        const defectPrice = Number(line.defectUnitPrice || defects[0]?.unitPrice || 0);
        const defectAmount = defects.reduce((sum, defect) => sum + Number(defect.total || 0), 0) || defectCount * defectPrice;
        const quantity = Number(line.quantity || 0), cost = Number(line.cost ?? line.product?.cost ?? 0);
        return <div key={`${line.id || line.name}-${index}`} className="rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><b>{line.name || line.product?.name || tx("Mahsulot nomi saqlanmagan")}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{tx("ID")}: {line.id || "—"} · {tx("Brend")}: {line.brand || line.product?.brand || "—"} · {tx("Kategoriya")}: {line.category || line.product?.category || "—"}</small></div><button className="btn-ghost text-xs shrink-0" style={{ color: "var(--danger)" }} disabled={!Number(line.product?.stock)} onClick={() => startReturn(line)}><RotateCcw size={14}/>{tx("Qaytarish")}</button></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs"><span>{tx("Qabul qilingan")}: <b>{quantity.toLocaleString("uz-UZ")} {tx(unitOf(line))}</b></span><span>{tx("Yaroqli")}: <b>{Math.max(0, quantity - defectCount).toLocaleString("uz-UZ")} {tx(unitOf(line))}</b></span><span>{tx("Tan narxi")}: <b>{money(cost)}</b></span><span>{tx("Mahsulot jami")}: <b>{money(quantity * cost)}</b></span></div>
          {defectCount > 0 && <div className="mt-3 rounded-lg p-2.5 text-xs" style={{ background: "var(--danger-light)", color: "var(--danger)" }}><b>{tx("Brak")}: {defectCount.toLocaleString("uz-UZ")} {tx(unitOf(line))}</b><div className="mt-1">{tx("Holati")}: {defectStatus || "—"} · {tx("Sababi")}: {defectReason || "—"}</div><div className="mt-1">{tx("Brak narxi")}: {money(defectPrice)} / {tx(unitOf(line))} · {tx("Brak summasi")}: {money(defectAmount)}</div></div>}
        </div>;
      })}{!lines.length && <p className="rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{tx("Mahsulot tafsilotlari saqlanmagan")}</p>}</div>
      <div className="grid grid-cols-2 gap-2 pt-2 text-sm">{[["Umumiy narx", summary?.amount], ["Qaytarilgan", -summary?.returned], ["Yakuniy summa", summary?.net], ["Jami to‘langan", summary?.cash], ["Qolgan qarz", summary?.debt]].map(([text, value]) => <div className="p-3 rounded-xl" style={{ background: "var(--brand-light)" }} key={text}><small>{tx(text)}</small><b className="block mt-1">{value < 0 ? "−" : ""}{money(Math.abs(value || 0))}</b>{text === "Qaytarilgan" && <div className="mt-2 space-y-1 text-xs" style={{ color: "var(--text-secondary)" }}><div>{tx("Yaroqli")}: <b style={{ color: "var(--success)" }}>{quantityGroupsText(summary?.returnedQuantities?.good)}</b></div><div>{tx("Brak")}: <b style={{ color: "var(--danger)" }}>{quantityGroupsText(summary?.returnedQuantities?.defective)}</b></div><div>{tx("Jami qaytarilgan")}: <b>{quantityGroupsText(combinedQuantityGroups(summary?.returnedQuantities?.good, summary?.returnedQuantities?.defective))}</b></div></div>}</div>)}</div>
      <div><h3 className="font-semibold text-sm mb-2">{tx("To‘lovlar tarixi")}</h3><div className="space-y-2">{payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 p-3 rounded-xl text-sm" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}><div><b>{payment.method || tx("Naqd")}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{payment.date ? new Date(payment.date).toLocaleString("uz-UZ", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : tx("Sana saqlanmagan")} · {payment.id}</small></div><b style={{ color: "var(--success)" }}>{money(payment.amount)}</b></div>)}{!payments.length && <p className="p-3 rounded-xl text-sm" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>{tx("To‘lov tarixi saqlanmagan")}</p>}</div></div>
      {Number(summary?.debt || 0) > 0 && <section className="space-y-3 rounded-xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
        <h3 className="font-semibold text-sm">{tx("Qarzni to‘lash")}</h3>
        <Field label={tx("To‘lanadigan summa")}><div className="relative"><input className="input-base pr-14" type="text" inputMode="numeric" value={paymentInput === "" ? "" : moneyInputValue(paymentInput, true)} onChange={(event) => { const raw = event.target.value; setPaymentInput(raw === "" ? "" : String(Math.min(Number(summary.debt), toBaseMoney(raw)))); }} placeholder="0"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div></Field>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg p-3" style={{ background: "var(--surface)" }}><small>{tx("Jami qarz")}</small><b className="block mt-1">{money(summary.debt)}</b></div>
          <div className="rounded-lg p-3" style={{ background: "var(--surface)" }}><small>{tx("To‘lovdan keyin qoladigan qarz")}</small><b className="block mt-1" style={{ color: remainingAfterPayment ? "var(--danger)" : "var(--success)" }}>{money(remainingAfterPayment)}</b></div>
        </div>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setPaymentInput("")}>{tx("Bekor qilish")}</button><button type="button" className="btn-primary" onClick={() => { onPay?.(order, paymentInput); setPaymentInput(""); }} disabled={paymentValue <= 0}>{tx("To‘lovni amalga oshirish")}</button></div>
      </section>}
    </div>
  </Modal>;
}


function EnhancedSupplierReceiveModal({ open, close, supplier, form, setForm, items, setItems, cash, setCash, debtInput, setDebtInput, error, add, save }) {
  const total = [...items, ...(form.name.trim() ? [form] : [])].reduce((sum, item) => sum + Number(item.quantity || 0) * amount(item.cost), 0);
  const debt = amount(debtInput), cashValue = Math.max(0, total - debt), hasPackCount = /qop|karob|box/i.test(form.packaging);
  const products = read("crm_products"), knownBrands = [...new Set(products.map((item) => String(item.brand || "").trim()).filter(Boolean))].sort();
  const categories = [...new Set([...products.map((item) => String(item.category || "").trim()).filter(Boolean), "Qurilish mollari", "Oziq-ovqat", "Maishiy kimyo", "Elektr jihozlari"])].sort();
  const input = (key, label, props = {}) => {
    const groupedInteger = props.type === "number" && key !== "weight";
    const rawValue = String(form[key] ?? "");
    const displayValue = groupedInteger && rawValue !== "" ? (Number(rawValue) || 0).toLocaleString("en-US") : rawValue;
    return <Field label={tx(label)}><input className="input-base" {...props} type={groupedInteger ? "text" : props.type} inputMode={groupedInteger ? "numeric" : undefined} value={displayValue} onChange={(e) => setForm({ ...form, [key]: key === "name" ? firstUpper(e.target.value) : groupedInteger ? e.target.value.replace(/\D/g, "") : e.target.value })}/></Field>;
  };
  return <Modal contentOnly open={open} onClose={close} title={tx("Tovar qabul qilish")} subtitle={supplier?.name || ""} icon={PackageCheck} width={760}><div className="space-y-4"><div className="grid grid-cols-2 gap-3">{input("name", "Tovar nomi")}<Suggest label="Brend" value={form.brand} setValue={(brand) => setForm({ ...form, brand })} values={knownBrands}/><Suggest label="Kategoriya" value={form.category} setValue={(category) => setForm({ ...form, category })} values={categories}/><Field label={tx("Qadoq turi")}><select className="input-base" value={form.packaging} onChange={(e) => setForm({ ...form, packaging: e.target.value })}><option value="">{tx("Tanlang")}</option>{["Dona", "Karobka", "Paket", "Butilka", "Qop", "Rulon"].map((item) => <option key={item} value={item}>{tx(item)}</option>)}</select></Field>{input("quantity", "Qabul miqdori", { type: "number", min: "1" })}{hasPackCount && input("packageCount", "Qadoq ichidagi soni", { type: "number", min: "1" })}{input("weight", "Og'irligi, kg", { type: "number", min: "0", step: "any" })}<MoneyInput label="Tan narxi" value={form.cost} onChange={(cost) => setForm({ ...form, cost })}/></div><button className="btn-ghost w-full justify-center" style={{ border: "1px dashed var(--brand)", color: "var(--brand)" }} onClick={add}><Plus size={15}/>{tx("Yana mahsulot qo'shish")}</button>{items.map((item, index) => <div className="flex justify-between p-2 rounded-lg text-sm" style={{ background: "var(--surface-2)" }} key={item.id}><span>{index + 1}. {item.name} · {item.quantity}{tx("ta")}</span><button style={{ color: "var(--danger)" }} onClick={() => setItems(items.filter((x) => x.id !== item.id))}>{tx("O'chirish")}</button></div>)}<div className="grid grid-cols-3 gap-2 text-sm"><Box label="Umumiy summa" value={money(total)}/><MoneyInput label="Qarzga yoziladi *" value={debtInput} onChange={(value) => { const next = Math.min(total, amount(value)); setDebtInput(String(next)); setCash(String(Math.max(0, total - next))); }}/><Box label="Naqd to'lov *" value={money(cashValue)}/></div>{error && <p className="text-xs" style={{ color: "var(--danger)" }}>{tx(error)}</p>}<div className="flex justify-end gap-2"><button className="btn-ghost" onClick={close}>{tx("Bekor qilish")}</button><button className="btn-primary" onClick={save}><PackageCheck size={15}/>{tx("Qabulni saqlash")}</button></div></div></Modal>;
}
function Box({ label, value }) { return <div className="p-3 rounded-xl" style={{ background: "var(--surface-2)" }}><small>{tx(label)}</small><b className="block mt-1">{value}</b></div>; }
function MoneyInput({ label, value, onChange }) { return <Field label={tx(label)}><div className="relative"><input className="input-base pr-14" inputMode="decimal" value={moneyInputValue(value, false)} onChange={(e) => onChange(String(toBaseMoney(e.target.value)))}/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div></Field>; }
function Suggest({ label, value, setValue, values }) { const list = value ? values.filter((x) => x.toLowerCase().startsWith(value.toLowerCase())) : []; return <Field label={tx(label)}><div><input className="input-base" value={value} onChange={(e) => setValue(firstUpper(e.target.value))}/>{list.length > 0 && <div className="text-xs mt-1 flex gap-1 flex-wrap">{list.map((x) => <button type="button" className="px-2 py-1 rounded" style={{ background: "var(--brand-light)", color: "var(--brand)" }} key={x} onClick={() => setValue(x)}>{x}</button>)}</div>}</div></Field>; }

function FilteredSupplierOrders({ orders, open, download, getItems }) {
  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState({ category: "", product: null, query: "" });
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const rows = orders.map((order) => ({
    order,
    lines: getItems(order).map((line) => ({
      ...line,
      name: line.name || line.product?.name,
      category: line.category || line.product?.category,
    })),
  }));
  const catalog = [...new Map(rows.flatMap(({ lines }) => lines)
    .filter((line) => line.name)
    .map((line) => [JSON.stringify([line.id, line.name, line.category]), line])).values()];
  const term = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(({ order, lines }) =>
    [order.id, label(order.id), ...lines.map((line) => line.name)].some((value) => String(value ?? "").toLocaleLowerCase().includes(term)) &&
    saleMatchesProduct({ items: lines }, catalog, productFilter) &&
    matchesDateRange(order.date, day || from, day || to)
  ).map(({ order }) => order);

  return <>
    <div className="flex flex-wrap items-center gap-2 p-4">
      <input className="input-base" style={{ width: 210, maxWidth: "100%" }} type="search" aria-label={tx("ID / Mahsulot")} placeholder={tx("ID / Mahsulot")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <div style={{ width: 220, maxWidth: "100%" }}><SalesProductFilter products={catalog} value={productFilter} onChange={setProductFilter} /></div>
      <label className="flex items-center gap-2 text-xs">{tx("Sana")}
        <input className="input-base" type="date" value={day} onChange={(event) => { setDay(event.target.value); setFrom(""); setTo(""); }} />
      </label>
      <DateRangeFilter from={from} to={to} onFromChange={(value) => { setDay(""); setFrom(value); }} onToChange={(value) => { setDay(""); setTo(value); }} />
      <button type="button" className="btn-ghost" onClick={() => { setQuery(""); setProductFilter({ category: "", product: null, query: "" }); setDay(""); setFrom(""); setTo(""); }}>{tx("Tozalash")}</button>
    </div>
    <OrderRows orders={filtered} open={open} download={download} getItems={getItems} />
    {!filtered.length && <p className="p-5 text-center text-sm">{tx("Buyurtmalar topilmadi")}</p>}
  </>;
}