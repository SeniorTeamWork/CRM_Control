import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import './ProductDetail.css';
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Edit2,
  Trash2,
  Package,
  BarChart3,
  ShoppingCart,
  ArrowUpCircle,
  ArrowDownCircle,
  RotateCcw,
  // Copy,
  // Pointer,
} from "lucide-react";  
import Modal, { Field } from "../components/Modal";
import { SupplierReturnForm, SupplierReturnPrompt } from "../components/SupplierReturns";
import { calculateReturn, returnLimits, reduceReturnStock, supplierOutstanding, allocateReturnDebt } from "../data/supplierReturns";
import { reservedQuantitiesByCondition } from "../data/ordersStore";
import { useToast } from "../context/ToastContext";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  Tooltip,
} from "recharts";
// import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { currencyLabel, formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { getData, setData } from "../supabase/db";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { findSameNameProduct, findSkuOwner, productLabel, skuTakenMessage } from "../data/productIdentity";
const readList = (key) => {
  try { const value = getData(key, []); return Array.isArray(value) ? value : []; } catch { return []; }
};
const parsedDate = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; };
const sameDay = (left, right) => left?.toDateString() === right.toDateString();
const saleItems = (sale, productId) => Array.isArray(sale.items)
  ? sale.items.filter((item) => String(item.id) === String(productId) && !item.returned)
  : [];
const saleQuantity = (sale, productId) => Array.isArray(sale.items)
  ? saleItems(sale, productId).reduce((sum, item) => sum + Number(item.qty || 0), 0)
  : (sale.productIds || []).filter((id) => String(id) === String(productId)).length;
const saleAmount = (sale, productId) => saleItems(sale, productId).reduce((sum, item) => sum + Number(item.total ?? Number(item.qty || 0) * Number(item.price || 0)), 0);
const receiptQuantity = (receipt, productId) => (receipt.products || []).filter((item) => String(item.id) === String(productId)).reduce((sum, item) => sum + Number(item.quantity ?? item.stock ?? 0), 0);
const findProduct = (productId) => {
  let list = [];
  try {
    const saved = getProducts([]);
    if (Array.isArray(saved)) list = saved;
  } catch { /* Empty catalog when Supabase data is unavailable. */ }
  return list.find((item) => String(item.id) === String(productId)) || null;
};
const EmptyData = ({ icon: Icon, text }) => <div className="py-10 text-center"><Icon size={24} className="mx-auto mb-2" style={{ color: "var(--text-faint)" }}/><p className="text-sm" style={{ color: "var(--text-muted)" }}>{tx(text)}</p></div>;

