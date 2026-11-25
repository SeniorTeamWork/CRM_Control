import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardList, Download, FileText, MapPin, Package, Printer, Search, UserRound } from "lucide-react";
import Modal from "../components/Modal";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatCurrency } from "../data/currency";
import { uniqueProductCount } from "../data/productCounts";
import { readDebtPayments, readPosSales, withDebtBalance } from "../data/debtPayments";
import { ADDITIONAL_SALES_KEY, getReturns, getSales, SALES_KEY, saveSales } from "../supabase/bolimlar/sotuvlar";
import { useDataVersion } from "../supabase/db";
import { translateText as tx } from "../locales/translateText";
import { useLanguage as useUILanguage } from "../context/LanguageContext";
import { downloadPendingPickupExcel, downloadPendingPickupPdf, printPendingPickupReceipt } from "../data/pendingPickupReceipt";
import { useToast } from "../context/ToastContext";
import "./PendingPickups.css";

const dateKey = (value) => {
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const todayKey = () => dateKey(new Date());
const displayDate = (value, withTime = false) => value && !Number.isNaN(new Date(value).getTime())
  ? new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", year: "numeric", month: "short", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) })
  : "—";
const quantityOf = (item) => Math.max(0, Number(item.qty ?? item.quantity ?? 0));
const salePaidAmount = (sale) => Number(sale.paidAmount ?? sale.initialPaidAmount ?? Math.max(0, Number(sale.amount || 0) - Number(sale.debtBalance || 0)));

function readPendingPickups(includeDelivered = false) {
  const today = todayKey();
  const payments = readDebtPayments();
  const returns = getReturns() || [];
  const sales = [
    ...readPosSales(SALES_KEY).map((sale) => ({ ...sale, sourceSalesKey: SALES_KEY, sourceLabel: "Asosiy kassa" })),
    ...readPosSales(ADDITIONAL_SALES_KEY).map((sale) => ({ ...sale, sourceSalesKey: ADDITIONAL_SALES_KEY, sourceLabel: "Qo‘shimcha sotuv" })),
  ].map((sale) => withDebtBalance(sale, payments));

  return sales.map((sale) => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const pendingItems = items.flatMap((item, index) => {
      const quantity = quantityOf(item);
      const returnKey = `${sale.id}:${item.id ?? "item"}:${index}`;
      const returnedFromHistory = returns
        .filter((record) => record.status === "approved" && String(record.saleId) === String(sale.id) && record.returnKey === returnKey)
        .reduce((sum, record) => sum + Number(record.quantity || 0), 0);
      const returned = Math.min(quantity, Math.max(Number(item.returnedQuantity || 0), item.returned ? quantity : 0, returnedFromHistory));
      const remaining = Math.max(0, quantity - returned);
      const scheduledDay = dateKey(item.deliveryDate);
      const legacyFutureSchedule = !item.deliveryStatus && scheduledDay && scheduledDay > today;
      if (remaining <= 0 || (item.deliveryStatus !== "waiting" && item.deliveryStatus !== "dispatched" && !legacyFutureSchedule)) return [];
      const originalTotal = Number(item.total ?? Number(item.price || 0) * quantity);
      return [{ ...item, qty: remaining, total: quantity > 0 ? originalTotal * remaining / quantity : 0, originalQty: quantity, returnedQty: returned, saleItemIndex: index }];
    });
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.total ?? Number(item.price || 0) * quantityOf(item)), 0);
    const netRatio = itemsTotal > 0 ? Math.min(1, Number(sale.amount || 0) / itemsTotal) : 1;
    return { ...sale, pendingItems: pendingItems.map((item) => ({ ...item, price: Number(item.price || 0) * netRatio, total: item.total * netRatio })) };
  }).filter((sale) => sale.pendingItems.length > 0 || (includeDelivered && sale.items?.some((item) => item.deliveredAt)))
    .sort((a, b) => {
      const aDate = a.pendingItems.map((item) => dateKey(item.deliveryDate)).filter(Boolean).sort()[0] || "9999-12-31";
      const bDate = b.pendingItems.map((item) => dateKey(item.deliveryDate)).filter(Boolean).sort()[0] || "9999-12-31";
      return aDate.localeCompare(bDate) || String(a.customer || a.customerName || "").localeCompare(String(b.customer || b.customerName || ""), "uz-UZ", { sensitivity: "base" });
    });
}

