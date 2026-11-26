import { createPortal } from "react-dom";
import { PaymentSuccessAnimation } from "./PosPaymentPanel";
import checkSound from "../assets/check animation sound.m4a";
import "./POS.css";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import "./Suppliers.css";
import { useEffect, useRef, useState } from "react";
import {
  Search,
  Plus,
  Eye,
  Truck,
  Package,
  PackagePlus,
  UserPlus,
  DollarSign,
  AlertCircle,
  ChevronDown,
  RotateCcw,
} from "lucide-react";

import Modal, { Field } from "../components/Modal";
import PhoneInput from "../components/PhoneInput";
import { useToast } from "../context/ToastContext";
import DateRangeFilter, { matchesDateRange } from "../components/DateRangeFilter";
import SupplierReturnsLedger from "../components/SupplierReturns";
import { getData, setData, useData, useDataVersion } from "../supabase/db";
import { returnReceivable } from "../data/supplierReturns";
import { getProducts, saveProducts } from "../supabase/bolimlar/mahsulotlar";
import { getSupplierReceipts, getSuppliers, saveSupplierOrders, saveSupplierReceipts, saveSuppliers } from "../supabase/bolimlar/taminotchilar";

const statusMap = {
  active: {
    label: "Faol",
    bg: "var(--success-light)",
    color: "var(--success)",
  },
  inactive: {
    label: "Nofaol",
    bg: "var(--border-subtle)",
    color: "var(--text-muted)",
  },
};