export default function ProductDetail({ productId, onBack, animateDefectCount = false, openDefectEditor = false }) {
  useUILanguage();
  const [product, setProduct] = useState(() => findProduct(productId));
  const [, refreshMetrics] = useState(0);
  useEffect(() => {
    const refresh = () => { setProduct(findProduct(productId)); refreshMetrics((value) => value + 1); };
    refresh();
    window.addEventListener("storage", refresh);
    const timer = window.setInterval(refresh, 1500);
    return () => { window.removeEventListener("storage", refresh); window.clearInterval(timer); };
  }, [productId]);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [returnDraft, setReturnDraft] = useState(null);
  const [returnConfirming, setReturnConfirming] = useState(false);
  const [returnReceipt, setReturnReceipt] = useState(null);
  const returnSaving = useRef(false);
  const defectEditorOpenedFor = useRef("");
  const { success, error } = useToast();
  const { t } = useLanguage();
  const [tab, setTab] = useState("overview");
  useEffect(() => {
    if (!openDefectEditor) {
      defectEditorOpenedFor.current = "";
      return;
    }
    if (!product || defectEditorOpenedFor.current === String(productId)) return;
    defectEditorOpenedFor.current = String(productId);
    setEditForm({
      name: product.name || "",
      brand: product.brand || "",
      sku: product.sku || "",
      category: product.category || "",
      price: product.price ?? "",
      cost: product.cost ?? "",
      stock: product.stock ?? "",
      defectiveStock: "",
      defectAction: "add",
      addDefectToStock: true,
      defectUnitPrice: "",
      defectSalePrice: "",
    });
    setIsEditOpen(true);
  }, [openDefectEditor, product, productId]);
  if (!product) {
    return (
      <div className="space-y-6 fade-in">
        <button type="button" onClick={onBack} className="app-back-button" aria-label={tx("Oldingi sahifaga qaytish")}>
          <ArrowLeft size={16} aria-hidden="true" style={{ flexShrink: 0 }} />{tx("Orqaga")}
        </button>
        <div className="card p-6"><EmptyData icon={Package} text="Mahsulot topilmadi" /></div>
      </div>
    );
  }
  const statusMap = {
    active: {
      label: t("productDetail.status.active", "Faol"),
      bg: "var(--success-light)",
      color: "var(--success)",
    },
    low: {
      label: t("productDetail.status.low", "Kam qolgan"),
      bg: "var(--warning-light)",
      color: "var(--warning)",
    },
    out: {
      label: t("productDetail.status.out", "Tugagan"),
      bg: "var(--danger-light)",
      color: "var(--danger)",
    },
  };
  const st = statusMap[product.status] || statusMap.active;
  const margin = product.price > 0
    ? Math.round(((product.price - product.cost) / product.price) * 100)
    : 0;
  const costPrice = Number(product.cost || 0);
  const sellPrice = Number(product.price || 0);
  const unitProfit = sellPrice - costPrice;
  const profitPercent = costPrice > 0 ? (unitProfit / costPrice) * 100 : null;
  const profitPercentLabel = profitPercent === null
    ? "—"
    : `${new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(profitPercent)}%`;
  const profitColor = profitPercent === null ? "var(--text-muted)" : unitProfit < 0 ? "var(--danger)" : "var(--success)";
  const now = new Date(), sales = readList("crm_sales"), receipts = readList("crm_supplier_receipts"), customerReturns = readList("crm_returns"), supplierReturns = readList("crm_supplier_returns");
  const productCustomerReturns = customerReturns.filter((item) => item.status === "approved" && String(item.productId) === String(product.id));
  const productSales = sales.map((sale) => {
    const returned = productCustomerReturns.filter((item) => String(item.saleId) === String(sale.id));
    const returnedQuantity = returned.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const returnedAmount = returned.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      sale,
      date: parsedDate(sale.date),
      qty: Math.max(0, saleQuantity(sale, product.id) - returnedQuantity),
      amount: Math.max(0, saleAmount(sale, product.id) - returnedAmount),
    };
  });
  const productReceipts = receipts.map((receipt) => ({ receipt, date: parsedDate(receipt.date), qty: receiptQuantity(receipt, product.id) }));
  const soldToday = productSales.filter(({ date }) => sameDay(date, now)).reduce((sum, item) => sum + item.qty, 0);
  const soldTotal = productSales.reduce((sum, item) => sum + item.qty, 0);
  const receivedThisMonth = productReceipts.filter(({ date }) => date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()).reduce((sum, item) => sum + item.qty, 0);
  const minimumStock = Number(product.minStock ?? product.minStockLevel ?? product.minQuantity ?? 0);
  const vatRate = Number(product.vat ?? product.vatRate ?? 0);
  const productSupplierReturns = supplierReturns.filter((item) => String(item.productId) === String(product.id));
  const totalStock = Math.max(0, Number(product.stock || 0));
  const defectiveStock = Math.min(totalStock, Math.max(0, Number(product.defectiveStock ?? product.defects?.reduce((sum, defect) => sum + Number(defect.quantity || 0), 0) ?? 0)));
  const usableStock = Math.max(0, totalStock - defectiveStock);
  const defectEntries = Array.isArray(product.defects) ? product.defects.filter((defect) => Number(defect.quantity) > 0) : [];
  const recordedDefectQuantity = defectEntries.reduce((sum, defect) => sum + Number(defect.quantity || 0), 0);
  const unrecordedDefectQuantity = Math.max(0, defectiveStock - recordedDefectQuantity);
  const defectCostTotal = defectEntries.reduce((sum, defect) => sum + Number(defect.quantity || 0) * Number(defect.unitPrice ?? defect.price ?? product.defectUnitPrice ?? 0), 0)
    + unrecordedDefectQuantity * Number(product.defectUnitPrice ?? 0);
  const defectSellTotal = defectEntries.reduce((sum, defect) => sum + Number(defect.quantity || 0) * Number(defect.salePrice ?? defect.sellingPrice ?? product.defectSalePrice ?? product.defectPrice ?? 0), 0)
    + unrecordedDefectQuantity * Number(product.defectSalePrice ?? product.defectPrice ?? 0);
  const defectCostPrice = defectiveStock > 0
    ? defectCostTotal / defectiveStock
    : Number(product.defectUnitPrice ?? 0);
  const defectSellPrice = defectiveStock > 0
    ? defectSellTotal / defectiveStock
    : Number(product.defectSalePrice ?? product.defectPrice ?? 0);
  const plannedDefectChange = Math.max(0, Number(editForm.defectiveStock) || 0);
  const plannedDefectTotal = editForm.defectAction === "reduce"
    ? Math.max(0, defectiveStock - plannedDefectChange)
    : defectiveStock + plannedDefectChange;
  const plannedStockTotal = Number(editForm.stock ?? product.stock ?? 0)
    + (editForm.defectAction !== "reduce" && editForm.addDefectToStock !== false ? plannedDefectChange : 0);
  const money = (value) => formatCurrency(value);
  const dateLabel = (value) => parsedDate(value)?.toLocaleDateString("uz-UZ", { day: "2-digit", month: "short", year: "numeric" }) || "—";
  const startProductReturn = () => {
    const matchingReceipt = receipts
      .filter((receipt) => (receipt.products || []).some((line) => String(line.id) === String(product.id)))
      .sort((left, right) => (parsedDate(right.date)?.getTime() || 0) - (parsedDate(left.date)?.getTime() || 0))[0];
    const supplierId = product.supplierId ?? matchingReceipt?.supplierId;
    const supplier = readList("crm_suppliers").find((item) => String(item.id) === String(supplierId)) || null;
    if (!supplier || supplierId == null) {
      error("Ta’minotchi topilmadi", "Mahsulot uchun ta’minotchi ma’lumotini tekshiring.");
      return;
    }
    const orders = readList(`crm_supplier_orders_${supplierId}`);
    const matchingOrder = (matchingReceipt?.orderId != null
      ? orders.find((order) => String(order.id) === String(matchingReceipt.orderId))
      : null) || [...orders].sort((left, right) => (parsedDate(right.date)?.getTime() || 0) - (parsedDate(left.date)?.getTime() || 0)).find((order) => (order.productDetails || order.products || []).some((line) => String(line.id) === String(product.id)));
    if (!matchingOrder) {
      error("Qabul hujjati topilmadi", "Mahsulotga tegishli ta’minotchi qabul hujjati topilmadi.");
      return;
    }
    const receiptLine = (matchingReceipt?.products || []).find((line) => String(line.id) === String(product.id));
    const line = (matchingOrder.productDetails || matchingOrder.products || []).find((item) => String(item.id) === String(product.id)) || receiptLine || {
      id: product.id,
      name: product.name,
      quantity: product.stock,
      cost: product.cost,
      measurementUnit: product.measurementUnit,
      measurementType: product.measurementType,
    };
    const currentReturns = readList("crm_supplier_returns").filter((record) => String(record.supplierId) === String(supplierId));
    const reserved = reservedQuantitiesByCondition();
    const productId = String(product.id);
    const limits = returnLimits(line, product, currentReturns, matchingOrder.id, {
      good: reserved.good[productId] || 0,
      defective: reserved.defective[productId] || 0,
    });
    const unit = line.measurementUnit || product.measurementUnit || (line.measurementType === "weight" || product.measurementType === "weight" ? "kg" : "dona");
    setReturnDraft({
      product,
      line,
      ...limits,
      supplierId,
      supplierName: supplier.name,
      orderId: matchingOrder.id,
      orderDebt: supplierOutstanding(supplier, orders, currentReturns).total,
      receivedAt: matchingReceipt?.date || matchingOrder.date,
      unit,
      goodQuantity: "",
      defectiveQuantity: "",
      refundedAmount: "",
      reason: "",
    });
    returnSaving.current = false;
    setReturnConfirming(false);
  };
  const confirmProductReturn = () => {
    if (!returnDraft || returnSaving.current) return;
    const catalog = getProducts([]);
    const currentProduct = (Array.isArray(catalog) ? catalog : []).find((item) => String(item.id) === String(returnDraft.product.id));
    const supplierId = returnDraft.supplierId;
    const suppliers = readList("crm_suppliers");
    const supplier = suppliers.find((item) => String(item.id) === String(supplierId));
    const orders = readList(`crm_supplier_orders_${supplierId}`);
    const order = orders.find((item) => String(item.id) === String(returnDraft.orderId));
    const allReturns = readList("crm_supplier_returns");
    const currentReturns = allReturns.filter((item) => String(item.supplierId) === String(supplierId));
    if (!currentProduct || !supplier || !order) {
      error("Qaytarish amalga oshmadi", "Mahsulot, ta’minotchi yoki qabul hujjati topilmadi.");
      setReturnDraft(null);
      return;
    }
    const reserved = reservedQuantitiesByCondition();
    const productId = String(currentProduct.id);
    const fresh = {
      ...returnDraft,
      ...returnLimits(returnDraft.line, currentProduct, currentReturns, order.id, {
        good: reserved.good[productId] || 0,
        defective: reserved.defective[productId] || 0,
      }),
      orderDebt: supplierOutstanding(supplier, orders, currentReturns).total,
    };
    const totals = calculateReturn(fresh);
    if (!totals.valid || fresh.orderDebt !== returnDraft.orderDebt) {
      setReturnDraft({ ...fresh, error: "Ombor qoldig‘i, band qilingan miqdor yoki qarz o‘zgardi. Miqdor va pulni qayta tekshiring." });
      setReturnConfirming(false);
      return;
    }
    returnSaving.current = true;
    const record = {
      version: 2,
      id: crypto.randomUUID(),
      supplierId,
      supplierName: supplier.name,
      orderId: order.id,
      productId: currentProduct.id,
      productName: currentProduct.name,
      productCategory: currentProduct.categoryName || currentProduct.category || currentProduct.categoryTitle || "",
      productCount: 1,
      reason: fresh.reason.trim(),
      items: totals.goodQuantity + totals.defectiveQuantity,
      measurementUnit: fresh.unit,
      goodQuantity: totals.goodQuantity,
      defectiveQuantity: totals.defectiveQuantity,
      goodUnitCost: fresh.goodCost,
      defectUnitCost: fresh.badCost,
      amount: totals.amount,
      debtOffset: totals.debtOffset,
      refundDue: totals.refundDue,
      refundedAmount: totals.refundedAmount,
      receivedAt: fresh.receivedAt,
      returnedAt: new Date().toISOString(),
    };
    Object.assign(record, allocateReturnDebt(totals.debtOffset, supplier, orders, currentReturns, order.id));
    try {
      const balances = supplierOutstanding(supplier, orders, currentReturns);
      const nextSupplier = {
        ...supplier,
        debt: Math.max(0, fresh.orderDebt - totals.debtOffset),
        legacyDebt: Math.max(0, balances.legacy - record.legacyOffset),
      };
      saveProducts(catalog.map((item) => String(item.id) === String(currentProduct.id) ? reduceReturnStock(item, record, fresh.defectIds) : item));
      setData("crm_suppliers", suppliers.map((item) => String(item.id) === String(supplierId) ? nextSupplier : item));
      setData("crm_supplier_returns", [record, ...allReturns]);
      setReturnDraft(null);
      setReturnConfirming(false);
      setReturnReceipt(record);
      success("Tovar qaytarildi", currentProduct.name);
    } catch (cause) {
      returnSaving.current = false;
      setReturnDraft({ ...fresh, error: cause.message || "Saqlash amalga oshmadi" });
      setReturnConfirming(false);
    }
  };
  const historyEvents = [
    ...productReceipts.filter((item) => item.qty > 0).map((item) => ({ ...item, type: "in", reason: "Ta'minotchidan qabul qilindi" })),
    ...productSales.filter((item) => item.qty > 0).map((item) => ({ ...item, type: "out", reason: "Sotuv" })),
    ...productCustomerReturns.map((item) => ({ date: parsedDate(item.date), qty: Number(item.quantity || 0), type: "in", reason: "Mijoz qaytarishi" })),
    ...productSupplierReturns.map((item) => ({ date: parsedDate(item.returnedAt), qty: Number(item.items || 0), type: "out", reason: "Tovar ta'minotchiga qaytarildi" })),
  ].sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0));
  const movements = historyEvents.slice(0, 8);
  const monthlySales = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    const v = productSales.filter(({ date }) => date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth()).reduce((sum, item) => sum + item.qty, 0);
    return { d: month.toLocaleDateString("uz-UZ", { month: "short" }), v };
  });
  const previousMonth = monthlySales[4]?.v || 0, currentMonth = monthlySales[5]?.v || 0;
  const salesChange = previousMonth ? `${currentMonth >= previousMonth ? "+" : ""}${Math.round(((currentMonth - previousMonth) / previousMonth) * 100)}%` : currentMonth ? "+100%" : "0%";
  const tabs = [
    {
      key: "overview",
      label: t("productDetail.tabs.overview", "Umumiy"),
    },
    {
      key: "pricing",
      label: t("productDetail.tabs.pricing", "Narxlash"),
    },
    {
      key: "inventory",
      label: t("productDetail.tabs.inventory", "Inventar"),
    },
    {
      key: "sales",
      label: t("productDetail.tabs.sales", "Sotuv statistikasi"),
    },
    {
      key: "history",
      label: t("productDetail.tabs.history", "Tarix"),
    },
  ];
  const openEdit = () => {
    setEditForm({
      name: product.name || "",
      brand: product.brand || "",
      sku: product.sku || "",
      category: product.category || "",
      price: product.price ?? "",
      cost: product.cost ?? "",
      stock: product.stock ?? "",
      defectiveStock: "",
      defectAction: "add",
      addDefectToStock: true,
      defectUnitPrice: "",
      defectSalePrice: "",
    });
    setIsEditOpen(true);
  };
  const saveEdit = () => {
    {
      const catalog = (Array.isArray(getProducts([])) ? getProducts([]) : []);
      // Eski (oldindan bor) dublikatlar tahrirlashni to'smasin — faqat o'zgartirilgan qiymat tekshiriladi.
      const changed = (key) => String(editForm[key] ?? "").trim().toLocaleLowerCase("uz-UZ") !== String(product?.[key] ?? "").trim().toLocaleLowerCase("uz-UZ");
      const skuOwner = changed("sku") && findSkuOwner(catalog, { sku: editForm.sku, name: editForm.name, brand: editForm.brand, excludeId: product?.id });
      if (skuOwner) { error(skuTakenMessage(String(editForm.sku).trim(), skuOwner)); return; }
      const sameProduct = (changed("name") || changed("brand")) && findSameNameProduct(catalog, { name: editForm.name, brand: editForm.brand, excludeId: product?.id });
      if (sameProduct) { error(`"${productLabel(sameProduct)}" mahsuloti allaqachon mavjud. Bir mahsulot ikki marta bo'lishi mumkin emas.`); return; }
    }
    if (!editForm.name.trim() || editForm.price === "" || editForm.cost === "" || editForm.stock === "") {
      error("Mahsulot nomi, narxlari va qoldig'ini kiriting");
      return;
    }
    const stock = Number(editForm.stock);
    const defectChange = Number(editForm.defectiveStock || 0);
    const hasDefectUnitPrice = editForm.defectUnitPrice !== "" && editForm.defectUnitPrice !== undefined;
    const hasDefectSalePrice = editForm.defectSalePrice !== "" && editForm.defectSalePrice !== undefined;
    const defectUnitPrice = hasDefectUnitPrice ? Number(editForm.defectUnitPrice) : null;
    const defectSalePrice = hasDefectSalePrice ? Number(editForm.defectSalePrice) : null;
    if (!Number.isFinite(defectChange) || defectChange < 0) {
      error("Brak miqdori 0 dan kam bo'lishi mumkin emas");
      return;
    }
    if ((hasDefectUnitPrice && (!Number.isFinite(defectUnitPrice) || defectUnitPrice < 0)) || (hasDefectSalePrice && (!Number.isFinite(defectSalePrice) || defectSalePrice < 0))) {
      error("Brak narxlarini to'g'ri kiriting");
      return;
    }
    const currentDefects = Array.isArray(product.defects) ? product.defects : [];
    const currentRecordedQuantity = currentDefects.reduce((sum, defect) => sum + Math.max(0, Number(defect.quantity) || 0), 0);
    const oldDefectiveQuantity = Math.max(0, Number(product.defectiveStock ?? currentRecordedQuantity) || 0);
    const isAddingDefect = editForm.defectAction !== "reduce";
    const targetDefectiveQuantity = isAddingDefect ? oldDefectiveQuantity + defectChange : oldDefectiveQuantity - defectChange;
    const updatedStock = stock + (isAddingDefect && editForm.addDefectToStock ? defectChange : 0);
    if (!isAddingDefect && defectChange > oldDefectiveQuantity) {
      error("Kamaytiriladigan miqdor hozirgi brak sonidan ko'p bo'lishi mumkin emas");
      return;
    }
    if (targetDefectiveQuantity > updatedStock) {
      error("Brak miqdori ombordagi qoldiqdan ko'p. Yangi kirimga qo'shish variantini tanlang.");
      return;
    }
    if (isAddingDefect && defectChange > 0 && (!hasDefectUnitPrice || !hasDefectSalePrice)) {
      error("Yangi brak qo'shish uchun uning tannarxi va sotuv narxini kiriting");
      return;
    }
    const savedDefects = (Array.isArray(product.defects) ? product.defects : [])
      .filter((defect) => Number(defect.quantity) > 0)
      .map((defect, index) => ({ ...defect, id: defect.id || `${product.id}-defect-${index}`, quantity: Number(defect.quantity) }));
    const recordedQuantity = savedDefects.reduce((sum, defect) => sum + defect.quantity, 0);
    const unrecordedQuantity = Math.max(0, oldDefectiveQuantity - recordedQuantity);
    if (unrecordedQuantity > 0) savedDefects.push({
      id: `${product.id}-defect-existing`, quantity: unrecordedQuantity, status: "Brak",
      reason: "Sabab ko'rsatilmagan", date: product.createdAt || new Date().toISOString(),
      unitPrice: Number(product.defectUnitPrice ?? 0),
      salePrice: Number(product.defectSalePrice ?? product.defectPrice ?? 0),
    });
    if (isAddingDefect && defectChange > 0) {
      const quantity = defectChange;
      savedDefects.push({
        id: crypto.randomUUID(), quantity, status: "Brak",
        reason: "Keyinchalik brak aniqlandi", date: new Date().toISOString(),
        unitPrice: defectUnitPrice, salePrice: defectSalePrice, total: quantity * defectUnitPrice,
      });
    } else if (!isAddingDefect && defectChange > 0) {
      let toRemove = defectChange;
      for (let index = savedDefects.length - 1; index >= 0 && toRemove > 0; index -= 1) {
        const removed = Math.min(savedDefects[index].quantity, toRemove);
        savedDefects[index].quantity -= removed;
        toRemove -= removed;
      }
    }
    const nextDefects = savedDefects
      .filter((defect) => defect.quantity > 0)
      .map((defect) => {
        const nextUnitPrice = hasDefectUnitPrice ? defectUnitPrice : Number(defect.unitPrice ?? defect.price ?? product.defectUnitPrice ?? 0);
        return {
          ...defect,
          ...(hasDefectUnitPrice ? { unitPrice: defectUnitPrice } : {}),
          ...(hasDefectSalePrice ? { salePrice: defectSalePrice } : {}),
          total: defect.quantity * nextUnitPrice,
        };
      });
    const updatedProduct = {
      ...product,
      ...editForm,
      name: editForm.name.trim(),
      brand: editForm.brand.trim(),
      sku: editForm.sku.trim(),
      category: editForm.category.trim(),
      price: Number(editForm.price),
      cost: Number(editForm.cost),
      stock: updatedStock,
      defectiveStock: targetDefectiveQuantity,
      defectUnitPrice: hasDefectUnitPrice ? defectUnitPrice : product.defectUnitPrice,
      defectSalePrice: hasDefectSalePrice ? defectSalePrice : product.defectSalePrice,
      defectPrice: hasDefectSalePrice ? defectSalePrice : product.defectPrice,
      defects: nextDefects,
    };
    try {
      let list = [];
      const saved = getProducts([]);
      if (Array.isArray(saved)) list = saved;
      saveProducts(list.map((item) => String(item.id) === String(product.id) ? updatedProduct : item));
      window.dispatchEvent(new Event("crm-products-updated"));
      setProduct(updatedProduct);
      setIsEditOpen(false);
      success("Mahsulot tahrirlandi");
    } catch {
      error("Mahsulot saqlanmadi. Qayta urinib ko'ring.");
    }
  };
  const deleteProduct = () => {
    try {
      let list = [];
      const saved = getProducts([]);
      if (Array.isArray(saved)) list = saved;
      saveProducts(list.filter((item) => String(item.id) !== String(product.id)));
      setDeleteConfirmOpen(false);
      success("Mahsulot o'chirildi");
      onBack?.();
    } catch {
      error("Mahsulot o'chirilmadi. Qayta urinib ko'ring.");
    }
  };
  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="pd-product-detail-header">
        <div className="pd-product-detail-title">
        <button
          type="button"
          onClick={onBack}
          className="app-back-button"
          aria-label={tx("Oldingi sahifaga qaytish")}
          style={{ marginBottom: 12 }}
        >
          <ArrowLeft size={16} aria-hidden="true" style={{ flexShrink: 0 }} />{tx("Orqaga")}</button>
        <div>
          <h1
            className="font-display font-bold text-2xl"
            style={{
              fontFamily: "'Manrope',sans-serif",
              color: "var(--text-primary)",
            }}
          >
            {product.name}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={{
                background: st.bg,
                color: st.color,
                cursor:"Pointer",
              }}
            >
              {tx(st.label)}
            </span>
          </div>
        </div>
        </div>
        <button type="button" className="pd-product-return-button" onClick={startProductReturn}>
          <RotateCcw size={16} />{tx("Tovarni qaytarish")}
        </button>
      </div>

      {/* Top section */}
      <div
        className="grid gap-5 pd-detail-layout"
        style={{
          gridTemplateColumns: "1fr 2fr",
        }}
      >
        {/* Product card */}
        <div className="card p-6 flex flex-col items-center text-center pd-product-main-card">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--brand-light)", color: "var(--brand)" }}>
            <Package size={30} strokeWidth={1.8} aria-label={tx("Mahsulot")}/>
          </div>
          <div
            className="font-display font-bold text-lg mb-1"
            style={{
              fontFamily: "'Manrope',sans-serif",
              color: "var(--text-primary)",
            }}
          >
            {product.name}
          </div>
          <div
            className="text-sm mb-1"
            style={{
              color: "var(--text-muted)",
            }}
          >
            {product.brand} · {tx(product.category)}
          </div>

          <div className="w-full mt-5 space-y-3">
            <div
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: "var(--brand-light)",
              }}
            >
              <span
                className="text-sm"
                style={{
                  color: "var(--brand)",
                }}
              >
                {tx(t("productDetail.sellPrice", "Sotuv narxi"))}
              </span>
              <span
                className="font-display font-bold text-base"
                style={{
                  fontFamily: "'Manrope',sans-serif",
                  color: "var(--brand)",
                }}
              >
                {formatCurrency(product.price)}
              </span>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: "var(--surface-2)",
              }}
            >
              <span
                className="text-sm"
                style={{
                  color: "var(--text-muted)",
                }}
              >
                {tx(t("productDetail.costPrice", "Tan narxi"))}
              </span>
              <span
                className="font-semibold text-sm"
                style={{
                  color: "var(--text-secondary)",
                }}
              >
                {formatCurrency(product.cost)}
              </span>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: "var(--danger-light)",
              }}
            >
              <span className="text-sm" style={{ color: "var(--danger)" }}>
                {tx("Brak sotuv narxi")}
              </span>
              <span className="font-semibold text-sm" style={{ color: "var(--danger)" }}>
                {defectSellPrice > 0 || defectiveStock > 0 ? formatCurrency(defectSellPrice) : "—"}
              </span>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: "var(--danger-light)",
              }}
            >
              <span className="text-sm" style={{ color: "var(--danger)" }}>
                {tx("Brak tan narxi")}
              </span>
              <span className="font-semibold text-sm" style={{ color: "var(--danger)" }}>
                {defectCostPrice > 0 || defectiveStock > 0 ? formatCurrency(defectCostPrice) : "—"}
              </span>
            </div>
            <div
              className="flex items-center justify-between p-3 rounded-xl"
              style={{
                background: unitProfit < 0 ? "var(--danger-light)" : profitPercent === null ? "var(--surface-2)" : "var(--success-light)",
              }}
            >
              <span
                className="text-sm"
                style={{
                  color: profitColor,
                }}
              >
                {tx("Foyda foizi")}
              </span>
              <span
                className="font-bold text-sm"
                style={{
                  color: profitColor,
                }}
              >
                {profitPercentLabel}
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={openEdit} className="btn-ghost flex-1 justify-center cursor-pointer" title={tx("Tahrirlash")}>
                <Edit2 size={15} />{tx("Tahrirlash")}
              </button>
              <button type="button" onClick={() => setDeleteConfirmOpen(true)} className="flex flex-1 items-center justify-center gap-2 cursor-pointer" title={tx("O'chirish")} style={{ minHeight: 42, border: "1px solid var(--danger-border)", borderRadius: 12, background: "var(--danger-light)", color: "var(--danger)", fontWeight: 600 }}>
                <Trash2 size={15} />{tx("O'chirish")}
              </button>
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4 content-start pd-product-kpis">
          {[
            {
              icon: ShoppingCart,
              label: "Bugun sotilgan",
              value: `${soldToday} ${t("productDetail.kpi.unit", "dona")}`,
              color: "var(--brand)",
              bg: "var(--brand-light)",
            },
            {
              icon: ShoppingCart,
              label: "Jami sotilgan",
              value: `${soldTotal} ${t("productDetail.kpi.unit", "dona")}`,
              color: "var(--success)",
              bg: "var(--success-light)",
            },
            {
              icon: Package,
              label: "Yaroqlilar",
              value: `${usableStock} ${product.measurementUnit || (product.measurementType === "weight" ? "kg" : t("productDetail.kpi.unit", "dona"))}`,
              color: usableStock < 10 ? "var(--danger)" : "var(--violet)",
              bg:
                usableStock < 10
                  ? "var(--danger-light)"
                  : "var(--violet-light)",
            },
            {
              icon: Package,
              label: "Braklar",
              value: `${defectiveStock} ${product.measurementUnit || (product.measurementType === "weight" ? "kg" : t("productDetail.kpi.unit", "dona"))}`,
              color: "var(--danger)",
              bg: "var(--danger-light)",
              isDefectCount: true,
            },
            {
              icon: Package,
              label: "Umumiy soni",
              value: `${totalStock} ${product.measurementUnit || (product.measurementType === "weight" ? "kg" : t("productDetail.kpi.unit", "dona"))}`,
              color: "var(--brand)",
              bg: "var(--brand-light)",
              fullWidth: true,
            },
          ].map((k) => (
            <div key={k.label} className={`card p-4${k.fullWidth ? " col-span-2" : ""}${animateDefectCount && k.isDefectCount ? " pd-defect-count-pulse" : ""}`}>
              <div
                className="p-2.5 rounded-xl w-fit mb-3"
                style={{
                  background: k.bg,
                }}
              >
                <k.icon
                  size={16}
                  style={{
                    color: k.color,
                  }}
                />
              </div>
              <div
                className="text-xl font-display font-bold count-up mb-0.5"
                style={{
                  fontFamily: "'Manrope',sans-serif",
                  color: "var(--text-primary)",
                }}
              >
                {tx(k.value)}
              </div>
              <div
                className="text-xs"
                style={{
                  color: "var(--text-faint)",
                }}
              >
                {tx(k.label)}
              </div>
            </div>
          ))}

          {/* Mini sparkline */}
          <div className="col-span-2 card p-4 pd-sales-trend">
            <div className="flex items-center justify-between mb-3">
              <span
                className="text-sm font-semibold"
                style={{
                  color: "var(--text-primary)",
                }}
              >
                {tx(t("productDetail.salesTrend", "Oylik sotuv dinamikasi"))}
              </span>
              <span
                className="text-xs font-semibold"
                style={{
                  color: "var(--success)",
                }}
              >
                {salesChange}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart
                data={monthlySales}
                margin={{
                  top: 0,
                  right: 0,
                  bottom: 0,
                  left: 0,
                }}
              >
                <defs>
                  <linearGradient id="sparkg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="var(--brand)"
                  fill="url(#sparkg)"
                  strokeWidth={2}
                  dot={false}
                />
                <XAxis tickFormatter={(value) => tx(value)}
                  dataKey="d"
                  tick={{
                    fontSize: 10,
                    fill: "var(--text-faint)",
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    fontSize: 11,
                    color: "var(--text-primary)",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card-flat rounded-2xl overflow-hidden">
        <div
          className="flex items-center gap-1 px-5 py-3"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
              style={{
                background:
                  tab === tb.key ? "var(--brand-light)" : "transparent",
                color: tab === tb.key ? "var(--brand)" : "var(--text-muted)",
                fontWeight: tab === tb.key ? 600 : 400,
              }}
            >
              {tx(tb.label)}
            </button>
          ))}
        </div>

        <div className="p-5 fade-in">
          {tab === "overview" && (
            <div className="grid grid-cols-2 gap-5">
              <div className="space-y-3">
                <h3
                  className="font-semibold text-sm"
                  style={{
                    color: "var(--text-primary)",
                  }}
                >
                  {tx(t("productDetail.info.title", "Mahsulot ma'lumotlari"))}
                </h3>
                {[
                  {
                    label: t("productDetail.info.name", "Nomi"),
                    value: product.name, preserveText: true,
                  },
                  {
                    label: "Ta'minotchi",
                    value: product.supplierName || "Ko'rsatilmagan", preserveText: Boolean(product.supplierName),
                  },
                  {
                    label: t("productDetail.info.sku", "SKU"),
                    value: product.sku,
                  },
                  {
                    label: t("productDetail.info.category", "Kategoriya"),
                    value: product.category,
                  },
                  {
                    label: t("productDetail.info.brand", "Brend"),
                    value: product.brand, preserveText: true,
                  },
                  {
                    label: t("productDetail.info.status", "Holat"),
                    value: st.label,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-start justify-between py-2"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span
                      className="text-sm"
                      style={{
                        color: "var(--text-muted)",
                      }}
                    >
                      {tx(row.label)}
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: "var(--text-primary)",
                      }}
                    >
                      {row.preserveText ? row.value : tx(row.value)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-3">
                <h3
                  className="font-semibold text-sm"
                  style={{
                    color: "var(--text-primary)",
                  }}
                >
                  {tx(t("productDetail.price.title", "Narx ma'lumotlari"))}
                </h3>
                {[
                  {
                    label: t("productDetail.sellPrice", "Sotuv narxi"),
                    value: formatCurrency(product.price),
                  },
                  {
                    label: t("productDetail.costPrice", "Tan narxi"),
                    value: formatCurrency(product.cost),
                  },
                  {
                    label: t("productDetail.price.profit", "Foyda"),
                    value: formatCurrency(product.price - product.cost),
                  },
                  {
                    label: t("productDetail.price.margin", "Marja"),
                    value: `${margin}%`,
                  },
                  {
                    label: t("productDetail.price.vat", "QQS"),
                    value: vatRate ? `${vatRate}%` : "Belgilanmagan",
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-start justify-between py-2"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span
                      className="text-sm"
                      style={{
                        color: "var(--text-muted)",
                      }}
                    >
                      {tx(row.label)}
                    </span>
                    <span
                      className="text-sm font-medium"
                      style={{
                        color: "var(--text-primary)",
                      }}
                    >
                      {row.preserveText ? row.value : tx(row.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "inventory" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 pd-inventory-stats">
                {[
                  {
                    label: t("productDetail.inv.current", "Joriy qoldiq"),
                    value: product.stock,
                    icon: Package,
                    color: "var(--brand)",
                  },
                  {
                    label: t("productDetail.inv.min", "Min. qoldiq"),
                    value: minimumStock,
                    icon: ArrowDownCircle,
                    color: "var(--warning)",
                  },
                  {
                    label: t("productDetail.inv.inThisMonth", "Bu oy kirim"),
                    value: receivedThisMonth,
                    icon: ArrowUpCircle,
                    color: "var(--success)",
                  },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="p-4 rounded-2xl"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div
                      className="text-2xl font-display font-bold mb-1"
                      style={{
                        fontFamily: "'Manrope',sans-serif",
                        color: s.color,
                      }}
                    >
                      {tx(s.value)}
                    </div>
                    <div
                      className="text-xs"
                      style={{
                        color: "var(--text-muted)",
                      }}
                    >
                      {tx(s.label)}
                    </div>
                  </div>
                ))}
              </div>
              <div
                className="p-4 rounded-2xl"
                style={{
                  background: "var(--surface-2)",
                }}
              >
                <h4
                  className="text-sm font-semibold mb-3"
                  style={{
                    color: "var(--text-primary)",
                  }}
                >
                  {tx(t("productDetail.inv.recentActivity", "So'nggi harakatlar"))}
                </h4>
                {movements.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2"
                    style={{
                      borderBottom:
                        i < movements.length - 1 ? "1px solid var(--border-subtle)" : "none",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {m.type === "in" ? (
                        <ArrowUpCircle
                          size={14}
                          style={{
                            color: "var(--success)",
                          }}
                        />
                      ) : (
                        <ArrowDownCircle
                          size={14}
                          style={{
                            color: "var(--danger)",
                          }}
                        />
                      )}
                      <span
                        className="text-sm"
                        style={{
                          color: "var(--text-secondary)",
                        }}
                      >
                        {tx(m.reason)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className="text-xs"
                        style={{
                          color: "var(--text-faint)",
                        }}
                      >
                        {m.date?.toLocaleDateString("uz-UZ", { day: "2-digit", month: "short", year: "numeric" })}
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{
                          color:
                            m.type === "in"
                              ? "var(--success)"
                              : "var(--danger)",
                        }}
                      >
                        {tx(m.type === "in" ? "+" : "-")}
                        {m.qty} {tx(product.measurementUnit || (product.measurementType === "weight" ? "kg" : "dona"))}
                      </span>
                    </div>
                  </div>
                ))}{!movements.length && <p className="py-4 text-sm text-center" style={{ color: "var(--text-muted)" }}>{tx("Harakatlar hali mavjud emas")}</p>}
              </div>
            </div>
          )}

          {tab === "pricing" && <div className="grid md:grid-cols-2 gap-4">{[["Sotuv narxi", money(product.price)], ["Tan narxi", money(product.cost)], ["Har birlik foyda", money(Number(product.price || 0) - Number(product.cost || 0))], ["Marja", `${margin}%`], ["QQS", vatRate ? `${vatRate}%` : "Belgilanmagan"], ["Oxirgi kirim tannarxi", money(productReceipts.find((item) => item.qty > 0)?.receipt?.products?.find((item) => String(item.id) === String(product.id))?.cost ?? product.cost)]].map(([label, value]) => <div key={label} className="flex justify-between gap-4 p-4 rounded-xl" style={{ background: "var(--surface-2)" }}><span className="text-sm" style={{ color: "var(--text-muted)" }}>{tx(label)}</span><b className="text-sm">{value}</b></div>)}</div>}

          {tab === "sales" && <div className="space-y-4"><div className="grid grid-cols-3 gap-3 pd-sales-stats">{[["Bugun sotilgan", soldToday], ["Jami sotilgan", soldTotal], ["Jami daromad", money(productSales.reduce((sum, item) => sum + item.amount, 0))]].map(([label, value]) => <div key={label} className="p-4 rounded-xl" style={{ background: "var(--surface-2)" }}><small style={{ color: "var(--text-muted)" }}>{tx(label)}</small><b className="block mt-1 text-lg">{typeof value === "number" ? `${value} ${tx("dona")}` : value}</b></div>)}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr style={{ background: "var(--surface-2)" }}>{["Sana", "Mijoz", "Miqdor", "Summa", "To'lov"].map((label) => <th className="text-left p-3 text-xs" key={label}>{tx(label)}</th>)}</tr></thead><tbody>{productSales.filter((item) => item.qty > 0).sort((left, right) => (right.date?.getTime() || 0) - (left.date?.getTime() || 0)).map(({ sale, date, qty, amount }) => <tr key={sale.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}><td className="p-3">{dateLabel(date)}</td><td className="p-3">{sale.customer || sale.customerName || "—"}</td><td className="p-3">{qty} {tx("dona")}</td><td className="p-3">{money(amount)}</td><td className="p-3">{tx(sale.payment || sale.paymentMethod || "—")}</td></tr>)}</tbody></table></div>{!productSales.some((item) => item.qty > 0) && <EmptyData icon={BarChart3} text="Bu mahsulot hali sotilmagan"/>}</div>}

          {tab === "history" && <div className="space-y-2">{historyEvents.map((event, index) => <div key={`${event.type}-${event.date?.getTime()}-${index}`} className="flex justify-between items-center gap-4 p-4 rounded-xl" style={{ background: "var(--surface-2)" }}><div className="flex items-center gap-3">{event.type === "in" ? <ArrowUpCircle size={18} style={{ color: "var(--success)" }}/> : <ArrowDownCircle size={18} style={{ color: "var(--danger)" }}/>}<div><b className="text-sm">{tx(event.reason)}</b><small className="block mt-1" style={{ color: "var(--text-muted)" }}>{dateLabel(event.date)}</small></div></div><b style={{ color: event.type === "in" ? "var(--success)" : "var(--danger)" }}>{event.type === "in" ? "+" : "−"}{event.qty}{tx("dona")}</b></div>)}{!historyEvents.length && <EmptyData icon={Package} text="Bu mahsulot bo'yicha harakatlar hali mavjud emas"/>}</div>}
        </div>
      </div>
      <Modal contentOnly open={isEditOpen} onClose={() => setIsEditOpen(false)} title={tx("Mahsulotni tahrirlash")} subtitle={tx("Mahsulot ma'lumotlarini yangilang")} icon={Package}>
        <div style={{ display: "grid", gap: 14 }}>
          <Field label={tx("Mahsulot nomi")}><input className="input-base" value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tx("Brend")}><input className="input-base" value={editForm.brand || ""} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} /></Field>
            {(() => { const skuChanged = String(editForm.sku ?? "").trim().toLocaleLowerCase("uz-UZ") !== String(product?.sku ?? "").trim().toLocaleLowerCase("uz-UZ"); const skuTaken = skuChanged && findSkuOwner(getProducts([]), { sku: editForm.sku, name: editForm.name, brand: editForm.brand, excludeId: product?.id }); return <Field label={tx("SKU kodi")}><input className="input-base" value={editForm.sku || ""} aria-invalid={Boolean(skuTaken)} style={skuTaken ? { borderColor: "var(--danger)", background: "var(--danger-light)", color: "var(--danger)" } : undefined} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />{skuTaken && <small style={{ display: "block", marginTop: 6, color: "var(--danger)", fontSize: 12 }}>{tx(skuTakenMessage(String(editForm.sku).trim(), skuTaken))}</small>}</Field>; })()}
            <Field label={tx("Kategoriya")}><input className="input-base" value={editForm.category || ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} /></Field>
            <Field label={tx("Qoldiq")}><input type="number" min="0" className="input-base" value={editForm.stock ?? ""} onChange={(e) => setEditForm({ ...editForm, stock: e.target.value })} /></Field>
            <Field label={tx("Sotuv narxi")}><div className="relative"><input placeholder="0" type="text" inputMode="decimal" className="input-base pr-16" value={moneyInputValue(editForm.price, true)} onChange={(e) => setEditForm({ ...editForm, price: String(toBaseMoney(e.target.value)) })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-muted)" }}>{currencyLabel()}</span></div></Field>
            <Field label={tx("Tan narxi")}><div className="relative"><input placeholder="0" type="text" inputMode="decimal" className="input-base pr-16" value={moneyInputValue(editForm.cost, true)} onChange={(e) => setEditForm({ ...editForm, cost: String(toBaseMoney(e.target.value)) })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-muted)" }}>{currencyLabel()}</span></div></Field>
          </div>
          <section className="rounded-xl p-4 product-edit-defect-management" style={{ background: "var(--danger-light)", border: "1px solid var(--danger-border)" }}>
            <div className="mb-3"><b className="text-sm" style={{ color: "var(--danger)" }}>{tx("Braklarni boshqarish")}</b><p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{tx("Qo'shish miqdori joriy brak soniga qo'shiladi. Yangi kirim bo'lsa ombor qoldig'i ham ortadi.")}</p></div>
            <div className="mb-3 rounded-lg px-3 py-2 text-sm" style={{ background: "color-mix(in srgb, var(--danger) 7%, transparent)", color: "var(--text-secondary)" }}>
              {tx("Hozirgi brak miqdori")}: <b style={{ color: "var(--danger)" }}>{defectiveStock} {tx(product.measurementUnit || (product.measurementType === "weight" ? "kg" : "dona"))}</b>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3 product-edit-defect-actions" role="group" aria-label={tx("Brak amali")}>
              {[{ value: "add", label: "Brak qo'shish" }, { value: "reduce", label: "Brakni kamaytirish" }].map((action) => (
                <button key={action.value} type="button" aria-pressed={(editForm.defectAction || "add") === action.value} onClick={() => setEditForm({ ...editForm, defectAction: action.value })} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ border: `1px solid ${(editForm.defectAction || "add") === action.value ? "var(--danger)" : "var(--border)"}`, background: (editForm.defectAction || "add") === action.value ? "var(--surface)" : "transparent", color: (editForm.defectAction || "add") === action.value ? "var(--danger)" : "var(--text-muted)" }}>{tx(action.label)}</button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={tx(editForm.defectAction === "reduce" ? "Kamaytiriladigan brak miqdori" : "Qo'shiladigan brak miqdori")}><input type="number" min="0" step="any" className="input-base" value={editForm.defectiveStock ?? ""} onChange={(e) => setEditForm({ ...editForm, defectiveStock: e.target.value })} /></Field>
              {editForm.defectAction !== "reduce" && <label className="flex items-center gap-2 self-end rounded-lg px-3 py-3 text-xs" style={{ background: "var(--surface)", color: "var(--text-secondary)" }}><input type="checkbox" checked={editForm.addDefectToStock !== false} onChange={(e) => setEditForm({ ...editForm, addDefectToStock: e.target.checked })} />{tx("Yangi brak miqdorini ombor qoldig'iga qo'shish")}</label>}
              {editForm.defectAction !== "reduce" && <>
                <Field label={tx("Brak tan narxi")}><div className="relative"><input placeholder="0" type="text" inputMode="decimal" className="input-base pr-16" value={moneyInputValue(editForm.defectUnitPrice, true)} onChange={(e) => setEditForm({ ...editForm, defectUnitPrice: e.target.value === "" ? "" : String(toBaseMoney(e.target.value)) })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-muted)" }}>{currencyLabel()}</span></div></Field>
                <Field label={tx("Brak sotuv narxi")}><div className="relative"><input placeholder="0" type="text" inputMode="decimal" className="input-base pr-16" value={moneyInputValue(editForm.defectSalePrice, true)} onChange={(e) => setEditForm({ ...editForm, defectSalePrice: e.target.value === "" ? "" : String(toBaseMoney(e.target.value)) })} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--text-muted)" }}>{currencyLabel()}</span></div></Field>
              </>}
            </div>
            <p className="mt-3 text-xs" style={{ color: "var(--text-secondary)" }}>{tx("Saqlangandan keyin")}: {tx("Braklar")} <b>{plannedDefectTotal}</b> · {tx("Ombordagi qoldiq")} <b>{plannedStockTotal}</b></p>
          </section>
          <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-ghost cursor-pointer" onClick={() => setIsEditOpen(false)}>{tx("Bekor qilish")}</button><button type="button" className="btn-primary cursor-pointer" onClick={saveEdit}><Edit2 size={15} />{tx("Saqlash")}</button></div>
        </div>
      </Modal>
      <Modal contentOnly open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="O'chirishni tasdiqlang" icon={Trash2} width={440}>
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{tx("Haqiqatan ham ushbu mahsulotni o'chirmoqchimisiz?")}</p>
          <div className="rounded-xl px-4 py-3 font-semibold text-sm" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>{product.name}</div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setDeleteConfirmOpen(false)}>{tx("Yo'q")}</button>
            <button type="button" className="btn-primary" style={{ background: "var(--danger)" }} onClick={deleteProduct}><Trash2 size={15}/>{tx("Ha, o'chirish")}</button>
          </div>
        </div>
      </Modal>
      <SupplierReturnForm draft={returnDraft} setDraft={setReturnDraft} confirming={returnConfirming} setConfirming={setReturnConfirming} close={() => { setReturnDraft(null); setReturnConfirming(false); }} confirm={confirmProductReturn} />
      <SupplierReturnPrompt record={returnReceipt} close={() => setReturnReceipt(null)} />
    </div>
  );
}
