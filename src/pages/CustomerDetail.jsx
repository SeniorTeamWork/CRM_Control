import { formatCardNumber, resolveReceivingCard } from "../data/directorCards";
import { returnKeyFor, returnedQuantityFor } from './customerDetailHelpers';
import { SaleProductList, uniqueSaleProductCount } from './CustomerSaleProducts';
import { DebtPaymentModal } from './CustomerDebtPaymentModal';
import { CustomerGeneralPayModal, CustomerHistoryTab, buildCustomerHistory } from './CustomerHistory';
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import "./CustomerDetail.css";
import "./Returns.css";
import Modal from "../components/Modal";
import { printReturnReceipt, downloadReturnPdf, downloadReturnExcel } from "../data/returnReceipt";
import { printSaleReceipt } from "../data/saleReceipt";
import { readEmployees } from "../data/employeeStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Phone,
  MapPin,
  Calendar,
  Crown,
  ShoppingBag,
  DollarSign,
  CreditCard,
  Trash2,
  Edit2,
  CheckCircle,
  Copy,
  X,
  Save,
  RotateCcw,
  Printer,
  FileText,
  Download,
  Eye,
} from "lucide-react";
import {
  readDebtPayments,
  readPosSales,
  saveDebtPayment,
  withDebtBalance,
} from "../data/debtPayments";
import { useToast } from "../context/ToastContext";
import { uzbekRegions } from "../data/regions";

