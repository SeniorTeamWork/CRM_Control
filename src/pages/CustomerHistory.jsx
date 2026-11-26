// Mijoz profili: "To'lovlar tarixi" va "Umumiy tarix" bo'limlari, hamda "Umumiy qarzni yopish" oynasi.
// Barcha harakatlar (xarid, qaytarish, har qanday to'lov) bitta ro'yxatda; qatorni bosganda tafsiloti ochiladi.
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, HandCoins, RotateCcw, ShoppingBag, Wallet } from "lucide-react";
import Modal, { Field } from "../components/Modal";
import ReceivingCardSelect from "../components/ReceivingCardSelect";
import { translateText as tx } from "../locales/translateText";
import { formatCurrency, moneyInputValue, toBaseMoney } from "../data/currency";
import { formatCardNumber } from "../data/directorCards";

const money = (value) => formatCurrency(value);
const num = (value) => Math.max(0, Number(value) || 0);
const dateTime = (value) => {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return tx("Sana saqlanmagan");
  return date.toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
};
const saleLabel = (sale) => String(sale?.displayId || sale?.id || "—");
const methodText = (payment) => payment?.receivingCard?.number
  ? `${tx("Karta")} ${formatCardNumber(payment.receivingCard.number)}`
  : payment?.cardLast4 ? `${tx("Karta")} •••• ${payment.cardLast4}` : tx(payment?.method || "Naqd");

