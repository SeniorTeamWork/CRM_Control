import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search, ShoppingCart } from "lucide-react";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";
import SalesProductFilter from "../components/SalesProductFilter";
import Modal from "../components/Modal";
import { SupplierReturnForm, SupplierReturnPrompt } from "../components/SupplierReturns";
import { calculateReturn, returnLimits, reduceReturnStock, supplierOutstanding, allocateReturnDebt } from "../data/supplierReturns";
import { reservedQuantitiesByCondition } from "../data/ordersStore";
import { formatCurrency } from "../data/currency";
import { normalizeProductText, saleMatchesProduct } from "../data/salesProductFilter";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { translateText as tx } from "../locales/translateText";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { getData, setData } from "../supabase/db";
import { useToast } from "../context/ToastContext";
import "./Returns.css";

const readList = (key) => {
  try {
    const value = getData(key, []);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const readProducts = () => {
  try {
    const products = getProducts();
    return Array.isArray(products) ? products : [];
  } catch {
    return [];
  }
};

export default function DefectiveProducts({ onSellDefect }) {
  useUILanguage();
  const [products, setProducts] = useState(readProducts);
  const [returnPickerOpen, setReturnPickerOpen] = useState(false);
  const [returnDraft, setReturnDraft] = useState(null);
  const [returnConfirming, setReturnConfirming] = useState(false);
  const [returnReceipt, setReturnReceipt] = useState(null);
  const returnSaving = useRef(false);
  const { success, error } = useToast();
  const [categoryFilter, setCategoryFilter] = useState({ category: "", product: null, query: "" });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const refresh = () => setProducts(readProducts());
    window.addEventListener("crm-products-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("crm-products-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const defectiveItems = useMemo(() => products.flatMap((product) => {
    const defects = Array.isArray(product.defects) ? product.defects : [];
    const recordedQuantity = defects.reduce((sum, defect) => sum + Math.max(0, Number(defect.quantity) || 0), 0);
    const unrecordedQuantity = Math.max(0, Number(product.defectiveStock || 0) - recordedQuantity);
    const rows = defects.map((defect, index) => ({
      id: defect.id || `${product.id}-defect-${index}`,
      productId: product.id,
      product: defect.product || product.name,
      category: defect.category || product.category || "—",
      quantity: Number(defect.quantity) || 0,
      reason: defect.reason || "Sabab ko'rsatilmagan",
      status: defect.status || "Brak",
      measurementUnit: defect.measurementUnit || product.measurementUnit || (product.measurementType === "weight" ? "kg" : "dona"),
      unitPrice: Number(defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0),
      salePrice: Number(defect.salePrice ?? defect.sellingPrice ?? defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0),
      total: Number(defect.total) || Number(defect.unitPrice ?? defect.price ?? product.price ?? product.cost ?? 0) * (Number(defect.quantity) || 0),
      date: defect.date || product.createdAt || "",
    }));
    if (unrecordedQuantity > 0) rows.push({
      id: `${product.id}-defect-unrecorded`,
      productId: product.id,
      product: product.name,
      category: product.category || "—",
      quantity: unrecordedQuantity,
      reason: "Sabab ko'rsatilmagan",
      status: "Brak",
      measurementUnit: product.measurementUnit || (product.measurementType === "weight" ? "kg" : "dona"),
      unitPrice: Number(product.price ?? product.cost ?? 0),
      salePrice: Number(product.defectPrice ?? product.price ?? product.cost ?? 0),
      total: unrecordedQuantity * Number(product.price ?? product.cost ?? 0),
      date: product.createdAt || "",
    });
    return rows;
  }).filter((row) => row.quantity > 0), [products]);
  const query = normalizeProductText(search);
  const filtered = defectiveItems.filter((item) => {
    const values = [item.productId, item.id, item.product, item.category, item.reason];
    const matchesText = values.some((value) => normalizeProductText(value).includes(query));
    const date = new Date(item.date || "");
    const day = Number.isNaN(date.getTime()) ? String(item.date || "").slice(0, 10) : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return (matchesText || !query) && saleMatchesProduct({ items: [{ id: item.productId, name: item.product, category: item.category }] }, products, categoryFilter) && matchesDateRange(day, dateFrom, dateTo);
  });

  const now = new Date();
  const today = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const thisMonth = today.slice(0, 7);
  const monthlyQuantity = defectiveItems.filter((item) => String(item.date || "").slice(0, 7) === thisMonth).reduce((sum, item) => sum + item.quantity, 0);
  const totalQuantity = defectiveItems.reduce((sum, item) => sum + item.quantity, 0);
  const todayQuantity = defectiveItems.filter((item) => {
    const date = new Date(item.date || "");
    const normalized = Number.isNaN(date.getTime()) ? String(item.date || "").slice(0, 10) : [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return normalized === today;
  }).reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = defectiveItems.reduce((sum, item) => sum + item.total, 0);
  const returnProducts = useMemo(() => {
    const grouped = new Map();
    defectiveItems.forEach((item) => {
      const key = String(item.productId);
      const current = grouped.get(key) || { id: item.productId, name: item.product, quantity: 0, unit: item.measurementUnit || "dona" };
      current.quantity += Number(item.quantity) || 0;
      grouped.set(key, current);
    });
    return [...grouped.values()];
  }, [defectiveItems]);

  const startProductReturn = (productId) => {
    const product = products.find((item) => String(item.id) === String(productId));
    if (!product) {
      error("Mahsulot topilmadi", "Qaytariladigan mahsulotni qayta tanlang.");
      return;
    }
    const receipts = readList("crm_supplier_receipts");
    const matchingReceipt = receipts
      .filter((receipt) => (receipt.products || []).some((line) => String(line.id) === String(product.id)))
      .sort((left, right) => (new Date(right.date).getTime() || 0) - (new Date(left.date).getTime() || 0))[0];
    const supplierId = product.supplierId ?? matchingReceipt?.supplierId;
    const supplier = readList("crm_suppliers").find((item) => String(item.id) === String(supplierId)) || null;
    if (!supplier || supplierId == null) {
      error("Ta’minotchi topilmadi", "Mahsulot uchun ta’minotchi ma’lumotini tekshiring.");
      return;
    }
    const orders = readList(`crm_supplier_orders_${supplierId}`);
    const matchingOrder = (matchingReceipt?.orderId != null
      ? orders.find((order) => String(order.id) === String(matchingReceipt.orderId))
      : null) || [...orders]
      .sort((left, right) => (new Date(right.date).getTime() || 0) - (new Date(left.date).getTime() || 0))
      .find((order) => (order.productDetails || order.products || []).some((line) => String(line.id) === String(product.id)));
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
    const id = String(product.id);
    const limits = returnLimits(line, product, currentReturns, matchingOrder.id, {
      good: reserved.good[id] || 0,
      defective: reserved.defective[id] || 0,
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
    setReturnPickerOpen(false);
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

  return (
    <div className="space-y-4 fade-in defective-products-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display font-bold text-2xl text-primary-color">{tx("Brak mahsulotlar")}</h1>
          <p className="text-sm mt-0.5 text-muted-color">{tx("Brak deb belgilangan tovarlar va qaydlar")}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setReturnPickerOpen(true)} disabled={returnProducts.length === 0} style={{ color: "var(--danger)", borderColor: "var(--danger-border)" }}>
          <RotateCcw size={15} />{tx("Tovarni qaytarish")}
        </button>
      </div>

      <div className="returns-stats grid grid-cols-4 gap-3">
        {[
          { label: "Shu oydagi brak mahsulotlar", value: monthlyQuantity, color: "var(--brand)" },
          { label: "Jami brak mahsulotlar", value: totalQuantity, color: "var(--success)" },
          { label: "Bugungi brak mahsulotlar", value: todayQuantity, color: "var(--warning)" },
          { label: "Umumiy brak summasi", value: formatCurrency(totalValue), color: "var(--danger)" },
        ].map((stat) => (
          <div key={stat.label} className="returns-stat-card card p-4">
            <div className="returns-stat-value text-xl font-display font-bold mb-1" style={{ color: stat.color }}>{tx(stat.value)}</div>
            <div className="returns-stat-label text-xs text-faint-color">{tx(stat.label)}</div>
          </div>
        ))}
      </div>

      <div className="returns-table-card card-flat rounded-2xl">
        <div className="returns-filter-toolbar px-4 py-3 border-b-subtle">
          <div className="search-box-wrapper flex items-center gap-2 rounded-xl px-3 py-2.5 flex-1">
            <Search size={14} className="text-faint-color" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label={tx("Brak mahsulotlarni qidirish")}
              placeholder={tx("Mahsulot, kategoriya yoki ID...")}
              className="bg-transparent outline-none text-sm flex-1 text-primary-color"
            />
          </div>
          <SalesProductFilter products={products} value={categoryFilter} onChange={setCategoryFilter} />
          <div className="returns-date-filter"><DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} /></div>
        </div>

        <div className="returns-table-scroll" role="region" aria-label={tx("Brak mahsulotlar jadvali")} tabIndex="0">
          <table className="returns-table defective-products-table w-full">
            <thead>
              <tr className="table-header-row">
                {["ID", "Mahsulot", "Kategoriya", "Miqdor", "Sabab", "Summa", "Sana", "Holat", "Amal"].map((heading) => (
                  <th key={heading} className="text-left px-5 py-3 text-xs font-semibold text-faint-color">{tx(heading)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-color">{tx("Brak mahsulotlar topilmadi")}</td></tr> : filtered.map((item) => (
                <tr key={item.id} className="border-t border-subtle">
                  <td className="px-3 py-2.5 text-xs text-muted-color">{item.productId ?? "—"}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-primary-color">{tx(item.product)}</td>
                  <td className="px-3 py-2.5 text-sm text-secondary-color">{tx(item.category)}</td>
                  <td className="px-3 py-2.5 text-sm font-semibold text-primary-color">{tx(item.quantity)}{tx(item.measurementUnit || products.find((product) => String(product.id) === String(item.productId))?.measurementUnit || (products.find((product) => String(product.id) === String(item.productId))?.measurementType === "weight" ? " kg" : " dona"))}</td>
                  <td className="px-3 py-2.5 text-sm text-secondary-color"><span>{tx(item.reason)}</span><span className="block text-xs text-faint-color">{tx(item.status)}</span></td>
                  <td className="px-3 py-2.5 text-sm font-medium text-primary-color">{formatCurrency(item.total)}</td>
                  <td className="px-3 py-2.5 text-sm text-secondary-color">{item.date ? new Date(item.date).toLocaleDateString("uz-UZ") : "—"}</td>
                  <td className="px-3 py-2.5"><span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: "var(--danger)", background: "color-mix(in srgb, var(--danger) 10%, transparent)" }}>{tx(item.status)}</span></td>
                  <td className="px-3 py-2.5"><button type="button" className="btn-primary defective-products-sell-button text-xs justify-center" onClick={() => onSellDefect?.({ ...item, defectId: String(item.id), defectPrice: item.salePrice })} disabled={!item.quantity || item.salePrice < 0}><ShoppingCart size={14} />{tx("Sotish")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Modal contentOnly open={returnPickerOpen} onClose={() => setReturnPickerOpen(false)} title="Qaytariladigan mahsulotni tanlang" subtitle="Ta’minotchiga qaytariladigan brak mahsulotni tanlang" icon={RotateCcw} width={520}>
        <div className="space-y-2">
          {returnProducts.map((item) => (
            <button key={item.id} type="button" className="card flex w-full items-center justify-between gap-4 p-3 text-left" onClick={() => startProductReturn(item.id)}>
              <span><strong className="block text-sm text-primary-color">{tx(item.name)}</strong><small className="text-muted-color">{tx("Brak")}: {item.quantity.toLocaleString("uz-UZ")} {tx(item.unit)}</small></span>
              <RotateCcw size={16} style={{ color: "var(--brand)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </Modal>
      <SupplierReturnForm draft={returnDraft} setDraft={setReturnDraft} confirming={returnConfirming} setConfirming={setReturnConfirming} close={() => { setReturnDraft(null); setReturnConfirming(false); }} confirm={confirmProductReturn} />
      <SupplierReturnPrompt record={returnReceipt} close={() => setReturnReceipt(null)} />
    </div>
  );
}
