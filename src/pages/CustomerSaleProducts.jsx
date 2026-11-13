import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { MapPin, CheckCircle, RotateCcw } from "lucide-react";
import { products as catalogProducts } from "../data/mockData";
import { formatCurrency } from "../data/currency";
import { returnKeyFor, returnedQuantityFor } from './customerDetailHelpers';

export function SaleProductList({ sale, returnRecords = [], onReturn = () => {} }) {
  useUILanguage();
  const count = Number(sale.products) || 0;
  const items = sale.items?.length
    ? sale.items.map((item) => ({
        ...item,
        name: item.name || "Nomi kiritilmagan mahsulot",
        deliveryAddress: item.deliveryAddress || sale.deliveryAddress || "Manzil biriktirilmagan",
      }))
    : (sale.productIds || [])
      .slice(0, count)
      .map((id) => catalogProducts.find((product) => product.id === id))
      .filter(Boolean)
      .map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        quantityUnknown: true,
        deliveryAddress: sale.deliveryAddress || "Manzil biriktirilmagan",
      }));
  const missing = Math.max(0, count - items.length);
  const grossItemsTotal = items.reduce((sum, item) => {
    const quantity = Number(item.qty ?? item.quantity ?? 0);
    const lineTotal = item.total != null ? Number(item.total) : Number(item.price || 0) * quantity;
    return sum + lineTotal;
  }, 0);
  const saleReturns = returnRecords.filter((record) => record.status === "approved" && String(record.saleId) === String(sale.id));
  const returnedAmount = saleReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const originalSaleAmount = Number(sale.amount ?? sale.total ?? grossItemsTotal) + returnedAmount;
  const salePriceFactor = grossItemsTotal > 0 ? originalSaleAmount / grossItemsTotal : 1;

  return (
    <div className="customer-sale-products">
      <strong>{tx(count)}{tx(" xil mahsulot")}</strong>
      {items.length > 0 && (
        <div className="customer-sale-product-list">
          {items.map((item, index) => {
            const returnKey = returnKeyFor(sale.id, item.id, index);
            const quantity = Number(item.qty ?? item.quantity ?? 1);
            const sameProductRows = items.filter((saleItem) => String(saleItem.id ?? "") === String(item.id ?? "")).length;
            const lineReturns = saleReturns.filter((record) => record.returnKey === returnKey || (!record.returnKey && sameProductRows === 1 && String(record.productId ?? "") === String(item.id ?? "")));
            const returnedFromHistory = lineReturns.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
            const returnedQuantity = Math.min(quantity, Math.max(Number(item.returnedQuantity || 0), item.returned ? quantity : returnedQuantityFor(returnRecords, returnKey, quantity), returnedFromHistory));
            const recordedReturnedAmount = lineReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
            const returnedAmount = recordedReturnedAmount || returnedQuantity * Number(item.price ?? (Number(item.total || 0) / Math.max(1, quantity))) * salePriceFactor;
            const baseLineTotal = item.total != null ? Number(item.total) : Number(item.price || 0) * quantity;
            const unitPrice = Math.round(Number(item.price ?? (baseLineTotal / Math.max(1, quantity))) * salePriceFactor);
            const lineTotal = Math.round(baseLineTotal * salePriceFactor);
            const netLineTotal = Math.max(0, lineTotal - returnedAmount);
            const isReturned = returnedQuantity >= quantity;
            return (
              <div className="customer-sale-product-item" key={returnKey}>
                <div className="customer-sale-product-info">
                  <div className="customer-sale-product-title"><strong>{item.name}</strong>{(item.isDefectSale || item.defectId) && <em>{tx("Brak mahsulot")}</em>}</div>
                  <span className="customer-sale-product-quantity" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {item.quantityUnknown ? tx("Miqdor kiritilmagan") : <>{tx("Sotib olingan")}: {quantity.toLocaleString("uz-UZ")} {tx("dona")}</>}
                  </span>
                  <div className="customer-sale-product-financial">
                    <span><small>{tx("Bir dona narxi")}</small><b>{formatCurrency(unitPrice)}</b></span>
                    <span><small>{tx("Sotuv summasi")}</small><b>{formatCurrency(lineTotal)}</b></span>
                    {returnedQuantity > 0 && <span className="is-returned"><small>{tx("Qaytarilgan")}: {returnedQuantity.toLocaleString("uz-UZ")} {tx("dona")}</small><b>− {formatCurrency(returnedAmount)}</b></span>}
                    <span className="is-net"><small>{tx("Qolgan summa")}</small><b>{formatCurrency(netLineTotal)}</b></span>
                  </div>
                  {returnedQuantity > 0 && (lineReturns.length > 0 && lineReturns.every((record) => record.goodQuantity != null && record.defectiveQuantity != null)
                    ? <span className="customer-sale-product-return-detail">{tx("Qaytarish tarkibi")}: {tx("Yaroqli")} {lineReturns.reduce((sum, record) => sum + Number(record.goodQuantity || 0), 0).toLocaleString("uz-UZ")} {tx("dona")} · {tx("Brak")}: {lineReturns.reduce((sum, record) => sum + Number(record.defectiveQuantity || 0), 0).toLocaleString("uz-UZ")} {tx("dona")}</span>
                    : <span className="customer-sale-product-return-detail">{tx("Eski qaytarish yozuvida yaroqli va brak sonlari alohida saqlanmagan.")}</span>)}
                  <span className="customer-sale-product-address"><MapPin size={14} /> {tx(item.deliveryAddress)}</span>
                </div>
                <button
                  type="button"
                  className={`customer-product-return ${isReturned ? "is-requested" : ""}`}
                  onClick={() => onReturn(sale, item, index)}
                  disabled={isReturned}
                >
                  {isReturned ? <CheckCircle size={14} /> : <RotateCcw size={14} />}
                  {tx(isReturned ? "Qaytarilgan" : "Tovarni qaytarish")}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {missing > 0 && <span>{tx(missing)}{tx(" ta mahsulot nomi kiritilmagan")}</span>}
    </div>
  );
}
