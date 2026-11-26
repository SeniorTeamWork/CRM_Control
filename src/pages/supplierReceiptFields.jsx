// Ta'minotchidan tovar qabul qilish formasi — "Yangi ta'minotchi" va
// "Ta'minotchi profili → Tovar qabul qilish" oynalari shu umumiy formadan foydalanadi.
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Field } from "../components/Modal";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import "./Suppliers.css";
import { findSkuOwner, skuTakenMessage, uniqueProducts } from "../data/productIdentity";

export const emptyProduct = {
  productName: "", description: "", brand: "", sku: "", category: "", packaging: "", extraMeasurement: "", extraMeasurementValue: "",
  receivedQuantity: "", defectiveQuantity: "", defectStatus: "", defectReason: "", defectUnitPrice: "", defectSalePrice: "", unitsPerPackage: "", liters: "", weight: "", volume: "",
  length: "", width: "", height: "", cost: "", price: "", measurementType: "count", measurementUnit: "dona",
};
export const measurementUnits = ["dona", "metr", "santimetr", "millimetr", "kilometr", "kilogramm", "gramm", "milligramm", "litr", "millilitr", "quti", "karobka", "paket", "qop", "rulon", "juft", "to'plam"];
export const normalizedUnit = (value) => String(value || "").trim().toLocaleLowerCase("uz-UZ");
export const isMeterUnit = (value) => ["metr", "meter", "m"].includes(normalizedUnit(value));
export const allowsDecimalUnit = (value) => ["metr", "meter", "m", "santimetr", "sm", "cm", "millimetr", "mm", "kilometr", "km", "kilogramm", "kg", "gramm", "g", "milligramm", "mg", "litr", "l", "millilitr", "ml"].includes(normalizedUnit(value));
export const unitLabel = (item) => item?.measurementUnit || (item?.measurementType === "weight" ? "kg" : "dona");

export const moneyValue = (value) => Number(String(value ?? "").replace(/[^\d]/g, "")) || 0;
export const quantityInputValue = (value, allowDecimal) => {
  const normalized = String(value ?? "").replace(/,/g, ".").replace(allowDecimal ? /[^\d.]/g : /\D/g, "");
  if (!allowDecimal) return normalized.replace(/^0+(?=\d)/, "");
  const [whole, ...fractionParts] = normalized.split(".");
  const fraction = fractionParts.join("").replace(/\./g, "");
  const cleanWhole = whole.replace(/^0+(?=\d)/, "");
  return normalized.includes(".") ? `${cleanWhole || "0"}.${fraction}` : cleanWhole;
};
export const moneyText = (value) => formatCurrency(value);
export const defectQuantityOf = (product) => Math.max(0, Number(product.defectiveQuantity) || 0);
export const defectTotalOf = (product) => defectQuantityOf(product) * moneyValue(product.defectUnitPrice);
export const receiptLineAmount = (quantity, cost, defectiveQuantity, defectAmount) =>
  Math.max(0, quantity - defectiveQuantity) * moneyValue(cost) + defectAmount;
