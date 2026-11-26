// Ta'minotchi profili: "To'lovlar tarixi" va "Umumiy tarix" bo'limlari.
// Barcha harakatlar (tovar olish, qaytarish, har qanday to'lov) bitta ro'yxatga yig'iladi;
// istalgan qatorni bosganda o'sha amalning to'liq tafsiloti ochiladi.
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Package, RotateCcw, Wallet } from "lucide-react";
import Modal from "../components/Modal";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency } from "../data/currency";
import { returnReceivable } from "../data/supplierReturns";

const money = (value) => formatCurrency(value);
const num = (value) => Math.max(0, Number(value) || 0);
const dateTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return tx("Sana saqlanmagan");
  return new Date(value).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const orderLabel = (id) => String(id || "—").startsWith("PO-LEGACY-") ? tx("Eski qabul yozuvi") : String(id || "—");
const unitOf = (line) => line?.measurementUnit || line?.product?.measurementUnit || "dona";

const refundPaymentsOf = (record) => {
  if (Array.isArray(record.refundPayments)) return record.refundPayments;
  return num(record.refundedAmount) > 0 ? [{ id: `REFUND-INITIAL-${record.id}`, amount: num(record.refundedAmount), method: "Naqd", date: record.returnedAt, kind: "initial" }] : [];
};

