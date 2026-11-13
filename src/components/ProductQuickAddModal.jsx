import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Package, Plus, ShoppingCart, X } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency } from "../data/currency";
import "./ProductQuickAddModal.css";
import { getData } from "../supabase/db";

const readList = (key) => {
  try {
    const value = getData(key, []);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const toTime = (value) => {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
};

export default function ProductQuickAddModal({ product, suppliers, quantity, onQuantityChange, onAdd, defectRows = [], initialDefectId = null, onClose }) {
  useLanguage();
  const quantityRef = useRef(null);
  const allowZeroQuantity = Boolean(initialDefectId);
  const [defectQuantities, setDefectQuantities] = useState(() => initialDefectId ? { [String(initialDefectId)]: "1" } : {});
  const defectOptions = Array.isArray(defectRows) ? defectRows : null;
  const stock = Math.max(0, Math.floor(Number(product.defectLotQuantity ?? product.stock) || 0));
  const unitPrice = Number(product.defectPrice ?? product.price) || 0;
  const visibleDefectOptions = defectOptions
    ? defectOptions.filter((row) => !String(row.defectStatus || "").trim().toLocaleLowerCase("uz-UZ").startsWith("qisman ishlaydi"))
    : null;
  const allDefectQuantity = (visibleDefectOptions || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.defectLotQuantity) || 0)), 0);
  const allDefectAmount = (visibleDefectOptions || []).reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.defectLotQuantity) || 0)) * (Number(row.defectPrice) || 0), 0);
  const allDefectQuantityKey = "__all_brak__";
  const receipts = readList("crm_supplier_receipts")
    .map((receipt) => ({
      ...receipt,
      line: (Array.isArray(receipt.products) ? receipt.products : Array.isArray(receipt.productDetails) ? receipt.productDetails : [])
        .find((item) => String(item.id ?? item.productId) === String(product.id)),
    }))
    .filter((receipt) => receipt.line)
    .sort((a, b) => toTime(b.date) - toTime(a.date));
  const latestReceipt = receipts[0];
  const supplierId = product.supplierId ?? latestReceipt?.supplierId;
  const supplier = suppliers.find((item) => String(item.id) === String(supplierId));
  const supplierName = product.supplierName || latestReceipt?.supplier || supplier?.name || "";
  const receivedAt = latestReceipt?.date || product.lastReceivedAt || product.receivedAt || "";
  const receivedQuantity = latestReceipt?.line?.quantity;
  const receivedDate = receivedAt && toTime(receivedAt) ? new Date(receivedAt) : null;
  const formattedDate = receivedDate
    ? [String(receivedDate.getDate()).padStart(2, "0"), String(receivedDate.getMonth() + 1).padStart(2, "0"), receivedDate.getFullYear()].join(".")
    : "";

  useEffect(() => {
    quantityRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const setQuantity = (value) => {
    if (value === "") return onQuantityChange("");
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    onQuantityChange(String(Math.max(0, Math.min(stock, Math.floor(number)))));
  };

  const setDefectQuantity = (defectId, availableStock, value) => {
    if (!availableStock) return;
    if (value === "") {
      setDefectQuantities((current) => ({ ...current, [defectId]: "" }));
      return;
    }
    const digits = String(value).replace(/\D/g, "");
    const next = Math.max(0, Math.min(availableStock, Math.floor(Number(digits) || 0)));
    setDefectQuantities((current) => ({ ...current, [defectId]: String(next) }));
  };

  const rawAllDefectQuantity = defectQuantities[allDefectQuantityKey] ?? "0";
  const selectedAllDefectQuantity = rawAllDefectQuantity === "" ? 0 : Math.max(0, Math.min(allDefectQuantity, Math.floor(Number(rawAllDefectQuantity) || 0)));
  let unallocatedDefectQuantity = selectedAllDefectQuantity;
  const selectedDefectLines = (visibleDefectOptions || []).slice().reverse().flatMap((row) => {
    if (unallocatedDefectQuantity <= 0) return [];
    const availableQty = Math.max(0, Math.floor(Number(row.defectLotQuantity) || 0));
    const rowQty = Math.min(availableQty, unallocatedDefectQuantity);
    unallocatedDefectQuantity -= rowQty;
    return rowQty > 0 ? [{ product: row, quantity: rowQty }] : [];
  });
  const defectSubtotal = selectedDefectLines.reduce((sum, line) => sum + line.quantity * (Number(line.product.defectPrice) || 0), 0);
  const total = (Number(quantity) || 0) * unitPrice + defectSubtotal;

  return createPortal(
    <div className="crm-content-modal product-quick-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="product-quick-modal" role="dialog" aria-modal="true" aria-labelledby="product-quick-title">
        <header className="product-quick-header">
          <div><span>{tx("Mahsulot tafsilotlari")}</span><h2 id="product-quick-title">{product.name}</h2></div>
          <button type="button" className="product-quick-close" onClick={onClose} aria-label={tx("Oynani yopish")}><X size={20} /></button>
        </header>
        <div className="product-quick-body">
          <div className="product-quick-overview">
            <div className="product-quick-image" aria-hidden="true"><Package size={26} strokeWidth={1.8} /></div>
            <div><span>{`${tx(product.defectId ? "Brak holati:" : "Kategoriya:")} ${tx(product.defectId ? product.defectStatus || "Brak" : product.category || "Ko'rsatilmagan")}`}</span><small>{tx(product.defectId ? "Brak sababi" : "Bir birlik narxi")}</small>{product.defectId && product.defectReason && <small>{tx(product.defectReason)}</small>}<strong>{formatCurrency(unitPrice)}</strong>{product.sku && <small>{tx("Artikul")}: {product.sku}</small>}</div>
          </div>
          <dl className="product-quick-details">
            <div><dt>{tx("Brend")}</dt><dd>{product.brand || tx("Ko'rsatilmagan")}</dd></div>
            <div><dt>{tx("Qadoq turi")}</dt><dd>{tx(({ piece: "Dona", box: "Karobka", pack: "Paket", bottle: "Butilka", bag: "Qop", roll: "Rulon" })[product.packaging] || product.packaging || "Ko'rsatilmagan")}</dd></div>
            {product.extraMeasurement && <div><dt>{product.extraMeasurement}</dt><dd>{product.extraMeasurementValue || tx("Ko'rsatilmagan")}</dd></div>}
            <div><dt>{tx("Ta'minotchi")}</dt><dd>{supplierName || tx("Ta'minotchi ko'rsatilmagan")}</dd></div>
            <div><dt>{tx("Omborga kelgan sana")}</dt><dd>{formattedDate ? `${formattedDate} · ${receivedDate.toLocaleTimeString("uz-UZ", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit" })}` : tx("Kirim sanasi qayd qilinmagan")}{receivedQuantity != null && <small>{tx("So'nggi kirim")}: {Number(receivedQuantity).toLocaleString()} {tx("dona")}</small>}</dd></div>
            <div><dt>{tx(product.defectId ? "Brak qoldig'i" : "Yaroqli")}</dt><dd className={stock ? "is-available" : "is-empty"}>{stock.toLocaleString()} {tx("dona")}</dd></div>
          </dl>
          {defectOptions && (
            <section className="product-quick-defect-section" aria-label={tx("Brak mahsulotlar")}>
              {allDefectQuantity === 0
                ? <p className="product-quick-defect-empty">{tx("Bu mahsulotdan brak qoldig'i yo'q")}</p>
                : <div className="product-quick-defect-list"><article className="product-quick-defect-option">
                  <div className="product-quick-defect-info"><strong>{tx("Brak")}</strong><small>{tx("Omborda")}: {allDefectQuantity.toLocaleString()} {tx("dona")}</small></div>
                  <div className="product-quick-defect-buy"><strong>{formatCurrency(allDefectAmount)}</strong></div>
                </article></div>}
            </section>
          )}
          <div className="product-quick-total"><span>{tx("Tanlangan miqdor uchun jami")}<small>{Number(quantity) || 0} × {formatCurrency(unitPrice)}{defectSubtotal > 0 ? ` + ${formatCurrency(defectSubtotal)} ${tx("braklar")}` : ""}</small></span><strong>{formatCurrency(total)}</strong></div>
        </div>
        <footer className={`product-quick-footer${defectOptions?.length ? " has-defect-quantities" : ""}`}>
          <div className="product-quick-quantity">
            <label htmlFor="product-quick-quantity">{tx(product.defectId ? "Brak" : "Yaroqli")}</label>
            <div className="product-quick-stepper">
              <button type="button" aria-label={tx("Kamaytirish")} disabled={Number(quantity) <= (allowZeroQuantity ? 0 : 1) || !stock} onClick={() => setQuantity(Number(quantity || 1) - 1)}><Minus size={17} /></button>
              <input ref={quantityRef} id="product-quick-quantity" type="number" inputMode="numeric" min={allowZeroQuantity ? "0" : "1"} max={stock} step="1" value={quantity} disabled={!stock} aria-label={tx(product.defectId ? "Brak" : "Yaroqli")} onChange={(event) => setQuantity(event.target.value)} />
              <button type="button" aria-label={tx("Ko'paytirish")} disabled={!stock || Number(quantity) >= stock} onClick={() => setQuantity(Number(quantity || 0) + 1)}><Plus size={17} /></button>
            </div>
            <small>{stock ? `${tx("Mavjud")} ${stock.toLocaleString()} ${tx("dona")}` : tx("Mahsulot tugagan")}</small>
          </div>

          {allDefectQuantity > 0 && (
            <div className="product-quick-defect-quantity-list" aria-label={tx("Brak miqdorlari")}>
              <div className="product-quick-defect-quantity">
                <label htmlFor="product-quick-all-defect-quantity">{tx("Brak")}</label>
                <div className="product-quick-defect-stepper">
                  <button type="button" aria-label={`${tx("Brak miqdorini kamaytirish")}: ${tx("Brak")}`} disabled={selectedAllDefectQuantity <= 0} onClick={() => setDefectQuantity(allDefectQuantityKey, allDefectQuantity, selectedAllDefectQuantity - 1)}><Minus size={15} /></button>
                  <input id="product-quick-all-defect-quantity" type="text" inputMode="numeric" pattern="[0-9]*" value={rawAllDefectQuantity === "" ? "" : selectedAllDefectQuantity} aria-label={`${tx("Brak miqdori")}: ${tx("Brak")}`} onChange={(event) => setDefectQuantity(allDefectQuantityKey, allDefectQuantity, event.target.value)} onBlur={() => { if (rawAllDefectQuantity === "") setDefectQuantity(allDefectQuantityKey, allDefectQuantity, 0); }} />
                  <button type="button" aria-label={`${tx("Brak miqdorini ko'paytirish")}: ${tx("Brak")}`} disabled={selectedAllDefectQuantity >= allDefectQuantity} onClick={() => setDefectQuantity(allDefectQuantityKey, allDefectQuantity, selectedAllDefectQuantity + 1)}><Plus size={15} /></button>
                </div>
              </div>
            </div>
          )}

          <button type="button" className="product-quick-cancel" onClick={onClose}>{tx("Bekor qilish")}</button>
          <button type="button" className="product-quick-add" disabled={(!stock && selectedDefectLines.length === 0) || (!Number(quantity) && selectedDefectLines.length === 0)} onClick={() => onAdd(Number(quantity), selectedDefectLines)}><ShoppingCart size={17} />{tx("Savatga qo'shish")}</button>
        </footer>
      </section>
    </div>,
    document.getElementById("main-modal-root") || document.body,
  );
}