export default function PendingPickups() {
  useUILanguage();
  const toast = useToast();
  const dataVersion = useDataVersion();
  const [sales, setSales] = useState(readPendingPickups);
  const [query, setQuery] = useState("");
  const [selectedSale, setSelectedSale] = useState(null);
  const [confirmDelivery, setConfirmDelivery] = useState(null);

  useEffect(() => {
    const refresh = () => {
      const next = readPendingPickups();
      setSales(next);
      setSelectedSale((current) => current ? readPendingPickups(true).find((sale) => String(sale.id) === String(current.id) && sale.sourceSalesKey === current.sourceSalesKey) || null : null);
    };
    window.addEventListener("storage", refresh);
    window.addEventListener("crm-sales-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("crm-sales-updated", refresh);
    };
  }, [dataVersion]);

  const normalizedQuery = query.trim().toLocaleLowerCase("uz-UZ");
  const visibleSales = useMemo(() => sales.filter((sale) => {
    if (!normalizedQuery) return true;
    const text = [sale.displayId, sale.id, sale.customer, sale.customerName, sale.customerPhone, sale.deliveryAddress, ...sale.pendingItems.flatMap((item) => [item.name, item.deliveryAddress, item.deliveryDate])].join(" ").toLocaleLowerCase("uz-UZ");
    return text.includes(normalizedQuery);
  }), [sales, normalizedQuery]);
  const dispatchedCount = sales.filter((sale) => sale.pendingItems.some((item) => item.deliveryStatus === "dispatched")).length;
  const pendingQuantity = sales.reduce((sum, sale) => sum + sale.pendingItems.reduce((total, item) => total + quantityOf(item), 0), 0);
  const pendingValue = sales.reduce((sum, sale) => sum + sale.pendingItems.reduce((total, item) => total + Number(item.total || 0), 0), 0);
  const upcomingDate = sales.flatMap((sale) => sale.pendingItems.map((item) => dateKey(item.deliveryDate))).filter(Boolean).sort()[0];

  const markItemDelivered = (sale, item) => {
    try {
      const stored = getSales(sale.sourceSalesKey);
      let found = false;
      const next = (Array.isArray(stored) ? stored : []).map((entry) => {
        if (String(entry.id) !== String(sale.id)) return entry;
        found = true;
        return {
          ...entry,
          items: (entry.items || []).map((line, index) => (item.saleItemIndex === undefined ? sale.pendingItems.some((pending) => pending.saleItemIndex === index) : index === item.saleItemIndex)
            ? { ...line, deliveryStatus: confirmDelivery.status || "delivered", deliveredAt: !confirmDelivery.status ? new Date().toISOString() : line.deliveredAt }
            : line),
        };
      });
      if (!found) throw new Error("Sotuv topilmadi.");
      if (saveSales(next, sale.sourceSalesKey) === false) throw new Error("Ma’lumot saqlanmadi.");
      const refreshed = readPendingPickups();
      setSales(refreshed);
      if (item.saleItemIndex !== undefined) setSelectedSale(readPendingPickups(true).find((entry) => String(entry.id) === String(sale.id) && entry.sourceSalesKey === sale.sourceSalesKey) || null);
      toast.success(confirmDelivery.title || "Mahsulot mijozga topshirildi", `${item.name || "Mahsulot"} · ${quantityOf(item).toLocaleString("uz-UZ")} dona`);
    } catch {
      toast.error("Topshirish holati saqlanmadi", "Qayta urinib ko‘ring.");
    }
  };

  const confirmMarkItemDelivered = () => {
    if (!confirmDelivery) return;
    markItemDelivered(confirmDelivery.sale, confirmDelivery.item);
    setConfirmDelivery(null);
  };

  const exportReceipt = () => {
    if (!selectedSale) return;
    if (!printPendingPickupReceipt(selectedSale)) toast.error("Chek oynasi ochilmadi", "Brauzerda yangi oynalarni ochishga ruxsat bering.");
  };

  const detailStats = selectedSale ? [
    ["Sotuv summasi", formatCurrency(selectedSale.amount)],
    ["Jami to‘langan", formatCurrency(salePaidAmount(selectedSale))],
    ["Qolgan qarz", formatCurrency(selectedSale.debtBalance)],
    ["Kutayotgan mahsulotlar", `${selectedSale.pendingItems.reduce((sum, item) => sum + quantityOf(item), 0).toLocaleString("uz-UZ")} dona`],
  ] : [];

  return (
    <section className="pending-pickups-page">
      <header className="pending-pickups-heading">
        <div><span>{tx("YETKAZIB BERISH")}</span><h1>{tx("Yetkazib berish")}</h1><p>{tx("Olish sanasi belgilangan va hali topshirilmagan mahsulotlar")}</p></div>
      </header>

      <div className="pending-pickups-stats">
        <article><span>{tx("Kutayotgan buyurtmalar")}</span><strong>{sales.length.toLocaleString("uz-UZ")}</strong></article>
        <article><span>{tx("Yetkazib berishda")}</span><strong>{dispatchedCount.toLocaleString("uz-UZ")} {tx("ta buyurtma")}</strong></article>
        <article><span>{tx("Jami kutayotgan dona")}</span><strong>{pendingQuantity.toLocaleString("uz-UZ")} {tx("dona")}</strong></article>
        <article><span>{tx("Kutishdagi tovarlar summasi")}</span><strong>{formatCurrency(pendingValue)}</strong></article>
      </div>

      <div className="pending-pickups-toolbar">
        <label><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("Mijoz, mahsulot yoki sotuv ID sini qidiring...")} /></label>
        <span>{upcomingDate ? `${tx("Eng yaqin olish sanasi")}: ${displayDate(upcomingDate)}` : tx("Hozircha olish sanasi belgilanmagan")}</span>
      </div>

      {visibleSales.length ? <div className="pending-pickups-grid">
        {visibleSales.map((sale) => {
          const nextPickup = sale.pendingItems.map((item) => dateKey(item.deliveryDate)).filter(Boolean).sort()[0];
          const waitingQuantity = sale.pendingItems.reduce((sum, item) => sum + quantityOf(item), 0);
          return <article className="pending-pickup-card" key={`${sale.sourceSalesKey}-${sale.id}`}>
            <div className="pending-pickup-card-head"><span><ClipboardList size={16} />{sale.displayId || sale.receiptNumber || sale.id}</span><b>{tx("Olib ketish kutilmoqda")}</b></div>
            <button type="button" className="pending-pickup-card-main" onClick={() => setSelectedSale(sale)}>
              <span className="pending-pickup-customer"><span><UserRound size={17}/></span><span><b>{sale.customer || sale.customerName || tx("Noma’lum mijoz")}</b><small>{sale.customerPhone || tx("Telefon ko‘rsatilmagan")}</small></span></span>
              <span className="pending-pickup-card-products">{sale.pendingItems.slice(0, 4).map((item, index) => <span key={`${item.saleItemIndex}-${index}`}><b>{item.name || tx("Mahsulot")}{(item.isDefectSale || item.defectId) && <span style={{ color: "var(--danger)", marginInlineStart: 8 }}>{tx("Brak")}</span>}</b><small>{quantityOf(item).toLocaleString("uz-UZ")} {tx("dona")} · {item.deliveryDate ? displayDate(item.deliveryDate) : tx("Sana yo‘q")}</small></span>)}{sale.pendingItems.length > 4 && <small>+ {sale.pendingItems.length - 4} {tx("xil mahsulot")}</small>}</span>
              <span className="pending-pickup-card-meta"><span><CalendarClock size={14}/>{tx("Sotuv sanasi")}: {displayDate(sale.createdAt || sale.date)}</span><span><CalendarClock size={14}/>{tx("Olib ketish / yetkazib berish sanasi")}: {nextPickup ? displayDate(nextPickup) : tx("Sana belgilanmagan")}</span><span><Package size={14}/>{waitingQuantity.toLocaleString("uz-UZ")} {tx("dona kutmoqda")}</span><span><MapPin size={14}/>{sale.pendingItems[0]?.deliveryAddress || sale.deliveryAddress || tx("Manzil ko‘rsatilmagan")}</span></span>
              <span className="pending-pickup-card-money"><span><small>{tx("To‘lov")}: {sale.payment || sale.paymentMethod || "—"}</small><b>{formatCurrency(sale.amount)}</b></span><span><small>{tx("To‘langan")}</small><b>{formatCurrency(salePaidAmount(sale))}</b></span></span>
              </button>
            <div className="pending-pickup-actions">
              <button type="button" onClick={() => setConfirmDelivery({ sale, item: {}, status: "cancelled", title: "Kutish ro‘yxatidan o‘chirish" })}>{tx("O‘chirish")}</button>
              <button type="button" onClick={() => setConfirmDelivery({ sale, item: {}, title: "Mijozga topshirish" })}>{tx("Mijozga topshirish")}</button>
              <button type="button" disabled={sale.pendingItems.every((item) => item.deliveryStatus === "dispatched")} onClick={() => setConfirmDelivery({ sale, item: {}, status: "dispatched", title: "Yetkazib berishga chiqarish" })}>{tx(sale.pendingItems.every((item) => item.deliveryStatus === "dispatched") ? "Yetkazilmoqda" : "Yetkazib berishga chiqarish")}</button>
            </div>
          </article>;
        })}
      </div> : <div className="pending-pickups-empty"><span><Package size={25}/></span><h2>{tx(normalizedQuery ? "Mos buyurtma topilmadi" : "Kutishdagi tovarlar yo‘q")}</h2><p>{tx(normalizedQuery ? "Qidiruv so‘zini o‘zgartirib ko‘ring." : "Kelajakdagi olish sanasi bilan sotilgan va hali topshirilmagan mahsulotlar shu yerda ko‘rinadi.")}</p></div>}

      <Modal open={!!selectedSale} onClose={() => setSelectedSale(null)} title="Kutishdagi buyurtma tafsilotlari" subtitle={selectedSale ? (selectedSale.displayId || selectedSale.id) : ""} icon={CalendarClock} width={850} contentOnly>
        {selectedSale && <div className="pending-pickup-detail">
          <div className="pending-pickup-detail-customer"><div><small>{tx("MIJOZ")}</small><h2>{selectedSale.customer || selectedSale.customerName || tx("Noma’lum mijoz")}</h2><span>{selectedSale.customerPhone || tx("Telefon ko‘rsatilmagan")}</span></div><b>{tx("Olib ketish kutilmoqda")}</b></div>
          <div className="pending-pickup-detail-meta">
            {[
              ["Sotuv ID", selectedSale.displayId || selectedSale.id],
              ["Sotuv sanasi", displayDate(selectedSale.createdAt || selectedSale.date, true)],
              ["To‘lov usuli", selectedSale.payment || selectedSale.paymentMethod || "—"],
              ["Sotgan xodim", selectedSale.employeeName || "—"],
              ["Yetkazish manzili", selectedSale.deliveryAddress || "—"],
              ["Kassa", selectedSale.sourceLabel || "Asosiy kassa"],
            ].map(([label, value]) => <div key={label}><small>{tx(label)}</small><b>{value}</b></div>)}
          </div>
          <div className="pending-pickup-detail-items">
            <div className="pending-pickup-detail-section-title"><h3>{tx("Mahsulotlar")}</h3><span>{uniqueProductCount(selectedSale.pendingItems)} {tx("xil kutayotgan mahsulot")}</span></div>
            {selectedSale.items?.map((item, index) => {
              const pendingItem = selectedSale.pendingItems.find((waiting) => waiting.saleItemIndex === index);
              const quantity = pendingItem ? quantityOf(pendingItem) : quantityOf(item);
              const lineTotal = Number(item.total ?? Number(item.price || 0) * quantityOf(item));
              const displayedPrice = pendingItem?.price ?? item.price;
              return <article className={`pending-pickup-detail-item${pendingItem ? " is-waiting" : " is-delivered"}`} key={`${item.id}-${index}`}>
                <div className="pending-pickup-detail-item-main"><div><b>{item.name || tx("Mahsulot")}{(item.isDefectSale || item.defectId) && <span style={{ color: "var(--danger)", marginInlineStart: 8 }}>{tx("Brak")}</span>}</b><small>{quantity.toLocaleString("uz-UZ")} {tx("dona")} × {formatCurrency(displayedPrice || 0)}</small></div><strong>{formatCurrency(pendingItem ? pendingItem.total : lineTotal)}</strong></div>
                <div className="pending-pickup-detail-item-meta"><span><CalendarClock size={13}/>{item.deliveryDate ? displayDate(item.deliveryDate) : tx("Sana belgilanmagan")}</span><span><MapPin size={13}/>{item.deliveryAddress || selectedSale.deliveryAddress || "—"}</span></div>
                {pendingItem ? <><span className="pending-pickup-not-waiting">{tx("Kutishda")}</span><button type="button" className="pending-pickup-delivered-button" onClick={() => setConfirmDelivery({ sale: selectedSale, item: pendingItem })}><CheckCircle2 size={15}/>{tx("Topshirishni tasdiqlash")}</button></> : item.deliveryStatus === "delivered" ? <span className="pending-pickup-delivered-badge"><CheckCircle2 size={14}/>{tx("Mijozga topshirildi")}</span> : <span className="pending-pickup-not-waiting">{tx("Kutish ro‘yxatiga kirmaydi")}</span>}
              </article>;
            })}
          </div>
          <div className="pending-pickup-detail-stats">{detailStats.map(([label, value], index) => <div className={index === 2 ? "is-debt" : index === 1 ? "is-paid" : ""} key={label}><small>{tx(label)}</small><b>{value}</b></div>)}</div>
          <div className="pending-pickup-export-actions">
            <button type="button" onClick={exportReceipt}><Printer size={16}/>{tx("Chek")}</button>
            <button type="button" onClick={() => downloadPendingPickupPdf(selectedSale)}><FileText size={16}/>{tx("PDF")}</button>
            <button type="button" className="is-primary" onClick={() => downloadPendingPickupExcel(selectedSale)}><Download size={16}/>{tx("Excel")}</button>
          </div>
        </div>}
      </Modal>
      <ConfirmDialog open={!!confirmDelivery} title={confirmDelivery?.title || "Mahsulot mijozga topshirildimi?"} message={confirmDelivery ? `${confirmDelivery.item.name || confirmDelivery.sale.displayId || confirmDelivery.sale.id} · ${(confirmDelivery.item.saleItemIndex === undefined ? confirmDelivery.sale.pendingItems.reduce((sum, item) => sum + quantityOf(item), 0) : quantityOf(confirmDelivery.item))} dona · ${confirmDelivery.sale.customer || confirmDelivery.sale.customerName}` : ""} confirmLabel="Tasdiqlash" onCancel={() => setConfirmDelivery(null)} onConfirm={confirmMarkItemDelivered} />
    </section>
  );
}