/** Ta'minotchi bo'yicha barcha harakatlarni vaqt bo'yicha (yangisi tepada) qaytaradi. */
export function buildSupplierHistory({ orders = [], returns = [], supplier, paymentHistory, items }) {
  const events = [];
  const generalGroups = new Map();
  const addGeneralPart = (payment, part) => {
    const group = generalGroups.get(payment.groupId) || { id: payment.groupId, date: payment.date, amount: 0, parts: [] };
    group.amount += num(payment.amount);
    group.parts.push(part);
    generalGroups.set(payment.groupId, group);
  };

  orders.forEach((order) => {
    const lines = items(order);
    events.push({
      id: `receipt-${order.id}`, kind: "receipt", group: "goods", date: order.date, amount: num(order.amount), direction: "neutral",
      title: "Tovar qabul qilindi", subtitle: `${orderLabel(order.id)} · ${lines.length} ${tx("xil")} · ${num(order.items).toLocaleString("uz-UZ")} ${tx(unitOf(lines[0]))}`, order,
    });
    paymentHistory(order).filter((payment) => num(payment.amount) > 0).forEach((payment) => {
      if (payment.kind === "general" && payment.groupId) { addGeneralPart(payment, { order, payment, amount: num(payment.amount) }); return; }
      const atPurchase = payment.kind === "initial";
      events.push({
        id: `pay-${order.id}-${payment.id}`, kind: atPurchase ? "purchase-payment" : "order-payment", group: "payment", date: payment.date, amount: num(payment.amount), direction: "out",
        title: atPurchase ? "Tovar olishda to'landi" : "Buyurtma qarzi to'landi", subtitle: `${orderLabel(order.id)} · ${tx(payment.method || "Naqd")}`, order, payment,
      });
    });
  });

  (Array.isArray(supplier?.legacyPayments) ? supplier.legacyPayments : []).forEach((payment) => {
    if (payment.groupId) addGeneralPart(payment, { legacy: true, payment, amount: num(payment.amount) });
    else events.push({ id: `legacy-${payment.id}`, kind: "general-payment", group: "payment", date: payment.date, amount: num(payment.amount), direction: "out", title: "Umumiy qarz to'landi", subtitle: tx("Eski qarz"), parts: [{ legacy: true, payment, amount: num(payment.amount) }] });
  });
  generalGroups.forEach((group) => events.push({
    id: `general-${group.id}`, kind: "general-payment", group: "payment", date: group.date, amount: group.amount, direction: "out",
    title: "Umumiy qarz to'landi", subtitle: `${group.parts.length} ${tx("ta qarzga taqsimlandi")}`, parts: group.parts,
  }));

  returns.forEach((record) => {
    const order = orders.find((item) => String(item.id) === String(record.orderId)) || null;
    const quantity = record.version === 2 ? num(record.goodQuantity) + num(record.defectiveQuantity) : num(record.items);
    events.push({
      id: `return-${record.id}`, kind: "return", group: "goods", date: record.returnedAt, amount: num(record.amount), direction: "neutral",
      title: "Tovar qaytarildi", subtitle: `${record.productName || tx("Mahsulot")} · ${quantity.toLocaleString("uz-UZ")} ${tx(record.measurementUnit || "dona")}`, record, order,
    });
    if (num(record.debtOffset) > 0) events.push({
      id: `offset-${record.id}`, kind: "return-offset", group: "payment", date: record.returnedAt, amount: num(record.debtOffset), direction: "in",
      title: "Qaytarilgan tovar qarzdan ayirildi", subtitle: record.productName || "", record, order,
    });
    refundPaymentsOf(record).filter((payment) => num(payment.amount) > 0).forEach((payment) => events.push({
      id: `refund-${record.id}-${payment.id}`, kind: "refund", group: "payment", date: payment.date || record.returnedAt, amount: num(payment.amount), direction: "in",
      title: payment.kind === "initial" ? "Ta'minotchi qaytarishda pul berdi" : "Ta'minotchi bizga qarzini to'ladi", subtitle: `${record.productName || ""} · ${tx(payment.method || "Naqd")}`, record, order, payment,
    }));
  });

  return events.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

const KIND_STYLE = {
  receipt: { icon: Package, color: "var(--brand)", bg: "var(--brand-light)" },
  return: { icon: RotateCcw, color: "var(--warning)", bg: "var(--warning-light, #fff6e5)" },
  "purchase-payment": { icon: ArrowUpRight, color: "var(--danger)", bg: "var(--danger-light)" },
  "order-payment": { icon: HandCoins, color: "var(--danger)", bg: "var(--danger-light)" },
  "general-payment": { icon: Wallet, color: "var(--danger)", bg: "var(--danger-light)" },
  "return-offset": { icon: RotateCcw, color: "var(--success)", bg: "var(--success-light)" },
  refund: { icon: ArrowDownLeft, color: "var(--success)", bg: "var(--success-light)" },
};
const amountPrefix = (event) => event.direction === "out" ? "−" : event.direction === "in" ? "+" : "";
const amountColor = (event) => event.direction === "out" ? "var(--danger)" : event.direction === "in" ? "var(--success)" : "var(--text-primary)";

const FILTERS = {
  payments: [["all", "Hammasi"], ["out", "Biz to'ladik"], ["in", "Bizga qaytdi"]],
  all: [["all", "Hammasi"], ["receipt", "Tovar olindi"], ["return", "Qaytarildi"], ["payment", "To'lovlar"]],
};

export function SupplierHistoryTab({ mode, events, openOrder, downloadPaymentReceipt }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const base = mode === "payments" ? events.filter((event) => event.group === "payment") : events;
  const shown = base.filter((event) => {
    if (filter === "out" || filter === "in") { if (event.direction !== filter) return false; }
    else if (filter === "payment") { if (event.group !== "payment") return false; }
    else if (filter !== "all" && event.kind !== filter) return false;
    const terms = query.trim().toLocaleLowerCase("uz-UZ");
    return !terms || [tx(event.title), event.subtitle, event.order?.id, event.record?.productName].some((value) => String(value || "").toLocaleLowerCase("uz-UZ").includes(terms));
  });
  const paidOut = base.filter((event) => event.direction === "out").reduce((sum, event) => sum + event.amount, 0);
  const cameIn = base.filter((event) => event.kind === "refund").reduce((sum, event) => sum + event.amount, 0);
  const offset = base.filter((event) => event.kind === "return-offset").reduce((sum, event) => sum + event.amount, 0);
  const received = base.filter((event) => event.kind === "receipt").reduce((sum, event) => sum + event.amount, 0);
  const returned = base.filter((event) => event.kind === "return").reduce((sum, event) => sum + event.amount, 0);
  const cards = mode === "payments"
    ? [["Biz to'ladik", money(paidOut), "var(--danger)", "var(--danger-light)"], ["Ta'minotchi qaytardi", money(cameIn), "var(--success)", "var(--success-light)"], ["Qaytarish hisobidan qarzdan ayirildi", money(offset), "var(--brand)", "var(--brand-light)"]]
    : [["Harakatlar soni", base.length.toLocaleString("uz-UZ"), "var(--brand)", "var(--brand-light)"], ["Olingan tovarlar", money(received), "var(--text-primary)", "var(--surface-2)"], ["Qaytarilgan tovarlar", money(returned), "var(--warning)", "var(--surface-2)"]];

  return <div className="p-5 space-y-4">
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>{cards.map(([label, value, color, bg]) => <div key={label} className="rounded-xl p-4" style={{ background: bg, color }}><small>{tx(label)}</small><b className="block text-lg mt-1" style={{ overflowWrap: "anywhere" }}>{value}</b></div>)}</div>
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS[mode].map(([id, label]) => <button key={id} type="button" className="btn-ghost text-xs" onClick={() => setFilter(id)} style={{ borderColor: filter === id ? "var(--brand)" : undefined, color: filter === id ? "var(--brand)" : undefined, background: filter === id ? "var(--brand-light)" : undefined }}>{tx(label)}</button>)}
      <input className="input-base" style={{ flex: "1 1 180px", minWidth: 0 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("Qidirish: buyurtma, mahsulot...")}/>
    </div>
    <div className="space-y-2">
      {shown.map((event) => {
        const style = KIND_STYLE[event.kind] || KIND_STYLE.receipt, Icon = style.icon;
        return <button key={event.id} type="button" onClick={() => setSelected(event)} className="w-full flex items-center gap-3 p-3 rounded-xl text-left" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}>
          <span className="shrink-0 flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: style.bg, color: style.color }}><Icon size={18}/></span>
          <span className="min-w-0 flex-1"><b className="block text-sm">{tx(event.title)}</b><small className="block mt-0.5" style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{dateTime(event.date)}{event.subtitle ? ` · ${event.subtitle}` : ""}</small></span>
          <b className="shrink-0 text-sm text-right" style={{ color: amountColor(event) }}>{amountPrefix(event)}{money(event.amount)}</b>
        </button>;
      })}
      {!shown.length && <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>{tx("Tarix hali mavjud emas")}</p>}
    </div>
    <HistoryDetailModal event={selected} close={() => setSelected(null)} openOrder={(order) => { setSelected(null); openOrder(order); }} downloadPaymentReceipt={downloadPaymentReceipt}/>
  </div>;
}