export const draftLineAmount = (item) => receiptLineAmount(Number(item.receivedQuantity) || 0, item.cost, defectQuantityOf(item), defectTotalOf(item));
export const savedLineAmount = (item) => receiptLineAmount(item.quantity, item.cost, item.defectiveQuantity, item.defectiveQuantity * moneyValue(item.defectUnitPrice));
export const receivedProductAmount = (item) => receiptLineAmount(item.stock, item.cost, Number(item.defectiveStock) || 0, (item.defects || []).reduce((sum, defect) => sum + Number(defect.total || 0), 0));
export const createDefectEntry = (draft, productId, supplier, receiptId, date) => {
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

export const capitalizeStart = (value = "") => value ? value[0].toLocaleUpperCase("uz-UZ") + value.slice(1) : "";
export const fillFromSavedProduct = (current, product) => ({
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

export function MeasurementUnitInput({ value, disabled, onChange }) {
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

export function ReceiptProductFields({ value, onChange, suggestions = [], catalog = suggestions, onChooseProduct, disabled = false }) {
  const update = (key, nextValue) => onChange((current) => ({ ...current, [key]: nextValue }));
  // Oldin olingan mahsulot nomi to'liq yozilsa, ID raqami va boshqa ma'lumotlari avtomatik to'ldiriladi.
  const exactNameMatch = (name) => {
    const key = String(name || "").trim().toLocaleLowerCase("uz-UZ");
    if (!key) return null;
    const matches = uniqueProducts(catalog).filter((product) => String(product.name || "").trim().toLocaleLowerCase("uz-UZ") === key);
    const distinct = new Set(matches.map((product) => `${String(product.brand || "").trim().toLocaleLowerCase("uz-UZ")}|${String(product.sku || "").trim().toLocaleLowerCase("uz-UZ")}`));
    return distinct.size === 1 ? matches.reduce((best, product) => Number(product.stock || 0) > Number(best.stock || 0) ? product : best, matches[0]) : null;
  };
  const changeName = (rawValue) => onChange((current) => {
    const productName = capitalizeStart(rawValue);
    const base = current.existingId
      ? { ...current, ...emptyProduct, supplierId: current.supplierId, productName, existingId: null }
      : { ...current, productName };
    const match = exactNameMatch(productName);
    return match ? { ...fillFromSavedProduct(base, match), productName, receivedQuantity: base.receivedQuantity } : base;
  });
  const uniqueSuggestions = uniqueProducts(suggestions);
  const skuOwner = findSkuOwner(catalog, { sku: value.sku, name: value.productName, brand: value.brand, excludeId: value.existingId });
  const nameMatches = value.productName.trim()
    ? uniqueSuggestions.filter((product) => String(product.name || "").toLocaleLowerCase("uz-UZ").startsWith(value.productName.trim().toLocaleLowerCase("uz-UZ"))).slice(0, 6)
    : [];
  const skuMatches = value.sku.trim()
    ? uniqueSuggestions.filter((product) => [product.sku, product.id].some((code) => String(code || "").toLocaleLowerCase("uz-UZ").startsWith(value.sku.trim().toLocaleLowerCase("uz-UZ")))).slice(0, 6)
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
          <input className="input-base" value={value.sku} disabled={disabled} aria-invalid={Boolean(skuOwner)} style={skuOwner ? { borderColor: "var(--danger)", background: "var(--danger-light)", color: "var(--danger)", boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.15)" } : undefined} onChange={(event) => {
            const sku = event.target.value.toLocaleUpperCase("uz-UZ");
          if (!sku && value.existingId) onChange((current) => ({ ...current, ...emptyProduct, supplierId: current.supplierId, sku: "", existingId: null }));
            else update("sku", sku);
          }} placeholder={tx("Ixtiyoriy")} autoComplete="off" />
          {!disabled && skuMatches.length > 0 && <div className="supplier-learned-options">{skuMatches.map((product) => <button type="button" key={product.id} onMouseDown={(event) => event.preventDefault()} onClick={() => onChooseProduct?.(product)}>{product.sku || product.id} · {product.name}{product.brand ? ` · ${product.brand}` : ""}</button>)}</div>}
        </div>
        {skuOwner && <small style={{ display: "block", marginTop: 6, color: "var(--danger)", fontSize: 12 }}>{tx(skuTakenMessage(value.sku, skuOwner))}</small>}
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

/** Bitta qabul qatorini tekshiradi. Xato bo'lsa matn, bo'lmasa "" qaytaradi. */
export const receiptProductError = (product) => {
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

/** SKU boshqa mahsulotga berilgan bo'lsa xato matnini qaytaradi. */
export const receiptSkuError = (product, catalog) => {
  const owner = findSkuOwner(catalog, { sku: product.sku, name: product.productName, brand: product.brand, excludeId: product.existingId });
  return owner ? skuTakenMessage(product.sku.trim(), owner) : "";
};