import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { getCustomers, saveCustomers } from "../supabase/bolimlar/mijozlar";
import { ADDITIONAL_SALES_KEY, SALES_KEY, getReturns, getSales, saveReturns, saveSales } from "../supabase/bolimlar/sotuvlar";
export default function CustomerDetail({ customerId, saleCustomer, onBack, onNavigate }) {
  useUILanguage();
  const modalRoot = document.getElementById("main-modal-root");
  const modalDialogRef = useRef(null);
  let savedCustomers = [];
  try {
    const saved = getCustomers();
    if (Array.isArray(saved)) savedCustomers = saved;
  } catch {
    // Use the shared customer data if saved data is unavailable.
  }
  const matchesSale = (c) =>
    c.name?.trim().toLowerCase() === saleCustomer?.name?.trim().toLowerCase();
  const originalCustomer = saleCustomer
    ? savedCustomers.find(matchesSale) || saleCustomer
    : savedCustomers.find((c) => String(c.id) === String(customerId)) || { name: "Mijoz", phone: "", region: "", purchases: 0, spent: 0, debt: 0 };

  const { success, error } = useToast();

  const [returnRecords, setReturnRecords] = useState(() => {
    try {
      const saved = getReturns();
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  });
  const [pendingReturn, setPendingReturn] = useState(null);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [selectedPayment, setSelectedPayment] = useState(null);

  const [customer, setCustomer] = useState(originalCustomer);
  const customerReturns = returnRecords.filter((record) =>
    record.status === "approved" && record.customer?.trim().toLowerCase() === customer.name.trim().toLowerCase()
  );

  const [tab, setTab] = useState(saleCustomer?.initialTab || "purchases");
  const [purchaseDetailSaleId, setPurchaseDetailSaleId] = useState(saleCustomer?.selectedSaleId || null);
  const [returnSalesModalOpen, setReturnSalesModalOpen] = useState(false);
  const [returnSalesSearch, setReturnSalesSearch] = useState("");
  const [debtDetailSaleId, setDebtDetailSaleId] = useState(null);
  const [paymentRecords, setPaymentRecords] = useState(readDebtPayments);
  const [, refreshProfile] = useState(0);
  useEffect(() => {
    const refresh = () => {
      setPaymentRecords(readDebtPayments());
      try { const records = getReturns(); setReturnRecords(Array.isArray(records) ? records : []); } catch { setReturnRecords([]); }
      refreshProfile((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 1500);
    window.addEventListener("storage", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("storage", refresh); };
  }, []);
  const liveCustomerSales = readPosSales().filter((sale) =>
    sale.customer.trim().toLowerCase() === customer.name.trim().toLowerCase()
  );
  const profileSales = (liveCustomerSales.length > 0 ? liveCustomerSales : (saleCustomer?.sales || []))
    .map((sale) => withDebtBalance(sale, paymentRecords)).map((sale) => {
        const saleReturnedAmount = customerReturns
          .filter((record) => String(record.saleId) === String(sale.id))
          .reduce((sum, record) => sum + Number(record.amount || 0), 0);
        if (saleReturnedAmount <= 0) return sale;
        const amount = Math.max(0, Number(sale.amount || 0) - saleReturnedAmount);
        const debtBalance = Math.max(0, Number(sale.debtBalance || 0) - saleReturnedAmount);
        const paidAmount = Math.min(amount, Number(sale.paidAmount || 0));
        return {
          ...sale,
          amount,
          paidAmount,
          debtBalance,
          status: debtBalance > 0 ? (paidAmount > 0 ? "partial" : "debt") : "paid",
        };
      });
  const purchaseDetailSale = profileSales.find((sale) => sale.id === purchaseDetailSaleId) || null;
  const dateLabel = (value) => value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
  const groupedCustomerReturns = Object.values(customerReturns.reduce((groups, record) => {
    const id = record.groupId || record.id;
    const sale = profileSales.find(item => String(item.id) === String(record.saleId));
    if (!groups[id]) groups[id] = { ...record, id, purchaseDate: record.purchaseDate || sale?.createdAt || sale?.date, lines: [], amount: 0 };
    groups[id].lines.push(record);
    groups[id].amount += Number(record.amount || 0);
    return groups;
  }, {})).sort((a,b) => new Date(b.date) - new Date(a.date));
  const returnStatusMap = { approved: { label: "Qabul qilindi" }, pending: { label: "Kutilmoqda" }, rejected: { label: "Rad etildi" } };
  const exportReturn = (kind) => {
    try {
      const label = returnStatusMap[selectedReturn.status]?.label || "—";
      if (kind === "print") { if (!printReturnReceipt(selectedReturn, label)) error("Chek ochilmadi", "Brauzerda yangi oynalarni ochishga ruxsat bering."); }
      else if (kind === "pdf") downloadReturnPdf(selectedReturn, label);
      else downloadReturnExcel(selectedReturn, label);
    } catch { error("Hujjat tayyorlanmadi", "Iltimos, qayta urinib ko‘ring."); }
  };
  const totalPurchased = profileSales.reduce((sum, sale) => sum + (Array.isArray(sale.items)
    ? sale.items.reduce((total, item, index) => {
      const quantity = Number(item.qty || 0);
      const returned = returnedQuantityFor(returnRecords, returnKeyFor(sale.id, item.id, index), quantity, item);
      return total + Math.max(0, quantity - returned);
    }, 0)
    : Number(sale.products || 0)), 0);
  const customerSpentAfterReturns = profileSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0);
  const debtSales = profileSales.filter((sale) => Number(sale.debtBalance || 0) > 0);
  const activeDebtSale = debtSales.find((sale) => sale.id === debtDetailSaleId);
  const activeDebtReturns = activeDebtSale ? customerReturns.filter((record) => String(record.saleId) === String(activeDebtSale.id)) : [];
  const activeDebtReturnedAmount = activeDebtReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const activeDebtReturnedQuantity = activeDebtReturns.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
  const activeDebtOriginalAmount = Number(activeDebtSale?.amount || 0) + activeDebtReturnedAmount;
  const activeDebtPaidAmount = Number(activeDebtSale?.paidAmount ?? activeDebtSale?.initialPaidAmount ?? Math.max(0, Number(activeDebtSale?.amount || 0) - Number(activeDebtSale?.debtBalance || 0)));
  const activeDebtItemQuantity = activeDebtSale?.items?.length
    ? activeDebtSale.items.reduce((sum, item) => sum + Number(item.qty ?? item.quantity ?? 0), 0)
    : Number(activeDebtSale?.products || 0);
  const activeDebtDueDate = activeDebtSale?.debtDueDate ? new Date(String(activeDebtSale.debtDueDate).includes("T") ? activeDebtSale.debtDueDate : `${activeDebtSale.debtDueDate}T23:59:59`) : null;
  const activeDebtOverdueDays = activeDebtDueDate && !Number.isNaN(activeDebtDueDate.getTime())
    ? Math.max(0, Math.floor((Date.now() - activeDebtDueDate.getTime()) / 86400000))
    : 0;
  const debtAmount = profileSales.some((sale) => sale.debtBalance !== undefined)
    ? debtSales.reduce((sum, sale) => sum + sale.debtBalance, 0)
    : Number(customer.debt || 0);
  const [paymentModalSale, setPaymentModalSale] = useState(null);
  const [generalPayOpen, setGeneralPayOpen] = useState(false);
  const [deleteCustomerOpen, setDeleteCustomerOpen] = useState(false);
  const paymentSale = paymentModalSale || activeDebtSale || (debtSales.length === 1 ? debtSales[0] : null);
  const renderDebtPurchaseCard = (sale, selected = false) => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const itemQuantity = items.length
      ? items.reduce((sum, item) => sum + Number(item.qty ?? item.quantity ?? 0), 0)
      : Number(sale.products || 0);
    const itemTypes = uniqueSaleProductCount(sale);
    const paid = Number(sale.paidAmount ?? sale.initialPaidAmount ?? Math.max(0, Number(sale.amount || 0) - Number(sale.debtBalance || 0)));
    const content = <>
      <span className="customer-debt-purchase-content">
        <span className="customer-debt-purchase-heading">
          <b>{sale.displayId || sale.id}</b>
          <span>{dateLabel(sale.createdAt || sale.date)}</span>
        </span>
        <span className="customer-debt-purchase-items">
          {items.length > 0 ? items.map((item, index) => (
            <span className="customer-debt-purchase-item" key={`${sale.id}-${item.id ?? index}-${index}`}>
              <span>{item.name || tx("Mahsulot")}</span>
              <b>{Number(item.qty ?? item.quantity ?? 0).toLocaleString("uz-UZ")} {tx("dona")}</b>
            </span>
          )) : <span className="customer-debt-purchase-item">{tx(itemTypes)}{tx(" xil mahsulot")}</span>}
        </span>
        <span className="customer-debt-purchase-stats">
          <span><small>{tx("Jami miqdor")}</small><b>{itemQuantity.toLocaleString("uz-UZ")} {tx("dona")} · {tx(itemTypes)}{tx(" xil")}</b></span>
          <span><small>{tx("Sotuv summasi")}</small><b>{formatCurrency(sale.amount)}</b></span>
          <span><small>{tx("To‘langan")}</small><b>{formatCurrency(paid)}</b></span>
        </span>
      </span>
      <span className="customer-debt-purchase-balance"><small>{tx("Qolgan qarz")}</small><b>{formatCurrency(sale.debtBalance)}</b></span>
    </>;
    const openDetails = () => {
        setDebtDetailSaleId(sale.id);
    };
    if (selected) return <div className="customer-debt-purchase is-selected">{content}</div>;
    return (
      <div className="customer-debt-purchase-row" key={sale.id}>
        <button
          type="button"
          className="customer-debt-purchase"
          onClick={openDetails}
        >{content}</button>
        <button
          type="button"
          className="customer-debt-purchase-eye"
          aria-label={tx("Xarid tafsilotlarini ko‘rish")}
          title={tx("Xarid tafsilotlarini ko‘rish")}
          onClick={openDetails}
        >
          <Eye size={17} />
        </button>
      </div>
    );
  };
  const requestProductReturn = (sale, item, index) => {
    const returnKey = returnKeyFor(sale.id, item.id, index);
    const quantity = Number(item.qty ?? item.quantity ?? 1);
    const returned = returnedQuantityFor(returnRecords, returnKey, quantity, item);
    const remainingQuantity = Math.max(0, quantity - returned);
    if (!remainingQuantity) return;
    let originalSale = sale;
    try { originalSale = getSales().find((entry) => String(entry.id) === String(sale.id)) || sale; } catch { /* Use the visible sale if it is not in the saved list. */ }
    const soldLines = Array.isArray(originalSale.items) && originalSale.items.length ? originalSale.items : sale.items || [];
    const grossItemsTotal = soldLines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.qty ?? line.quantity ?? 0), 0);
    const originalAmount = Number(originalSale.amount ?? originalSale.total ?? sale.amount ?? grossItemsTotal);
    const itemQuantity = Number(item.qty ?? item.quantity ?? 0);
    const baseUnitPrice = Number(item.price ?? (itemQuantity > 0 && item.total != null ? Number(item.total) / itemQuantity : 0));
    const unitPrice = Math.round(baseUnitPrice * (grossItemsTotal > 0 ? originalAmount / grossItemsTotal : 1));
    setPurchaseDetailSaleId(null);
    setPendingReturn({ sale, item, index, returnKey, unitPrice, goodQuantity: "", defectiveQuantity: "", reason: "", returned, remainingQuantity });
  };

  const confirmProductReturn = () => {
    if (!pendingReturn) return;
    const { sale, item, returnKey, returned, remainingQuantity } = pendingReturn;
    const goodQuantity = Number(pendingReturn.goodQuantity || 0);
    const defectiveQuantity = Number(pendingReturn.defectiveQuantity || 0);
    const quantity = goodQuantity + defectiveQuantity;
    if (![goodQuantity, defectiveQuantity].every(Number.isInteger) || goodQuantity < 0 || defectiveQuantity < 0 || quantity < 1 || quantity > remainingQuantity) {
      error("Miqdorni tekshiring", `1 dan ${remainingQuantity} gacha butun son kiriting.`);
      return;
    }

    const stockProducts = getProducts();
    const currentProduct = Array.isArray(stockProducts) ? stockProducts.find((product) => String(product.id) === String(item.id)) : null;
    if (!currentProduct) {
      error("Mahsulot omborda topilmadi", "Qaytarish saqlanmadi. Mahsulot qoldig‘ini tekshiring.");
      return;
    }
    const currentStock = Math.max(0, Number(currentProduct.stock || 0));
    const recordedDefects = (currentProduct.defects || []).reduce((sum, defect) => sum + Number(defect.quantity || 0), 0);
    const currentDefectiveStock = Math.min(currentStock, Math.max(0, Number(currentProduct.defectiveStock || 0), recordedDefects));
    const reason = pendingReturn.reason.trim() || "Mijoz tovarni qaytardi";
    const unitPrice = Number(pendingReturn.unitPrice ?? item.price ?? 0);
    const record = {
      id: `R-${Date.now()}`,
      returnKey,
      saleId: sale.id,
      customer: customer.name,
      productId: item.id,
      product: item.name,
      category: item.category || currentProduct.category || "",
      purchaseDate: sale.createdAt || sale.date || "",
      quantity,
      goodQuantity,
      defectiveQuantity,
      unitPrice,
      unitCost: Number(currentProduct.cost || item.cost || 0),
      amount: unitPrice * quantity,
      deliveryAddress: item.deliveryAddress || sale.deliveryAddress || "Manzil biriktirilmagan",
      reason,
      date: new Date().toISOString(),
      status: "approved",
    };
    try {
      const sourceSalesKey = sale.sourceSalesKey === ADDITIONAL_SALES_KEY ? ADDITIONAL_SALES_KEY : SALES_KEY;
      const savedSales = getSales(sourceSalesKey);
      if (!Array.isArray(savedSales)) throw new Error("Savdo ma’lumoti o‘qilmadi.");
      const sales = savedSales.map((savedSale) => {
        if (String(savedSale.id) !== String(sale.id)) return savedSale;
        return {
          ...savedSale,
          items: (savedSale.items || []).map((savedItem, savedIndex) =>
            String(savedItem.id) === String(item.id) && savedIndex === pendingReturn.index
              ? { ...savedItem, returnedQuantity: returned + quantity, returned: returned + quantity >= Number(savedItem.qty ?? savedItem.quantity ?? 1), returnedAt: record.date }
              : savedItem
          ),
        };
      });
      const defect = defectiveQuantity > 0 ? {
        id: `customer-return-${record.id}`,
        product: item.name,
        category: record.category,
        quantity: defectiveQuantity,
        reason: `Mijoz qaytargan: ${reason}`,
        status: "Brak",
        unitPrice,
        total: unitPrice * defectiveQuantity,
        date: record.date,
        sourceReturnId: record.id,
      } : null;
      const products = stockProducts.map((product) => String(product.id) !== String(item.id) ? product : {
        ...product,
        stock: currentStock + quantity,
        stockIn: Number(product.stockIn || 0) + quantity,
        defectiveStock: currentDefectiveStock + defectiveQuantity,
        defects: defect ? [...(Array.isArray(product.defects) ? product.defects : []), defect] : product.defects,
        status: currentStock + quantity - currentDefectiveStock - defectiveQuantity <= 0 ? "out" : currentStock + quantity - currentDefectiveStock - defectiveQuantity < Number(product.minStock || product.minimumStock || 10) ? "low" : "active",
      });
      const updated = [record, ...returnRecords];
      saveProducts(products);
      saveSales(sales, sourceSalesKey);
      saveReturns(updated);
      setReturnRecords(updated);
      window.dispatchEvent(new Event("crm-products-updated"));
      window.dispatchEvent(new Event("crm-returns-updated"));
      try {
        const savedCustomers = getCustomers();
        if (Array.isArray(savedCustomers)) {
          const debtReduction = Math.min(Math.max(0, Number(sale.debtBalance || 0)), unitPrice * quantity);
          saveCustomers(savedCustomers.map((entry) => entry.name?.trim().toLowerCase() === customer.name.trim().toLowerCase() ? {
            ...entry,
            spent: Math.max(0, Number(entry.spent || 0) - unitPrice * quantity),
            debt: Math.max(0, Number(entry.debt || 0) - debtReduction),
            status: Number(entry.debt || 0) - debtReduction > 0 ? entry.status : entry.status === "debtor" ? "active" : entry.status,
          } : entry));
        }
      } catch { /* Sales and return details remain the source of truth if a legacy customer summary cannot be updated. */ }
    } catch {
      error("Qaytarish saqlanmadi", "Ombor yoki qaytarish ma’lumotini saqlashda xatolik yuz berdi. Qayta urinib ko‘ring.");
      return;
    }

    setPendingReturn(null);
    success("Tovar omborga qaytarildi", `${item.name} · ${quantity} dona · ${formatCurrency(unitPrice * quantity)}`);
  };

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [selectedCardId, setSelectedCardId] = useState("");
  const [paymentComplete, setPaymentComplete] = useState(false);
  const paymentTimerRef = useRef(null);
  const paymentSubmittingRef = useRef(false);

  useEffect(() => () => clearTimeout(paymentTimerRef.current), []);

  // Tahrirlash modali
  const [showEditModal, setShowEditModal] = useState(false);

  const closePaymentModal = useCallback(() => {
    clearTimeout(paymentTimerRef.current);
    setShowPaymentModal(false);
    setPaymentComplete(false);
    setPaymentMethod("cash");
    setSelectedCardId("");
    setPayAmount("");
    setPaymentModalSale(null);
    paymentSubmittingRef.current = false;
  }, []);

  useEffect(() => {
    if (!showPaymentModal && !showEditModal) return;

    const closeOnOutsideClick = (event) => {
      if (modalDialogRef.current?.contains(event.target)) return;
      closePaymentModal();
      setShowEditModal(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [showPaymentModal, showEditModal, closePaymentModal]);

  const [editForm, setEditForm] = useState({
    name: originalCustomer.name || "",
    phone: originalCustomer.phone || "",
    region: originalCustomer.region || "",
  });

  const statusMap = {
    vip: {
      label: "VIP",
      bg: "var(--violet-light)",
      color: "var(--violet)",
    },
    debtor: {
      label: "Qarzdor",
      bg: "var(--danger-light)",
      color: "var(--danger)",
    },
    active: {
      label: "Faol",
      bg: "var(--success-light)",
      color: "var(--success)",
    },
    regular: {
      label: "Oddiy",
      bg: "var(--surface-2)",
      color: "var(--text-muted)",
    },
  };

  const displayStatus = debtAmount > 0
    ? customer.status === "vip" ? "vip" : "debtor"
    : customer.status === "debtor" ? "active" : customer.status;
  const st = statusMap[displayStatus] || statusMap.active;

  // =========================
  // COPY
  // =========================
  const handleCopy = (val, label) => {
    navigator.clipboard?.writeText(val);
    success(`${label} nusxalandi`);
  };

  // =========================
  // PAYMENT
  // =========================
  const openPaymentModal = () => {
    if (!activeDebtSale) {
      setTab("debt");
      return;
    }
    setPaymentModalSale(paymentSale);
    if (paymentSale) setDebtDetailSaleId(paymentSale.id);
    setPaymentComplete(false);
    setShowPaymentModal(true);
  };

  const handlePayment = () => {
    if (paymentComplete || paymentSubmittingRef.current) return;

    if (!paymentSale) {
      if (!payAmount || Number(payAmount) <= 0) return;
      success("To'lov qabul qilindi", `${customer.name} — ${formatCurrency(payAmount)}`);
      closePaymentModal();
      return;
    }

    const amount = Math.min(paymentSale.debtBalance, Number(String(payAmount || "").replace(/\D/g, "")) || 0);
    if (amount <= 0) return;

    let receivingCard = null;
    if (paymentMethod === "card") {
      try {
        receivingCard = resolveReceivingCard(selectedCardId);
      } catch (cause) {
        error(tx(cause.message));
        return;
      }
    }

    const record = {
      id: `PAY-${Date.now()}`,
      saleId: paymentSale.id,
      customer: customer.name,
      amount,
      method: paymentMethod === "card" ? "Karta" : "Naqd",
      receivingCard,
      cardLast4: receivingCard?.number.slice(-4) || "",
      createdAt: new Date().toISOString(),
    };
    let updatedPayments;
    paymentSubmittingRef.current = true;
    try {
      updatedPayments = saveDebtPayment(record);
    } catch {
      paymentSubmittingRef.current = false;
      error("To'lov saqlanmadi", "Qayta urinib ko'ring.");
      return;
    }

    setPaymentRecords(updatedPayments);
    const remainingDebt = Math.max(0, debtAmount - amount);
    setCustomer((prev) => ({
      ...prev,
      debt: remainingDebt,
      status: remainingDebt > 0 ? "debtor" : prev.status === "debtor" ? "active" : prev.status,
    }));
    try {
      const saved = getCustomers(undefined, null);
      const list = Array.isArray(saved) ? saved : [];
      saveCustomers(list.map((item) =>
        item.name?.trim().toLowerCase() === customer.name.trim().toLowerCase()
          ? { ...item, debt: remainingDebt, status: remainingDebt > 0 ? "debtor" : item.status === "debtor" ? "active" : item.status }
          : item
      ));
    } catch {
      // The payment is saved even if the separate customer list cannot be updated.
    }

    setPaymentComplete(true);
    success("To'lov qabul qilindi", `${customer.name} — ${formatCurrency(amount)}`);
    paymentTimerRef.current = setTimeout(() => {
      closePaymentModal();
      setDebtDetailSaleId(null);
      onNavigate?.("sales-new");
    }, 1200);
  };

  // =========================
  // UMUMIY QARZNI YOPISH: summa eng eski xariddan boshlab taqsimlanadi,
  // har bir qism o'z xaridining qarz to'lovi bo'lib yoziladi (bitta groupId bilan).
  // =========================
  const payGeneralDebt = ({ amount, method, cardId }) => {
    const total = Math.min(debtAmount, Number(amount) || 0);
    if (total <= 0) return false;
    let receivingCard = null;
    if (method === "card") {
      try { receivingCard = resolveReceivingCard(cardId); } catch (cause) { error(tx(cause.message)); return false; }
    }
    const now = new Date().toISOString(), groupId = `GEN-${Date.now()}`;
    let rest = total, latest = paymentRecords;
    try {
      [...debtSales].sort((a, b) => new Date(a.createdAt || a.date || 0) - new Date(b.createdAt || b.date || 0)).forEach((sale) => {
        if (rest <= 0) return;
        const part = Math.min(rest, Number(sale.debtBalance || 0));
        if (part <= 0) return;
        rest -= part;
        latest = saveDebtPayment({
          id: `${groupId}-${sale.id}`, saleId: sale.id, customer: customer.name, amount: part,
          method: method === "card" ? "Karta" : "Naqd", receivingCard, cardLast4: receivingCard?.number.slice(-4) || "",
          createdAt: now, groupId, groupTotal: total,
        });
      });
    } catch {
      error("To'lov saqlanmadi", "Qayta urinib ko'ring.");
      setPaymentRecords(readDebtPayments());
      return false;
    }
    setPaymentRecords(latest);
    const remainingDebt = Math.max(0, debtAmount - total);
    setCustomer((prev) => ({ ...prev, debt: remainingDebt, status: remainingDebt > 0 ? "debtor" : prev.status === "debtor" ? "active" : prev.status }));
    try {
      const saved = getCustomers(undefined, null);
      const list = Array.isArray(saved) ? saved : [];
      saveCustomers(list.map((item) => item.name?.trim().toLowerCase() === customer.name.trim().toLowerCase()
        ? { ...item, debt: remainingDebt, status: remainingDebt > 0 ? "debtor" : item.status === "debtor" ? "active" : item.status }
        : item));
    } catch { /* To'lov saqlandi; mijozlar ro'yxati keyin yangilanadi. */ }
    success("Umumiy qarz to'landi", `${customer.name} — ${formatCurrency(total)} · ${tx("Qolgan qarz")}: ${formatCurrency(remainingDebt)}`);
    return true;
  };

  // Mijoz hisobini o'chirish (tasdiqlashdan keyin). Sotuvlar tarixi saqlanib qoladi.
  const deleteCustomer = () => {
    if (debtAmount > 0) return; // Qarzi to'lanmaguncha mijozni o'chirib bo'lmaydi.
    try {
      const saved = getCustomers(undefined, null);
      const list = Array.isArray(saved) ? saved : [];
      const sameCustomer = (item) => customer.id != null && item.id != null
        ? String(item.id) === String(customer.id)
        : item.name?.trim().toLowerCase() === customer.name.trim().toLowerCase();
      saveCustomers(list.filter((item) => !sameCustomer(item)));
    } catch {
      error("Mijoz o'chirilmadi", "Qayta urinib ko'ring.");
      return;
    }
    setDeleteCustomerOpen(false);
    success("Mijoz o'chirildi", customer.name);
    onBack?.();
  };

  // =========================
  // EDIT MODAL OPEN
  // =========================
  const handleOpenEdit = () => {
    setEditForm({
      name: customer.name || "",
      phone: customer.phone || "",
      region: customer.region || "",
    });

    setShowEditModal(true);
  };

  // =========================
  // EDIT SAVE
  // =========================
  const handleSaveEdit = (e) => {
    e.preventDefault();

    if (!editForm.name.trim()) {
      return;
    }

    setCustomer((prev) => ({
      ...prev,
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      region: editForm.region.trim(),
    }));

    setShowEditModal(false);

    success("Mijoz ma'lumotlari muvaffaqiyatli yangilandi!");
  };

  // =========================
  // TABS
  // =========================
  const tabs = [
    {
      key: "purchases",
      label: "Xaridlar",
    },
    {
      key: "debt",
      label: "Qarzdorlik",
    },
    {
      key: "payments",
      label: "To'lovlar tarixi",
    },
    {
      key: "activity",
      label: "Umumiy tarix",
    },
    {
      key: "returns",
      label: "Qaytarilgan tovarlar",
    },
  ];
  const customerPaymentRecords = paymentRecords.filter((payment) => profileSales.some((sale) => String(sale.id) === String(payment.saleId)));

  return (
    <div className="space-y-6 fade-in">

      {/* =========================
          BACK + HEADER
      ========================= */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="app-back-button"
          aria-label={tx("Oldingi sahifaga qaytish")}
          style={{ marginBottom: 12 }}
        >
          <ArrowLeft size={16} aria-hidden="true" style={{ flexShrink: 0 }} />{tx("Orqaga")}</button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1
              className="font-display font-bold text-2xl"
              style={{
                fontFamily: "'Manrope',sans-serif",
                color: "var(--text-primary)",
              }}
            >{tx("Mijoz profili")}</h1>

            <p
              className="text-sm mt-0.5"
              style={{
                color: "var(--text-muted)",
              }}
            >{tx("Mijoz tarixi va batafsil ma'lumotlari")}</p>
          </div>
          {profileSales.length > 0 && (
            <button
              type="button"
              className="customer-profile-return-button"
              onClick={() => {
                setDebtDetailSaleId(null);
                setPurchaseDetailSaleId(null);
                setReturnSalesSearch("");
                setReturnSalesModalOpen(true);
              }}
            >
              <RotateCcw size={15} />{tx("Tovarni qaytarish")}
            </button>
          )}
        </div>
      </div>

      {/* =========================
          MAIN CONTENT
      ========================= */}
      <div
        className="customer-detail-layout grid gap-5"
      >

        {/* =========================
            LEFT PANEL
        ========================= */}
        <div className="customer-detail-summary space-y-4">

          {/* PROFILE CARD */}
          <div className="card p-5 text-center" style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setDeleteCustomerOpen(true)}
              aria-label={tx("Mijozni o'chirish")}
              title={tx("Mijozni o'chirish")}
              className="flex items-center justify-center rounded-xl"
              style={{ position: "absolute", top: 14, right: 14, width: 38, height: 38, border: "1px solid var(--danger-border, var(--danger))", background: "var(--danger-light)", color: "var(--danger)", cursor: "pointer" }}
            >
              <Trash2 size={17} />
            </button>

            <div className="relative inline-block mb-4">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-xl font-bold mx-auto"
                style={{
                  background:
                    customer.status === "vip"
                      ? "linear-gradient(135deg, var(--violet), var(--violet))"
                      : "linear-gradient(135deg, var(--brand), var(--brand-hover))",
                }}
              >
                {tx(customer.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2))}
              </div>

              {customer.status === "vip" && (
                <div
                  className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{
                    background: "var(--warning)",
                  }}
                >
                  <Crown size={13} color="white" />
                </div>
              )}
            </div>

            <div
              className="font-display font-bold text-lg mb-1"
              style={{
                fontFamily: "'Manrope',sans-serif",
                color: "var(--text-primary)",
              }}
            >
              {customer.name}
            </div>

            <span
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: st.bg,
                color: st.color,
              }}
            >
              {customer.status === "vip" && <Crown size={10} />}
              {tx(st.label)}
            </span>

            {/* CUSTOMER INFO */}
            <div className="mt-5 space-y-3 text-left">
              {[
                {
                  icon: Phone,
                  label: customer.phone,
                  action: () =>
                    handleCopy(customer.phone, "Telefon"),
                },
                {
                  icon: MapPin,
                  label: customer.region,
                  action: undefined,
                },
                {
                  icon: Calendar,
                  label: `Ro'yxatdan: ${customer.lastPurchase}`,
                  action: undefined,
                },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3"
                >
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: "var(--surface-2)",
                    }}
                  >
                    <item.icon
                      size={14}
                      style={{
                        color: "var(--text-muted)",
                      }}
                    />
                  </div>

                  <span
                    className="text-sm flex-1"
                    style={{
                      color: "var(--text-secondary)",
                    }}
                  >
                    {tx(item.label)}
                  </span>

                  {item.action && (
                    <button
                      onClick={item.action}
                      className="hover:opacity-70 transition-opacity"
                      style={{
                        cursor: "pointer",
                        background: "transparent",
                        border: "none",
                        padding: 0,
                      }}
                    >
                      <Copy
                        size={12}
                        style={{
                          color: "var(--text-faint)",
                        }}
                      />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* BUTTONS */}
            <div className="flex gap-2 mt-5">

              <button
                onClick={openPaymentModal}
                className="btn-primary flex-1 justify-center text-xs"
                style={{
                  background: "var(--success)",
                  boxShadow:
                    "0 2px 8px rgba(16,185,129,0.25)",
                  cursor: "pointer",
                }}
              >
                <CheckCircle size={13} />{tx("To'lov")}</button>

              {/* TAHIRLASH */}
              <button
                onClick={handleOpenEdit}
                className="btn-ghost text-xs flex-1 justify-center"
                style={{
                  cursor: "pointer",
                }}
              >
                <Edit2 size={13} />{tx("Tahrirlash")}</button>

            </div>
          </div>

          {/* =========================
              STATS
          ========================= */}
          <div className="card p-4 space-y-3">
            {[
              {
                icon: ShoppingBag,
                label: "Jami xaridlar",
                value: `${totalPurchased} ta`,
                color: "var(--brand)",
                bg: "var(--brand-light)",
              },
              {
                icon: DollarSign,
                label: "Jami xarajat",
                value: formatCurrency(customerSpentAfterReturns),
                color: "var(--success)",
                bg: "var(--success-light)",
              },
              {
                icon: CreditCard,
                label: "Joriy qarz",
                value:
                  debtAmount > 0
                    ? formatCurrency(debtAmount)
                    : "—",
                color:
                  debtAmount > 0
                    ? "var(--danger)"
                    : "var(--success)",
                bg:
                  debtAmount > 0
                    ? "var(--danger-light)"
                    : "var(--success-light)",
              },
              {
                icon: CheckCircle,
                label: "To'langan",
                // Shu paytgacha mijoz bizga to'lagan jami summa (xarid paytida + qarz to'lovlari).
                value: formatCurrency(profileSales.reduce((sum, sale) => sum + Number(sale.paidAmount || 0), 0)),
                color: "var(--success)",
                bg: "var(--success-light)",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-3"
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: s.bg,
                  }}
                >
                  <s.icon
                    size={14}
                    style={{
                      color: s.color,
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div
                    className="text-xs"
                    style={{
                      color: s.label === "Joriy qarz" ? s.color : "var(--text-faint)",
                    }}
                  >
                    {tx(s.label)}
                  </div>

                  <div
                    className="text-sm font-semibold"
                    style={{
                      color: s.label === "Joriy qarz" ? s.color : "var(--text-primary)",
                    }}
                  >
                    {tx(s.value)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* =========================
            RIGHT PANEL
        ========================= */}
        <div className="customer-detail-history card-flat rounded-2xl overflow-hidden">

          {/* TAB BAR */}
          <div
            className="flex items-center gap-1 px-5 py-3"
            style={{
              borderBottom:
                "1px solid var(--border-subtle)",
            }}
          >
            {tabs.map((item) => (
              <button
                key={item.key}
                onClick={() => { setDebtDetailSaleId(null); setTab(item.key); }}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{
                  background:
                    tab === item.key
                      ? "var(--brand-light)"
                      : "transparent",
                  color:
                    tab === item.key
                      ? "var(--brand)"
                      : "var(--text-muted)",
                  fontWeight:
                    tab === item.key ? 600 : 400,
                  cursor: "pointer",
                  border: "none",
                }}
              >
                {tx(item.label)}
              </button>
            ))}
          </div>

          {/* TAB CONTENT */}
          <div className="fade-in">

            {/* PURCHASES */}
            {tab === "purchases" && (
              <div style={{ overflowX: "auto" }}>
                <table className="w-full">
                  <thead>
                    <tr
                      style={{
                        background:
                          "var(--table-stripe)",
                      }}
                    >
                      {[
                        "ID",
                        "Mahsulotlar",
                        "Summa",
                        "Qolgan qarz",
                        "To'lov",
                        "Sana",
                        "Holat",
                        "Amallar",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left px-5 py-3 text-xs font-semibold"
                          style={{
                            color:
                              "var(--text-faint)",
                          }}
                        >
                          {tx(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {profileSales.map((s, index) => {
                      const statusMap2 = {
                        paid: {
                          label: "To'landi",
                          bg: "var(--success-light)",
                          color: "var(--success)",
                        },
                        debt: {
                          label: "Qarz",
                          bg: "var(--danger-light)",
                          color: "var(--danger)",
                        },
                        partial: {
                          label: "Qisman",
                          bg: "var(--warning-light)",
                          color: "var(--warning)",
                        },
                        returned: {
                          label: "Qaytarilgan",
                          bg: "var(--surface-2)",
                          color: "var(--text-muted)",
                        },
                      };

                      const ss =
                        statusMap2[s.status] ||
                        statusMap2.paid;

                      return (
                        <tr
                          key={s.id}
                          className={`border-t table-row-hover row-anim customer-purchase-row ${purchaseDetailSaleId === s.id ? "is-selected" : ""}`}
                          onClick={() => setPurchaseDetailSaleId(s.id)}
                          style={{
                            borderColor:
                              "var(--border-subtle)",
                          }}
                        >
                          <td
                            className="px-5 py-3.5 font-mono text-xs font-semibold"
                            style={{
                              color:
                                "var(--text-muted)",
                            }}
                          >
                            {s.id}
                          </td>

                          <td
                            className="px-5 py-3.5 text-sm"
                            style={{
                              color:
                                "var(--text-secondary)",
                            }}
                          >
                            <button
                              type="button"
                              className="customer-purchase-toggle"
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPurchaseDetailSaleId(s.id);
                              }}
                            >
                              {tx(uniqueSaleProductCount(s))}{tx(" ta mahsulot")}</button>
                          </td>

                          <td
                            className="px-5 py-3.5 text-sm font-semibold"
                            style={{
                              color:
                                "var(--text-primary)",
                            }}
                          >
                            {formatCurrency(s.amount)}</td>

                          <td
                            className="px-5 py-3.5 text-sm font-semibold"
                            style={{
                              color: Number(s.debtBalance || 0) > 0 ? "var(--danger)" : "var(--text-muted)",
                            }}
                          >
                            {Number(s.debtBalance || 0) > 0 ? formatCurrency(s.debtBalance) : "—"}
                          </td>

                          <td
                            className="px-5 py-3.5 text-sm"
                            style={{
                              color:
                                "var(--text-secondary)",
                            }}
                          >
                            {tx(s.payment)}
                          </td>

                          <td
                            className="px-5 py-3.5 text-xs"
                            style={{
                              color:
                                "var(--text-faint)",
                            }}
                          >
                            {tx(s.date)}
                          </td>

                          <td className="px-5 py-3.5">
                            <span
                              className="px-2.5 py-1 rounded-full text-xs font-semibold"
                              style={{
                                background: ss.bg,
                                color: ss.color,
                              }}
                            >
                              {tx(ss.label)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="customer-purchase-actions">
                              {(s.items?.length > 0 || s.productIds?.length > 0 || Number(s.products) > 0) && (
                                <button
                                  type="button"
                                  className="customer-purchase-return-action"
                                  style={{ animationDelay: `${index * 180}ms` }}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPurchaseDetailSaleId(s.id);
                                  }}
                                >
                                  <RotateCcw size={14} />{tx("Tovarni qaytarish")}
                                </button>
                              )}
                              <button
                                type="button"
                                className="customer-purchase-view-action"
                                aria-label={tx("Xarid tafsilotlarini ko‘rish")}
                                title={tx("Xarid tafsilotlarini ko‘rish")}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPurchaseDetailSaleId(s.id);
                                }}
                              >
                                <Eye size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {profileSales.length === 0 && (
                      <tr><td colSpan={8} className="px-5 py-6 text-sm">{tx("Xaridlar mavjud emas")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "returns" && (
              <div className="customer-returns-panel">
                {groupedCustomerReturns.length > 0 ? groupedCustomerReturns.map((record) => (
                  <button type="button" className="customer-return-card" key={record.id} onClick={() => setSelectedReturn(record)} aria-haspopup="dialog">
                    <div className="customer-return-icon"><RotateCcw size={18} /></div>
                    <div className="customer-return-main">
                      <strong>{record.lines[0]?.product}{record.lines.length > 1 ? " …" : ""}</strong>
                      <small>{record.id} · {uniqueSaleProductCount({ items: record.lines })} {tx("xil mahsulot")} · {record.lines.reduce((sum,line) => sum + Number(line.quantity || 0),0)} {tx("dona")}</small>
                      <span>{tx("Sabab")}: {[...new Set(record.lines.map(line => line.reason || "Ko‘rsatilmagan"))].map(reason => tx(reason)).join(" · ")}</span>
                    </div>
                    <div className="customer-return-meta">
                      <strong>{formatCurrency(record.amount)}</strong><span>{dateLabel(record.date)}</span>
                      <small className="customer-return-open">{tx("Tafsilotlarni ko‘rish")} ↗</small>
                    </div>
                  </button>
                )) : (
                  <div className="customer-returns-empty">
                    <RotateCcw size={28} />
                    <strong>{tx("Qaytarilgan tovarlar yo'q")}</strong>
                    <span>{tx("Mijoz qaytargan tovarlar shu yerda ko'rinadi.")}</span>
                  </div>
                )}
              </div>
            )}

      <Modal open={!!selectedReturn} onClose={() => setSelectedReturn(null)} title="Qaytarish tafsilotlari" subtitle={selectedReturn?.id} icon={RotateCcw} width={820} contentOnly>
        {selectedReturn && (() => {
          const lines = selectedReturn.lines || [];
          const hasBreakdown = lines.length > 0 && lines.every(line => line.goodQuantity != null && line.defectiveQuantity != null);
          const good = lines.reduce((sum, line) => sum + Number(line.goodQuantity || 0), 0);
          const defective = lines.reduce((sum, line) => sum + Number(line.defectiveQuantity || 0), 0);
          const quantity = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
          return <div className="return-document customer-return-document">
            <div className="return-document-head"><div><small>{tx("Mijoz qaytargan mahsulotlar")}</small><h3>{selectedReturn.customer}</h3><p>{tx("Qaytarilgan sana va vaqt")}: {dateLabel(selectedReturn.date)}</p></div><span>{tx(returnStatusMap[selectedReturn.status]?.label || "—")}</span></div>
            <dl className="return-document-meta">{[["Sotuv ID",selectedReturn.saleId],["Xarid sanasi",dateLabel(selectedReturn.purchaseDate)],["Manzil",selectedReturn.deliveryAddress || "—"],["Mahsulot turlari",tx(uniqueSaleProductCount({ items: lines }) + " xil")]].map(([label,value]) => <div key={label}><dt>{tx(label)}</dt><dd>{value}</dd></div>)}</dl>
            <section className="customer-return-items">{lines.map(line => {
              const unitPrice = Number(line.unitPrice ?? (line.quantity ? line.amount / line.quantity : 0));
              const lineHasBreakdown = line.goodQuantity != null && line.defectiveQuantity != null;
              return <article className="customer-return-item" key={line.id}>
                <div className="customer-return-item-head"><div><h4>{line.product || tx("Mahsulot")}</h4>{line.category && <small>{tx("Kategoriya")}: {tx(line.category)}</small>}</div><strong>{formatCurrency(line.amount)}</strong></div>
                {lineHasBreakdown ? <div className="customer-return-condition-grid">
                  <div><b>{tx("Yaroqli")}</b><span>{Number(line.goodQuantity).toLocaleString("uz-UZ")} {tx("dona")}</span><small>{formatCurrency(unitPrice)} · {tx("bir dona")}</small><strong>{formatCurrency(Number(line.goodQuantity) * unitPrice)}</strong></div>
                  <div className="is-defective"><b>{tx("Brak / yaroqsiz")}</b><span>{Number(line.defectiveQuantity).toLocaleString("uz-UZ")} {tx("dona")}</span><small>{formatCurrency(unitPrice)} · {tx("bir dona")}</small><strong>{formatCurrency(Number(line.defectiveQuantity) * unitPrice)}</strong></div>
                </div> : <div className="customer-return-legacy"><b>{tx("Qaytarilgan jami")}: {Number(line.quantity || 0).toLocaleString("uz-UZ")} {tx("dona")}</b><small>{tx("Bu eski qaytarish yozuvida yaroqli va brak soni alohida saqlanmagan.")}</small></div>}
                <div className="customer-return-reason"><small>{tx("Qaytarish sababi")}</small><span>{tx(line.reason || "Ko‘rsatilmagan")}</span></div>
              </article>;
            })}</section>
            <div className="customer-return-summary"><div className="customer-return-summary-counts"><span><small>{tx("Yaroqli jami")}</small><b>{hasBreakdown ? `${good.toLocaleString("uz-UZ")} ${tx("dona")}` : "—"}</b></span><span><small>{tx("Brak jami")}</small><b>{hasBreakdown ? `${defective.toLocaleString("uz-UZ")} ${tx("dona")}` : "—"}</b></span><span><small>{tx("Jami miqdor")}</small><b>{quantity.toLocaleString("uz-UZ")} {tx("dona")}</b></span></div>{!hasBreakdown && <p className="customer-return-history-note">{tx("Eski yozuvlarda yaroqli va brak sonlari alohida saqlanmagan; sonlar taxmin qilinmadi.")}</p>}<div className="customer-return-summary-total"><small>{tx("Umumiy qaytarish summasi")}</small><b>{formatCurrency(selectedReturn.amount)}</b></div><div className="return-export-actions"><button onClick={() => exportReturn("print")}><Printer size={16}/>{tx("Chop etish")}</button><button onClick={() => exportReturn("pdf")}><FileText size={16}/>{tx("PDF")}</button><button className="return-export-excel" onClick={() => exportReturn("excel")}><Download size={16}/>{tx("Excel")}</button></div></div>
          </div>;
        })()}
      </Modal>
            {/* DEBT */}
            {tab === "debt" && (
              <div className="p-5">
                {debtAmount > 0 ? (
                  <div className="space-y-4">
                    {activeDebtSale && (
                      <button
                        type="button"
                        className="app-back-button customer-debt-back"
                        onClick={() => setDebtDetailSaleId(null)}
                        aria-label={tx("Qarzga olingan xaridlar ro'yxatiga qaytish")}
                      >
                        <ArrowLeft size={16} />{tx(" Orqaga")}</button>
                    )}
                    {!activeDebtSale && <div
                      className="p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3"
                      style={{
                        background:
                          "var(--danger-light)",
                        border:
                          "1px solid var(--danger-border, var(--danger))",
                      }}
                    >
                      <div>
                      <div
                        className="text-sm font-semibold mb-1"
                        style={{
                          color: "var(--danger)",
                        }}
                      >
                        {tx("Joriy qarzdorlik")}
                      </div>

                      <div
                        className="text-2xl font-display font-bold"
                        style={{
                          fontFamily:
                            "'Manrope',sans-serif",
                          color: "var(--danger)",
                        }}
                      >
                        {formatCurrency(debtAmount)}</div>
                      </div>
                      <button type="button" className="btn-primary" style={{ marginLeft: "auto" }} onClick={() => setGeneralPayOpen(true)}><CreditCard size={16} />{tx("Umumiy qarzni yopish")}</button>
                    </div>}

                    {activeDebtSale ? (
                      <>
                        <div className="customer-debt-purchases">
                          <section className="customer-debt-receipt" aria-label={tx("Xarid tafsilotlari")}>
                            <div className="customer-debt-receipt-heading"><div><small>{tx("SAVDO HUJJATI")}</small><b>{tx("Xarid tafsilotlari")}</b></div><span>{activeDebtSale.status === "partial" ? tx("Qisman to‘langan") : tx("Qarzdor")}</span></div>
                            <div className="customer-debt-receipt-meta">
                              {[
                                ["Sotuv ID", activeDebtSale.displayId || activeDebtSale.id],
                                ["Xarid sanasi", dateLabel(activeDebtSale.createdAt || activeDebtSale.date)],
                                ["To‘lov usuli", activeDebtSale.payment || activeDebtSale.paymentMethod || "—"],
                                ["Telefon", activeDebtSale.customerPhone || customer.phone || "—"],
                                ["Yetkazish manzili", activeDebtSale.deliveryAddress || "—"],
                                ["Sotgan xodim", activeDebtSale.employeeName || "—"],
                              ].map(([label, value]) => <div key={label}><small>{tx(label)}</small><b>{tx(value)}</b></div>)}
                            </div>
                            <div className="customer-debt-receipt-totals">
                              {[
                                ["Jami tovar", `${activeDebtItemQuantity.toLocaleString("uz-UZ")} ${tx("dona")}`],
                                ["Sotuv summasi", formatCurrency(activeDebtOriginalAmount)],
                                ["Qaytarilgan summa", `− ${formatCurrency(activeDebtReturnedAmount)}`],
                                ["Qaytarilgan miqdor", `${activeDebtReturnedQuantity.toLocaleString("uz-UZ")} ${tx("dona")}`],
                                ["Jami to‘langan", formatCurrency(activeDebtPaidAmount)],
                                ["Qolgan qarz", formatCurrency(activeDebtSale.debtBalance)],
                              ].map(([label, value], index) => <div className={index === 2 ? "is-returned" : index === 5 ? "is-debt" : ""} key={label}><small>{tx(label)}</small><b>{value}</b></div>)}
                            </div>
                          </section>
                          <SaleProductList
                            sale={activeDebtSale}
                            returnRecords={returnRecords}
                            onReturn={requestProductReturn}
                          />
                        </div>

                        <div className="space-y-2">
                          {[
                            { label: "Qarz yaratilgan sana", value: activeDebtSale.date },
                            { label: "To'lov muddati", value: activeDebtSale.debtDueDate || "Ko'rsatilmagan" },
                            { label: "Kechikish", value: `${activeDebtOverdueDays.toLocaleString("uz-UZ")} ${tx("kun")}` },
                          ].map((item) => (
                            <div
                              key={item.label}
                              className="flex items-center justify-between py-2"
                              style={{ borderBottom: "1px solid var(--border-subtle)" }}
                            >
                              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                                {tx(item.label)}
                              </span>
                              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                                {tx(item.value)}
                              </span>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={openPaymentModal}
                          className="btn-primary w-full justify-center"
                          style={{ background: "var(--success)", cursor: "pointer" }}
                        >
                          <CheckCircle size={15} />{tx("Qarzni to'lash")}</button>
                      </>
                    ) : (
                      <div className="customer-debt-purchases">
                        <h3>{tx("Qarzga olingan xaridlar")}</h3>
                        {debtSales.length > 0 ? debtSales.map((sale) => renderDebtPurchaseCard(sale)) : (
                          <p>{tx("Bu qarzga tegishli xarid tafsilotlari kiritilmagan.")}</p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                      style={{
                        background:
                          "var(--success-light)",
                      }}
                    >
                      <CheckCircle
                        size={24}
                        style={{
                          color: "var(--success)",
                        }}
                      />
                    </div>

                    <p
                      className="text-sm font-semibold mb-1"
                      style={{
                        color:
                          "var(--text-primary)",
                      }}
                    >{tx("Qarzdorlik yo'q")}</p>

                    <p
                      className="text-xs"
                      style={{
                        color:
                          "var(--text-muted)",
                      }}
                    >{tx("Bu mijozning hech qanday qarzdorligi mavjud emas")}</p>
                  </div>
                )}
              </div>
            )}

            {/* TO'LOVLAR TARIXI va UMUMIY TARIX */}
            {(tab === "payments" || tab === "activity") && (
              <CustomerHistoryTab
                key={tab}
                mode={tab === "payments" ? "payments" : "all"}
                events={buildCustomerHistory({ sales: profileSales, payments: customerPaymentRecords, returns: groupedCustomerReturns })}
                allPayments={customerPaymentRecords}
                onOpenSale={(sale) => { setDebtDetailSaleId(null); setPurchaseDetailSaleId(sale.id); setTab("purchases"); }}
              />
            )}
          </div>
        </div>
      </div>

      {/* =====================================================
          TAHIRLASH MODALI
      ===================================================== */}
      {showEditModal && modalRoot && createPortal(
        <div
          className="crm-content-modal"
          onClick={() => setShowEditModal(false)}
        >
          <div
            ref={modalDialogRef}
            className="customer-detail-edit-modal"
            style={{ maxWidth: "100%", maxHeight: "100%", boxSizing: "border-box" }}
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex items-center justify-between mb-5">
              <div>
                <h2
                  className="font-display font-bold text-lg"
                  style={{
                    color:
                      "var(--text-primary)",
                    fontFamily:
                      "'Manrope',sans-serif",
                  }}
                >{tx("Mijozni tahrirlash")}</h2>

                <p
                  className="text-xs mt-1"
                  style={{
                    color:
                      "var(--text-muted)",
                  }}
                >{tx("Mijoz ma'lumotlarini o'zgartiring")}</p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setShowEditModal(false)
                }
                className="p-2 rounded-xl transition-opacity hover:opacity-70"
                style={{
                  color:
                    "var(--text-faint)",
                  background:
                    "var(--surface-2)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <X size={17} />
              </button>
            </div>

            <form
              onSubmit={handleSaveEdit}
              className="space-y-4"
            >

              {/* NAME */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{
                    color:
                      "var(--text-secondary)",
                  }}
                >{tx("Mijoz ismi")}</label>

                <input
                  required
                  type="text"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      name: e.target.value,
                    })
                  }
                  placeholder={tx("Masalan: Ali Valiyev")}
                  className="input-base"
                  autoFocus
                />
              </div>

              {/* PHONE */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{
                    color:
                      "var(--text-secondary)",
                  }}
                >{tx("Telefon raqam")}</label>

                <input
                  type="tel"
                  value={editForm.phone}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      phone: e.target.value,
                    })
                  }
                  placeholder={tx("+998 90 123 45 67")}
                  className="input-base"
                />
              </div>

              {/* REGION */}
              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{
                    color:
                      "var(--text-secondary)",
                  }}
                >{tx("Manzil / Viloyat")}</label>

                <select
                  value={editForm.region || ""}
                  onChange={(e) => setEditForm({ ...editForm, region: e.target.value })}
                  className="input-base"
                >
                  <option value="">{tx("Viloyatni tanlang")}</option>
                  {editForm.region && !uzbekRegions.includes(editForm.region) && (
                    <option value={editForm.region}>{editForm.region}</option>
                  )}
                  {uzbekRegions.map((region) => <option key={region} value={region}>{tx(region)}</option>)}
                </select>
              </div>

              {/* ACTIONS */}
              <div className="flex gap-3 pt-2">

                <button
                  type="button"
                  onClick={() =>
                    setShowEditModal(false)
                  }
                  className="btn-ghost flex-1 justify-center"
                  style={{
                    cursor: "pointer",
                  }}
                >{tx("Bekor qilish")}</button>

                <button
                  type="submit"
                  className="btn-primary flex-1 justify-center"
                  style={{
                    cursor: "pointer",
                  }}
                >
                  <Save size={14} />{tx("Saqlash")}</button>

              </div>
            </form>
          </div>
        </div>
      , modalRoot)}

      {/* =====================================================
          PAYMENT MODAL
      ===================================================== */}
      {deleteCustomerOpen && debtAmount > 0 && modalRoot && createPortal(
        <div className="crm-content-modal" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDeleteCustomerOpen(false); }}>
          <style>{`@keyframes customerDebtBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.25;transform:scale(.92)}}`}</style>
          <div role="alertdialog" aria-modal="true" aria-labelledby="customer-debt-block-title" className="slide-up" style={{ width: "min(440px, calc(100vw - 32px))", borderRadius: 20, overflow: "hidden", background: "var(--surface)", border: "2px solid var(--danger)", boxShadow: "0 24px 60px rgba(220, 38, 38, 0.25)" }}>
            <div style={{ background: "var(--danger)", color: "#fff", padding: "22px 20px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, margin: "0 auto 10px", borderRadius: "50%", background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, fontWeight: 800, lineHeight: 1, animation: "customerDebtBlink 1s ease-in-out infinite" }} aria-hidden="true">!</div>
              <h2 id="customer-debt-block-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{tx("Mijozni o'chirib bo'lmaydi")}</h2>
            </div>
            <div style={{ padding: 20 }} className="space-y-4">
              <p className="text-sm" style={{ color: "var(--text-primary)" }}>{tx("Bu mijozning to'lanmagan qarzi bor. Qarzi to'liq to'lanmaguncha mijoz profilini o'chirib bo'lmaydi.")}</p>
              <div className="p-3 rounded-xl text-sm" style={{ background: "var(--danger-light)", color: "var(--danger)" }}>
                <b className="block">{customer.name}</b>
                <span className="block mt-1">{tx("Joriy qarz")}: <b>{formatCurrency(debtAmount)}</b></span>
              </div>
              <div className="flex justify-end gap-2 flex-wrap">
                <button type="button" className="btn-ghost" onClick={() => setDeleteCustomerOpen(false)}>{tx("Bekor qilish")}</button>
                <button type="button" className="btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => { setDeleteCustomerOpen(false); setDebtDetailSaleId(null); setTab("debt"); }}><CreditCard size={15} />{tx("Qarzini to'lash")}</button>
              </div>
            </div>
          </div>
        </div>,
        modalRoot
      )}
      <Modal contentOnly open={deleteCustomerOpen && debtAmount <= 0} onClose={() => setDeleteCustomerOpen(false)} title="Mijozni o'chirish" subtitle={customer.name} icon={Trash2} width={440}>
        <div className="space-y-4">
          <p className="text-sm">{tx("Rostdan ham bu mijozning hisobini o'chirmoqchimisiz?")}</p>
          <div className="p-3 rounded-xl text-sm" style={{ background: "var(--danger-light)", color: "var(--danger)" }}>
            <b className="block">{customer.name}</b>
            {debtAmount > 0 && <span className="block mt-1">{tx("Joriy qarz")}: {formatCurrency(debtAmount)}</span>}
            <span className="block mt-1">{tx("Bu amalni ortga qaytarib bo'lmaydi.")}</span>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteCustomerOpen(false)}>{tx("Yo'q, bekor qilish")}</button>
            <button type="button" className="btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={deleteCustomer}><Trash2 size={15} />{tx("Ha, o'chirish")}</button>
          </div>
        </div>
      </Modal>
      <CustomerGeneralPayModal open={generalPayOpen} close={() => setGeneralPayOpen(false)} customerName={customer.name} debtSales={debtSales} totalDebt={debtAmount} onPay={payGeneralDebt} />
      {showPaymentModal && paymentSale && modalRoot && createPortal(
        <DebtPaymentModal
          sale={paymentSale}
          paymentAmount={payAmount}
          setPaymentAmount={setPayAmount}
          method={paymentMethod}
          setMethod={setPaymentMethod}
          selectedCardId={selectedCardId}
          setSelectedCardId={setSelectedCardId}
          completed={paymentComplete}
          onSubmit={handlePayment}
          onClose={closePaymentModal}
          dialogRef={modalDialogRef}
        />,
        modalRoot
      )}
      <Modal contentOnly open={Boolean(selectedPayment)} onClose={() => setSelectedPayment(null)} title="To‘lov tafsilotlari" subtitle={selectedPayment?.saleId || customer.name} icon={DollarSign} width={740}>
        {selectedPayment && (() => {
          const relatedSale = profileSales.find((sale) => String(sale.id) === String(selectedPayment.saleId));
          const receivingCard = selectedPayment.receivingCard || relatedSale?.receivingCard;
          const transactionDate = selectedPayment.createdAt || selectedPayment.date;
          const saleReturns = customerReturns.filter((record) => String(record.saleId) === String(relatedSale?.id));
          const returnedAmount = saleReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
          const receiptSale = relatedSale ? {
            ...relatedSale,
            items: (relatedSale.items || []).map((item, index) => {
              const key = returnKeyFor(relatedSale.id, item.id, index);
              const itemReturns = saleReturns.filter((record) => record.returnKey === key);
              const returnedQuantity = returnedQuantityFor(returnRecords, key, Number(item.qty ?? item.quantity ?? 0), item);
              const refundAmount = itemReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
              return { ...item, returnedQuantity, refundAmount: refundAmount || returnedQuantity * Number(item.price || 0) };
            }),
          } : null;
          let seller = relatedSale?.employeeName || "";
          if (!seller && relatedSale?.employeeId != null) {
            try { seller = readEmployees().find((employee) => String(employee.id) === String(relatedSale.employeeId))?.name || ""; } catch { seller = ""; }
          }
          const paidAmount = Number(relatedSale?.paidAmount ?? 0);
          const remainingAmount = Number(relatedSale?.debtBalance ?? 0);
          const timeText = transactionDate ? new Date(transactionDate).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Ma’lumot saqlanmagan";
          const saleItems = receiptSale?.items || [];
          const itemQuantity = saleItems.reduce((sum, item) => sum + Number(item.qty ?? item.quantity ?? 0), 0);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[["To‘lov summasi", formatCurrency(selectedPayment.amount)], ["To‘lov sanasi", timeText], ["To‘lov usuli", selectedPayment.method || "Ma’lumot saqlanmagan"], ["Tranzaksiya raqami", selectedPayment.id || "Ma’lumot saqlanmagan"], ["Sotuv raqami", selectedPayment.saleId || "Ma’lumot saqlanmagan"], ["Sotgan xodim", seller || "Xodim biriktirilmagan"]].map(([label, value]) => (
                  <div key={label} className="p-3 rounded-xl min-w-0" style={{ background: "var(--surface-2)" }}>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tx(label)}</div>
                    <div className="text-sm font-semibold mt-1 break-words" style={{ color: "var(--text-primary)" }}>{tx(value)}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: "var(--surface-2)" }}>
                  <div><div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{tx("Sotilgan mahsulotlar")}</div><div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{itemQuantity} {tx("dona")} · {uniqueSaleProductCount({ items: saleItems })} {tx("xil mahsulot")}</div></div>
                  <div className="text-right"><div className="text-xs" style={{ color: "var(--text-muted)" }}>{tx("Qaytarilgan miqdor")}</div><div className="font-semibold text-sm" style={{ color: "var(--danger)" }}>{saleItems.reduce((sum, item) => sum + Number(item.returnedQuantity || 0), 0)} {tx("dona")}</div></div>
                </div>
                <div className="max-h-56 overflow-y-auto divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {saleItems.length ? saleItems.map((item, index) => (
                    <div key={String(item.id) + "-" + index} className="px-4 py-3 flex items-start justify-between gap-4 text-sm">
                      <div className="min-w-0"><div className="font-semibold break-words" style={{ color: "var(--text-primary)" }}>{item.name || tx("Mahsulot")}</div><div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{item.qty ?? item.quantity ?? 0} × {formatCurrency(item.price || 0)}</div>{Number(item.returnedQuantity) > 0 && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{tx("Qaytarildi")}: {item.returnedQuantity} {tx("dona")} · {formatCurrency(item.refundAmount || 0)}</div>}</div>
                      <strong className="shrink-0 text-right" style={{ color: "var(--text-primary)" }}>{formatCurrency(item.total ?? Number(item.price || 0) * Number(item.qty ?? item.quantity ?? 0))}</strong>
                    </div>
                  )) : <p className="p-4 text-sm" style={{ color: "var(--text-muted)" }}>{tx("Mahsulotlar tafsiloti saqlanmagan")}</p>}
                </div>
              </div>
              <div className="p-4 rounded-2xl space-y-2" style={{ background: "var(--brand-light)" }}>
                {[["Sotuv summasi", formatCurrency(Number(relatedSale?.amount || 0) + returnedAmount)], ["Qaytarilgan tovar puli", "− " + formatCurrency(returnedAmount)], ["Yakuniy summa", formatCurrency(relatedSale?.amount || 0)], ["Jami to‘langan", formatCurrency(paidAmount)], ["Qolgan qarz", formatCurrency(remainingAmount)]].map(([label, value], index) => (
                  <div key={label} className={"flex justify-between gap-3 text-sm " + (index === 2 ? "pt-2 border-t font-bold" : "")} style={{ borderColor: index === 2 ? "var(--border)" : undefined, color: index === 1 ? "var(--danger)" : "var(--text-primary)" }}><span>{tx(label)}</span><strong className="text-right">{tx(value)}</strong></div>
                ))}
              </div>
              {receivingCard && <div className="text-xs" style={{ color: "var(--text-muted)" }}>{tx("Qabul qiluvchi karta")}: {receivingCard.name || tx("Karta")} · {formatCardNumber(receivingCard.number)}</div>}
              <button type="button" className="btn-primary w-full justify-center" onClick={() => {
                const printableSale = receiptSale && { ...receiptSale, amount: Number(relatedSale.amount || 0), paidAmount, debtBalance: remainingAmount };
                if (!printableSale || !printSaleReceipt({ sale: printableSale, payment: { ...selectedPayment, receivingCard }, customer, seller, refundRecords: saleReturns, currency: formatCurrency })) error("Chek ochilmadi", "Brauzerda yangi oynalarni ochishga ruxsat bering.");
              }}><Printer size={15} />{tx("Chekni chiqarish / Chop etish")}</button>
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={returnSalesModalOpen}
        onClose={() => setReturnSalesModalOpen(false)}
        title="Tovarni qaytarish"
        subtitle={`${customer.name} · ${tx("Xaridlar tarixi")}`}
        icon={RotateCcw}
        width={640}
        contentOnly
      >
        <div className="customer-return-sales-select">
          <input
            className="input-base"
            type="search"
            value={returnSalesSearch}
            onChange={(event) => setReturnSalesSearch(event.target.value)}
            placeholder={tx("Sotuv ID yoki sana bo‘yicha qidirish...")}
            aria-label={tx("Sotuv ID yoki sana bo‘yicha qidirish")}
          />
          <div className="customer-return-sales-list">
            {[...profileSales]
              .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
              .filter((sale) => {
                const query = returnSalesSearch.trim().toLowerCase();
                if (!query) return true;
                return [sale.displayId, sale.id, dateLabel(sale.createdAt || sale.date)]
                  .some((value) => String(value || "").toLowerCase().includes(query));
              })
              .map((sale) => {
                const itemQuantity = Array.isArray(sale.items)
                  ? sale.items.reduce((sum, item) => sum + Number(item.qty ?? item.quantity ?? 0), 0)
                  : 0;
                const productTypes = uniqueSaleProductCount(sale);
                const quantityLabel = sale.items?.length
                  ? `${itemQuantity.toLocaleString("uz-UZ")} ${tx("dona")} · ${productTypes} ${tx("xil mahsulot")}`
                  : `${productTypes} ${tx("xil mahsulot")}`;
                return (
                  <button
                    type="button"
                    className="customer-return-sale-choice"
                    key={sale.id}
                    onClick={() => {
                      setReturnSalesModalOpen(false);
                      setTab("purchases");
                      setPurchaseDetailSaleId(sale.id);
                    }}
                  >
                    <span className="customer-return-sale-icon"><ShoppingBag size={17} /></span>
                    <span className="customer-return-sale-main">
                      <strong>{sale.displayId || sale.id}</strong>
                      <small>{dateLabel(sale.createdAt || sale.date)} · {quantityLabel}</small>
                    </span>
                    <span className="customer-return-sale-amount">{formatCurrency(sale.amount)}</span>
                  </button>
                );
              })}
            {profileSales.length > 0 && returnSalesSearch.trim() && !profileSales.some((sale) =>
              [sale.displayId, sale.id, dateLabel(sale.createdAt || sale.date)]
                .some((value) => String(value || "").toLowerCase().includes(returnSalesSearch.trim().toLowerCase()))
            ) && <p className="customer-return-sales-empty">{tx("Mos sotuv topilmadi")}</p>}
            {profileSales.length === 0 && <p className="customer-return-sales-empty">{tx("Xaridlar topilmadi")}</p>}
          </div>
        </div>
      </Modal>

      <Modal
        open={!!purchaseDetailSale}
        onClose={() => setPurchaseDetailSaleId(null)}
        title="Xarid tafsilotlari"
        subtitle={purchaseDetailSale ? `${customer.name} · ${purchaseDetailSale.displayId || purchaseDetailSale.id}` : ""}
        icon={ShoppingBag}
        width={980}
        contentOnly
      >
        {purchaseDetailSale && (() => {
          const sale = purchaseDetailSale;
          const saleReturns = customerReturns.filter((record) => String(record.saleId) === String(sale.id));
          const returnedAmount = saleReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
          const returnedQuantity = saleReturns.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
          const totalQuantity = Array.isArray(sale.items)
            ? sale.items.reduce((sum, item) => sum + Number(item.qty ?? item.quantity ?? 0), 0)
            : 0;
          const paidAmount = Number(sale.paidAmount ?? sale.initialPaidAmount ?? Math.max(0, Number(sale.amount || 0) - Number(sale.debtBalance || 0)));
          const status = sale.status === "partial"
            ? { label: "Qisman", bg: "var(--warning-light)", color: "var(--warning)" }
            : sale.status === "debt"
              ? { label: "Qarz", bg: "var(--danger-light)", color: "var(--danger)" }
              : sale.status === "returned"
                ? { label: "Qaytarilgan", bg: "var(--surface-2)", color: "var(--text-muted)" }
                : { label: "To‘landi", bg: "var(--success-light)", color: "var(--success)" };
          return (
            <section className="customer-purchase-detail-document">
              <div className="customer-debt-receipt customer-purchase-receipt">
                <div className="customer-debt-receipt-heading">
                  <div><small>{tx("SAVDO HUJJATI")}</small><b>{tx("Xarid tafsilotlari")}</b></div>
                  <span style={{ background: status.bg, color: status.color }}>{tx(status.label)}</span>
                </div>
                <div className="customer-debt-receipt-meta">
                  {[
                    ["Sotuv ID", sale.displayId || sale.id],
                    ["Xarid sanasi", dateLabel(sale.createdAt || sale.date)],
                    ["To‘lov usuli", sale.payment || sale.paymentMethod || "—"],
                    ["Mijoz", customer.name || "—"],
                    ["Telefon", sale.customerPhone || customer.phone || "—"],
                    ["Yetkazish manzili", sale.deliveryAddress || "—"],
                  ].map(([label, value]) => <div key={label}><small>{tx(label)}</small><b>{tx(value)}</b></div>)}
                </div>
                <div className="customer-debt-receipt-totals">
                  {[
                    ["Tovar miqdori", sale.items?.length ? `${totalQuantity.toLocaleString("uz-UZ")} ${tx("dona")} · ${uniqueSaleProductCount(sale)} ${tx("xil")}` : `${uniqueSaleProductCount(sale)} ${tx("xil")}`],
                    ["Umumiy xarid summasi", formatCurrency(Number(sale.amount || 0) + returnedAmount)],
                    ["Qaytarilgan summa", `− ${formatCurrency(returnedAmount)}`],
                    ["Qaytarilgan miqdor", `${returnedQuantity.toLocaleString("uz-UZ")} ${tx("dona")}`],
                    ["Jami to‘langan", formatCurrency(paidAmount)],
                    ["Qolgan qarz", formatCurrency(Number(sale.debtBalance || 0))],
                  ].map(([label, value], index) => <div className={index === 2 ? "is-returned" : index === 5 && Number(sale.debtBalance || 0) > 0 ? "is-debt" : ""} key={label}><small>{tx(label)}</small><b>{value}</b></div>)}
                </div>
              </div>
              <SaleProductList sale={sale} returnRecords={returnRecords} onReturn={requestProductReturn} />
            </section>
          );
        })()}
      </Modal>

      {pendingReturn && modalRoot && createPortal(
        <div className="crm-content-modal customer-return-workflow-overlay">
          {(() => {
            const product = getProducts().find(entry => String(entry.id) === String(pendingReturn.item.id)) || {};
            const stock = Math.max(0, Number(product.stock || 0));
            const recordedDefects = (product.defects || []).reduce((sum, defect) => sum + Number(defect.quantity || 0), 0);
            const defectiveStock = Math.min(stock, Math.max(0, Number(product.defectiveStock || 0), recordedDefects));
            const goodQuantity = Number(pendingReturn.goodQuantity || 0);
            const defectiveQuantity = Number(pendingReturn.defectiveQuantity || 0);
            const returnQuantity = goodQuantity + defectiveQuantity;
            const unitPrice = Number(pendingReturn.unitPrice ?? pendingReturn.item.price ?? 0);
            const returnAmount = returnQuantity * unitPrice;
            const purchasedQuantity = Number(pendingReturn.item.qty ?? pendingReturn.item.quantity ?? 1);
            const purchasedAsDefect = Boolean(
              pendingReturn.item.isDefectSale ||
              pendingReturn.item.isDefective ||
              pendingReturn.item.defectId ||
              ["defective", "defect", "brak", "yaroqsiz"].includes(String(pendingReturn.item.condition || "").trim().toLowerCase())
            );
            const updateQuantity = (field, value) => {
              const other = field === "goodQuantity" ? defectiveQuantity : goodQuantity;
              const max = Math.max(0, pendingReturn.remainingQuantity - other);
              const next = Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));
              setPendingReturn({ ...pendingReturn, [field]: value === "" ? "" : String(next) });
            };
            return <div className="customer-return-confirm customer-return-workflow" role="dialog" aria-modal="true" aria-labelledby="return-confirm-title">
              <div className="customer-return-workflow-header"><div className="customer-return-confirm-icon"><RotateCcw size={20} /></div><div><h2 id="return-confirm-title">{tx("Mijozdan tovar qaytarish")}</h2><p>{customer.name} · {pendingReturn.item.name} · {tx("Sotuv")}: {pendingReturn.sale.id}</p></div><button type="button" className="customer-return-close" onClick={() => setPendingReturn(null)} aria-label={tx("Yopish")}><X size={17}/></button></div>
              <div className="customer-return-stock-grid">
                <div><small>{tx("Olingan")}</small><b>{purchasedQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b></div>
                <div><small>{tx("Olingan braklar")}</small><b>{(purchasedAsDefect ? purchasedQuantity : 0).toLocaleString("uz-UZ")} {tx("dona")}</b></div>
                <div><small>{tx("Qaytarish mumkin")}</small><b>{pendingReturn.remainingQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b></div>
                <div><small>{tx("Hozir omborda")}</small><b>{(stock - defectiveStock).toLocaleString("uz-UZ")} {tx("yaroqli")} · {defectiveStock.toLocaleString("uz-UZ")} {tx("brak")}</b></div>
              </div>
              <div className="customer-return-price-note"><span>{tx("Sotuvdagi bir dona narxi")}</span><b>{formatCurrency(unitPrice)}</b></div>
              <div className="customer-return-condition-grid customer-return-input-grid">
                <label><b>{tx("Yaroqli tovar")}</b><small>{tx("Yaroqli omborga qaytadi")}</small><input className="input-base" type="number" min="0" max={Math.max(0, pendingReturn.remainingQuantity - defectiveQuantity)} step="1" inputMode="numeric" placeholder="0" value={pendingReturn.goodQuantity} onChange={event => updateQuantity("goodQuantity", event.target.value)} /></label>
                <label className="is-defective"><b>{tx("Brak / yaroqsiz")}</b><small>{tx("Brak omboriga qaytadi")}</small><input className="input-base" type="number" min="0" max={Math.max(0, pendingReturn.remainingQuantity - goodQuantity)} step="1" inputMode="numeric" placeholder="0" value={pendingReturn.defectiveQuantity} onChange={event => updateQuantity("defectiveQuantity", event.target.value)} /></label>
              </div>
              <label className="customer-return-reason-field"><span>{tx("Qaytarish sababi")}</span><textarea className="input-base" rows="2" value={pendingReturn.reason} onChange={event => setPendingReturn({ ...pendingReturn, reason: event.target.value })} placeholder={tx("Sababini yozing (ixtiyoriy)")} /></label>
              <div className="customer-return-money-summary"><span>{tx("Jami qaytariladigan")}</span><b>{returnQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b><span>{tx("Qaytariladigan summa")}</span><strong>{formatCurrency(returnAmount)}</strong></div>
              <p className="customer-return-stock-note">{tx("Tasdiqlanganda yaroqli mahsulot oddiy omborga, brak mahsulot brak omboriga qo‘shiladi. Qaytarish summasi sotuv daromadi va mijoz qarzidan ayriladi.")}</p>
              <div className="customer-return-confirm-actions"><button type="button" className="btn-ghost" onClick={() => setPendingReturn(null)}>{tx("Bekor qilish")}</button><button type="button" className="customer-return-confirm-button" onClick={confirmProductReturn} disabled={returnQuantity < 1}><RotateCcw size={15} />{tx("Qaytarishni tasdiqlash")}</button></div>
            </div>;
          })()}
        </div>,
        modalRoot
      )}
      {showPaymentModal && !paymentSale && modalRoot && createPortal(
        <div
          className="crm-content-modal"
        >
          <div
            ref={modalDialogRef}
            className="rounded-3xl p-6 w-full max-w-sm slide-up"
            style={{
              background: "var(--surface)",
              boxShadow: "var(--shadow-lg)",
              border:
                "1px solid var(--border)",
              maxHeight: "100%",
              overflowY: "auto",
              boxSizing: "border-box",
            }}
          >

            <div className="flex items-center justify-between mb-5">

              <h2
                className="font-display font-bold text-lg"
                style={{
                  fontFamily:
                    "'Manrope',sans-serif",
                  color:
                    "var(--text-primary)",
                }}
              >{tx("To'lov qabul qilish")}</h2>

              <button
                onClick={closePaymentModal}
                className="p-2 rounded-xl hover:opacity-70"
                style={{
                  color:
                    "var(--text-faint)",
                  cursor: "pointer",
                  background: "transparent",
                  border: "none",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">

              <div>
                <label
                  className="block text-xs font-semibold mb-1.5"
                  style={{
                    color:
                      "var(--text-secondary)",
                  }}
                >{tx("Miqdor")}</label>

                <input
                  type="number"
                  min="1"
                  value={moneyInputValue(payAmount, false)}
                  onChange={(e) => setPayAmount(String(toBaseMoney(e.target.value)))}
                  className="input-base"
                  placeholder={tx("0")}
                />
              </div>

              <button
                onClick={handlePayment}
                disabled={!payAmount}
                className="btn-primary w-full justify-center"
                style={{
                  background:
                    "var(--success)",
                  opacity:
                    !payAmount ? 0.5 : 1,
                  cursor: payAmount
                    ? "pointer"
                    : "not-allowed",
                }}
              >
                <CheckCircle size={15} />{tx("Tasdiqlash")}</button>

            </div>
          </div>
        </div>
      , modalRoot)}
    </div>
  );
}