function Rows({ rows }) {
  return <dl className="text-sm">{rows.filter(Boolean).map(([name, value, color]) => <div key={name} className="flex justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}><dt style={{ color: "var(--text-muted)" }}>{tx(name)}</dt><dd style={{ margin: 0, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", color }}>{typeof value === "string" ? tx(value) : value}</dd></div>)}</dl>;
}

function OrderPayments({ order }) {
  const history = Array.isArray(order?.paymentHistory) ? order.paymentHistory.filter((payment) => num(payment.amount) > 0) : [];
  if (!history.length) return null;
  const names = { initial: "Tovar olishda", debt: "Qarz to'lovi", general: "Umumiy qarz to'lovi" };
  return <section><h4 className="font-semibold text-sm mb-2">{tx("Shu buyurtma bo'yicha barcha to'lovlar")}</h4><div className="space-y-1">{history.map((payment) => <div key={payment.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span>{dateTime(payment.date)} · {tx(names[payment.kind] || "To'lov")}</span><b>{money(payment.amount)}</b></div>)}</div></section>;
}

function HistoryDetailModal({ event, close, openOrder, downloadPaymentReceipt }) {
  if (!event) return null;
  const { order, record, payment } = event;
  let body;
  if (event.kind === "receipt") {
    const lines = order?.productDetails || order?.products || [];
    const paidAtPurchase = (order?.paymentHistory || []).filter((item) => item.kind === "initial").reduce((sum, item) => sum + num(item.amount), 0);
    body = <>
      <Rows rows={[["Qabul ID", orderLabel(order?.id)], ["Sana", dateTime(order?.date)], ["Jami summa", money(order?.amount)], ["Qabulda to'langan", money(paidAtPurchase)], ["Qarzga yozilgan", money(Math.max(0, num(order?.amount) - paidAtPurchase))]]}/>
      {lines.length > 0 && <section><h4 className="font-semibold text-sm mb-2">{tx("Olingan tovarlar")}</h4><div className="space-y-1">{lines.map((line, index) => <div key={`${line.id}-${index}`} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span style={{ overflowWrap: "anywhere" }}>{index + 1}. <b>{line.name}</b> · {num(line.quantity).toLocaleString("uz-UZ")} {tx(unitOf(line))} × {money(line.cost)}</span><b>{money(num(line.quantity) * num(line.cost))}</b></div>)}</div></section>}
      <OrderPayments order={order}/>
    </>;
  } else if (event.kind === "general-payment") {
    body = <>
      <Rows rows={[["Sana", dateTime(event.date)], ["Jami to'langan", money(event.amount), "var(--danger)"], ["To'lov usuli", "Naqd"]]}/>
      <section><h4 className="font-semibold text-sm mb-2">{tx("Qaysi qarzlarga taqsimlandi")}</h4><div className="space-y-1">{event.parts.map((part, index) => <div key={index} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}>{part.legacy ? <span>{tx("Buyurtmaga biriktirilmagan eski qarz")}</span> : <button type="button" style={{ color: "var(--brand)", textAlign: "left" }} onClick={() => openOrder(part.order)}>{orderLabel(part.order.id)} · {dateTime(part.order.date)} →</button>}<b>{money(part.amount)}</b></div>)}</div></section>
    </>;
  } else if (record) {
    const refunds = refundPaymentsOf(record).filter((item) => num(item.amount) > 0);
    body = <>
      <Rows rows={[
        ["Mahsulot", record.productName || "—"],
        ["Qaytarilgan sana", dateTime(record.returnedAt)],
        record.version === 2 ? ["Yaroqli miqdor", `${num(record.goodQuantity)} ${record.measurementUnit || "dona"}`] : ["Miqdor", `${num(record.items)} ${record.measurementUnit || "dona"}`],
        record.version === 2 && ["Brak miqdori", `${num(record.defectiveQuantity)} ${record.measurementUnit || "dona"}`],
        ["Qaytarish sababi", record.reason || "—"],
        ["Qaytarilgan tovar summasi", money(record.amount)],
        ["Bizning qarzimizdan ayirildi", money(record.debtOffset), "var(--brand)"],
        record.version === 2 && ["Ta'minotchi qaytarishi kerak edi", money(record.refundDue)],
        record.version === 2 && ["Ta'minotchi qaytargan", money(record.refundedAmount), "var(--success)"],
        record.version === 2 && ["Ta'minotchining bizga qolgan qarzi", money(returnReceivable(record)), returnReceivable(record) > 0 ? "var(--danger)" : undefined],
        ["Buyurtma", orderLabel(record.orderId)],
      ]}/>
      {refunds.length > 0 && <section><h4 className="font-semibold text-sm mb-2">{tx("Ta'minotchidan qaytgan pullar")}</h4><div className="space-y-1">{refunds.map((item) => <div key={item.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: item.id === payment?.id ? "var(--success-light)" : "var(--surface-2)" }}><span>{dateTime(item.date)} · {tx(item.kind === "initial" ? "Qaytarish paytida" : "Keyin to'ladi")}</span><b style={{ color: "var(--success)" }}>+{money(item.amount)}</b></div>)}</div></section>}
    </>;
  } else {
    const before = (order?.paymentHistory || []).filter((item) => new Date(item.date || 0) <= new Date(payment?.date || 0)).reduce((sum, item) => sum + num(item.amount), 0);
    body = <>
      <Rows rows={[["To'lov ID", payment?.id || "—"], ["Sana", dateTime(payment?.date)], ["To'langan summa", money(payment?.amount), "var(--danger)"], ["To'lov usuli", payment?.method || "Naqd"], ["Buyurtma", orderLabel(order?.id)], ["Buyurtma summasi", money(order?.amount)], ["Shu to'lovgacha jami to'langan", money(before)]]}/>
      <OrderPayments order={order}/>
    </>;
  }
  return <Modal contentOnly open={Boolean(event)} onClose={close} title={tx(event.title)} subtitle={dateTime(event.date)} icon={(KIND_STYLE[event.kind] || KIND_STYLE.receipt).icon} width={620}>
    <div className="space-y-4">
      {body}
      <div className="flex flex-wrap justify-end gap-2">
        {payment && order && event.group === "payment" && !record && downloadPaymentReceipt && <button type="button" className="btn-ghost" onClick={() => downloadPaymentReceipt(order, payment)}>{tx("To'lov cheki")}</button>}
        {order && <button type="button" className="btn-primary" onClick={() => openOrder(order)}>{tx("Buyurtma tafsilotlari")}</button>}
        <button type="button" className="btn-ghost" onClick={close}>{tx("Yopish")}</button>
      </div>
    </div>
  </Modal>;
}
