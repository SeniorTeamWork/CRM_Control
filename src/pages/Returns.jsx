import { documentNumbers, nextDocumentNumber } from "../data/documentNumbers";
import { printReturnReceipt, downloadReturnPdf, downloadReturnExcel } from "../data/returnReceipt";
import { PaymentSuccessAnimation } from "./PosPaymentPanel";
import checkSound from "../assets/check animation sound.m4a";
import SalesProductFilter from "../components/SalesProductFilter";
import { normalizeProductText, saleMatchesProduct } from "../data/salesProductFilter";
import "./Sales.css";
import Modal from "../components/Modal";
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import './Returns.css';
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, RotateCcw, AlertCircle, CheckCircle, X, PackagePlus, Printer, FileText, Download } from "lucide-react";
import { useToast } from "../context/ToastContext";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";

import { formatCurrency } from "../data/currency";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { getCustomers, saveCustomers } from "../supabase/bolimlar/mijozlar";
import { getReturns, getSales, saveReturns, saveSales } from "../supabase/bolimlar/sotuvlar";
const reasonOptions = [
  "Nosoz / ishlamaydi",
  "Sifat muammosi",
  "Hajm/o'lcham to'g'ri kelmadi",
  "Noto'g'ri mahsulot yetkazildi",
  "Mijoz fikri o'zgardi",
  "Boshqa",
];

const statusMap = {
  approved: {
    label: "Qabul qilindi",
    bg: "var(--success-light)",
    color: "var(--success)",
    icon: CheckCircle,
  },
};

const normalizeText = (value) => String(value ?? "").trim().toLocaleLowerCase("uz-UZ");
const capitalizeName = (value) => String(value ?? "").replace(/\s+/g, " ").trim().split(" ").map((part) => part ? part[0].toLocaleUpperCase("uz-UZ") + part.slice(1).toLocaleLowerCase("uz-UZ") : "").join(" ");
const saleTotal = (sale) => Number(sale?.total ?? sale?.amount ?? (sale?.items || []).reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty ?? item.quantity ?? 0), 0));
const formatSaleDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Sana ko'rsatilmagan" : date.toLocaleString("uz-UZ", { day: "2-digit", month: "2-digit", timeZone: "Asia/Tashkent", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const readReturns = () => {
  try {
    const value = getReturns();
    if (!Array.isArray(value)) return [];
    const accepted = value.map((item) => item.status === "approved" ? item : { ...item, status: "approved" });
    if (accepted.some((item, index) => item !== value[index])) {
      try { saveReturns(accepted); } catch { /* Keep the accepted state visible for this session. */ }
    }
    return accepted;
  } catch {
    return [];
  }
};
const countReturnGroups = (entries) => new Set(entries.map((entry, index) => String(entry.groupId || entry.id || index))).size;