const emptyProduct = {
  productName: "", description: "", brand: "", sku: "", category: "", packaging: "", extraMeasurement: "", extraMeasurementValue: "",
  receivedQuantity: "", defectiveQuantity: "", defectStatus: "", defectReason: "", defectUnitPrice: "", defectSalePrice: "", unitsPerPackage: "", liters: "", weight: "", volume: "",
  length: "", width: "", height: "", cost: "", price: "", measurementType: "count", measurementUnit: "dona",
};
const measurementUnits = ["dona", "metr", "santimetr", "millimetr", "kilometr", "kilogramm", "gramm", "milligramm", "litr", "millilitr", "quti", "karobka", "paket", "qop", "rulon", "juft", "to'plam"];
const normalizedUnit = (value) => String(value || "").trim().toLocaleLowerCase("uz-UZ");
const isMeterUnit = (value) => ["metr", "meter", "m"].includes(normalizedUnit(value));
const allowsDecimalUnit = (value) => ["metr", "meter", "m", "santimetr", "sm", "cm", "millimetr", "mm", "kilometr", "km", "kilogramm", "kg", "gramm", "g", "milligramm", "mg", "litr", "l", "millilitr", "ml"].includes(normalizedUnit(value));
const unitLabel = (item) => item?.measurementUnit || (item?.measurementType === "weight" ? "kg" : "dona");
const emptyShipmentInfo = { farmName: "", tripNumber: "" };
const SUPPLIER_RECEIPT_DRAFT_KEY = "crm_supplier_receipt_draft_v1";
const readSupplierReceiptDraft = () => {
  try { return JSON.parse(localStorage.getItem(SUPPLIER_RECEIPT_DRAFT_KEY) || "null") || {}; }
  catch { return {}; }
};
const createReceiptSupplierGroup = () => ({ key: `receipt-supplier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: "", phone: "", address: "", existingSupplierId: "", expanded: true });

const pickProduct = (source) => Object.fromEntries(
  [...Object.keys(emptyProduct), "existingId", "supplierId"].map((key) => [key, source[key]])
);
const hasDuplicateProducts = (drafts) => {
  const keys = drafts.map((item) => `${item.supplierId || ""}:${String(item.existingId || item.productName || "").trim().toLocaleLowerCase("uz-UZ")}`);
  return new Set(keys).size !== keys.length;
};
const readList = (key) => { try { const value = getData(key, []); return Array.isArray(value) ? value : []; } catch { return []; } };
const moneyValue = (value) => Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
const quantityInputValue = (value, allowDecimal) => {
  const normalized = String(value ?? "").replace(/,/g, ".").replace(allowDecimal ? /[^\d.]/g : /\D/g, "");
  if (!allowDecimal) return normalized.replace(/^0+(?=\d)/, "");
  const [whole, ...fractionParts] = normalized.split(".");
  const fraction = fractionParts.join("").replace(/\./g, "");
  const cleanWhole = whole.replace(/^0+(?=\d)/, "");
  return normalized.includes(".") ? `${cleanWhole || "0"}.${fraction}` : cleanWhole;
};
const moneyText = (value) => formatCurrency(value);
const defectQuantityOf = (product) => Math.max(0, Number(product.defectiveQuantity) || 0);
const defectTotalOf = (product) => defectQuantityOf(product) * moneyValue(product.defectUnitPrice);
const receiptLineAmount = (quantity, cost, defectiveQuantity, defectAmount) =>
  Math.max(0, quantity - defectiveQuantity) * moneyValue(cost) + defectAmount;
const draftLineAmount = (item) => receiptLineAmount(Number(item.receivedQuantity) || 0, item.cost, defectQuantityOf(item), defectTotalOf(item));
const savedLineAmount = (item) => receiptLineAmount(item.quantity, item.cost, item.defectiveQuantity, item.defectiveQuantity * moneyValue(item.defectUnitPrice));
const receivedProductAmount = (item) => receiptLineAmount(item.stock, item.cost, Number(item.defectiveStock) || 0, (item.defects || []).reduce((sum, defect) => sum + Number(defect.total || 0), 0));
const createDefectEntry = (draft, productId, supplier, receiptId, date) => {
  const quantity = defectQuantityOf(draft);
  if (!quantity) return null;
  const unitPrice = moneyValue(draft.defectUnitPrice);
  return {
    id: `${receiptId}-${productId}-defect`,
    productId,
    product: capitalizeStart(draft.productName.trim()),
    category: draft.category.trim() || "Boshqa",
    quantity,
    status: "Brak",
    reason: draft.defectReason.trim(),
    unitPrice,
    salePrice: moneyValue(draft.defectSalePrice),
    total: quantity * unitPrice,
    supplierId: supplier.id,
    supplier: supplier.name,
    receiptId,
    receivedQuantity: Math.max(0, Number(draft.receivedQuantity) || 0),
    measurementType: draft.measurementType || "count",
    measurementUnit: draft.measurementUnit || "dona",
    date,
  };
};

const capitalizeStart = (value = "") => value ? value[0].toLocaleUpperCase("uz-UZ") + value.slice(1) : "";
const fillFromSavedProduct = (current, product) => ({
  ...current,
  productName: capitalizeStart(product.name || ""),
  description: product.description || "",
  brand: capitalizeStart(product.brand || ""),
  sku: String(product.sku || "").toLocaleUpperCase("uz-UZ"),
  category: capitalizeStart(product.category || ""),
  packaging: capitalizeStart(product.packaging || ""),
  cost: String(product.cost ?? ""),
  price: String(product.price ?? ""),
  measurementType: product.measurementType || "count",
  measurementUnit: product.measurementUnit || (product.measurementType === "weight" ? "kg" : "dona"),
  extraMeasurement: product.extraMeasurement || "",
  extraMeasurementValue: String(product.extraMeasurementValue || ""),
  unitsPerPackage: String(product.unitsPerPackage || ""),
  liters: String(product.liters || ""),
  weight: String(product.weight || ""),
  volume: String(product.volume || ""),
  length: String(product.length || ""),
  width: String(product.width || ""),
  height: String(product.height || ""),
  defectiveQuantity: "",
  defectStatus: "",
  defectReason: "",
  defectUnitPrice: "",
  defectSalePrice: String(product.defectPrice ?? product.price ?? ""),
  existingId: product.id,
});

function ShipmentFields({ value, onChange, skipped, onEdit }) {
  if (skipped) return (
    <div className="supplier-shipment-skipped">
      <span>{tx("Yuk ma'lumotlari o'tkazib yuborildi")}</span>
      <button type="button" className="btn-ghost" onClick={onEdit}>{tx("Ma'lumot kiritish")}</button>
    </div>
  );
  const update = (key, next) => onChange((current) => ({ ...current, [key]: next }));
  return (
    <div className="supplier-shipment-card">
      <div className="supplier-shipment-title">{tx("Yuk ma'lumotlari (ixtiyoriy)")}</div>
      <div className="supplier-shipment-fields">
        <Field label={tx("Ferma / ta'minotchi nomi")}><input className="input-base" value={value.farmName} onChange={(event) => update("farmName", event.target.value)} placeholder={tx("Masalan: Samarqand fermasi")} /></Field>
        <Field label={tx("Reys raqami")}><input className="input-base" value={value.tripNumber} onChange={(event) => update("tripNumber", event.target.value)} placeholder={tx("Masalan: 12-reys")} /></Field>
      </div>
    </div>
  );
}

function MeasurementUnitInput({ value, disabled, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);
  const filteredUnits = measurementUnits.filter((unit) =>
    unit.toLocaleLowerCase("uz-UZ").includes(query.trim().toLocaleLowerCase("uz-UZ"))
  );
  const setUnit = (unit) => {
    const isWeight = ["kilogramm", "kg", "gramm", "g", "milligramm", "mg"].includes(normalizedUnit(unit));
    onChange((current) => ({
      ...current,
      measurementUnit: unit,
      measurementType: isWeight ? "weight" : "count",
      extraMeasurementValue: isMeterUnit(unit) ? current.extraMeasurementValue : "",
    }));
    setQuery("");
    setOpen(false);
  };

  return (
    <div
      className={`supplier-unit-input${open ? " is-open" : ""}`}
      ref={wrapperRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input
        className="input-base"
        value={value || "dona"}
        disabled={disabled}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(event) => {
          const unit = event.target.value;
          setQuery(unit);
          setOpen(true);
          const isWeight = ["kilogramm", "kg", "gramm", "g", "milligramm", "mg"].includes(normalizedUnit(unit));
          onChange((current) => ({
            ...current,
            measurementUnit: unit,
            measurementType: isWeight ? "weight" : "count",
            extraMeasurementValue: isMeterUnit(unit) ? current.extraMeasurementValue : "",
          }));
        }}
        placeholder={tx("Birlikni tanlang yoki yozing")}
        autoComplete="off"
        aria-label={tx("O'lchov birligi *")}
        role="combobox"
        aria-controls="supplier-measurement-unit-options"
        aria-expanded={open}
        aria-haspopup="listbox"
        required
      />
      {!disabled && <button
        type="button"
        className="supplier-unit-toggle"
        aria-label={tx("O'lchov birliklarini ko'rsatish")}
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { setQuery(""); setOpen((current) => !current); }}
      ><ChevronDown size={16} /></button>}
      {!disabled && open && <div id="supplier-measurement-unit-options" className="supplier-learned-options supplier-unit-options" role="listbox" aria-label={tx("O'lchov birliklari")}>
        {filteredUnits.length ? filteredUnits.map((unit) => <button
          type="button"
          role="option"
          aria-selected={normalizedUnit(unit) === normalizedUnit(value)}
          key={unit}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setUnit(unit)}
        >{unit}</button>) : <div className="supplier-unit-empty">{tx("Yangi birlik sifatida yoziladi")}</div>}
      </div>}
    </div>
  );
}

function ReceiptProductFields({ value, onChange, suggestions = [], onChooseProduct, disabled = false }) {
  const update = (key, nextValue) => onChange((current) => ({ ...current, [key]: nextValue }));
  const changeName = (rawValue) => onChange((current) => current.existingId
    ? { ...current, ...emptyProduct, supplierId: current.supplierId, productName: capitalizeStart(rawValue), existingId: null }
    : { ...current, productName: capitalizeStart(rawValue) });
  const nameMatches = value.productName.trim()
    ? suggestions.filter((product) => String(product.name || "").toLocaleLowerCase("uz-UZ").startsWith(value.productName.trim().toLocaleLowerCase("uz-UZ"))).slice(0, 6)
    : [];
  const skuMatches = value.sku.trim()
    ? suggestions.filter((product) => [product.sku, product.id].some((code) => String(code || "").toLocaleLowerCase("uz-UZ").startsWith(value.sku.trim().toLocaleLowerCase("uz-UZ")))).slice(0, 6)
    : [];
  const currencyField = (key, label, required = false) => (
    <Field label={tx(label)}>
      <div className="supplier-money-input">
        <input
          className="input-base"
          inputMode="numeric"
          aria-label={tx(label)}
          value={value[key] === "" ? "" : moneyInputValue(value[key])}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "");
            update(key, digits ? String(toBaseMoney(digits)) : "");
          }}
          placeholder="0"
          required={required}
          disabled={disabled}
        />
        <span>{tx("so'm")}</span>
      </div>
    </Field>
  );
  return (
    <div className="supplier-product-fields">
      <Field label={tx("Tovar nomi *")}>
        <div className="supplier-product-name-input">
          <input className="input-base" value={value.productName} onChange={(event) => changeName(event.target.value)} placeholder={tx("Masalan: Kir yuvish kukuni")} autoComplete="off" required disabled={disabled} />
          {!disabled && nameMatches.length > 0 && <div className="supplier-learned-options">{nameMatches.map((product) => <button type="button" key={product.id} onMouseDown={(event) => event.preventDefault()} onClick={() => onChooseProduct?.(product)}>{product.name}{product.brand ? ` · ${product.brand}` : ""}</button>)}</div>}
        </div>
      </Field>
      <div style={{ gridColumn: "1 / -1" }}>
        <Field label={tx("Tovar uchun izoh (ixtiyoriy)")}>
          <textarea className="input-base" value={value.description || ""} disabled={disabled} onChange={(event) => update("description", capitalizeStart(event.target.value))} placeholder={tx("Mahsulot haqida qo'shimcha ma'lumot...")} rows={3} maxLength={1000} style={{ width: "100%", minHeight: 84, resize: "vertical", padding: 12 }} />
        </Field>
      </div>
      <Field label={tx("Brend")}><input className="input-base" value={value.brand} disabled={disabled} onChange={(event) => update("brand", capitalizeStart(event.target.value))} placeholder={tx("Ixtiyoriy")} /></Field>
      <Field label={tx("ID raqami")}>
        <div className="supplier-product-name-input">
          <input className="input-base" value={value.sku} disabled={disabled} onChange={(event) => {
            const sku = event.target.value.toLocaleUpperCase("uz-UZ");
          if (!sku && value.existingId) onChange((current) => ({ ...current, ...emptyProduct, supplierId: current.supplierId, sku: "", existingId: null }));
            else update("sku", sku);
          }} placeholder={tx("Ixtiyoriy")} autoComplete="off" />
          {!disabled && skuMatches.length > 0 && <div className="supplier-learned-options">{skuMatches.map((product) => <button type="button" key={product.id} onMouseDown={(event) => event.preventDefault()} onClick={() => onChooseProduct?.(product)}>{product.sku || product.id} · {product.name}{product.brand ? ` · ${product.brand}` : ""}</button>)}</div>}
        </div>
      </Field>
      <Field label={tx("Kategoriya")}><input className="input-base" value={value.category} disabled={disabled} onChange={(event) => update("category", capitalizeStart(event.target.value))} placeholder={tx("Masalan: Maishiy kimyo")} /></Field>
      <div className="supplier-measurement-row">
        <Field label={tx("O'lchov birligi *")}>
          <MeasurementUnitInput value={value.measurementUnit || "dona"} disabled={disabled} onChange={onChange} />
        </Field>
        {isMeterUnit(value.measurementUnit) && <Field label={tx("Uzunligi (metr)")}><input className="input-base" type="text" inputMode="decimal" value={value.extraMeasurementValue || ""} disabled={disabled} onChange={(event) => update("extraMeasurementValue", quantityInputValue(event.target.value, true))} placeholder={tx("Masalan: 1.5")} /></Field>}
      </div>
      <Field label={tx("Qabul qilingan miqdor *")}><input className="input-base" type="text" inputMode={allowsDecimalUnit(value.measurementUnit) ? "decimal" : "numeric"} value={value.receivedQuantity} disabled={disabled} onChange={(event) => update("receivedQuantity", quantityInputValue(event.target.value, allowsDecimalUnit(value.measurementUnit)))} placeholder={tx(allowsDecimalUnit(value.measurementUnit) ? "Masalan: 2.5" : "Masalan: 20")} required /></Field>
      {currencyField("cost", "Tan narxi *", true)}
      {currencyField("price", "Sotuv narxi (ixtiyoriy)")}
      <Field label={tx("Brak miqdori")}><input className="input-base" type="text" inputMode={allowsDecimalUnit(value.measurementUnit) ? "decimal" : "numeric"} value={value.defectiveQuantity || ""} disabled={disabled} onChange={(event) => update("defectiveQuantity", quantityInputValue(event.target.value, allowsDecimalUnit(value.measurementUnit)))} placeholder="0" autoComplete="off" /></Field>
      {Number(value.defectiveQuantity) > 0 && <>
        <Field label={tx("Brak sababi *")}><input className="input-base" value={value.defectReason} disabled={disabled} onChange={(event) => update("defectReason", capitalizeStart(event.target.value))} placeholder={tx("Masalan: ekrani singan")} required /></Field>
        {currencyField("defectUnitPrice", `${tx("Brak tan narxi")} (1 ${tx(unitLabel(value))}) *`, true)}
        <div className="supplier-form-help" style={{ gridColumn: "1 / -1", marginTop: -8 }}>
          {tx("Brak summasi")}: {moneyText((Number(value.defectiveQuantity) || 0) * moneyValue(value.defectUnitPrice))}
        </div>
        {currencyField("defectSalePrice", `${tx("Brak sotuv narxi")} (1 ${tx(unitLabel(value))}) *`, true)}
        <div className="supplier-form-help" style={{ gridColumn: "1 / -1", marginTop: -8 }}>
          {tx("Brak sotuv summasi")}: {moneyText((Number(value.defectiveQuantity) || 0) * moneyValue(value.defectSalePrice))}
        </div>
      </>}
    </div>
  );
}

export default function Suppliers({ onNavigate, section = "suppliers" }) {
  useUILanguage();
  const activeSection = section;
  const initialSectionRef = useRef(activeSection);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [returnPickerOpen, setReturnPickerOpen] = useState(false);
  const [returnSupplierQuery, setReturnSupplierQuery] = useState('');
  const [suppliers, setSuppliers] = useState(() => {
    try {
      const saved = getSuppliers(null);
      return Array.isArray(saved) ? saved : [];
    } catch { return []; }
  });
  // Boshqa kassir yoki kompyuterda o'zgarsa, Supabase'dan kelgan yangi holat qayta o'qiladi.
  const dataVersion = useDataVersion();
  useEffect(() => { if (dataVersion) setSuppliers(getSuppliers()); }, [dataVersion]);
  const supplierReturns = useData("crm_supplier_returns", []);
  const returnedRecords = Array.isArray(supplierReturns) ? supplierReturns : [];
  const returnSearchQuery = returnSupplierQuery.trim().toLocaleLowerCase("uz-UZ");
  const returnSearchProducts = getProducts([]) || [];
  const returnSearchReceipts = getSupplierReceipts() || [];
  const returnSearchSales = readList("crm_sales");
  const returnSupplierMatches = suppliers.map((supplier) => {
    const supplierId = String(supplier.id);
    const supplierName = String(supplier.name || "").trim().toLocaleLowerCase("uz-UZ");
    const sameSupplier = (record) => String(record.supplierId ?? record.taminotchiId ?? "") === supplierId
      || (supplierName && String(record.supplierName || record.supplier || "").trim().toLocaleLowerCase("uz-UZ") === supplierName);
    const catalogProducts = returnSearchProducts.filter((product) => String(product.supplierId ?? "") === supplierId
      || (supplierName && String(product.supplierName || "").trim().toLocaleLowerCase("uz-UZ") === supplierName));
    const receipts = returnSearchReceipts.filter(sameSupplier);
    const orders = readList(`crm_supplier_orders_${supplier.id}`);
    const orderLines = orders.flatMap((order) => order.productDetails || order.products || order.items || []);
    const receiptLines = receipts.flatMap((receipt) => receipt.products || receipt.items || []);
    const productMap = new Map();
    [...catalogProducts, ...orderLines, ...receiptLines].forEach((line) => {
      const id = line.id ?? line.productId ?? line.product?.id;
      const name = line.name ?? line.productName ?? line.product?.name ?? line.product;
      if (id == null && !name) return;
      const key = String(id ?? name);
      const existing = productMap.get(key) || { id, name, sku: line.sku ?? line.product?.sku };
      productMap.set(key, { ...existing, id: existing.id ?? id, name: existing.name || name, sku: existing.sku || line.sku || line.product?.sku });
    });
    const relatedProducts = [...productMap.values()];
    const productIds = new Set(relatedProducts.map((product) => String(product.id ?? "")).filter(Boolean));
    const sales = returnSearchSales.filter((sale) => {
      const soldIds = [
        ...(Array.isArray(sale.items) ? sale.items.map((item) => item.id ?? item.productId ?? item.product?.id) : []),
        ...(Array.isArray(sale.productIds) ? sale.productIds : []),
      ].map(String);
      return soldIds.some((id) => productIds.has(id));
    });
    const orderIds = orders.flatMap((order) => [order.id, order.orderId, order.saleId, order.invoiceId]).filter((value) => value != null).map(String);
    const receiptIds = receipts.flatMap((receipt) => [receipt.id, receipt.orderId, receipt.saleId, receipt.invoiceId]).filter((value) => value != null).map(String);
    const saleIds = sales.flatMap((sale) => [sale.id, sale.saleId, sale.invoiceId, sale.ticketId]).filter((value) => value != null).map(String);
    const supplierText = [supplier.name, supplier.phone, supplier.id].map((value) => String(value ?? "").toLocaleLowerCase("uz-UZ"));
    const matchedProduct = relatedProducts.find((product) => [product.name, product.id, product.sku]
      .some((value) => String(value ?? "").toLocaleLowerCase("uz-UZ").includes(returnSearchQuery)));
    const matchedSaleId = saleIds.find((id) => id.toLocaleLowerCase("uz-UZ").includes(returnSearchQuery));
    const matchedOrderId = [...orderIds, ...receiptIds].find((id) => id.toLocaleLowerCase("uz-UZ").includes(returnSearchQuery));
    const supplierMatches = supplierText.some((value) => value.includes(returnSearchQuery));
    return {
      supplier,
      matchedProduct,
      matchedSaleId,
      matchedOrderId,
      matches: !returnSearchQuery || supplierMatches || Boolean(matchedProduct || matchedSaleId || matchedOrderId),
    };
  }).filter((entry) => entry.matches);
  const toast = useToast();
  const receiveReturnPayment = (record, paymentValue) => {
    const currentReturns = getData("crm_supplier_returns", []);
    const current = currentReturns.find((item) => String(item.id) === String(record?.id));
    if (!current || current.version !== 2) return null;
    const paidNow = Math.min(returnReceivable(current), Math.max(0, Number(paymentValue) || 0));
    if (!paidNow) return null;
    const paidBefore = Math.max(0, Number(current.refundedAmount) || 0);
    const history = Array.isArray(current.refundPayments) ? current.refundPayments : paidBefore > 0 ? [{ id: `REFUND-INITIAL-${current.id}`, amount: paidBefore, method: "Naqd", date: current.returnedAt, kind: "initial" }] : [];
    const payment = { id: `REFUND-${Date.now()}`, amount: paidNow, method: "Naqd", date: new Date().toISOString(), kind: "debt-payment" };
    const updated = { ...current, refundedAmount: paidBefore + paidNow, refundPayments: [...history, payment] };
    setData("crm_supplier_returns", currentReturns.map((item) => String(item.id) === String(current.id) ? updated : item));
    toast.success("To‘lov qabul qilindi", `${paidNow.toLocaleString("uz-UZ")} so‘m · Qolgan qarz: ${returnReceivable(updated).toLocaleString("uz-UZ")} so‘m`);
    return updated;
  };
  const [open, setOpen] = useState(false);
  const [productOpen, setProductOpen] = useState(false);
  const [shipmentStepOpen, setShipmentStepOpen] = useState(false);
  const [shipmentStepTarget, setShipmentStepTarget] = useState(null);
  const [pendingProducts, setPendingProducts] = useState([]);
  const [receiptSupplierGroups, setReceiptSupplierGroups] = useState([]);
  const [activeReceiptSupplierKey, setActiveReceiptSupplierKey] = useState("");
  const [draftRestoreReady, setDraftRestoreReady] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    existingSupplierId: "",
    ...emptyProduct,
    status: "active",
  });

  const [err, setErr] = useState("");
  const [productErr, setProductErr] = useState("");
  const [productForm, setProductForm] = useState({ supplierId: "", ...emptyProduct, packaging: "" });
  const [productQueue, setProductQueue] = useState([]);
  const [supplierCashInput, setSupplierCashInput] = useState("");
  const [newSupplierCashInput, setNewSupplierCashInput] = useState("");
  const [shipmentInfo, setShipmentInfo] = useState(emptyShipmentInfo);
  const [shipmentInfoSkipped, setShipmentInfoSkipped] = useState(false);
  const [receiptConfirmation, setReceiptConfirmation] = useState(false);
  const [newSupplierConfirmation, setNewSupplierConfirmation] = useState(false);
  useEffect(() => {
    const saved = readSupplierReceiptDraft();
    const savedUi = saved.uiBySection?.[initialSectionRef.current] || {};
    if (saved.supplier?.form) setForm(saved.supplier.form);
    if (Array.isArray(saved.supplier?.pendingProducts)) setPendingProducts(saved.supplier.pendingProducts);
    if (Array.isArray(saved.supplier?.receiptSupplierGroups)) setReceiptSupplierGroups(saved.supplier.receiptSupplierGroups);
    if (typeof saved.supplier?.activeReceiptSupplierKey === "string") setActiveReceiptSupplierKey(saved.supplier.activeReceiptSupplierKey);
    const restoredSupplierDrafts = [
      ...(Array.isArray(saved.supplier?.pendingProducts) ? saved.supplier.pendingProducts : []),
      ...(saved.supplier?.form?.productName?.trim() ? [pickProduct(saved.supplier.form)] : []),
    ];
    const restoredSupplierTotal = restoredSupplierDrafts.reduce((sum, item) => sum + draftLineAmount(item), 0);
    if (typeof saved.supplier?.newSupplierCashInput === "string") setNewSupplierCashInput(saved.supplier.newSupplierCashInput);
    else if (typeof saved.supplier?.newSupplierDebtInput === "string") setNewSupplierCashInput(String(Math.max(0, restoredSupplierTotal - Math.min(restoredSupplierTotal, moneyValue(saved.supplier.newSupplierDebtInput)))));
    if (saved.product?.productForm) setProductForm(saved.product.productForm);
    if (Array.isArray(saved.product?.productQueue)) setProductQueue(saved.product.productQueue);
    const restoredProductDrafts = [
      ...(Array.isArray(saved.product?.productQueue) ? saved.product.productQueue : []),
      ...(saved.product?.productForm?.productName?.trim() ? [saved.product.productForm] : []),
    ];
    const restoredProductTotal = restoredProductDrafts.reduce((sum, item) => sum + draftLineAmount(item), 0);
    if (typeof saved.product?.supplierCashInput === "string") setSupplierCashInput(saved.product.supplierCashInput);
    else if (typeof saved.product?.supplierDebtInput === "string") setSupplierCashInput(String(Math.max(0, restoredProductTotal - Math.min(restoredProductTotal, moneyValue(saved.product.supplierDebtInput)))));
    if (saved.shipmentInfo && typeof saved.shipmentInfo === "object") setShipmentInfo(saved.shipmentInfo);
    if (typeof saved.shipmentInfoSkipped === "boolean") setShipmentInfoSkipped(saved.shipmentInfoSkipped);
    setOpen(savedUi.open === true);
    setProductOpen(savedUi.productOpen === true);
    setShipmentStepOpen(savedUi.shipmentStepOpen === true);
    setShipmentStepTarget(savedUi.shipmentStepTarget === "supplier" || savedUi.shipmentStepTarget === "products" ? savedUi.shipmentStepTarget : null);
    setNewSupplierConfirmation(savedUi.newSupplierConfirmation === true);
    setReceiptConfirmation(savedUi.receiptConfirmation || false);
    setDraftRestoreReady(true);
  }, []);
  useEffect(() => {
    if (!draftRestoreReady) return;
    try {
      const saved = readSupplierReceiptDraft();
      localStorage.setItem(SUPPLIER_RECEIPT_DRAFT_KEY, JSON.stringify({
        ...saved,
        supplier: { form, pendingProducts, receiptSupplierGroups, activeReceiptSupplierKey, newSupplierCashInput },
        product: { productForm, productQueue, supplierCashInput },
        shipmentInfo,
        shipmentInfoSkipped,
        uiBySection: {
          ...(saved.uiBySection || {}),
          [activeSection]: { open, productOpen, shipmentStepOpen, shipmentStepTarget, newSupplierConfirmation, receiptConfirmation },
        },
      }));
    } catch { /* Keep the in-memory draft if browser storage is unavailable. */ }
  }, [draftRestoreReady, activeSection, open, productOpen, shipmentStepOpen, shipmentStepTarget, newSupplierConfirmation, receiptConfirmation, form, pendingProducts, receiptSupplierGroups, activeReceiptSupplierKey, newSupplierCashInput, productForm, productQueue, supplierCashInput, shipmentInfo, shipmentInfoSkipped]);
  const [receiptAnimation, setReceiptAnimation] = useState(null);
  const receiptTimer = useRef(null);
  useEffect(() => () => clearTimeout(receiptTimer.current), []);
  const knownProducts = readList("crm_products");
  const productSuggestions = productForm.supplierId
    ? knownProducts.filter((item) => String(item.supplierId) === String(productForm.supplierId)).filter((item, index, list) => list.findIndex((match) => String(match.id) === String(item.id)) === index)
    : [];
  const newSupplierProductSuggestions = knownProducts;
  const chooseProduct = (product) => setProductForm((current) => fillFromSavedProduct(current, product));
  const chooseNewSupplierProduct = (product) => setForm((current) => fillFromSavedProduct(current, product));
  const updateProductForm = (updater) => { setProductForm(updater); setProductErr(""); };
  const updateNewSupplierForm = (updater) => { setForm(updater); setErr(""); };
  useEffect(() => {
    if (!activeReceiptSupplierKey) return;
    setReceiptSupplierGroups((groups) => groups.map((group) => group.key === activeReceiptSupplierKey
      ? { ...group, name: form.name, phone: form.phone, address: form.address, existingSupplierId: form.existingSupplierId }
      : group));
  }, [activeReceiptSupplierKey, form.name, form.phone, form.address, form.existingSupplierId]);
  const chooseSavedSupplierByName = (name) => {
    const normalizedName = String(name || "").trim().toLocaleLowerCase("uz-UZ");
    return suppliers.find((supplier) => String(supplier.name || "").trim().toLocaleLowerCase("uz-UZ") === normalizedName) || null;
  };
  const updateNewSupplierName = (name) => {
    const formattedName = capitalizeStart(name);
    const savedSupplier = chooseSavedSupplierByName(formattedName);
    setForm((current) => ({
      ...current,
      name: formattedName,
      existingSupplierId: savedSupplier ? String(savedSupplier.id) : "",
      phone: savedSupplier ? savedSupplier.phone || "" : current.existingSupplierId ? "" : current.phone,
      address: savedSupplier ? savedSupplier.address || "" : current.existingSupplierId ? "" : current.address,
    }));
    setErr("");
  };
  const selectSavedSupplier = (supplierId) => {
    const supplier = suppliers.find((item) => String(item.id) === String(supplierId));
    setForm((current) => ({
      ...current,
      existingSupplierId: supplier ? String(supplier.id) : "",
      name: supplier ? capitalizeStart(supplier.name || "") : current.existingSupplierId ? "" : current.name,
      phone: supplier?.phone || (current.existingSupplierId ? "" : current.phone),
      address: supplier?.address || (current.existingSupplierId ? "" : current.address),
    }));
    setErr("");
  };
  const selectedSavedSupplier = suppliers.find((supplier) => String(supplier.id) === String(form.existingSupplierId)) || null;
  const resetReceiptSupplierGroups = () => {
    const initial = createReceiptSupplierGroup();
    setReceiptSupplierGroups([initial]);
    setActiveReceiptSupplierKey(initial.key);
  };
  const resetShipmentInfo = () => { setShipmentInfo(emptyShipmentInfo); setShipmentInfoSkipped(false); };
  // Modal tashqarisi bosilib yopilganda yozilgan ma'lumot saqlanib qoladi; shu yerda "qoralama bor-yo'qligi" aniqlanadi.
  const blankSupplierForm = { name: "", phone: "", address: "", existingSupplierId: "", ...emptyProduct, status: "active" };
  const hasSupplierDraft = receiptSupplierGroups.length > 0 && (
    pendingProducts.length > 0 ||
    JSON.stringify(form) !== JSON.stringify(blankSupplierForm) ||
    newSupplierCashInput !== "" ||
    shipmentInfoSkipped ||
    JSON.stringify(shipmentInfo) !== JSON.stringify(emptyShipmentInfo)
  );
  const blankProductReceipt = { supplierId: "", ...emptyProduct, packaging: "" };
  const hasProductDraft = productQueue.length > 0 ||
    JSON.stringify(productForm) !== JSON.stringify(blankProductReceipt) ||
    supplierCashInput !== "" || shipmentInfoSkipped ||
    JSON.stringify(shipmentInfo) !== JSON.stringify(emptyShipmentInfo);
  const discardSupplierDraft = () => {
    setOpen(false);
    setErr("");
    setPendingProducts([]);
    setReceiptSupplierGroups([]);
    setActiveReceiptSupplierKey("");
    setNewSupplierCashInput("");
    setNewSupplierConfirmation(false);
    resetShipmentInfo();
    setForm({ ...blankSupplierForm });
  };
  const startShipmentFlow = (target) => {
    const hasDraft = target === "supplier" ? hasSupplierDraft : hasProductDraft;
    if (!hasDraft) resetShipmentInfo();
    setShipmentStepTarget(target);
    setShipmentStepOpen(true);
  };
  const continueShipmentFlow = (skipped = false) => {
    if (skipped) {
      setShipmentInfo(emptyShipmentInfo);
      setShipmentInfoSkipped(true);
    }
    const target = shipmentStepTarget;
    setShipmentStepOpen(false);
    setShipmentStepTarget(null);
    if (target === "supplier") setOpen(true);
    if (target === "products") setProductOpen(true);
  };
  const skipShipmentInfo = () => continueShipmentFlow(true);
  const receiptDrafts = [...productQueue, ...(productForm.productName.trim() ? [productForm] : [])];
  const receiptTotal = receiptDrafts.reduce((sum, item) => sum + draftLineAmount(item), 0);
  const receiptDefectQuantity = receiptDrafts.reduce((sum, item) => sum + Math.max(0, Number(item.defectiveQuantity) || 0), 0);
  const receiptDefectTotal = receiptDrafts.reduce((sum, item) => sum + defectTotalOf(item), 0);
  const supplierDebtLimit = receiptDrafts.filter((item) => item.supplierId && String(item.supplierId) !== "street").reduce((sum, item) => sum + draftLineAmount(item), 0);
  const minimumReceiptCash = Math.max(0, receiptTotal - supplierDebtLimit);
  const receiptCash = Math.max(minimumReceiptCash, Math.min(receiptTotal, moneyValue(supplierCashInput)));
  const receiptDebt = Math.max(0, receiptTotal - receiptCash);
  const newSupplierDrafts = [...pendingProducts, ...(form.productName.trim() ? [{ ...pickProduct(form), supplierGroupKey: activeReceiptSupplierKey, supplierId: form.existingSupplierId || activeReceiptSupplierKey }] : [])];
  const newSupplierTotal = newSupplierDrafts.reduce((sum, item) => sum + draftLineAmount(item), 0);
  const newSupplierCash = Math.min(newSupplierTotal, moneyValue(newSupplierCashInput));
  const newSupplierDebt = Math.max(0, newSupplierTotal - newSupplierCash);
  useEffect(() => { setNewSupplierCashInput((value) => value === "" ? "" : String(Math.min(newSupplierTotal, moneyValue(value)))); }, [newSupplierTotal]);
  useEffect(() => {
    setSupplierCashInput((value) => {
      const minimum = Math.max(0, receiptTotal - supplierDebtLimit);
      return value === "" && minimum === 0 ? "" : String(Math.max(minimum, Math.min(receiptTotal, moneyValue(value))));
    });
  }, [receiptTotal, supplierDebtLimit]);

  const productError = (product) => {
    const quantity = Number(product.receivedQuantity);
    const cost = Number(product.cost);
    if (!product.productName.trim() || product.receivedQuantity === "" || product.cost === "") {
      return "Tovar nomi, qabul qilingan miqdor va tan narxini kiriting";
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || (!allowsDecimalUnit(product.measurementUnit) && !Number.isInteger(quantity)) || !Number.isFinite(cost) || cost < 0) {
      return "Miqdor va tan narxini to'g'ri kiriting";
    }
    const defectQuantity = Number(product.defectiveQuantity || 0);
    if (!Number.isFinite(defectQuantity) || defectQuantity < 0 || defectQuantity > quantity || (!allowsDecimalUnit(product.measurementUnit) && !Number.isInteger(defectQuantity))) {
      return "Brak miqdori qabul qilingan miqdordan oshmasin va to'g'ri kiritilsin";
    }
    if (defectQuantity > 0 && (!product.defectReason?.trim() || product.defectUnitPrice === "" || !Number.isFinite(Number(product.defectUnitPrice)) || Number(product.defectUnitPrice) < 0 || product.defectSalePrice === "" || !Number.isFinite(Number(product.defectSalePrice)) || Number(product.defectSalePrice) < 0)) {
      return "Brak sababi, tan narxi va sotuv narxini kiriting";
    }
    return "";
  };

  const addPendingProduct = () => {
    const product = { ...pickProduct(form), supplierGroupKey: activeReceiptSupplierKey, supplierId: form.existingSupplierId || activeReceiptSupplierKey };
    const error = productError(product);
    if (error) { setErr(error); return false; }
    if (hasDuplicateProducts([...pendingProducts, product])) { setErr("Bu mahsulot ushbu ta'minotchi ro'yxatida allaqachon qo'shilgan."); return false; }
    setPendingProducts((items) => [...items, { ...product, key: `${Date.now()}-${items.length}` }]);
    setForm((current) => ({ ...current, ...emptyProduct, existingId: null }));
    setErr("");
    return true;
  };

  const queueProduct = () => {
    if (!productForm.supplierId) return setProductErr("Ta'minotchini tanlang yoki 'Ko'chadan' variantini tanlang");
    const error = productError(productForm); if (error) return setProductErr(error);
    if (hasDuplicateProducts([...productQueue, productForm])) return setProductErr("Bu mahsulot qabul ro'yxatiga allaqachon qo'shilgan.");
    setProductQueue((items) => [...items, { ...pickProduct(productForm), key: `${Date.now()}-${items.length}` }]);
    setProductForm((current) => ({ ...current, ...emptyProduct, packaging: "", existingId: null, supplierId: current.supplierId }));
    setProductErr("");
  };

  const addProductToSupplier = () => {
    const drafts = [...productQueue, ...(productForm.productName.trim() ? [pickProduct(productForm)] : [])];
    if (!drafts.length) return setProductErr("Kamida bitta mahsulot nomini kiriting");
    if (drafts.some((draft) => draft.supplierId !== "street" && !suppliers.some((supplier) => String(supplier.id) === String(draft.supplierId)))) return setProductErr("Har bir mahsulot uchun ta'minotchini tanlang yoki 'Ko'chadan' variantini tanlang");
    if (hasDuplicateProducts(drafts)) return setProductErr("Bir xil mahsulot qabul ro'yxatida takrorlangan. Takrorlangan qatorni o'chiring.");

    const invalid = drafts.map(productError).find(Boolean); if (invalid) return setProductErr(invalid);
    if (!receiptConfirmation) { setReceiptConfirmation(new Date().toISOString()); return; }
    const createdAt = receiptConfirmation, savedProducts = readList("crm_products");
    const receiptId = `REC-${Date.now()}`;
    const productsToSave = drafts.map((draft, index) => {
      const supplier = suppliers.find((item) => String(item.id) === String(draft.supplierId)) || { id: null, name: "Ko'chadan" };
      const quantity = Math.max(0, Number(draft.receivedQuantity) || 0);
      const defectiveQuantity = defectQuantityOf(draft);
      const existing = savedProducts.find((item) => String(item.supplierId) === String(supplier.id) && (draft.existingId ? String(item.id) === String(draft.existingId) : String(item.name || "").trim().toLowerCase() === draft.productName.trim().toLowerCase()));
      if (existing) {
        const nextStock = Number(existing.stock || 0) + quantity;
        const nextDefectiveStock = Number(existing.defectiveStock || 0) + defectiveQuantity;
        const defect = createDefectEntry(draft, existing.id, supplier, receiptId, createdAt);
        const nextDefects = defect ? [...(Array.isArray(existing.defects) ? existing.defects : []), defect] : (existing.defects || []);
        const sellableStock = Math.max(0, nextStock - nextDefectiveStock);
        return { ...existing, measurementType: draft.measurementType || existing.measurementType || "count", measurementUnit: draft.measurementUnit || existing.measurementUnit || "dona", extraMeasurement: isMeterUnit(draft.measurementUnit) ? tx("Uzunligi (metr)") : draft.extraMeasurement, extraMeasurementValue: Number(draft.extraMeasurementValue) || 0, description: draft.description.trim() || existing.description || "", stock: nextStock, defectiveStock: nextDefectiveStock, defects: nextDefects, status: sellableStock === 0 ? "out" : sellableStock < 10 ? "low" : "active", brand: capitalizeStart(draft.brand.trim()) || existing.brand, sku: capitalizeStart(draft.sku.trim()) || existing.sku, category: capitalizeStart(draft.category.trim()) || existing.category, packaging: capitalizeStart(draft.packaging.trim()) || existing.packaging, cost: draft.cost === "" ? existing.cost : Number(draft.cost), price: draft.price === "" ? existing.price : Number(draft.price) };
      }
      const id = `${Date.now()}-manual-${index}`;
      const defect = createDefectEntry(draft, id, supplier, receiptId, createdAt);
      const sellableStock = Math.max(0, quantity - defectiveQuantity);
      return {
        id, name: capitalizeStart(draft.productName.trim()),
        description: draft.description.trim(), brand: draft.brand.trim(), sku: draft.sku.trim() || `SKU-${Date.now().toString().slice(-6)}-${index + 1}`,
        category: draft.category.trim() || "Boshqa", packaging: capitalizeStart(draft.packaging.trim()), defectiveStock: defectiveQuantity, defects: defect ? [defect] : [],
        price: Number(draft.price) || 0, cost: Number(draft.cost) || 0, stock: quantity, measurementType: draft.measurementType || "count", measurementUnit: draft.measurementUnit || "dona",
        status: sellableStock === 0 ? "out" : sellableStock < 10 ? "low" : "active", supplierId: supplier.id,
        supplierName: supplier.name, extraMeasurement: isMeterUnit(draft.measurementUnit) ? tx("Uzunligi (metr)") : draft.extraMeasurement, extraMeasurementValue: Number(draft.extraMeasurementValue) || 0, unitsPerPackage: Number(draft.unitsPerPackage) || 0,
        liters: Number(draft.liters) || 0, weight: Number(draft.weight) || 0,
        volume: Number(draft.volume) || 0, length: Number(draft.length) || 0,
        width: Number(draft.width) || 0, height: Number(draft.height) || 0, createdAt,
      };
    });
    const receiptLines = drafts.map((draft, index) => {
      const supplier = suppliers.find((item) => String(item.id) === String(draft.supplierId)) || { id: null, name: "Ko'chadan" };
      return { id: productsToSave[index].id, name: productsToSave[index].name, description: draft.description.trim(), supplierId: supplier.id, supplierName: supplier.name, quantity: Math.max(0, Number(draft.receivedQuantity) || 0), defectiveQuantity: defectQuantityOf(draft), defectStatus: defectQuantityOf(draft) > 0 ? "Brak" : "", defectReason: draft.defectReason || "", defectUnitPrice: moneyValue(draft.defectUnitPrice), defectSalePrice: moneyValue(draft.defectSalePrice), defects: [createDefectEntry(draft, productsToSave[index].id, supplier, receiptId, createdAt)].filter(Boolean), measurementType: draft.measurementType || "count", measurementUnit: draft.measurementUnit || "dona", extraMeasurement: isMeterUnit(draft.measurementUnit) ? tx("Uzunligi (metr)") : draft.extraMeasurement || "", extraMeasurementValue: Number(draft.extraMeasurementValue) || 0, packaging: draft.packaging || "", cost: Number(draft.cost) };
    });
    const totalAmount = receiptLines.reduce((sum, item) => sum + savedLineAmount(item), 0);
    const supplierOrderAmount = receiptLines.filter((line) => line.supplierId !== null).reduce((sum, line) => sum + savedLineAmount(line), 0);
    const debtAmount = Math.min(supplierOrderAmount, receiptDebt);
    const groupedLines = new Map();
    receiptLines.filter((line) => line.supplierId !== null).forEach((line) => groupedLines.set(String(line.supplierId), [...(groupedLines.get(String(line.supplierId)) || []), line]));
    const supplierGroups = [...groupedLines.entries()];
    let allocatedDebt = 0;
    const orders = supplierGroups.map(([supplierKey, lines], index) => {
      const supplier = suppliers.find((item) => String(item.id) === supplierKey);
      const amount = lines.reduce((sum, line) => sum + savedLineAmount(line), 0);
      const remaining = index === supplierGroups.length - 1 ? debtAmount - allocatedDebt : supplierOrderAmount > 0 ? Math.min(debtAmount - allocatedDebt, Math.round(debtAmount * amount / supplierOrderAmount)) : 0;
      allocatedDebt += remaining;
      const paid = amount - remaining;
      const order = { id: `${receiptId}-${supplier.id}`, receiptId, supplierId: supplier.id, supplierName: supplier.name, supplierAddress: supplier.address || "", items: lines.reduce((sum, line) => sum + line.quantity, 0), defectiveItems: lines.reduce((sum, line) => sum + line.defectiveQuantity, 0), productCount: lines.length, productNames: lines.map((line) => line.name), productIds: lines.map((line) => line.id), productDetails: lines, amount, remaining, payment: remaining === 0 ? "Naqd" : paid ? "Qisman" : "Qarz", status: remaining === 0 ? "paid" : paid ? "partial" : "debt", paymentHistory: paid > 0 ? [{ id: `PAY-INITIAL-${Date.now()}-${supplier.id}`, amount: paid, method: "Naqd", date: createdAt, kind: "initial" }] : [], received: true, date: createdAt, farmName: shipmentInfoSkipped ? "" : shipmentInfo.farmName.trim(), tripNumber: shipmentInfoSkipped ? "" : shipmentInfo.tripNumber.trim() };
      return order;
    });
    const supplierIds = supplierGroups.map(([supplierId]) => suppliers.find((item) => String(item.id) === supplierId)?.id).filter((id) => id !== undefined);
    const supplierNames = [...new Set(receiptLines.map((line) => line.supplierName).filter(Boolean))];
    const receipt = { id: receiptId, supplierId: supplierIds.length === 1 ? supplierIds[0] : null, supplierIds, supplier: supplierNames.join(", "), supplierNames, supplierAddresses: orders.map((order) => ({ supplierId: order.supplierId, supplierName: order.supplierName, address: order.supplierAddress || "" })), orderId: orders.length === 1 ? orders[0].id : undefined, orderIds: orders.map((order) => order.id), items: receiptLines.reduce((sum, item) => sum + item.quantity, 0), defectiveItems: receiptLines.reduce((sum, item) => sum + item.defectiveQuantity, 0), products: receiptLines, amount: totalAmount, remaining: debtAmount, date: createdAt, farmName: shipmentInfoSkipped ? "" : shipmentInfo.farmName.trim(), tripNumber: shipmentInfoSkipped ? "" : shipmentInfo.tripNumber.trim() };
    const updated = suppliers.map((item) => {
      const order = orders.find((entry) => String(entry.supplierId) === String(item.id));
      if (!order) return item;
      const newProductCount = productsToSave.filter((product) => String(product.supplierId) === String(item.id) && !savedProducts.some((saved) => String(saved.id) === String(product.id))).length;
      return { ...item, products: (Number(item.products) || 0) + newProductCount, purchases: (Number(item.purchases) || 0) + order.amount, debt: (Number(item.debt) || 0) + order.remaining, lastOrder: createdAt };
    });
    try {
      saveProducts([...productsToSave.filter((product) => !savedProducts.some((saved) => String(saved.id) === String(product.id))), ...savedProducts.map((saved) => productsToSave.find((product) => String(product.id) === String(saved.id)) || saved)]);
      saveSuppliers(updated);
      orders.forEach((order) => saveSupplierOrders(order.supplierId, [order, ...readList(`crm_supplier_orders_${order.supplierId}`)]));
      saveSupplierReceipts([receipt, ...readList("crm_supplier_receipts")]);
    } catch { return setProductErr("Mahsulot saqlanmadi. Qayta urinib ko'ring."); }
    setSuppliers(updated);
    setProductForm({ supplierId: "", ...emptyProduct, packaging: "" });
    setProductQueue([]);
    setSupplierCashInput("");
    setProductErr("");
    setProductOpen(false);
    setReceiptConfirmation(false);
    resetShipmentInfo();
    setReceiptAnimation({ amount: totalAmount, remainingDebt: debtAmount });
    const sound = new Audio(checkSound); sound.play().catch(() => {});
    receiptTimer.current = setTimeout(() => setReceiptAnimation(null), 2400);
    window.dispatchEvent(new Event("crm-products-updated"));
    toast.success && toast.success(`${productsToSave.length} ta mahsulot qabul qilindi`);
  };

  const submit = () => {
    const groups = receiptSupplierGroups.map((group) => {
      const lines = pendingProducts.filter((item) => item.supplierGroupKey === group.key);
      if (group.key === activeReceiptSupplierKey && form.productName.trim()) lines.push({ ...pickProduct(form), supplierGroupKey: group.key, supplierId: form.existingSupplierId || group.key });
      return { ...group, lines };
    }).filter((group) => group.lines.length);
    if (!groups.length) return setErr("Kamida bitta ta'minotchi va tovar kiriting");
    for (const group of groups) {
      if (!group.name.trim()) return setErr("Har bir ta'minotchi nomini kiriting");
      if (group.phone.replace(/\D/g, "").length !== 12) return setErr(`${group.name}: telefon raqamini to'liq kiriting`);
    }
    const supplierKeys = groups.map((group) => group.existingSupplierId
      ? `saved:${group.existingSupplierId}`
      : `new:${group.name.trim().toLocaleLowerCase("uz-UZ")}`);
    if (new Set(supplierKeys).size !== supplierKeys.length) return setErr("Bir ta'minotchini bitta qabulga ikki marta qo'shib bo'lmaydi.");
    const productDrafts = groups.flatMap((group) => group.lines.map((item) => ({ ...item, supplierGroupKey: group.key, supplierId: group.existingSupplierId || group.key })));
    if (hasDuplicateProducts(productDrafts)) return setErr("Bir xil mahsulot bir ta'minotchi ro'yxatida takrorlangan. Takrorlangan qatorni o'chiring.");
    const invalid = productDrafts.map(productError).find(Boolean);
    if (invalid) return setErr(invalid);

    setErr("");
    if (!newSupplierConfirmation) {
      setNewSupplierConfirmation(true);
      return;
    }
    const prev = suppliers;
    const createdAt = new Date().toISOString();
    const receiptId = `REC-${Date.now()}`;
    let nextId = Math.max(0, ...prev.map((item) => Number(item.id) || 0));
    const resolvedGroups = groups.map((group) => {
      const saved = prev.find((item) => String(item.id) === String(group.existingSupplierId));
      const id = saved?.id ?? ++nextId;
      return { ...group, supplierId: id, supplierName: group.name.trim(), supplierAddress: group.address.trim(), savedSupplier: saved || null };
    });
    const groupForDraft = (draft) => resolvedGroups.find((group) => group.key === draft.supplierGroupKey);
    const productsForReceipt = productDrafts.map((item, index) => {
      const group = groupForDraft(item);
      const receivedQuantity = Number(item.receivedQuantity);
      const defectiveQuantity = defectQuantityOf(item);
      const id = `${Date.now()}-${index}`;
      const defect = createDefectEntry(item, id, { id: group.supplierId, name: group.supplierName }, receiptId, createdAt);
      const sellableStock = Math.max(0, receivedQuantity - defectiveQuantity);
      return {
        id, name: item.productName.trim(), description: item.description.trim(), brand: item.brand.trim(),
        sku: item.sku.trim() || `SKU-${Date.now().toString().slice(-6)}-${index + 1}`, category: item.category.trim() || "Boshqa",
        price: Number(item.price) || 0, cost: Number(item.cost), stock: receivedQuantity, defectiveStock: defectiveQuantity, defects: defect ? [defect] : [], measurementType: item.measurementType || "count",
        status: sellableStock === 0 ? "out" : sellableStock < 10 ? "low" : "active", supplierId: group.supplierId, supplierName: group.supplierName,
        packaging: item.packaging, measurementUnit: item.measurementUnit || "dona", extraMeasurement: isMeterUnit(item.measurementUnit) ? tx("Uzunligi (metr)") : item.extraMeasurement, extraMeasurementValue: Number(item.extraMeasurementValue) || 0,
        unitsPerPackage: Number(item.unitsPerPackage) || 0, liters: Number(item.liters) || 0, weight: Number(item.weight) || 0, volume: Number(item.volume) || 0,
        length: Number(item.length) || 0, width: Number(item.width) || 0, height: Number(item.height) || 0,
      };
    });
    const totalAmount = productsForReceipt.reduce((sum, item) => sum + receivedProductAmount(item), 0);
    const debtTotal = Math.min(totalAmount, newSupplierDebt);
    let allocatedDebt = 0;
    const orders = resolvedGroups.map((group, index) => {
      const items = productsForReceipt.filter((item) => String(item.supplierId) === String(group.supplierId));
      const amount = items.reduce((sum, item) => sum + receivedProductAmount(item), 0);
      const remaining = index === resolvedGroups.length - 1 ? debtTotal - allocatedDebt : totalAmount > 0 ? Math.min(debtTotal - allocatedDebt, Math.round(debtTotal * amount / totalAmount)) : 0;
      allocatedDebt += remaining;
      const paid = amount - remaining;
      return {
        id: `${receiptId}-${group.supplierId}`, receiptId, supplierId: group.supplierId, supplierName: group.supplierName, supplierAddress: group.supplierAddress,
        items: items.reduce((sum, item) => sum + item.stock, 0), productCount: items.length, productNames: items.map((item) => item.name), productIds: items.map((item) => item.id),
        defectiveItems: items.reduce((sum, item) => sum + Number(item.defectiveStock || 0), 0),
        productDetails: items.map((item) => ({ id: item.id, name: item.name, description: item.description, quantity: item.stock, defectiveQuantity: item.defectiveStock || 0, defects: item.defects || [], measurementType: item.measurementType, measurementUnit: item.measurementUnit, packaging: item.packaging, cost: item.cost })),
        amount, remaining, payment: remaining === 0 ? "Naqd" : paid ? "Qisman" : "Qarz", status: remaining === 0 ? "paid" : paid ? "partial" : "debt",
        paymentHistory: paid > 0 ? [{ id: `PAY-INITIAL-${Date.now()}-${group.supplierId}`, amount: paid, method: "Naqd", date: createdAt, kind: "initial" }] : [],
        received: true, date: createdAt, farmName: shipmentInfoSkipped ? "" : shipmentInfo.farmName.trim(), tripNumber: shipmentInfoSkipped ? "" : shipmentInfo.tripNumber.trim(),
      };
    });
    const updated = [...prev];
    resolvedGroups.forEach((group) => {
      const order = orders.find((item) => String(item.supplierId) === String(group.supplierId));
      const index = updated.findIndex((item) => String(item.id) === String(group.supplierId));
      const current = index >= 0 ? updated[index] : group.savedSupplier;
      const next = {
        ...(current || {}), id: group.supplierId, name: group.supplierName, phone: group.phone || current?.phone || "", address: group.supplierAddress || current?.address || "",
        products: Number(current?.products || 0) + order.productCount, purchases: Number(current?.purchases || 0) + order.amount, debt: Number(current?.debt || 0) + order.remaining,
        lastOrder: createdAt, createdAt: current?.createdAt || createdAt, status: "active",
      };
      if (index >= 0) updated[index] = next; else updated.unshift(next);
    });
    const supplierIds = [...new Set(orders.map((order) => order.supplierId))];
    const supplierNames = [...new Set(orders.map((order) => order.supplierName))];
    const receipt = {
      id: receiptId, supplierId: supplierIds.length === 1 ? supplierIds[0] : null, supplierIds, supplier: supplierNames.join(", "), supplierNames,
      supplierAddresses: orders.map((order) => ({ supplierId: order.supplierId, supplierName: order.supplierName, address: order.supplierAddress })),
      orderId: orders.length === 1 ? orders[0].id : undefined, orderIds: orders.map((order) => order.id), items: productsForReceipt.reduce((sum, item) => sum + item.stock, 0),
      defectiveItems: productsForReceipt.reduce((sum, item) => sum + item.defectiveStock, 0), productCount: productsForReceipt.length,
      products: productsForReceipt.map((item) => ({ id: item.id, name: item.name, description: item.description, quantity: item.stock, defectiveQuantity: item.defectiveStock || 0, defects: item.defects || [], measurementType: item.measurementType, measurementUnit: item.measurementUnit, packaging: item.packaging, cost: item.cost, supplierId: item.supplierId, supplierName: item.supplierName })),
      amount: totalAmount, remaining: debtTotal, date: createdAt, farmName: shipmentInfoSkipped ? "" : shipmentInfo.farmName.trim(), tripNumber: shipmentInfoSkipped ? "" : shipmentInfo.tripNumber.trim(),
    };
    try {
      const currentProducts = getProducts(null);
      saveSuppliers(updated);
      saveProducts([...productsForReceipt, ...(Array.isArray(currentProducts) ? currentProducts : [])]);
      orders.forEach((order) => saveSupplierOrders(order.supplierId, [order, ...readList(`crm_supplier_orders_${order.supplierId}`)]));
      const savedReceipts = getSupplierReceipts();
      saveSupplierReceipts([receipt, ...(Array.isArray(savedReceipts) ? savedReceipts : [])]);
    } catch { setErr("Ta'minotchi yoki mahsulotlar saqlanmadi. Qayta urinib ko'ring."); return; }
    setSuppliers(updated);
    setForm({ name: "", phone: "", address: "", existingSupplierId: "", ...emptyProduct, status: "active" });
    setPendingProducts([]);
    setReceiptSupplierGroups([]);
    setActiveReceiptSupplierKey("");
    setNewSupplierCashInput("");
    resetShipmentInfo();
    setNewSupplierConfirmation(false);
    setOpen(false);
    window.dispatchEvent(new Event("crm-products-updated"));
    toast.success && toast.success(`${orders.length} ta ta'minotchidan mahsulotlar qabul qilindi`);
  };

  const filtered = suppliers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) &&
    matchesDateRange(s.lastOrder || s.createdAt, dateFrom, dateTo)
  );

  return (
    <div className="space-y-6 fade-in">

      {/* Sarlavha */}
      <div className="flex items-center justify-between supplier-page-heading">
        <div>
          <h1
            className="font-display text-2xl font-bold"
            style={{
              fontFamily: "'Manrope',sans-serif",
              color: "var(--text-primary)",
            }}
          >{tx(activeSection === "suppliers" ? "Ta'minotchilar" : "Qaytarilgan tovarlar")}</h1>

          <p
            className="text-sm mt-0.5"
            style={{
              color: "var(--text-muted)",
            }}
          >{tx(activeSection === "suppliers" ? "Yetkazib beruvchilar va shartnomalar" : "Ta’minotchiga qaytarilgan mahsulotlar tarixi")}</p>
        </div>

        {activeSection === "returns" && (
          <button type="button" className="btn-primary supplier-return-picker-button" aria-label={tx("Tovarni qaytarish")} title={tx("Tovarni qaytarish")} onClick={() => { setReturnSupplierQuery(""); setReturnPickerOpen(true); }}>
            <PackagePlus size={16} aria-hidden="true" /><span>{tx("Tovarni qaytarish")}</span>
          </button>
        )}
        {activeSection === "suppliers" && <div className="flex items-center gap-2 supplier-heading-actions">
          <button
            type="button"
            onClick={() => { setReturnSupplierQuery(""); setReturnPickerOpen(true); }}
            aria-label={tx("Tovarni qaytarish")}
            title={tx("Tovarni qaytarish")}
            className="supplier-return-action-btn flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
            style={{ background: "var(--brand-light)", color: "var(--brand)", border: "1px solid var(--brand)" }}
          >
            <RotateCcw size={16} aria-hidden="true" /><span>{tx("Tovarni qaytarish")}</span>
          </button>
          <button
            type="button"
            onClick={() => { if (!hasProductDraft) { setProductForm({ supplierId: "", ...emptyProduct, packaging: "" }); setProductQueue([]); setSupplierCashInput(""); } setProductErr(""); startShipmentFlow("products"); }}
            aria-label={tx("Mahsulot qo'shish")}
            title={tx("Mahsulot qo'shish")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90 supplier-add-product-btn"
            style={{ background: "var(--brand-light)", color: "var(--brand)", border: "1px solid var(--brand)" }}
          >
            <PackagePlus size={16} /><span>{tx("Mahsulot qo'shish")}</span></button>
          <button
            type="button"
            onClick={() => {
              // Oldin yozilgan ma'lumot bo'lsa — tozalamasdan o'sha holatda qayta ochamiz.
              if (hasSupplierDraft) { setOpen(true); return; }
              setForm({ name: "", phone: "", address: "", existingSupplierId: "", ...emptyProduct, status: "active" });
              setPendingProducts([]);
              resetReceiptSupplierGroups();
              setNewSupplierCashInput("");
              setErr("");
              startShipmentFlow("supplier");
            }}
            aria-label={tx("Ta'minotchi qo'shish")}
            title={tx("Ta'minotchi qo'shish")}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 supplier-add-person-btn"
            style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-hover))", boxShadow: "0 2px 8px rgba(37,99,235,0.25)" }}
          >
            <UserPlus size={16} /><span>{tx("Ta'minotchi qo'shish")}</span></button>
        </div>}
      </div>

      {activeSection === "suppliers" && <>
      {/* Analitika kartalari */}
      <div className="suppliers-stats grid grid-cols-4 gap-4">
        {[
          {
            label: "Jami ta'minotchilar",
            value: suppliers.length,
            icon: Truck,
            color: "var(--brand)",
            bg: "var(--brand-light)",
          },
          {
            label: "Jami mahsulotlar",
            value: suppliers.reduce(
              (s, x) => s + x.products,
              0
            ),
            icon: Package,
            color: "var(--violet)",
            bg: "var(--violet-light)",
          },
          {
            label: "Jami xaridlar",
            value: formatCurrency(
              suppliers.reduce((sum, supplier) => sum + (Number(supplier.purchases) || 0), 0)
            ),
            icon: DollarSign,
            color: "var(--success)",
            bg: "var(--success-light)",
          },
          {
            label: "Qarz",
            value: formatCurrency(
              suppliers.reduce((sum, supplier) => sum + Math.max(0, Number(supplier.debt) || 0), 0)
            ),
            icon: AlertCircle,
            color: "var(--danger)",
            bg: "var(--danger-light)",
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`supplier-stat-card rounded-2xl p-4 transition-card ${s.label === "Qarz" ? "debt-highlight" : ""}`}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              boxShadow:
                "0 2px 8px rgba(15,23,42,0.04)",
            }}
          >
            <div
              className="p-2.5 rounded-xl w-fit mb-3"
              style={{
                background: s.bg,
              }}
            >
              <s.icon
                size={18}
                style={{
                  color: s.color,
                }}
              />
            </div>

            <div
              className="min-w-0 break-words text-xl font-display font-bold tabular-nums leading-tight [overflow-wrap:anywhere]"
              style={{
                fontFamily: "'Manrope',sans-serif",
                color: "var(--text-primary)",
              }}
            >
              {tx(s.value)}
            </div>

            <div
              className="text-xs mt-0.5"
              style={{
                color: "var(--text-faint)",
              }}
            >
              {tx(s.label)}
            </div>
          </div>
        ))}
      </div>

      {/* Jadval */}
      <div
        className="suppliers-list-card rounded-2xl overflow-hidden"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow:
            "0 2px 8px rgba(15,23,42,0.04)",
        }}
      >
        {/* Qidiruv */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-wrap"
          style={{
            borderBottom:
              "1px solid var(--border-subtle)",
          }}
        >
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              minWidth: 260,
            }}
          >
            <Search
              size={14}
              style={{
                color: "var(--text-faint)",
              }}
            />

            <input
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              placeholder={tx("Ta'minotchi qidirish...")}
              className="bg-transparent outline-none text-sm flex-1"
              style={{
                color: "var(--text-primary)",
              }}
            />
          </div>
          <div className="suppliers-date-filter">
            <DateRangeFilter from={dateFrom} to={dateTo} onFromChange={setDateFrom} onToChange={setDateTo} />
          </div>
        </div>

        {/* Table */}
        <div className="suppliers-table-scroll" role="region" aria-label={tx("Ta'minotchilar jadvali")} tabIndex="0">
        <table className="suppliers-table w-full">
          <thead>
            <tr
              style={{
                background: "var(--table-stripe)",
              }}
            >
              {[
                "Ta'minotchi",
                "Telefon",
                "Mahsulotlar",
                "Jami xaridlar",
                "Qarzdorlik",
                "So'nggi buyurtma",
                "Holat",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left px-5 py-3 text-xs font-semibold"
                  style={{
                    color: "var(--text-faint)",
                  }}
                >
                  {tx(h)}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((s) => {
              const st =
                statusMap[s.status] ||
                statusMap.active;

              return (
                <tr
                  onClick={() =>
                    onNavigate &&
                    onNavigate("supplier-" + s.id)
                  }
                  key={s.id}
                  className="border-t table-row-hover transition-colors"
                  style={{
                    cursor: "pointer",
                    borderColor:
                      "var(--border-subtle)",
                  }}
                >
                  {/* Ta'minotchi */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                        style={{
                          background:
                            "linear-gradient(135deg,var(--brand),var(--violet))",
                        }}
                      >
                        {tx(s.name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join(""))}
                      </div>

                      <span
                        className="text-sm font-semibold"
                        style={{
                          color:
                            "var(--text-primary)",
                        }}
                      >
                        {s.name}
                      </span>
                    </div>
                  </td>

                  {/* Telefon */}
                  <td
                    className="px-5 py-3.5 text-sm"
                    style={{
                      color:
                        "var(--text-secondary)",
                    }}
                  >
                    {s.phone}
                  </td>

                  {/* Mahsulotlar */}
                  <td
                    className="px-5 py-3.5 text-sm"
                    style={{
                      color:
                        "var(--text-secondary)",
                    }}
                  >
                    {tx(s.products)}{tx(" ta")}</td>

                  {/* Xaridlar */}
                  <td
                    className="px-5 py-3.5 text-sm font-semibold"
                    style={{
                      color:
                        "var(--text-primary)",
                    }}
                  >
                    {formatCurrency(s.purchases)}</td>

                  {/* Qarzdorlik */}
                  <td className="px-5 py-3.5">
                    {s.debt > 0 ? (
                      <span
                        className="text-sm font-semibold"
                        style={{
                          color:
                            "var(--danger)",
                        }}
                      >
                        {formatCurrency(s.debt)}</span>
                    ) : (
                      <span
                        className="text-sm"
                        style={{
                          color:
                            "var(--success)",
                        }}
                      >
                        —
                      </span>
                    )}
                  </td>

                  {/* So'nggi buyurtma */}
                  <td
                    className="px-5 py-3.5 text-xs"
                    style={{
                      color:
                        "var(--text-faint)",
                    }}
                  >
                    {tx(s.lastOrder)}
                  </td>

                  {/* Holat */}
                  <td className="px-5 py-3.5">
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-semibold"
                      style={{
                        background: st.bg,
                        color: st.color,
                      }}
                    >
                      {tx(st.label)}
                    </span>
                  </td>

                  {/* Supplier profile shortcut */}
                  <td className="px-5 py-3.5">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onNavigate?.("supplier-" + s.id); }}
                      className="supplier-profile-eye"
                      aria-label={`${tx("Ta'minotchi profilini ko'rish")}: ${s.name}`}
                      title={tx("Profilni ko'rish")}
                    >
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      </>}
      {activeSection === "returns" && <SupplierReturnsLedger records={returnedRecords} showDashboard onReceivePayment={receiveReturnPayment} />}
      <Modal open={returnPickerOpen} onClose={() => setReturnPickerOpen(false)} title="Tovarni qaytarish" contentOnly>
        <Field label={tx("Ta'minotchi, mahsulot yoki ID")}>
          <input
            autoFocus
            className="input-base"
            value={returnSupplierQuery}
            onChange={(event) => setReturnSupplierQuery(event.target.value)}
            placeholder={tx("Ta'minotchi, mahsulot nomi, mahsulot IDsi yoki sotuv IDsi bo'yicha qidiring...")}
          />
        </Field>
        <div className="grid gap-2 mt-3" style={{ height: "min(248px, 40vh)", overflowY: "auto", alignContent: "start", scrollbarGutter: "stable" }}>
          {returnSupplierMatches.map(({ supplier, matchedProduct, matchedSaleId, matchedOrderId }) => (
            <button key={supplier.id} type="button" className="btn-ghost" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => { setReturnPickerOpen(false); onNavigate("supplier-" + supplier.id); }}>
              <span className="grid min-w-0 gap-1">
                <span>{supplier.name}{supplier.phone ? " · " + supplier.phone : ""}</span>
                {returnSearchQuery && matchedProduct && <small className="text-muted-color">{tx("Mahsulot")}: {matchedProduct.name || "—"} · {tx("ID")}: {matchedProduct.id ?? "—"}</small>}
                {returnSearchQuery && matchedSaleId && <small className="text-muted-color">{tx("Sotuv IDsi")}: {matchedSaleId}</small>}
                {returnSearchQuery && matchedOrderId && <small className="text-muted-color">{tx("Buyurtma IDsi")}: {matchedOrderId}</small>}
              </span>
            </button>
          ))}
          {returnSupplierMatches.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-color">{tx("Mos ta'minotchi yoki mahsulot topilmadi")}</p>}
        </div>
      </Modal>

      {/* ============================= */}
      {/* TA'MINOTCHI QO'SHISH MODALI */}
      {/* ============================= */}

      <Modal
        contentOnly
        open={shipmentStepOpen}
        onClose={() => {
          setShipmentStepOpen(false);
          setShipmentStepTarget(null);
        }}
        title={tx("Yuk ma'lumotlarini kiriting")}
        subtitle={tx("Ta'minotchi nomi va reys raqami ixtiyoriy")}
        icon={Package}
        width={680}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <ShipmentFields value={shipmentInfo} onChange={setShipmentInfo} skipped={false} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border-subtle)", paddingTop: 12 }}>
            <button type="button" className="supplier-shipment-skip" style={{ marginTop: 0 }} onClick={skipShipmentInfo}>{tx("O'tkazib yuborish")}</button>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => {
                setShipmentStepOpen(false);
                setShipmentStepTarget(null);
                resetShipmentInfo();
              }}>{tx("Bekor qilish")}</button>
              <button type="button" className="btn-primary" onClick={() => continueShipmentFlow(false)}>{tx("Davom etish")}</button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        contentOnly
        open={open}
        onClose={() => setOpen(false)}
        title={tx("Yangi ta'minotchi qo'shish")}
        subtitle={tx("Yetkazib beruvchi ma'lumotlari")}
        icon={Truck}
        width={760}
      >
        <div style={{ display: "grid", gap: 14 }}>
          {receiptSupplierGroups.map((group) => {
            const groupProducts = pendingProducts.filter((item) => item.supplierGroupKey === group.key);
            return <section key={group.key} style={{ display: "grid", gap: 14 }}>
                <Field label={tx("Ta'minotchi nomi *")}><input className="input-base" value={form.name} required onChange={(event) => updateNewSupplierName(event.target.value)} placeholder={tx("Global Import MChJ")} /></Field>
                <Field label={tx("Telefon raqami")} hint={tx("Faqat raqam kiritiladi")}><PhoneInput required value={form.phone} onChange={(value) => updateNewSupplierForm({ ...form, phone: value })} /></Field>
                <div className={suppliers.length ? "supplier-identity-fields has-saved-suppliers" : "supplier-identity-fields"}>
                  <Field label={tx("Manzil")}><input className="input-base" value={form.address || ""} onChange={(event) => updateNewSupplierForm({ ...form, address: capitalizeStart(event.target.value) })} placeholder={tx("Ta'minotchi manzili (ixtiyoriy)")} /></Field>
                  {suppliers.length > 0 && <Field label={tx("Saqlangan ta'minotchi")}><select className="input-base" value={form.existingSupplierId} onChange={(event) => selectSavedSupplier(event.target.value)}><option value="">{tx("Yangi ta'minotchi")}</option>{suppliers.map((supplier) => <option key={supplier.id} value={String(supplier.id)}>{supplier.name}{supplier.phone ? ` · ${supplier.phone}` : ""}</option>)}</select></Field>}
                </div>
                {selectedSavedSupplier && <div className="supplier-form-help" style={{ padding: "10px 12px", borderRadius: 10, background: "var(--brand-light)", border: "1px solid var(--brand-border)" }}><strong style={{ display: "block", color: "var(--text-primary)", marginBottom: 4 }}>{tx("Saqlangan ta'minotchi ma'lumotlari")}</strong><span>{tx("Telefon")}: {selectedSavedSupplier.phone || "—"}</span>{selectedSavedSupplier.address && <span> · {tx("Manzil")}: {selectedSavedSupplier.address}</span>}<span> · {tx("Oldingi xaridlar")}: {moneyText(selectedSavedSupplier.purchases || 0)}</span></div>}
                <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{tx("Qabul qilingan tovarlar")}</div>
                  {groupProducts.length > 0 && <div style={{ display: "grid", gap: 7, margin: "10px 0 14px" }}>{groupProducts.map((item, index) => <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "9px 10px", borderRadius: 9, background: "var(--surface-2)", fontSize: 12 }}><span><b style={{ color: "var(--text-primary)" }}>{index + 1}. {item.productName}</b><span style={{ color: "var(--text-secondary)" }}> · {item.receivedQuantity} {tx(unitLabel(item))} · {moneyText(draftLineAmount(item))}</span>{defectQuantityOf(item) > 0 && <small style={{ display: "block", color: "var(--danger)", marginTop: 3 }}>{tx("Brak")}: {defectQuantityOf(item)} {tx(unitLabel(item))} · {tx(item.defectStatus)} · {moneyText(defectTotalOf(item))}</small>}</span><button type="button" onClick={() => setPendingProducts((items) => items.filter((product) => product.key !== item.key))} style={{ border: 0, background: "transparent", color: "var(--danger)", fontWeight: 700, cursor: "pointer" }}>{tx("O'chirish")}</button></div>)}</div>}
                  <ReceiptProductFields value={form} onChange={updateNewSupplierForm} suggestions={newSupplierProductSuggestions} onChooseProduct={chooseNewSupplierProduct} />
                  <button type="button" className="btn-ghost" onClick={addPendingProduct} style={{ marginTop: 14, width: "100%", justifyContent: "center", border: "1px dashed var(--brand)", color: "var(--brand)" }}><Plus size={16} />{tx("Boshqa tovar qo'shish")}</button>
                </div>
            </section>;
          })}
          <div className="supplier-receipt-payment-grid">
            <div className="supplier-receipt-payment-total"><small>{tx("Umumiy summa")}</small><b>{moneyText(newSupplierTotal)}</b></div>
            <Field label={tx("Naqd to'lov")}><div className="supplier-money-input"><input className="input-base" inputMode="numeric" value={newSupplierCashInput === "" ? "" : moneyInputValue(newSupplierCashInput)} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ""); setNewSupplierCashInput(digits ? String(Math.min(newSupplierTotal, toBaseMoney(digits))) : ""); }} placeholder="0"/><span>{tx("so'm")}</span></div></Field>
            <div className="supplier-receipt-payment-total supplier-receipt-debt"><small>{tx("Qarzga yoziladi")}</small><b>{moneyText(newSupplierDebt)}</b></div>
          </div>

          {err && (
            <div
              style={{
                fontSize: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background:
                  "var(--danger-light)",
                color: "var(--danger)",
                border:
                  "1px solid var(--danger-border)",
              }}
            >
              {tx(err)}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
            }}
          >
            <button
              type="button"
              className="btn-ghost"
              onClick={discardSupplierDraft}
            >{tx("Bekor qilish")}</button>

            <button
              type="button"
              className="btn-primary"
              onClick={submit}
            >
              <Plus size={15} />{tx("Ta'minotchi va mahsulotlarni saqlash")}</button>
          </div>
        </div>
      </Modal>

      <Modal contentOnly open={newSupplierConfirmation} onClose={() => setNewSupplierConfirmation(false)} title={tx("Qabulni tasdiqlash")} subtitle={tx("Ta'minotchi va mahsulot ma'lumotlarini tekshiring")} icon={Package} width={600}>
        <div className="supplier-receipt-confirm">
          <div className="supplier-receipt-items">
            {receiptSupplierGroups.map((group) => {
              const items = newSupplierDrafts.filter((item) => item.supplierGroupKey === group.key);
              const amount = items.reduce((sum, item) => sum + draftLineAmount(item), 0);
              const defects = items.reduce((sum, item) => sum + defectQuantityOf(item), 0);
              return <section key={group.key}>
                <div><span><b>{group.name || tx("Ta'minotchi")}</b><small>{group.phone}{group.address ? ` · ${group.address}` : ""}</small></span><strong>{moneyText(amount)}</strong></div>
                {items.map((item, index) => <div key={`${group.key}-${item.existingId || item.sku || item.productName}-${index}`}>
                  <span>
                    <b>{capitalizeStart(item.productName)}</b>
                    <small>{[["ID", item.sku], ["Brend", item.brand], ["Kategoriya", item.category], ["Izoh", item.description]].filter(([, value]) => value).map(([label, value]) => tx(label) + ": " + value).join(" · ")}</small>
                    <small>{tx("Qabul qilingan miqdor")}: {Number(item.receivedQuantity) || 0} {tx(unitLabel(item))}</small>
                    <small>{tx("Yaroqli")}: {Math.max(0, Number(item.receivedQuantity) - defectQuantityOf(item))} {tx(unitLabel(item))} × {moneyText(moneyValue(item.cost))} = {moneyText(draftLineAmount(item) - defectTotalOf(item))}</small>
                    {defectQuantityOf(item) > 0 && <>
                      <small>{tx("Brak")}: {defectQuantityOf(item)} {tx(unitLabel(item))} × {moneyText(moneyValue(item.defectUnitPrice))} = {moneyText(defectTotalOf(item))}</small>
                      {item.defectReason && <small>{tx("Brak sababi")}: {item.defectReason}</small>}
                    </>}
                  </span>
                  <strong>{moneyText(draftLineAmount(item))}</strong>
                </div>)}
                <small>{tx("Brak miqdori")}: {defects} {tx("birlik")}</small>
              </section>;
            })}
          </div>
          <dl className="supplier-receipt-totals">
            <div><dt>{tx("Ta'minotchilar")}</dt><dd>{receiptSupplierGroups.length}</dd></div>
            <div><dt>{tx("Mahsulotlar")}</dt><dd>{newSupplierDrafts.length} {tx("xil")}</dd></div>
            <div><dt>{tx("Jami summa")}</dt><dd>{moneyText(newSupplierTotal)}</dd></div>
            <div className="receipt-debt"><dt>{tx("Qarzga yoziladi")}</dt><dd>{moneyText(newSupplierDebt)}</dd></div>
            <div className="receipt-cash"><dt>{tx("Naqd to'lov")}</dt><dd>{moneyText(newSupplierCash)}</dd></div>
          </dl>
          <p className="supplier-receipt-question">{tx("Ushbu ma'lumotlar bilan mahsulotlarni qabul qilishni tasdiqlaysizmi?")}</p>
          <div className="supplier-receipt-buttons">
            <button className="btn-ghost" onClick={() => setNewSupplierConfirmation(false)}>{tx("Bekor qilish")}</button>
            <button className="btn-primary" onClick={submit}><Package size={15} />{tx("Tasdiqlash va saqlash")}</button>
          </div>
        </div>
      </Modal>

      <Modal
        contentOnly
        open={productOpen}
        onClose={() => { setProductOpen(false); setProductErr(""); }}
        title={tx("Yukdagi mahsulotlarni qabul qilish")}
        subtitle={tx("Bir yukni bir nechta ta'minotchidan qabul qiling")}
        icon={Package}
        width={680}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ padding: 12, borderRadius: 12, background: "var(--brand-light)", color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.5 }}>
            {tx("Har bir mahsulotga o'z ta'minotchisini tanlang. Bir yuk qabulida bir nechta ta'minotchining mahsulotlarini kiritish mumkin.")}
          </div>

          <Field label={tx("Ta'minotchi *")}>
            <select className="input-base" value={productForm.supplierId} onChange={(event) => {
              if (event.target.value === String(productForm.supplierId)) { setProductErr(""); return; }
              const currentLineHasInput = Object.entries(emptyProduct).some(([key, emptyValue]) => !["measurementType", "measurementUnit"].includes(key) && productForm[key] !== emptyValue);
              if (currentLineHasInput) {
                setProductErr("Ta'minotchini almashtirishdan oldin joriy mahsulotni qabul ro'yxatiga qo'shing yoki maydonlarni tozalang.");
                return;
              }
              setProductForm({ ...emptyProduct, supplierId: event.target.value });
              setProductErr("");
            }} required>
              <option value="">{tx("Ta'minotchini tanlang")}</option>
              <option value="street">{tx("Ko'chadan / ta'minotchisiz")}</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </Field>
          {!suppliers.length && <p className="supplier-form-help">{tx("Ta'minotchi yo'q bo'lsa, Ko'chadan variantini tanlang.")}</p>}

          {productQueue.length > 0 && (
            <div style={{ padding: 12, borderRadius: 12, background: "var(--brand-light)", border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, fontSize: 12, fontWeight: 700, color: "var(--brand)" }}><span>{tx("Qo'shilgan mahsulotlar")}</span><span>{productQueue.length} {tx("xil")} · {tx("Jami")}: {productQueue.reduce((sum, item) => sum + Number(item.receivedQuantity || 0), 0)} {tx("dona")} · {tx("Brak")}: {productQueue.reduce((sum, item) => sum + defectQuantityOf(item), 0)} {tx("dona")}</span></div>
                <div style={{ display: "grid", gap: 6 }}>{productQueue.map((item, index) => <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 9px", borderRadius: 8, background: "var(--surface)", fontSize: 12 }}><span>{index + 1}. <b>{item.productName}</b> · {item.receivedQuantity} {tx(unitLabel(item))} · {item.supplierId === "street" ? tx("Ko'chadan") : suppliers.find((supplier) => String(supplier.id) === String(item.supplierId))?.name}{defectQuantityOf(item) > 0 && <small style={{ display: "block", color: "var(--danger)", marginTop: 3 }}>{tx("Brak")}: {defectQuantityOf(item)} {tx(unitLabel(item))} · {tx(item.defectStatus)} · {tx("Brak summasi")}: {moneyText(defectTotalOf(item))}</small>}</span><button type="button" onClick={() => setProductQueue((items) => items.filter((product) => product.key !== item.key))} style={{ border: 0, background: "transparent", color: "var(--danger)", cursor: "pointer" }}>{tx("O'chirish")}</button></div>)}</div>
            </div>
          )}

          <ReceiptProductFields value={productForm} onChange={updateProductForm} suggestions={productSuggestions} onChooseProduct={(product) => { chooseProduct(product); setProductErr(""); }} disabled={!productForm.supplierId} />

          <button type="button" className="btn-ghost" disabled={!productForm.supplierId} onClick={queueProduct} style={{ width: "100%", justifyContent: "center", border: "1px dashed var(--brand)", color: "var(--brand)" }}><Plus size={16} />{tx("Yana mahsulot qo'shish")}</button>

          <div className="supplier-receipt-payment-grid">
            <div className="supplier-receipt-payment-total"><small>{tx("Umumiy summa")}</small><b>{moneyText(receiptTotal)}</b></div>
            <Field label={tx("Naqd to'lov")}><div className="supplier-money-input"><input className="input-base" inputMode="numeric" disabled={supplierDebtLimit === 0} value={supplierCashInput === "" ? "" : moneyInputValue(supplierCashInput)} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ""); const minimum = Math.max(0, receiptTotal - supplierDebtLimit); setSupplierCashInput(digits ? String(Math.max(minimum, Math.min(receiptTotal, toBaseMoney(digits)))) : ""); }} placeholder="0"/><span>{tx("so'm")}</span></div></Field>
            <div className="supplier-receipt-payment-total supplier-receipt-debt"><small>{tx("Qarzga yoziladi")}</small><b>{moneyText(receiptDebt)}</b></div>
          </div>

          {productErr && <div style={{ fontSize: 12, padding: "10px 12px", borderRadius: 10, background: "var(--danger-light)", color: "var(--danger)", border: "1px solid var(--danger-border)" }}>{tx(productErr)}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn-ghost" onClick={() => { setProductOpen(false); setProductErr(""); setProductQueue([]); setSupplierCashInput(""); setProductForm({ supplierId: "", ...emptyProduct }); resetShipmentInfo(); }}>{tx("Bekor qilish")}</button>
            <button type="button" className="btn-primary" onClick={addProductToSupplier}><Plus size={15} />{tx("Tovarni qabul qilish")}</button>
          </div>
        </div>
      </Modal>
      <Modal contentOnly open={!!receiptConfirmation} onClose={() => setReceiptConfirmation(false)} title={tx("Mahsulotlarni qabul qilish")} subtitle={tx("Ma'lumotlarni tekshirib, qabul qilishni tasdiqlang")} icon={Package} width={560}>
        <div className="supplier-receipt-confirm">
          <div className="supplier-receipt-heading"><strong>{[...new Set(receiptDrafts.map((draft) => draft.supplierId === "street" ? tx("Ko'chadan") : suppliers.find((item) => String(item.id) === String(draft.supplierId))?.name).filter(Boolean))].join(", ")}</strong><time dateTime={receiptConfirmation || undefined}>{receiptConfirmation && new Date(receiptConfirmation).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>
          {!shipmentInfoSkipped && [shipmentInfo.farmName, shipmentInfo.tripNumber].some((value) => value.trim()) && <p className="supplier-receipt-question">{[shipmentInfo.farmName && `${tx("Ferma / ta'minotchi")}: ${shipmentInfo.farmName}`, shipmentInfo.tripNumber && `${tx("Reys")}: ${shipmentInfo.tripNumber}`].filter(Boolean).join(" · ")}</p>}
          <div className="supplier-receipt-items">{receiptDrafts.map((item, index) => <div key={index}><span><b>{capitalizeStart(item.productName)}</b><small>{item.supplierId === "street" ? tx("Ko'chadan") : suppliers.find((supplier) => String(supplier.id) === String(item.supplierId))?.name} · {Number(item.receivedQuantity)} {tx(unitLabel(item))}{defectQuantityOf(item) > 0 ? ` · ${tx("Brak")}: ${defectQuantityOf(item)} ${tx(unitLabel(item))} · ${tx(item.defectStatus)} · ${tx("Brak summasi")}: ${moneyText(defectTotalOf(item))}` : ""}</small></span><strong>{moneyText(draftLineAmount(item))}</strong></div>)}</div>
          <dl className="supplier-receipt-totals"><div><dt>{tx("Mahsulotlar")}</dt><dd>{receiptDrafts.length} {tx("xil")} · {receiptDrafts.reduce((sum, item) => sum + Number(item.receivedQuantity || 0), 0)} {tx("birlik")}</dd></div><div><dt>{tx("Brak miqdori")}</dt><dd>{receiptDefectQuantity} {tx("birlik")}</dd></div><div><dt>{tx("Brak summasi")}</dt><dd>{moneyText(receiptDefectTotal)}</dd></div><div><dt>{tx("Jami summa")}</dt><dd>{moneyText(receiptTotal)}</dd></div><div className="receipt-cash"><dt>{tx("Naqd to'lov")}</dt><dd>{moneyText(receiptCash)}</dd></div><div className="receipt-debt"><dt>{tx("Qarzga yoziladi")}</dt><dd>{moneyText(receiptDebt)}</dd></div></dl>
          <p className="supplier-receipt-question">{tx("Ushbu yukdagi mahsulotlarni ko'rsatilgan naqd to'lov va qarz bilan qabul qilishni tasdiqlaysizmi?")}</p>
          <div className="supplier-receipt-buttons"><button className="btn-ghost" onClick={() => setReceiptConfirmation(false)}>{tx("Bekor qilish")}</button><button className="btn-primary" onClick={addProductToSupplier}>{tx("Ha, qabul qilish")}</button></div>
        </div>
      </Modal>
      {receiptAnimation && createPortal(<PaymentSuccessAnimation {...receiptAnimation} title="Tovarlar qabul qilindi" />, document.getElementById("main-modal-root"))}
    </div>
  );
}