/** Mijozning barcha harakatlari, yangisi tepada. */
export function buildCustomerHistory({ sales = [], payments = [], returns = [] }) {
  const events = [];
  const groups = new Map();
  sales.forEach((sale) => {
    const items = Array.isArray(sale.items) ? sale.items : [];
    const quantity = items.reduce((sum, item) => sum + num(item.qty ?? item.quantity), 0);
    events.push({ id: `sale-${sale.id}`, kind: "sale", group: "goods", date: sale.createdAt || sale.date, amount: num(sale.amount), direction: "neutral", title: "Xarid qilindi", subtitle: `${saleLabel(sale)} · ${items.length || num(sale.products)} ${tx("xil")}${quantity ? ` · ${quantity.toLocaleString("uz-UZ")} ${tx("dona")}` : ""}`, sale });
    if (num(sale.initialPaidAmount) > 0) events.push({ id: `sale-pay-${sale.id}`, kind: "sale-payment", group: "payment", date: sale.createdAt || sale.date, amount: num(sale.initialPaidAmount), direction: "in", title: "Xarid paytida to'landi", subtitle: `${saleLabel(sale)} · ${methodText({ receivingCard: sale.receivingCard, cardLast4: sale.cardLast4, method: sale.payment })}`, sale });
  });
  payments.forEach((payment) => {
    const sale = sales.find((item) => String(item.id) === String(payment.saleId)) || null;
    if (!sale || num(payment.amount) <= 0) return;
    if (payment.groupId) {
      const group = groups.get(payment.groupId) || { id: payment.groupId, date: payment.createdAt, amount: 0, parts: [], payment };
      group.amount += num(payment.amount);
      group.parts.push({ sale, payment, amount: num(payment.amount) });
      groups.set(payment.groupId, group);
      return;
    }
    events.push({ id: `pay-${payment.id}`, kind: "debt-payment", group: "payment", date: payment.createdAt, amount: num(payment.amount), direction: "in", title: "Xarid qarzi to'landi", subtitle: `${saleLabel(sale)} · ${methodText(payment)}`, sale, payment });
  });
  groups.forEach((group) => events.push({ id: `general-${group.id}`, kind: "general-payment", group: "payment", date: group.date, amount: group.amount, direction: "in", title: "Umumiy qarz to'landi", subtitle: `${group.parts.length} ${tx("ta xaridga taqsimlandi")} · ${methodText(group.payment)}`, parts: group.parts, payment: group.payment }));
  returns.forEach((record) => {
    const sale = sales.find((item) => String(item.id) === String(record.saleId)) || null;
    const lines = record.lines?.length ? record.lines : [record];
    const quantity = lines.reduce((sum, line) => sum + num(line.quantity), 0);
    events.push({ id: `return-${record.id}`, kind: "return", group: "goods", date: record.date, amount: num(record.amount), direction: "neutral", title: "Tovar qaytarildi", subtitle: `${lines[0]?.product || tx("Mahsulot")}${lines.length > 1 ? ` +${lines.length - 1}` : ""} · ${quantity.toLocaleString("uz-UZ")} ${tx("dona")}`, record, sale });
    if (num(record.amount) > 0) events.push({ id: `return-money-${record.id}`, kind: "return-money", group: "payment", date: record.date, amount: num(record.amount), direction: "out", title: "Qaytarilgan tovar summasi ayirildi", subtitle: lines[0]?.product || "", record, sale });
  });
  return events.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

const KIND = {
  sale: { icon: ShoppingBag, color: "var(--brand)", bg: "var(--brand-light)" },
  return: { icon: RotateCcw, color: "var(--warning)", bg: "var(--warning-light, #fff6e5)" },
  "sale-payment": { icon: ArrowDownLeft, color: "var(--success)", bg: "var(--success-light)" },
  "debt-payment": { icon: HandCoins, color: "var(--success)", bg: "var(--success-light)" },
  "general-payment": { icon: Wallet, color: "var(--success)", bg: "var(--success-light)" },
  "return-money": { icon: ArrowUpRight, color: "var(--danger)", bg: "var(--danger-light)" },
};
const sign = (event) => event.direction === "in" ? "+" : event.direction === "out" ? "−" : "";
const tone = (event) => event.direction === "in" ? "var(--success)" : event.direction === "out" ? "var(--danger)" : "var(--text-primary)";
const FILTERS = {
  payments: [["all", "Hammasi"], ["in", "Mijoz to'ladi"], ["out", "Qaytarilganlar"]],
  all: [["all", "Hammasi"], ["sale", "Xaridlar"], ["return", "Qaytarildi"], ["payment", "To'lovlar"]],
};

export function CustomerHistoryTab({ mode, events, allPayments = [], onOpenSale }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const base = mode === "payments" ? events.filter((event) => event.group === "payment") : events;
  const terms = query.trim().toLocaleLowerCase("uz-UZ");
  const shown = base.filter((event) => {
    if (filter === "in" || filter === "out") { if (event.direction !== filter) return false; }
    else if (filter === "payment") { if (event.group !== "payment") return false; }
    else if (filter !== "all" && event.kind !== filter) return false;
    return !terms || [tx(event.title), event.subtitle, event.sale?.id, event.sale?.displayId].some((value) => String(value || "").toLocaleLowerCase("uz-UZ").includes(terms));
  });
  const sum = (predicate) => base.filter(predicate).reduce((total, event) => total + event.amount, 0);
  const cards = mode === "payments"
    ? [["Mijoz to'lagan", money(sum((event) => event.direction === "in")), "var(--success)", "var(--success-light)"], ["Qarz to'lovlari", money(sum((event) => event.kind === "debt-payment" || event.kind === "general-payment")), "var(--brand)", "var(--brand-light)"], ["Qaytarilgan summa", money(sum((event) => event.direction === "out")), "var(--danger)", "var(--danger-light)"]]
    : [["Harakatlar soni", base.length.toLocaleString("uz-UZ"), "var(--brand)", "var(--brand-light)"], ["Xaridlar", money(sum((event) => event.kind === "sale")), "var(--text-primary)", "var(--surface-2)"], ["Qaytarilgan tovarlar", money(sum((event) => event.kind === "return")), "var(--warning)", "var(--surface-2)"]];

  return <div className="p-5 space-y-4">
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>{cards.map(([label, value, color, bg]) => <div key={label} className="rounded-xl p-4" style={{ background: bg, color }}><small>{tx(label)}</small><b className="block text-lg mt-1" style={{ overflowWrap: "anywhere" }}>{value}</b></div>)}</div>
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS[mode].map(([id, label]) => <button key={id} type="button" className="btn-ghost text-xs" onClick={() => setFilter(id)} style={{ borderColor: filter === id ? "var(--brand)" : undefined, color: filter === id ? "var(--brand)" : undefined, background: filter === id ? "var(--brand-light)" : undefined }}>{tx(label)}</button>)}
      <input className="input-base" style={{ flex: "1 1 180px", minWidth: 0 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tx("Qidirish: xarid, mahsulot...")}/>
    </div>
    <div className="space-y-2">
      {shown.map((event) => { const style = KIND[event.kind] || KIND.sale, Icon = style.icon; return <button key={event.id} type="button" onClick={() => setSelected(event)} className="w-full flex items-center gap-3 p-3 rounded-xl text-left" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", cursor: "pointer" }}>
        <span className="shrink-0 flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: style.bg, color: style.color }}><Icon size={18}/></span>
        <span className="min-w-0 flex-1"><b className="block text-sm">{tx(event.title)}</b><small className="block mt-0.5" style={{ color: "var(--text-muted)", overflowWrap: "anywhere" }}>{dateTime(event.date)}{event.subtitle ? ` · ${event.subtitle}` : ""}</small></span>
        <b className="shrink-0 text-sm text-right" style={{ color: tone(event) }}>{sign(event)}{money(event.amount)}</b>
      </button>; })}
      {!shown.length && <p className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>{tx("Tarix hali mavjud emas")}</p>}
    </div>
    <HistoryDetail event={selected} allPayments={allPayments} close={() => setSelected(null)} openSale={(sale) => { setSelected(null); onOpenSale?.(sale); }}/>
  </div>;
}

function Rows({ rows }) {
  return <dl className="text-sm">{rows.filter(Boolean).map(([name, value, color]) => <div key={name} className="flex justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}><dt style={{ color: "var(--text-muted)" }}>{tx(name)}</dt><dd style={{ margin: 0, fontWeight: 600, textAlign: "right", overflowWrap: "anywhere", color }}>{value}</dd></div>)}</dl>;
}

function SalePayments({ sale, allPayments, highlightId }) {
  if (!sale) return null;
  const list = [
    ...(num(sale.initialPaidAmount) > 0 ? [{ id: `initial-${sale.id}`, amount: num(sale.initialPaidAmount), createdAt: sale.createdAt || sale.date, label: "Xarid paytida", receivingCard: sale.receivingCard, cardLast4: sale.cardLast4, method: sale.payment }] : []),
    ...allPayments.filter((payment) => String(payment.saleId) === String(sale.id) && num(payment.amount) > 0).map((payment) => ({ ...payment, label: payment.groupId ? "Umumiy qarz to'lovi" : "Qarz to'lovi" })),
  ].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  if (!list.length) return null;
  return <section><h4 className="font-semibold text-sm mb-2">{tx("Shu xarid bo'yicha barcha to'lovlar")}</h4><div className="space-y-1">{list.map((payment) => <div key={payment.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: payment.id === highlightId ? "var(--success-light)" : "var(--surface-2)" }}><span>{dateTime(payment.createdAt)} · {tx(payment.label)} · {methodText(payment)}</span><b>{money(payment.amount)}</b></div>)}</div></section>;
}

function HistoryDetail({ event, allPayments, close, openSale }) {
  if (!event) return null;
  const { sale, record, payment } = event;
  let body;
  if (event.kind === "sale") {
    const items = Array.isArray(sale.items) ? sale.items : [];
    body = <>
      <Rows rows={[["Xarid", saleLabel(sale)], ["Sana", dateTime(sale.createdAt || sale.date)], ["Jami summa", money(sale.amount)], ["To'langan", money(sale.paidAmount), "var(--success)"], ["Qolgan qarz", money(sale.debtBalance), num(sale.debtBalance) > 0 ? "var(--danger)" : undefined], sale.debtDueDate && num(sale.debtBalance) > 0 && ["Qarz muddati", String(sale.debtDueDate)]]}/>
      {items.length > 0 && <section><h4 className="font-semibold text-sm mb-2">{tx("Olingan tovarlar")}</h4><div className="space-y-1">{items.map((item, index) => <div key={`${item.id}-${index}`} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span style={{ overflowWrap: "anywhere" }}>{index + 1}. <b>{item.name}</b> · {num(item.qty ?? item.quantity).toLocaleString("uz-UZ")} {tx("dona")} × {money(item.price)}</span><b>{money(item.total ?? num(item.qty) * num(item.price))}</b></div>)}</div></section>}
      <SalePayments sale={sale} allPayments={allPayments}/>
    </>;
  } else if (event.kind === "general-payment") {
    body = <>
      <Rows rows={[["Sana", dateTime(event.date)], ["Jami to'langan", money(event.amount), "var(--success)"], ["To'lov usuli", methodText(payment)]]}/>
      <section><h4 className="font-semibold text-sm mb-2">{tx("Qaysi xaridlarga taqsimlandi")}</h4><div className="space-y-1">{event.parts.map((part) => <div key={part.payment.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><button type="button" style={{ color: "var(--brand)", textAlign: "left" }} onClick={() => openSale(part.sale)}>{saleLabel(part.sale)} · {dateTime(part.sale.createdAt || part.sale.date)} →</button><b>{money(part.amount)}</b></div>)}</div></section>
    </>;
  } else if (record) {
    const lines = record.lines?.length ? record.lines : [record];
    body = <>
      <Rows rows={[["Qaytarilgan sana", dateTime(record.date)], ["Xarid", sale ? saleLabel(sale) : String(record.saleId || "—")], ["Qaytarish sababi", tx(record.reason || "—")], ["Qaytarilgan tovar summasi", money(record.amount), "var(--danger)"]]}/>
      <section><h4 className="font-semibold text-sm mb-2">{tx("Qaytarilgan tovarlar")}</h4><div className="space-y-1">{lines.map((line, index) => <div key={line.id || index} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span>{index + 1}. <b>{line.product || tx("Mahsulot")}</b> · {num(line.quantity).toLocaleString("uz-UZ")} {tx("dona")}</span><b>{money(line.amount)}</b></div>)}</div></section>
    </>;
  } else {
    body = <>
      <Rows rows={[["Sana", dateTime(payment?.createdAt || event.date)], ["To'langan summa", money(event.amount), "var(--success)"], ["To'lov usuli", methodText(payment || { receivingCard: sale?.receivingCard, cardLast4: sale?.cardLast4, method: sale?.payment })], ["Xarid", saleLabel(sale)], ["Xarid summasi", money(sale?.amount)], ["Qolgan qarz", money(sale?.debtBalance), num(sale?.debtBalance) > 0 ? "var(--danger)" : undefined]]}/>
      <SalePayments sale={sale} allPayments={allPayments} highlightId={payment?.id}/>
    </>;
  }
  const Icon = (KIND[event.kind] || KIND.sale).icon;
  return <Modal contentOnly open onClose={close} title={tx(event.title)} subtitle={dateTime(event.date)} icon={Icon} width={620}>
    <div className="space-y-4">
      {body}
      <div className="flex flex-wrap justify-end gap-2">
        {sale && <button type="button" className="btn-primary" onClick={() => openSale(sale)}>{tx("Xarid tafsilotlari")}</button>}
        <button type="button" className="btn-ghost" onClick={close}>{tx("Yopish")}</button>
      </div>
    </div>
  </Modal>;
}

/** "Umumiy qarzni yopish": summa (avtomatik to'liq qarz, qo'lda o'zgartirsa bo'ladi) → "To'lov qilinsinmi?" → to'lov. */
export function CustomerGeneralPayModal({ open, close, customerName, debtSales, totalDebt, onPay }) {
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState("cash");
  const [cardId, setCardId] = useState("");
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openedFor, setOpenedFor] = useState(false);
  if (open && !openedFor) { setOpenedFor(true); setAmountInput(String(totalDebt)); setAsk(false); setMethod("cash"); setCardId(""); }
  if (!open && openedFor) setOpenedFor(false);
  const payValue = Math.min(totalDebt, num(amountInput));
  const after = Math.max(0, totalDebt - payValue);
  let rest = payValue;
  const plan = [...debtSales].sort((a, b) => new Date(a.createdAt || a.date || 0) - new Date(b.createdAt || b.date || 0)).map((sale) => { const part = Math.min(rest, num(sale.debtBalance)); rest -= part; return { sale, part }; }).filter((row) => row.part > 0);
  const confirm = async () => { setBusy(true); try { if (await onPay({ amount: payValue, method, cardId })) close(); } finally { setBusy(false); setAsk(false); } };
  return <>
    <Modal contentOnly open={open && !ask} onClose={close} title="Umumiy qarzni yopish" subtitle={customerName} icon={HandCoins} width={560}>
      <div className="space-y-4">
        <div className="rounded-xl p-4" style={{ background: "var(--danger-light)", color: "var(--danger)" }}><small>{tx("Mijozning umumiy qarzi")}</small><b className="block text-xl mt-1">{money(totalDebt)}</b></div>
        <Field label={tx("To'lanadigan summa")}><div className="flex gap-2"><div className="relative" style={{ flex: 1 }}><input autoFocus className="input-base pr-14" inputMode="numeric" value={amountInput === "" ? "" : moneyInputValue(amountInput, true)} onChange={(event) => { const raw = event.target.value.replace(/\D/g, ""); setAmountInput(raw ? String(Math.min(totalDebt, toBaseMoney(raw))) : ""); }} placeholder="0"/><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: "var(--text-muted)" }}>{tx("so'm")}</span></div><button type="button" className="btn-ghost" onClick={() => setAmountInput(String(totalDebt))}>{tx("Hammasi")}</button></div></Field>
        <Field label={tx("To'lov usuli")}><div className="grid grid-cols-2 gap-2">{[["cash", "Naqd"], ["card", "Karta"]].map(([id, label]) => <button key={id} type="button" className="btn-ghost justify-center" onClick={() => setMethod(id)} style={{ borderColor: method === id ? "var(--brand)" : undefined, color: method === id ? "var(--brand)" : undefined, background: method === id ? "var(--brand-light)" : undefined }}>{tx(label)}</button>)}</div></Field>
        {method === "card" && <ReceivingCardSelect value={cardId} onChange={setCardId}/>}
        <div className="p-4 rounded-xl" style={{ background: after > 0 ? "var(--danger-light)" : "var(--success-light)", color: after > 0 ? "var(--danger)" : "var(--success)" }}><p className="text-sm">{tx("To'lovdan keyin qoladigan qarz")}</p><strong className="block text-xl">{money(after)}</strong></div>
        {plan.length > 0 && <section><h4 className="font-semibold text-sm mb-2">{tx("To'lov qaysi xaridlarga tushadi (eng eskisidan boshlab)")}</h4><div className="space-y-1 max-h-48 overflow-y-auto">{plan.map((row) => <div key={row.sale.id} className="flex justify-between gap-3 p-2 rounded-lg text-xs" style={{ background: "var(--surface-2)" }}><span>{saleLabel(row.sale)} · {dateTime(row.sale.createdAt || row.sale.date)}</span><b>{money(row.part)}{row.part < num(row.sale.debtBalance) ? ` / ${money(row.sale.debtBalance)}` : ""}</b></div>)}</div></section>}
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={close}>{tx("Bekor qilish")}</button><button type="button" className="btn-primary" disabled={payValue <= 0} onClick={() => setAsk(true)}><HandCoins size={15}/>{tx("To'lov qilish")}</button></div>
      </div>
    </Modal>
    <Modal contentOnly open={open && ask} onClose={() => setAsk(false)} title="To'lov qilinsinmi?" subtitle={customerName} icon={HandCoins} width={420}>
      <div className="space-y-4">
        <div className="space-y-2 text-sm">{[["To'lanadigan summa", money(payValue)], ["Hozirgi umumiy qarz", money(totalDebt)], ["To'lovdan keyin qoladigan qarz", money(after)], ["To'lov usuli", tx(method === "card" ? "Karta" : "Naqd")]].map(([name, value]) => <div key={name} className="flex justify-between gap-3"><span style={{ color: "var(--text-muted)" }}>{tx(name)}</span><strong>{value}</strong></div>)}</div>
        <p className="text-sm">{tx("Ushbu to'lovni amalga oshirishni tasdiqlaysizmi?")}</p>
        <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" disabled={busy} onClick={() => setAsk(false)}>{tx("Yo'q, orqaga")}</button><button type="button" className="btn-primary" disabled={busy} onClick={confirm}>{tx("Ha, to'lov qilinsin")}</button></div>
      </div>
    </Modal>
  </>;
}