export default function Returns() {
  useUILanguage();
  const { info } = useToast();
  const [returnsList, setReturnsList] = useState(readReturns);
  useEffect(() => {
    const refresh = () => setReturnsList(readReturns());
    const syncReturns = (event) => { if (event.key === "crm_returns" || event.key === null) refresh(); };
    window.addEventListener("storage", syncReturns);
    window.addEventListener("crm-returns-updated", refresh);
    return () => { window.removeEventListener("storage", syncReturns); window.removeEventListener("crm-returns-updated", refresh); };
  }, []);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState({ category: "", product: null, query: "" });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [salesForReturn] = useState(() => { try { const value = getSales(); return Array.isArray(value) ? value : []; } catch { return []; } });
  const [productsForReturn] = useState(() => { try { const value = getProducts(); return Array.isArray(value) ? value : []; } catch { return []; } });
  const [returnLookup, setReturnLookup] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [pendingSale, setPendingSale] = useState(null);
  const [returnCustomer, setReturnCustomer] = useState("");
  const [returnQuantities, setReturnQuantities] = useState({});
  const [confirmingReturn, setConfirmingReturn] = useState(false);
  const [reason, setReason] = useState("");
  const [returnError, setReturnError] = useState("");
  const [returnAnimation, setReturnAnimation] = useState(null);
  const animationTimer = useRef(null);
  const animationSound = useRef(null);
  useEffect(() => () => { clearTimeout(animationTimer.current); animationSound.current?.pause(); }, []);
  useEffect(() => { setReturnError(""); }, [selectedSale, pendingSale, reason, returnQuantities, showModal]);

  const groupedReturns = [...returnsList.reduce((groups, line) => {
    const id = String(line.groupId || line.id);
    const group = groups.get(id) || { ...line, id, lines: [], amount: 0 };
    group.lines.push(line); group.amount += Number(line.amount || 0);
    group.product = group.lines.map(item => item.product).join(", ");
    group.reason = [...new Set(group.lines.map(item => item.reason))].join("; ");
    group.status = group.lines.some(item => item.status === "pending") ? "pending" : group.lines.every(item => item.status === "approved") ? "approved" : "rejected";
    groups.set(id, group); return groups;
  }, new Map()).values()];
  const query = normalizeProductText(search);
  const filtered = groupedReturns.filter((r) => {
    const product = productsForReturn.find((item) => r.productId != null && String(item.id) === String(r.productId)) || productsForReturn.find((item) => normalizeProductText(item.name) === normalizeProductText(r.product));
    const sale = salesForReturn.find((item) => String(item.id) === String(r.saleId));
    const matchesText = [documentNumbers(returnsList, "returns")[r.id], documentNumbers(salesForReturn, "sales")[r.saleId], r.id, r.saleId, r.productId, r.customer, r.product, r.category, product?.category, product?.sku, sale?.receiptNumber, sale?.checkNumber]
      .some((value) => (normalizeProductText(value).startsWith(query) || normalizeProductText(value).replace(/^[sq]-/, "").startsWith(query)));
    const returned = new Date(r.date);
    const day = Number.isNaN(returned.getTime()) ? String(r.date || "").slice(0, 10) : [returned.getFullYear(), String(returned.getMonth() + 1).padStart(2, "0"), String(returned.getDate()).padStart(2, "0")].join("-");
    return (matchesText || r.lines.some(line => [line.id, line.productId, line.product].some(value => normalizeProductText(value).startsWith(query)))) && saleMatchesProduct({ items: r.lines.map(line => ({ id: line.productId, name: line.product, category: line.category })) }, productsForReturn, categoryFilter) && matchesDateRange(day, dateFrom, dateTo);
  });

  const saleNumbers = documentNumbers(salesForReturn, "sales");
  const returnNumbers = documentNumbers(returnsList, "returns");
  const lookupQuery = normalizeText(returnLookup);
  const saleSuggestions = lookupQuery ? salesForReturn.filter((sale) => [sale.customer, sale.customerName, sale.customerPhone, saleNumbers[String(sale.id)], sale.id, sale.saleId, sale.receiptNumber, sale.checkNumber].some((value) => normalizeText(value).includes(lookupQuery)))
    .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0)) : [];
  const customerKey = sale => sale.customerId != null ? "id:" + sale.customerId : normalizeText(sale.customer || sale.customerName || "Mijoz") + "|" + normalizeText(sale.customerPhone);
  const customerChoices = [...new Map(saleSuggestions.map(sale => [customerKey(sale), sale])).values()];
  const customerPurchases = historyCustomer ? salesForReturn.filter(sale => customerKey(sale) === customerKey(historyCustomer)).sort((a,b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0)) : [];
  const chooseCustomer = sale => { setHistoryCustomer(sale); setPendingSale(null); setSelectedSale(null); setReturnQuantities({}); setReason(""); setConfirmingReturn(false); };
  const getItemKey = (item, index) => `${item.id ?? item.name ?? "item"}-${index}`;
  const returnLines = (selectedSale?.items || []).map((item, index) => {
    const itemId = String(item.id ?? "");
    const saleId = String(selectedSale.id ?? selectedSale.receiptNumber ?? "");
    const returnedQty = returnsList.filter((entry) => entry.status !== "rejected" && String(entry.saleId) === saleId && (itemId ? String(entry.productId ?? "") === itemId : normalizeText(entry.product) === normalizeText(item.name))).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    const available = Math.max(0, Number(item.qty ?? item.quantity ?? 0) - returnedQty);
    const product = productsForReturn.find((entry) => String(entry.id) === itemId);
    const itemQuantity = Number(item.qty ?? item.quantity ?? 0);
    const baseUnitPrice = Number(item.price ?? (itemQuantity > 0 && item.total != null ? Number(item.total) / itemQuantity : product?.price) ?? 0);
    const grossItemsTotal = (selectedSale?.items || []).reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty ?? line.quantity ?? 0), 0);
    const saleAmount = Number(selectedSale?.amount ?? selectedSale?.total ?? grossItemsTotal);
    const unitPrice = Math.round(baseUnitPrice * (grossItemsTotal > 0 ? saleAmount / grossItemsTotal : 1));
    const key = getItemKey(item, index);
    const saved = returnQuantities[key];
    const quantities = saved && typeof saved === "object"
      ? { goodQuantity: Number(saved.goodQuantity || 0), defectiveQuantity: Number(saved.defectiveQuantity || 0) }
      : { goodQuantity: Number(saved || 0), defectiveQuantity: 0 };
    return { item, index, key, available, returnedQuantity: returnedQty, unitPrice, ...quantities, quantity: quantities.goodQuantity + quantities.defectiveQuantity };
  });
  const selectedLines = returnLines.filter((line) => line.quantity > 0);
  const returnTotal = selectedLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const selectedSaleTotal = saleTotal(selectedSale);

  const chooseReturnSale = (sale) => {
    const customerName = capitalizeName(sale.customer || sale.customerName || "");
    setSelectedSale(sale);
    setReturnCustomer(customerName);
    setReturnLookup(`${customerName} · ${saleNumbers[String(sale.id)] || sale.id || sale.receiptNumber || ""}`);
    setReturnQuantities({});
    setConfirmingReturn(false);
  };

  const closeReturnModal = () => {
    setShowModal(false);
    setHistoryCustomer(null); setPendingSale(null);
    setReturnLookup(""); setSelectedSale(null); setReturnCustomer("");
    setReturnQuantities({}); setReason(""); setConfirmingReturn(false);
  };

  const requestReturnConfirmation = () => {
    if (!selectedLines.length) {
      setReturnError("Hali qaytariladigan mahsulot tanlanmagan. Iltimos, kerakli mahsulotning qaytarish sonini kiriting.");
      return;
    }
    if (!reason) { setReturnError("Qaytarish sababini tanlang. Shundan keyin qaytarishni tasdiqlashingiz mumkin."); return; }
    setReturnError(""); setConfirmingReturn(true);
  };
  const saveReturn = () => {
    if (!selectedSale || !selectedLines.length || !reason) return;
    const groupId = nextDocumentNumber(returnsList, "returns");
    const createdAt = new Date().toISOString();
    let updated;
    try {
      const currentProducts = getProducts();
      if (!Array.isArray(currentProducts)) throw new Error("Ombor ma’lumoti topilmadi.");
      const stockProductByLine = new Map(selectedLines.map((line) => {
        const id = String(line.item.id ?? "");
        const byId = id ? currentProducts.find(product => String(product.id) === id) : null;
        const sameName = currentProducts.filter(product => normalizeText(product.name) === normalizeText(line.item.name));
        const product = byId || (sameName.length === 1 ? sameName[0] : null);
        if (!product) throw new Error(`Mahsulot omborda topilmadi: ${line.item.name || "Mahsulot"}`);
        return [line.index, product];
      }));
      const additions = selectedLines.map(({ item, index, quantity, goodQuantity, defectiveQuantity, returnedQuantity, unitPrice }) => {
        const stockProduct = stockProductByLine.get(index);
        return {
          id: `${groupId}-${index + 1}`, groupId, saleId: String(selectedSale.id ?? selectedSale.receiptNumber),
          productId: stockProduct.id, customer: capitalizeName(returnCustomer), product: item.name || stockProduct.name || "Mahsulot",
          quantity, goodQuantity, defectiveQuantity, unitPrice, amount: quantity * unitPrice, reason, status: "approved", date: createdAt,
          category: item.category || item.categoryName || stockProduct.category || "",
          unitCost: Number(stockProduct.cost ?? item.cost ?? 0),
          customerPhone: selectedSale.customerPhone || selectedSale.phone || "",
          returnKey: `${selectedSale.id ?? selectedSale.receiptNumber}:${item.id ?? "item"}:${index}`,
          purchaseDate: selectedSale.date || "", deliveryAddress: item.deliveryAddress || selectedSale.deliveryAddress || "",
        };
      });
      updated = [...additions, ...returnsList];
      const returnGroups = selectedLines.reduce((groups, line) => {
        const id = String(stockProductByLine.get(line.index).id);
        const group = groups.get(id) || { goodQuantity: 0, defectiveQuantity: 0, defects: [] };
        group.goodQuantity += line.goodQuantity;
        group.defectiveQuantity += line.defectiveQuantity;
        if (line.defectiveQuantity > 0) group.defects.push({ id: `customer-return-${groupId}-${line.index}`, product: line.item.name, category: line.item.category || "", quantity: line.defectiveQuantity, reason: `Mijoz qaytargan: ${reason}`, status: "Brak", unitPrice: line.unitPrice, total: line.defectiveQuantity * line.unitPrice, date: createdAt, sourceReturnId: `${groupId}-${line.index + 1}` });
        groups.set(id, group);
        return groups;
      }, new Map());
      const products = currentProducts.map(product => {
        const group = returnGroups.get(String(product.id));
        if (!group) return product;
        const stock = Math.max(0, Number(product.stock || 0));
        const defectRows = Array.isArray(product.defects) ? product.defects : [];
        const recordedDefects = defectRows.reduce((sum, defect) => sum + Number(defect.quantity || 0), 0);
        const defectiveStock = Math.min(stock, Math.max(Number(product.defectiveStock || 0), recordedDefects));
        const nextStock = stock + group.goodQuantity + group.defectiveQuantity;
        const nextDefective = defectiveStock + group.defectiveQuantity;
        const sellable = nextStock - nextDefective;
        return { ...product, stock: nextStock, stockIn: Number(product.stockIn || 0) + group.goodQuantity + group.defectiveQuantity, defectiveStock: nextDefective, defects: group.defects.length ? [...defectRows, ...group.defects] : product.defects, status: sellable <= 0 ? "out" : sellable < Number(product.minStock || product.minimumStock || 10) ? "low" : "active" };
      });
      const currentSales = getSales();
      if (!Array.isArray(currentSales) || !currentSales.some(sale => String(sale.id ?? sale.receiptNumber) === String(selectedSale.id ?? selectedSale.receiptNumber))) throw new Error("Qaytarilayotgan savdo topilmadi.");
      {
        const sales = currentSales.map(sale => String(sale.id ?? sale.receiptNumber) !== String(selectedSale.id ?? selectedSale.receiptNumber) ? sale : {
          ...sale,
          items: (sale.items || []).map((item, index) => {
            const line = selectedLines.find(entry => entry.index === index && String(entry.item.id ?? "") === String(item.id ?? ""));
            return line ? { ...item, returnedQuantity: line.returnedQuantity + line.quantity, returned: line.returnedQuantity + line.quantity >= Number(item.qty ?? item.quantity ?? 0), returnedAt: createdAt } : item;
          }),
        });
        saveSales(sales);
      }
      saveProducts(products);
      saveReturns(updated);
      try {
        const customers = getCustomers();
        if (Array.isArray(customers)) {
          const previousReturnAmount = returnsList.filter(entry => entry.status === "approved" && String(entry.saleId) === String(selectedSale.id ?? selectedSale.receiptNumber)).reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
          const saleDebt = Number(selectedSale.debtBalance ?? Math.max(0, saleTotal(selectedSale) - Number(selectedSale.paidAmount || 0)));
          const debtReduction = Math.min(Math.max(0, saleDebt - previousReturnAmount), returnTotal);
          saveCustomers(customers.map(customer => {
            const sameId = selectedSale.customerId != null && String(customer.id) === String(selectedSale.customerId);
            const sameName = normalizeText(customer.name) === normalizeText(returnCustomer)
              && (!selectedSale.customerPhone || normalizeText(customer.phone).replace(/\D/g, "") === normalizeText(selectedSale.customerPhone).replace(/\D/g, ""));
            const matchesCustomer = selectedSale.customerId != null ? sameId : sameName;
            return matchesCustomer ? {
              ...customer,
              spent: Math.max(0, Number(customer.spent || 0) - returnTotal),
              debt: Math.max(0, Number(customer.debt || 0) - debtReduction),
              status: Number(customer.debt || 0) - debtReduction > 0 ? customer.status : customer.status === "debtor" ? "active" : customer.status,
            } : customer;
          }));
        }
      } catch { /* Sales and return history remain the source of truth when a legacy customer summary is unavailable. */ }
      window.dispatchEvent(new Event("crm-products-updated"));
      window.dispatchEvent(new Event("crm-returns-updated"));
    }
    catch (cause) { setReturnError(cause?.message || "Qaytarish saqlanmadi. Iltimos, qayta urinib ko‘ring."); return; }
    setReturnsList(updated);
    const quantity = selectedLines.reduce((sum, line) => sum + line.quantity, 0);
    setReturnAnimation({ amount: returnTotal, title: capitalizeName(returnCustomer) + ": " + selectedLines.length + " xil, " + quantity + " ta mahsulot qaytarish uchun rasmiylashtirildi" });
    animationSound.current?.pause();
    const sound = new Audio(checkSound); animationSound.current = sound; sound.play().catch(() => {});
    clearTimeout(animationTimer.current);
    animationTimer.current = setTimeout(() => setReturnAnimation(null), 3600);
    closeReturnModal();
  };

  const totalReturned = returnsList
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + r.amount, 0);
  const now = new Date();
  const returnsThisMonth = returnsList.filter((entry) => {
    const date = new Date(entry.date || entry.createdAt || "");
    return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const returnsToday = returnsList.filter((entry) => {
    const date = new Date(entry.date || entry.createdAt || "");
    return !Number.isNaN(date.getTime()) && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  });

  return (
    <div className="space-y-6 fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-primary-color">{tx("Qaytarilgan mahsulotlar")}</h1>
          <p className="text-sm mt-0.5 text-muted-color">{tx("Qaytarilgan tovarlar va refund so'rovlari")}</p>
        </div>
        <button
          onClick={showModal ? closeReturnModal : () => setShowModal(true)}
          className="btn-primary returns-add-button"
          aria-label={tx(showModal ? "Yopish" : "Qaytarish qo'shish")}
          title={tx(showModal ? "Yopish" : "Qaytarish qo'shish")}
        >
          <span className="returns-add-icon">{showModal ? <X size={16} /> : <PackagePlus size={18} />}</span>
        </button>
      </div>

      {/* Stats */}
      <div className="returns-stats grid grid-cols-4 gap-4">
        {[
          {
            label: "Shu oydagi qaytarilganlar",
            value: countReturnGroups(returnsThisMonth),
            color: "var(--brand)",
          },
          {
            label: "Jami qaytarilganlar",
            value: countReturnGroups(returnsList),
            color: "var(--success)",
          },
          {
            label: "Bugungi qaytarilganlar",
            value: countReturnGroups(returnsToday),
            color: "var(--warning)",
          },
          {
            label: "Umumiy Qaytarilgan summa",
            value: formatCurrency(totalReturned),
            color: "var(--danger)",
          },
        ].map((s) => (
          <div key={s.label} className="returns-stat-card card p-4">
            <div
              className="returns-stat-value text-xl font-display font-bold mb-1"
              style={{ color: s.color }}
            >
              {tx(s.value)}
            </div>
            <div className="returns-stat-label text-xs text-faint-color">{tx(s.label)}</div>
          </div>
        ))}
      </div>

      {showModal && createPortal(<div className="crm-content-modal"><section className={`returns-create-panel modal-card${!selectedSale && lookupQuery ? " has-sale-choices" : ""}`}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="font-display font-bold text-lg text-primary-color">{tx("Qaytarish qo'shish")}</h2>
                  <p className="text-xs mt-0.5 text-muted-color">{tx("Qaytarilgan mahsulot ma'lumotlari")}</p>
                </div>
                <button
                  onClick={closeReturnModal}
                  className="p-2 rounded-xl hover:opacity-70 text-faint-color"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-4">
                <div style={{ position: "relative" }}>
                  <label className="block text-xs font-semibold mb-1.5 text-secondary-color">{tx("Mijoz ismi, sotuv ID yoki chek raqami")}</label>
                  <input value={returnLookup} onChange={(event) => { setReturnLookup(capitalizeName(event.target.value)); setHistoryCustomer(null); setPendingSale(null); setSelectedSale(null); setReturnQuantities({}); setConfirmingReturn(false); }} placeholder={tx("Ism, ID yoki chek raqamini yozing...")} className="input-base" autoComplete="off" />
                  {!selectedSale && !historyCustomer && lookupQuery && <div className="returns-sale-choices">{customerChoices.length ? customerChoices.map((sale) => <button type="button" key={customerKey(sale)} onClick={() => chooseCustomer(sale)}><span><b>{capitalizeName(sale.customer || sale.customerName || "Mijoz")}</b><small>{sale.customerPhone || tx("Xaridlar tarixini ko‘rish")}</small></span><span><b>{salesForReturn.filter(entry => customerKey(entry) === customerKey(sale)).length} {tx("ta xarid")}</b><small>{tx("Tanlash")}</small></span></button>) : <p>{tx("Bu mijoz bo'yicha savdo topilmadi")}</p>}</div>}
                </div>

                {historyCustomer && !selectedSale && <div className="returns-history"><div className="returns-history-heading"><div><b>{capitalizeName(historyCustomer.customer || historyCustomer.customerName || "Mijoz")}</b><small>{customerPurchases.length} {tx("ta xarid · Qaytariladigan xaridni tanlang")}</small></div><button className="btn-ghost" onClick={() => { setHistoryCustomer(null); setPendingSale(null); }}>{tx("Mijozni almashtirish")}</button></div><div className="returns-sale-choices">{customerPurchases.map((sale, index) => <button type="button" key={String(sale.id || sale.receiptNumber) + index} aria-pressed={pendingSale === sale} onClick={() => setPendingSale(sale)}><span><b>{formatSaleDate(sale.createdAt || sale.date || sale.formattedDate)}</b><small>{tx("Sotuv")}: {saleNumbers[String(sale.id)] || sale.id || sale.receiptNumber}</small></span><span><b>{formatCurrency(saleTotal(sale))}</b><small>{new Set((sale.items || []).map(item => item.id ?? item.name)).size} {tx("xil mahsulot")}</small></span></button>)}</div></div>}
                {selectedSale && <>
                  <div className="returns-selected-sale"><span><b>{capitalizeName(returnCustomer)}</b><small>{saleNumbers[String(selectedSale.id)] || selectedSale.id || selectedSale.receiptNumber} · {formatSaleDate(selectedSale.date || selectedSale.createdAt || selectedSale.formattedDate)}</small></span><span><small>{tx("Savdo jami")}</small><b>{formatCurrency(selectedSaleTotal)}</b></span></div>
                  <div className="returns-products-section">
                    <div className="text-xs font-semibold text-secondary-color">{tx("Qaytariladigan mahsulotlar")} · {returnLines.length} {tx("xil")}</div>
                    <div className="returns-products-scroll" role="region" aria-label={tx("Sotuvdagi mahsulotlar")} tabIndex={0}>
                    {returnLines.map(({ item, key, available, unitPrice, quantity, goodQuantity, defectiveQuantity }) => <div key={key} className="returns-line-row">
                      <div><b style={{ fontSize: 13 }}>{item.name || tx("Mahsulot")}</b><small style={{ display: "block", color: "var(--text-muted)" }}>{tx("Olingan")}: {Number(item.qty ?? item.quantity ?? 0).toLocaleString("uz-UZ")} {tx("ta")} · {tx("Jami")}: {formatCurrency(Number(item.total ?? unitPrice * Number(item.qty ?? item.quantity ?? 0)))}</small></div>
                      <label className="returns-quantity-field">{tx("Yaroqli")}<input type="number" min="0" max={Math.max(0, available - defectiveQuantity)} step="1" disabled={!available} value={goodQuantity || ""} onChange={(event) => { const next = Math.min(Math.max(0, available - defectiveQuantity), Math.max(0, Math.floor(Number(event.target.value) || 0))); setReturnQuantities((prev) => ({ ...prev, [key]: { ...(prev[key] && typeof prev[key] === "object" ? prev[key] : { goodQuantity: Number(prev[key] || 0), defectiveQuantity: 0 }), goodQuantity: next } })); setConfirmingReturn(false); }} className="input-base mt-1" placeholder="0" /></label>
                      <label className="returns-quantity-field">{tx("Brak")}<input type="number" min="0" max={Math.max(0, available - goodQuantity)} step="1" disabled={!available} value={defectiveQuantity || ""} onChange={(event) => { const next = Math.min(Math.max(0, available - goodQuantity), Math.max(0, Math.floor(Number(event.target.value) || 0))); setReturnQuantities((prev) => ({ ...prev, [key]: { ...(prev[key] && typeof prev[key] === "object" ? prev[key] : { goodQuantity: Number(prev[key] || 0), defectiveQuantity: 0 }), defectiveQuantity: next } })); setConfirmingReturn(false); }} className="input-base mt-1" placeholder="0" /></label>
                      <div style={{ textAlign: "right", fontSize: 12 }}><small style={{ display: "block", color: "var(--text-muted)" }}>{tx("Bir dona narxi")}</small><b>{formatCurrency(unitPrice)}</b></div>
                      <div style={{ textAlign: "right", fontSize: 12 }}><small style={{ display: "block", color: "var(--text-muted)" }}>{tx("Qaytarish summasi")}</small><b>{formatCurrency(quantity * unitPrice)}</b></div>
                    </div>)}
                    {!returnLines.length && <p className="text-sm text-muted-color">{tx("Bu sotuvda mahsulotlar ro‘yxati saqlanmagan")}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5 text-secondary-color">{tx("Sabab")}</label>
                    <select value={reason} onChange={(e) => { setReason(e.target.value); setConfirmingReturn(false); }} className="input-base">
                      <option value="">{tx("Sabab tanlang")}</option>
                      {reasonOptions.map((o) => <option key={o} value={o}>{tx(o)}</option>)}
                    </select>
                  </div>
                  <div className="returns-total-summary"><span><small>{tx("Qaytariladigan mahsulotlar")}</small><b>{selectedLines.length} {tx("xil")}</b></span><span className="refund-total"><small>{tx("Qaytarish summasi")}</small><b>{formatCurrency(returnTotal)}</b></span></div>
                  {confirmingReturn && <div role="alert" style={{ padding: 14, border: "1px solid var(--warning)", borderRadius: 12, background: "var(--warning-light)" }}><b>{tx("Qaytarishni tasdiqlaysizmi?")}</b><p className="text-sm mt-1">{selectedLines.length} {tx("xil mahsulot")}, {formatCurrency(returnTotal)} — {tx("ma'lumotlarni tekshirib tasdiqlang")}</p></div>}
                </>}
              </div>
              {returnError && <div className="returns-validation-message" role="alert"><AlertCircle size={18}/><span>{tx(returnError)}</span></div>}
              <div className="flex gap-3 mt-6">
                {selectedSale && !confirmingReturn && <button className="btn-ghost" onClick={() => { setSelectedSale(null); setReturnQuantities({}); setReason(""); }}>{tx("Xaridlarga qaytish")}</button>}
                <button onClick={closeReturnModal} className="btn-ghost flex-1">{tx("Bekor qilish")}</button>
                {!selectedSale ? <button disabled={!pendingSale} className="btn-primary flex-1 justify-center" onClick={() => chooseReturnSale(pendingSale)}><RotateCcw size={14}/>{tx("Qaytarishni tasdiqlash")}</button> : confirmingReturn ? <>
                  <button onClick={() => setConfirmingReturn(false)} className="btn-ghost flex-1">{tx("Ortga")}</button>
                  <button onClick={saveReturn} disabled={!selectedSale || !selectedLines.length || !reason} className="btn-primary flex-1 justify-center"><CheckCircle size={14} />{tx("Tasdiqlash va saqlash")}</button>
                </> : <button onClick={requestReturnConfirmation} className="btn-primary flex-1 justify-center"><RotateCcw size={14} />{tx("Qaytarishni tasdiqlash")}</button>}
              </div>
      </section></div>, document.getElementById("main-modal-root"))}

      {/* Table */}
      <div className="returns-table-card card-flat rounded-2xl">
        <div className="returns-filter-toolbar px-5 py-4 border-b-subtle">
          <div className="search-box-wrapper flex items-center gap-2 rounded-xl px-3 py-2.5 flex-1">
            <Search size={14} className="text-faint-color" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value.replace(/(^|\s)(\S)/g, (_, space, letter) => space + letter.toLocaleUpperCase("uz-UZ")))}
              aria-label={tx("Qaytarishlarni qidirish")}
              placeholder={tx("Mijoz, mahsulot, kategoriya yoki ID...")}
              className="bg-transparent outline-none text-sm flex-1 text-primary-color"
            />
          </div>
          <SalesProductFilter products={productsForReturn} value={categoryFilter} onChange={setCategoryFilter} /><div className="returns-date-filter"><DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} /></div>
        </div>

        <div className="returns-table-scroll" role="region" aria-label={tx("Qaytarishlar jadvali")} tabIndex="0">
        <table className="returns-table w-full">
          <thead>
            <tr className="table-header-row">
              {[
                "ID",
                "Sotuv",
                "Mijoz",
                "Mahsulot",
                "Sabab",
                "Summa",
                "Sana",
                "Manzil",
                "Holat",
              ].map((h, i) => (
                <th
                  key={i}
                  className="text-left px-5 py-3 text-xs font-semibold text-faint-color"
                >
                  {tx(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-color">{tx("Qaytarishlar topilmadi")}</td></tr>}
            {filtered.map((r) => {
              const st = statusMap[r.status] || statusMap.approved;
              const Icon = st.icon;
              return (
                <tr key={r.id} className="border-t table-row-hover" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => setSelectedReturn(r)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedReturn(r); } }}>
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-muted-color">
                    {returnNumbers[r.id] || r.id}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-faint-color">
                    {saleNumbers[r.saleId] || r.saleId}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-medium text-primary-color">
                    {r.customer}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-secondary-color">
                    {r.lines[0]?.product || r.product}{r.lines.length > 1 && <span aria-label={tx("Qolgan mahsulotlarni tafsilotlarda ko‘ring")} style={{ marginLeft: 4, color: "var(--text-muted)", fontWeight: 700 }}>...</span>}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-color">
                    {tx(r.reason)}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-danger-color">
                    -{formatCurrency(r.amount)}</td>
                  <td className="px-5 py-3.5 text-xs text-faint-color">
                    {tx(Number.isNaN(new Date(r.date).getTime()) ? r.date : new Date(r.date).toLocaleDateString("uz-UZ"))}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted-color">
                    {tx(r.deliveryAddress || "—")}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold w-fit"
                      style={{
                        background: st.bg,
                        color: st.color,
                      }}
                    >
                      <Icon size={10} />
                      {tx(st.label)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {returnAnimation && createPortal(<PaymentSuccessAnimation {...returnAnimation} />, document.getElementById("main-modal-root"))}
      <Modal open={!!selectedReturn} onClose={() => setSelectedReturn(null)} title="Qaytarish tafsilotlari" subtitle={returnNumbers[selectedReturn?.id] || selectedReturn?.id} icon={RotateCcw} width={820} contentOnly>
        {selectedReturn && (() => {
          const lines = selectedReturn.lines || [];
          const totalQuantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
          const hasConditionBreakdown = lines.every(line => line.goodQuantity != null && line.defectiveQuantity != null);
          const goodTotal = lines.reduce((sum, line) => sum + Number(line.goodQuantity || 0), 0);
          const defectiveTotal = lines.reduce((sum, line) => sum + Number(line.defectiveQuantity || 0), 0);
          const receiptRecord = { ...selectedReturn, id: returnNumbers[selectedReturn.id] || selectedReturn.id, saleId: saleNumbers[selectedReturn.saleId] || selectedReturn.saleId };
          return <div className="return-document customer-return-document">
            <div className="return-document-head">
              <div><small>{tx("MIJOZ QAYTARGAN MAHSULOTLAR")}</small><h3>{selectedReturn.customer || tx("Mijoz")}</h3><p>{tx("Qaytarilgan sana va vaqt")}: {formatSaleDate(selectedReturn.date)}</p></div>
              <span>{tx(statusMap[selectedReturn.status]?.label || "—")}</span>
            </div>
            <dl className="return-document-meta">{[
              ["Qaytarish ID", returnNumbers[selectedReturn.id] || selectedReturn.id],
              ["Sotuv ID", saleNumbers[selectedReturn.saleId] || selectedReturn.saleId],
              ["Xarid sanasi", formatSaleDate(selectedReturn.purchaseDate)],
              ["Telefon", selectedReturn.customerPhone || "—"],
              ["Manzil", selectedReturn.deliveryAddress || "—"],
              ["Mahsulot turlari", tx(lines.length + " xil")],
            ].map(([label, value]) => <div key={label}><dt>{tx(label)}</dt><dd>{value}</dd></div>)}</dl>
            <section className="customer-return-items" aria-label={tx("Qaytarilgan mahsulotlar")}>
              {lines.map(line => {
                const unitPrice = Number(line.unitPrice ?? (line.quantity ? line.amount / line.quantity : 0));
                const hasLineBreakdown = line.goodQuantity != null && line.defectiveQuantity != null;
                return <article className="customer-return-item" key={line.id}>
                  <div className="customer-return-item-head">
                    <div><h4>{line.product || tx("Mahsulot")}</h4>{line.category && <small>{tx("Kategoriya")}: {tx(line.category)}</small>}</div>
                    <strong>{formatCurrency(line.amount)}</strong>
                  </div>
                  {hasLineBreakdown ? <div className="customer-return-condition-grid">
                    <div><b>{tx("Yaroqli")}</b><span>{Number(line.goodQuantity).toLocaleString("uz-UZ")} {tx("dona")}</span><small>{formatCurrency(unitPrice)} · {tx("bir dona")}</small><strong>{formatCurrency(Number(line.goodQuantity) * unitPrice)}</strong></div>
                    <div className="is-defective"><b>{tx("Brak / yaroqsiz")}</b><span>{Number(line.defectiveQuantity).toLocaleString("uz-UZ")} {tx("dona")}</span><small>{formatCurrency(unitPrice)} · {tx("bir dona")}</small><strong>{formatCurrency(Number(line.defectiveQuantity) * unitPrice)}</strong></div>
                  </div> : <div className="customer-return-legacy"><b>{tx("Qaytarilgan jami")}: {Number(line.quantity || 0).toLocaleString("uz-UZ")} {tx("dona")}</b><span>{tx("Bir dona narxi")}: {formatCurrency(unitPrice)}</span><small>{tx("Bu eski qaytarish yozuvida yaroqli va brak miqdori alohida saqlanmagan.")}</small></div>}
                  <div className="customer-return-reason"><small>{tx("Qaytarish sababi")}</small><span>{tx(line.reason || "—")}</span></div>
                </article>;
              })}
            </section>
            <div className="customer-return-summary">
              <div className="customer-return-summary-counts">
                <span><small>{tx("Yaroqli jami")}</small><b>{hasConditionBreakdown ? `${goodTotal.toLocaleString("uz-UZ")} ${tx("dona")}` : "—"}</b></span>
                <span><small>{tx("Brak jami")}</small><b>{hasConditionBreakdown ? `${defectiveTotal.toLocaleString("uz-UZ")} ${tx("dona")}` : "—"}</b></span>
                <span><small>{tx("Jami miqdor")}</small><b>{totalQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b></span>
              </div>
              {!hasConditionBreakdown && <p className="customer-return-history-note">{tx("Eski yozuvlarda yaroqli va brak sonlari alohida saqlanmagan; shu sabab bu sonlar uchun taxmin ko‘rsatilmaydi.")}</p>}
              <div className="customer-return-summary-total"><small>{tx("Umumiy qaytarish summasi")}</small><b>{formatCurrency(selectedReturn.amount)}</b></div>
              <div className="return-export-actions">
                <button onClick={() => { if (!printReturnReceipt(receiptRecord, statusMap[selectedReturn.status]?.label || "—")) info("Chek ochilmadi", "Brauzerda yangi oynalarni ochishga ruxsat bering."); }}><Printer size={16}/>{tx("Chop etish")}</button>
                <button onClick={() => downloadReturnPdf(receiptRecord, statusMap[selectedReturn.status]?.label || "—")}><FileText size={16}/>{tx("PDF")}</button>
                <button className="return-export-excel" onClick={() => downloadReturnExcel(receiptRecord, statusMap[selectedReturn.status]?.label || "—")}><Download size={16}/>{tx("Excel")}</button>
              </div>
            </div>
          </div>;
        })()}
      </Modal>

    </div>
  );
}
