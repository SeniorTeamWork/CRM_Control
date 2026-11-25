import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { CheckCircle, RotateCcw } from "lucide-react";
import { useProducts } from "../supabase/bolimlar/mahsulotlar";
import { formatCurrency } from "../data/currency";
import { uniqueProductCount } from "../data/productCounts";
import { returnKeyFor, returnedQuantityFor } from './customerDetailHelpers';

const isDefectiveLine = (item) => Boolean(
  item.isDefectSale ||
  item.isDefective ||
  item.defectId ||
  ["defective", "defect", "brak", "yaroqsiz"].includes(String(item.condition || "").trim().toLowerCase())
);

export const uniqueSaleProductCount = (sale) => {
  const items = Array.isArray(sale?.items) && sale.items.length
    ? sale.items
    : (sale?.productIds || []).map((id) => ({ id }));
  return uniqueProductCount(items, sale?.products);
};

export function SaleProductList({ sale, returnRecords = [], onReturn = () => {} }) {
  useUILanguage();
  const catalogProducts = useProducts();
  const items = sale.items?.length
    ? sale.items.map((item) => ({
        ...item,
        name: item.name || "Nomi kiritilmagan mahsulot",
        deliveryAddress: item.deliveryAddress || sale.deliveryAddress || "Manzil biriktirilmagan",
      }))
    : (sale.productIds || [])
      .map((id) => catalogProducts.find((product) => String(product.id) === String(id)))
      .filter(Boolean)
      .map((product) => ({
        id: product.id,
        name: product.name,
        price: product.price,
        qty: 1,
        quantityUnknown: true,
        deliveryAddress: sale.deliveryAddress || "Manzil biriktirilmagan",
      }));
  const saleReturns = returnRecords.filter((record) => record.status === "approved" && String(record.saleId) === String(sale.id));
  const grossItemsTotal = items.reduce((sum, item) => {
    const quantity = Number(item.qty ?? item.quantity ?? 0);
    return sum + (item.total != null ? Number(item.total) : Number(item.price || 0) * quantity);
  }, 0);
  const returnedSaleAmount = saleReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const salePriceFactor = grossItemsTotal > 0 ? (Number(sale.amount ?? sale.total ?? grossItemsTotal) + returnedSaleAmount) / grossItemsTotal : 1;

  const lineItems = items.map((item, index) => {
    const returnKey = returnKeyFor(sale.id, item.id, index);
    const quantity = Number(item.qty ?? item.quantity ?? 1);
    const sameProductRows = items.filter((saleItem) => String(saleItem.id ?? "") === String(item.id ?? "")).length;
    const lineReturns = saleReturns.filter((record) => record.returnKey === returnKey || (!record.returnKey && sameProductRows === 1 && String(record.productId ?? "") === String(item.id ?? "")));
    const returnedFromHistory = lineReturns.reduce((sum, record) => sum + Number(record.quantity || 0), 0);
    const returnedQuantity = Math.min(quantity, Math.max(returnedQuantityFor(returnRecords, returnKey, quantity, item), returnedFromHistory));
    const recordedReturnedAmount = lineReturns.reduce((sum, record) => sum + Number(record.amount || 0), 0);
    const baseLineTotal = item.total != null ? Number(item.total) : Number(item.price || 0) * quantity;
    const unitPrice = Math.round(Number(item.price ?? (baseLineTotal / Math.max(1, quantity))) * salePriceFactor);
    const lineTotal = Math.round(baseLineTotal * salePriceFactor);
    const returnedAmount = recordedReturnedAmount || returnedQuantity * unitPrice;
    return {
      item,
      index,
      returnKey,
      quantity,
      unitPrice,
      lineTotal,
      returnedQuantity,
      returnedAmount,
      remainingQuantity: Math.max(0, quantity - returnedQuantity),
      isDefective: isDefectiveLine(item),
      isReturned: returnedQuantity >= quantity,
      lineReturns,
    };
  });

  const groups = lineItems.reduce((result, line) => {
    const identity = line.item.id != null && line.item.id !== ""
      ? `id:${String(line.item.id).trim().toLocaleLowerCase()}`
      : `name:${String(line.item.name).trim().toLocaleLowerCase()}`;
    let group = result.find((entry) => entry.identity === identity);
    if (!group) {
      group = { identity, name: line.item.name, lines: [] };
      result.push(group);
    }
    group.lines.push(line);
    return result;
  }, []);
  const count = groups.length || uniqueSaleProductCount(sale);
  const missing = Math.max(0, uniqueSaleProductCount(sale) - uniqueProductCount(lineItems));

  return (
    <div className="customer-sale-products">
      <strong>{tx(count)}{tx(" xil mahsulot")}</strong>
      {groups.length > 0 && (
        <div className="customer-sale-product-list">
          {groups.map((group) => {
            const goodLines = group.lines.filter((line) => !line.isDefective);
            const defectiveLines = group.lines.filter((line) => line.isDefective);
            const goodQuantity = goodLines.reduce((sum, line) => sum + line.quantity, 0);
            const defectiveQuantity = defectiveLines.reduce((sum, line) => sum + line.quantity, 0);
            const goodTotal = goodLines.reduce((sum, line) => sum + line.lineTotal, 0);
            const defectiveTotal = defectiveLines.reduce((sum, line) => sum + line.lineTotal, 0);
            const total = goodTotal + defectiveTotal;
            const returnedAmount = group.lines.reduce((sum, line) => sum + line.returnedAmount, 0);
            const goodReturnLine = goodLines.find((line) => line.remainingQuantity > 0);
            const defectiveReturnLine = defectiveLines.find((line) => line.remainingQuantity > 0);
            const metaLine = group.lines.find(({ item }) => item.id || item.brand || item.category);
            const meta = metaLine?.item;
            const priceBreakdown = (lines) => lines.map((line) => `${formatCurrency(line.unitPrice)} × ${line.quantity.toLocaleString("uz-UZ")}`).join(" · ");
            return (
              <div className="customer-sale-product-item customer-sale-product-group" key={group.identity}>
                <div className="customer-sale-product-info">
                  <div className="customer-sale-product-title"><strong>{group.name}</strong></div>
                  {(meta?.id || meta?.brand || meta?.category) && (
                    <small className="customer-sale-product-meta">
                      {[meta.id && `${tx("ID")}: ${meta.id}`, meta.brand && `${tx("Brend")}: ${tx(meta.brand)}`, meta.category && `${tx("Kategoriya")}: ${tx(meta.category)}`].filter(Boolean).join(" · ")}
                    </small>
                  )}
                  <div className="customer-sale-condition-list">
                    {goodQuantity > 0 && <div className="customer-sale-condition is-good">
                      <div><b>{tx("Yaroqli")}: {goodQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b><small>{priceBreakdown(goodLines)}</small></div>
                      <strong>{formatCurrency(goodTotal)}</strong>
                      <div className="customer-sale-condition-actions"><button type="button" className={`customer-product-return customer-product-return-compact ${goodReturnLine ? "" : "is-requested"}`} onClick={() => goodReturnLine && onReturn(sale, goodReturnLine.item, goodReturnLine.index)} disabled={!goodReturnLine}>
                        {goodReturnLine ? <RotateCcw size={13} /> : <CheckCircle size={13} />}{tx(goodReturnLine ? "Tovarni qaytarish" : "Qaytarilgan")}
                      </button></div>
                    </div>}
                    {defectiveQuantity > 0 && <div className="customer-sale-condition is-defective">
                      <div><b>{tx("Brak")}: {defectiveQuantity.toLocaleString("uz-UZ")} {tx("dona")}</b><small>{priceBreakdown(defectiveLines)}</small></div>
                      <strong>{formatCurrency(defectiveTotal)}</strong>
                      <div className="customer-sale-condition-actions"><button type="button" className={`customer-product-return customer-product-return-compact ${defectiveReturnLine ? "" : "is-requested"}`} onClick={() => defectiveReturnLine && onReturn(sale, defectiveReturnLine.item, defectiveReturnLine.index)} disabled={!defectiveReturnLine}>
                        {defectiveReturnLine ? <RotateCcw size={13} /> : <CheckCircle size={13} />}{tx(defectiveReturnLine ? "Tovarni qaytarish" : "Qaytarilgan")}
                      </button></div>
                    </div>}
                  </div>
                  <div className="customer-sale-product-total"><span>{tx("Umumiy summa")}</span><b>{formatCurrency(total)}</b></div>
                  {returnedAmount > 0 && <span className="customer-sale-product-return-detail">{tx("Qaytarilgan summa")}: − {formatCurrency(returnedAmount)} · {tx("Qaytarilgan miqdor")}: {group.lines.reduce((sum, line) => sum + line.returnedQuantity, 0).toLocaleString("uz-UZ")} {tx("dona")}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {missing > 0 && <span>{tx(missing)}{tx(" ta mahsulot nomi kiritilmagan")}</span>}
    </div>
  );
}
